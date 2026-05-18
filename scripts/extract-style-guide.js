// One-time style extraction: reads styles/pages/*.png and styles/banners/*.{jpg,png}
// (resizing huge files), sends them to Claude vision, asks for a structured JSON
// style guide we can inject into prompts for banner + reel generation. Output:
// styles/style-guide.json.
//
// Run with: npm run extract:styles
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { logUsage } from "../lib/usage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PAGES_DIR = path.join(ROOT, "styles/pages");
const BANNERS_DIR = path.join(ROOT, "styles/banners");
const OUT_PATH = path.join(ROOT, "styles/style-guide.json");

const MAX_INPUT_BYTES = 4.5 * 1024 * 1024; // Claude vision: 5MB cap per image (base64)

const SYSTEM = `You are a senior brand designer analyzing visual references from IE
Business School (Madrid). Inputs include a full-page screencap of the official
site and a few sample banners. Extract a concrete, machine-usable design
guide. Output STRICT JSON only — no prose, no fences.

Schema (every key required):
{
  "primary_colors":      [{"name": "...", "hex": "#RRGGBB", "role": "..."}, ...],
  "accent_colors":       [{"name": "...", "hex": "#RRGGBB", "role": "..."}, ...],
  "typography": {
    "headline":          {"description": "...", "weight": "...", "case": "...", "tracking": "..."},
    "body":              {"description": "...", "weight": "..."},
    "cta":               {"description": "...", "weight": "..."}
  },
  "layout_patterns":     ["...short pattern observed...", ...],
  "photographic_style":  "...one sentence about portraiture, color grading, lighting...",
  "logo_treatment":      "...one sentence about typical placement, size, clear space...",
  "mood":                ["...3–6 single adjectives describing brand feel..."],
  "things_to_avoid":     ["..."]
}

Rules:
- Use REAL hex values you can perceive in the references. Be conservative —
  prefer the dominant 2–4 colors rather than every shade.
- "tracking" values like "tight" / "normal" / "wide" are fine.
- "case" values like "Sentence", "Title", "ALL CAPS" are fine.
- No commentary, no markdown, JSON only.`;

async function loadResized(file) {
  const stat = await fs.stat(file);
  let buf = await fs.readFile(file);
  // Always pass through sharp to ensure we control output mime + size.
  buf = await sharp(buf, { failOn: "none" })
    .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  if (buf.length > MAX_INPUT_BYTES) {
    // Re-encode smaller if still too big.
    buf = await sharp(buf).resize({ width: 900 }).jpeg({ quality: 70 }).toBuffer();
  }
  return { data: buf.toString("base64"), media_type: "image/jpeg", name: path.basename(file), original_bytes: stat.size };
}

async function listImages(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((n) => !n.startsWith(".") && /\.(png|jpe?g|webp)$/i.test(n))
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY in .env");
    process.exit(1);
  }

  const pageFiles = await listImages(PAGES_DIR);
  const bannerFiles = await listImages(BANNERS_DIR);
  const all = [...pageFiles, ...bannerFiles];
  if (!all.length) {
    console.error("No reference images found in styles/pages or styles/banners");
    process.exit(1);
  }

  console.log(`Analyzing ${all.length} reference image(s)…`);
  const blocks = [];
  for (const f of all) {
    process.stdout.write(`  • ${path.relative(ROOT, f)} `);
    const { data, media_type, name, original_bytes } = await loadResized(f);
    const kb = (original_bytes / 1024).toFixed(0);
    const sentKb = ((data.length * 0.75) / 1024).toFixed(0);
    console.log(`(${kb}KB → ${sentKb}KB)`);
    blocks.push({
      type: "image",
      source: { type: "base64", media_type, data },
    });
    blocks.push({
      type: "text",
      text: `(reference: ${name})`,
    });
  }
  blocks.push({
    type: "text",
    text: "Now produce the JSON style guide as instructed.",
  });

  const client = new Anthropic();
  const t0 = Date.now();
  const msg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: "user", content: blocks }],
  });

  if (msg.usage) {
    await logUsage({
      surface: "style-extract",
      model: "claude-haiku-4-5",
      input_tokens: msg.usage.input_tokens ?? 0,
      output_tokens: msg.usage.output_tokens ?? 0,
      cached_tokens: msg.usage.cache_read_input_tokens ?? 0,
      latency_ms: Date.now() - t0,
      meta: { images: all.length },
    }).catch(() => {});
  }

  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const stripped = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    console.error("Claude returned non-JSON output:", text.slice(0, 400));
    process.exit(1);
  }

  parsed.__meta__ = {
    generated_at: new Date().toISOString(),
    source_files: all.map((f) => path.relative(ROOT, f)),
    model: "claude-haiku-4-5",
  };

  await fs.writeFile(OUT_PATH, JSON.stringify(parsed, null, 2));
  console.log(`\n✓ style guide written to ${path.relative(ROOT, OUT_PATH)}`);
  console.log("Preview:");
  console.log(JSON.stringify({ primary_colors: parsed.primary_colors, mood: parsed.mood }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

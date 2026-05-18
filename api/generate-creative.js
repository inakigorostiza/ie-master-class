import fs from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";
import { Resvg } from "@resvg/resvg-js";
import { getSql } from "../lib/db.js";
import { generateImage, NANO_BANANA_MODEL } from "../lib/gemini.js";
import { buildBannerPrompt } from "../lib/prompts/banner.js";
import { buildReelPrompt } from "../lib/prompts/reel.js";
import { writeCopy } from "../lib/copywriter.js";
import { startVideo, VEO_MODEL } from "../lib/veo.js";
import { compositePortraitWithLogo, findLogoPath } from "../lib/composite-portrait.js";
import { logUsage } from "../lib/usage.js";

export const config = {
  // Nano Banana Pro can take 30–60s per image. Leave headroom.
  maxDuration: 120,
};

const STYLE_DIR = "styles/banners";
const LOGO_DIR = "styles/logos";
const MAX_STYLE_REFS = 5;
const MAX_LOGOS = 3;
const RASTER_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const VECTOR_EXT = new Set([".svg"]);

function mimeFor(ext) {
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function rasterizeSvg(buf) {
  // Render the SVG to a PNG sized for Nano Banana to recognize fine details.
  // 1024px on the long edge is a sensible upper bound for a logo asset.
  const resvg = new Resvg(buf, { fitTo: { mode: "width", value: 1024 } });
  return resvg.render().asPng();
}

async function loadImagesFrom(dir, cap) {
  const abs = path.join(process.cwd(), dir);
  let entries;
  try {
    entries = await fs.readdir(abs);
  } catch {
    return [];
  }
  const files = entries
    .filter((name) => {
      if (name.startsWith(".")) return false;
      const ext = path.extname(name).toLowerCase();
      return RASTER_EXT.has(ext) || VECTOR_EXT.has(ext);
    })
    .sort()
    .slice(0, cap);

  const out = [];
  for (const name of files) {
    const ext = path.extname(name).toLowerCase();
    const buf = await fs.readFile(path.join(abs, name));
    if (VECTOR_EXT.has(ext)) {
      try {
        const png = rasterizeSvg(buf);
        out.push({
          inline_data: { mime_type: "image/png", data: png.toString("base64") },
        });
      } catch (err) {
        console.warn(`[generate-creative] SVG rasterize failed for ${name}:`, err.message);
      }
    } else {
      out.push({
        inline_data: { mime_type: mimeFor(ext), data: buf.toString("base64") },
      });
    }
  }
  return out;
}

async function fetchPortrait(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`portrait fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "image/jpeg";
  return { inline_data: { mime_type: ct, data: buf.toString("base64") } };
}

function sanitizeEmail(email) {
  return email.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return await new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const adminToken = process.env.ADMIN_TOKEN;
  const headerToken = req.headers["x-admin-token"];
  if (!adminToken || headerToken !== adminToken) {
    return res.status(401).json({ error: "invalid admin token" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: "BLOB_READ_WRITE_TOKEN is not configured" });
  }

  const sql = getSql();
  if (!sql) return res.status(500).json({ error: "DATABASE_URL is not configured" });

  const body = (await readJsonBody(req)) ?? {};
  const email = (body.email ?? "").toString().trim().toLowerCase();
  const format = (body.format ?? "banner").toString().trim();
  if (!email) return res.status(400).json({ error: "email is required" });
  if (format !== "banner" && format !== "reel") {
    return res.status(400).json({ error: `unsupported format '${format}' (use 'banner' or 'reel')` });
  }

  const t0 = Date.now();

  // 1) Load the student row.
  const rows = await sql`SELECT * FROM students WHERE email = ${email} LIMIT 1`;
  const student = rows[0];
  if (!student) return res.status(404).json({ error: `no student found for ${email}` });
  if (!student.profile_picture_url) {
    return res.status(400).json({ error: "student has no profile picture on file" });
  }

  if (format === "banner") {
    return generateBanner({ student, email, format, sql, res, t0 });
  }
  return generateReel({ student, email, format, sql, res, t0 });
}

async function generateBanner({ student, email, format, sql, res, t0 }) {
  // Load references (portrait + style refs + logos).
  let portrait, styleRefs, logos;
  try {
    [portrait, styleRefs, logos] = await Promise.all([
      fetchPortrait(student.profile_picture_url),
      loadImagesFrom(STYLE_DIR, MAX_STYLE_REFS),
      loadImagesFrom(LOGO_DIR, MAX_LOGOS),
    ]);
  } catch (err) {
    return res.status(400).json({ error: `reference load failed: ${err.message}` });
  }
  if (!logos.length) {
    return res.status(400).json({
      error: `no logo found in styles/logos — every banner must carry the IE logo. Drop a PNG/JPG/WebP/SVG into styles/logos/.`,
    });
  }

  let copy;
  try {
    copy = await writeCopy(student, { format: "banner" });
  } catch (err) {
    console.error("[generate-creative] copywriter error:", err);
    return res.status(502).json({ error: `copywriter failed: ${err.message}` });
  }

  const prompt = buildBannerPrompt(
    student,
    { styleRefs: styleRefs.length, logos: logos.length },
    copy,
  );
  const parts = [{ text: prompt }, portrait, ...styleRefs, ...logos];

  let generated;
  try {
    generated = await generateImage({ parts });
  } catch (err) {
    console.error("[generate-creative] Gemini error:", err);
    return res.status(502).json({ error: `Gemini failure: ${err.message}` });
  }
  const latencyMs = Date.now() - t0;
  logUsage({
    surface: "banner",
    model: generated.model ?? NANO_BANANA_MODEL,
    image_count: 1,
    latency_ms: latencyMs,
    student_email: email,
    meta: { width: 1200, height: 628 },
  }).catch(() => {});

  let blob;
  try {
    const bytes = Buffer.from(generated.base64, "base64");
    const ext = generated.mime === "image/jpeg" ? "jpg" : "png";
    const filename = `creatives/${sanitizeEmail(email)}/${format}-${Date.now()}.${ext}`;
    blob = await put(filename, bytes, {
      access: "public",
      contentType: generated.mime,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
  } catch (err) {
    console.error("[generate-creative] Blob upload error:", err);
    return res.status(502).json({ error: `Blob upload failed: ${err.message}` });
  }

  let creativeId = null;
  try {
    const [row] = await sql`
      INSERT INTO student_creatives (
        student_id, format, url, mime_type, width, height,
        prompt, model, latency_ms, status
      ) VALUES (
        ${student.id}, ${format}, ${blob.url}, ${generated.mime}, 1200, 628,
        ${prompt}, ${generated.model ?? NANO_BANANA_MODEL}, ${latencyMs}, 'completed'
      )
      RETURNING id
    `;
    creativeId = row?.id ?? null;
  } catch (err) {
    console.error("[generate-creative] DB insert error:", err);
    return res.status(200).json({
      ok: true, creative_id: null, url: blob.url, latency_ms: latencyMs,
      warning: "banner generated and stored in Blob but metadata insert failed",
    });
  }

  return res.status(200).json({
    ok: true,
    creative_id: creativeId,
    status: "completed",
    url: blob.url,
    latency_ms: latencyMs,
    copy,
    refs: { style: styleRefs.length, logos: logos.length },
  });
}

async function generateReel({ student, email, format, sql, res }) {
  // Image-to-video: the composited portrait + IE logo is the seed frame.
  // Frame 1 is the seed (lasts ~33ms — imperceptible in playback) and Veo
  // animates from there. This preserves the face AND keeps the logo locked.

  let portraitBytes, logoPath;
  try {
    const r = await fetch(student.profile_picture_url);
    if (!r.ok) throw new Error(`portrait fetch ${r.status}`);
    portraitBytes = Buffer.from(await r.arrayBuffer());
    logoPath = await findLogoPath("styles/logos");
  } catch (err) {
    return res.status(400).json({ error: `portrait load failed: ${err.message}` });
  }
  if (!logoPath) {
    return res.status(400).json({ error: "no logo in styles/logos/ — add a PNG/JPG/WebP/SVG" });
  }

  let composite;
  try {
    composite = await compositePortraitWithLogo(portraitBytes, logoPath);
  } catch (err) {
    console.error("[generate-creative] compositing error:", err);
    return res.status(500).json({ error: `compositing failed: ${err.message}` });
  }

  let copy;
  try {
    copy = await writeCopy(student, { format: "reel" });
  } catch (err) {
    console.error("[generate-creative] reel copywriter error:", err);
    return res.status(502).json({ error: `copywriter failed: ${err.message}` });
  }

  const prompt = buildReelPrompt(student, copy, { hasLogoRef: false });

  let op;
  try {
    op = await startVideo({
      prompt,
      image: {
        base64: composite.bytes.toString("base64"),
        mime: composite.mime,
      },
      durationSeconds: 8,
      aspectRatio: "9:16",
      resolution: "720p",
    });
  } catch (err) {
    console.error("[generate-creative] Veo start error:", err);
    return res.status(502).json({ error: `Veo failure: ${err.message}` });
  }

  // Log Veo usage immediately on start — Veo bills per requested video second
  // regardless of poll outcome (Lite ≈ $0.05/s × 8s = $0.40).
  logUsage({
    surface: "reel",
    model: op.model ?? VEO_MODEL,
    audio_seconds: 8,
    meta: { operation_id: op.operationName, aspect: "9:16", resolution: "720p" },
    student_email: email,
  }).catch(() => {});

  // 4) Insert a pending row. The admin's poll-creative endpoint will complete it.
  let creativeId = null;
  try {
    const [row] = await sql`
      INSERT INTO student_creatives (
        student_id, format, url, mime_type, width, height,
        prompt, model, latency_ms, status, operation_id
      ) VALUES (
        ${student.id}, ${format}, ${null}, 'video/mp4', 720, 1280,
        ${prompt}, ${op.model ?? VEO_MODEL}, ${0}, 'pending', ${op.operationName}
      )
      RETURNING id
    `;
    creativeId = row?.id ?? null;
  } catch (err) {
    console.error("[generate-creative] DB insert error (reel):", err);
    return res.status(502).json({ error: `db insert failed: ${err.message}` });
  }

  return res.status(200).json({
    ok: true,
    creative_id: creativeId,
    status: "pending",
    operation_id: op.operationName,
    copy,
  });
}

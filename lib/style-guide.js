import fs from "node:fs";
import path from "node:path";

let cached = null;

export function loadStyleGuide() {
  if (cached !== null) return cached;
  const p = path.join(process.cwd(), "styles/style-guide.json");
  try {
    const txt = fs.readFileSync(p, "utf8");
    cached = JSON.parse(txt);
  } catch {
    cached = false; // sentinel so we don't retry on every call
  }
  return cached || null;
}

// Render the style guide as a compact text block for embedding in prompts.
export function styleGuideAsPromptBlock() {
  const g = loadStyleGuide();
  if (!g) return "";
  const colors = (g.primary_colors ?? [])
    .map((c) => `${c.name} ${c.hex} (${c.role})`)
    .join("; ");
  const accents = (g.accent_colors ?? [])
    .map((c) => `${c.name} ${c.hex}`)
    .join("; ");
  const headline = g.typography?.headline ?? {};
  const cta = g.typography?.cta ?? {};
  const layouts = (g.layout_patterns ?? []).slice(0, 4).join(" / ");
  const mood = (g.mood ?? []).join(", ");
  const photo = g.photographic_style ?? "";
  const logo = g.logo_treatment ?? "";
  const avoid = (g.things_to_avoid ?? []).slice(0, 4).join("; ");

  return `IE BRAND GUIDE (derived from official site + sample banners):
- Primary colors: ${colors}
- Accent colors: ${accents}
- Headline typography: ${headline.description ?? ""} (weight ${headline.weight ?? "bold"}, case ${headline.case ?? "Title"}, tracking ${headline.tracking ?? "normal"}).
- CTA typography: ${cta.description ?? ""} (weight ${cta.weight ?? "bold"}).
- Photographic style: ${photo}
- Logo treatment: ${logo}
- Common layout patterns: ${layouts}.
- Mood: ${mood}.
- Avoid: ${avoid}.`;
}

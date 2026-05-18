import { styleGuideAsPromptBlock } from "../style-guide.js";

export function buildReelPrompt(student, copy, opts = {}) {
  const tone = student.tone_preference ?? "Inspirational";
  const country = student.country ?? "";
  const city = student.city ?? "";
  const vibe = student.visual_vibe ?? "Bold";
  const place = [city, country].filter(Boolean).join(", ") || "a global city";
  const hasLogoRef = !!opts.hasLogoRef;
  const brandGuide = styleGuideAsPromptBlock();

  // NOTE: never include the student's literal name in the visual prompt — Veo's
  // safety filter blocks "real people's names + likenesses" appearing together.
  // The reference portrait supplies the likeness; the prompt describes the
  // hero generically. Names are OK inside the voiceover (spoken audio).
  return `A vertical 9:16 8-second Instagram reel for IE Business School, premium cinematic look. **Begin animating immediately from frame 1** — subtle camera push-in or parallax — so the clip never feels like a still photo holding on screen.

THE REFERENCE FRAME (your starting frame) ALREADY CONTAINS TWO LOCKED ELEMENTS:
1. The face of the hero — the young professional. PRESERVE it exactly across every frame (eye color, skin tone, hair, face shape, age). Same person throughout, animated naturally (subtle head movement, expression, blinking). Never replace this person with a different person or stylized version.
2. The IE logo in the top-right corner. PRESERVE its position, colors, and size across every frame. Do not redraw, recolor, distort, or move it.

Animate the scene AROUND these two locked elements — change the background, add camera motion, introduce on-screen text — but never alter the face or the logo.

${brandGuide}

HERO (reference image #1 — preserve their face exactly, no morphing, no replacement; same person across every frame):
The young professional from the reference image, based in ${place}.

SCENE: ${copy.scene_description}

VISUAL DIRECTION:
- Vibe: ${vibe}. Modern, premium, IE-brand contemporary.
- Camera: smooth motion, slight push-in or parallax. NO whip-pans or shaky cam.
- Color grade: cinematic, slightly warm highlights, clean shadows.
- Lighting: editorial photography quality, soft directional key light.

IE LOGO HANDLING (critical):
- The IE logo is ALREADY composited in the top-right corner of the reference frame.
- Treat it as a fixed, locked element: do NOT redraw, recolor, move, or remove it. Keep it in the exact same position, size, and colors across every single frame of the 8-second clip. The hero or camera can move; the logo cannot.

ON-SCREEN TEXT (rendered as crisp kinetic typography — letter-perfect, no garbled glyphs, no duplicated words; follow the IE BRAND GUIDE above for colors and typography). Stack them vertically on the lower half of the frame so they do not obscure the hero's face. Use the IE Navy on a white card OR white on an IE Navy panel, with a subtle drop shadow for legibility:

  Around second 2 — HEADER (the IE program name, largest, bold ALL CAPS if it fits, otherwise Title Case):
    "${copy.header}"

  Immediately under the header — SUBHEADER (medium weight, ~60% header size):
    "${copy.subheader}"

  Around second 4 — BODY (smaller, regular weight, ~40% header size, single line if possible):
    "${copy.body}"

  Around second 6 through end of clip — CTA (pill-shaped button, IE Red fill, white bold text, ~50% header size):
    "${copy.cta}"

All four text blocks must be rendered with flawless typography in the IE BRAND GUIDE colors. They must NOT cover the hero's face or the IE logo in the top-right.

AUDIO:
- Voiceover (warm ${tone.toLowerCase()} voice, ${student.preferred_language === "ES" ? "Spanish" : "English"}): "${copy.voiceover}"
- Music: light cinematic underscore, modern, hopeful. Subtle, ducked under the voiceover.

ABSOLUTELY AVOID:
- Replacing or morphing the hero's face. No deepfake artifacts.
- Generating other identifiable people.
- Stock-photo aesthetics, generic gradient backgrounds, cartoon styles.
- Misspelled or distorted on-screen text.
- Colors outside the IE palette for headline/CTA text.
- Any logo other than IE's.

OUTPUT: a single 9:16 vertical clip, 720p, 8 seconds, with synced voiceover and music.`;
}

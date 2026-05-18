import Anthropic from "@anthropic-ai/sdk";
import { logUsage } from "./usage.js";

const MODEL = "claude-haiku-4-5";

const SYSTEM_BANNER = `You are a senior copywriter for IE Business School in Madrid, writing
hyper-personalized marketing banner copy. Given a student profile, output
exactly four pieces of copy as JSON:

  - header     — the hero line. 3–6 words. Punchy, aspirational, banner-worthy.
                 Do NOT just repeat their current job title; transform it into
                 a future-oriented promise or identity.
  - subheader  — 6–12 words tying them to the IE program. Format examples:
                 "Master in Big Data · IE Business School", or
                 "Your next chapter at IE Business School".
  - body       — 1 short sentence, max 18 words. Speaks directly to the
                 student by first name when possible. Connects who they are
                 (three_words / city / country) to what they want
                 (career_goal / dream_company). Concrete, warm, never generic.
  - cta        — 2–4 words, button-style. Examples: "Apply now",
                 "Explore the program", "Book a call", "Start here".
                 If the program name is long, use a generic CTA, not the full
                 program name.

Rules:
- Respect the student's tone preference (Inspirational, Professional,
  Conversational, Witty). Match it audibly.
- Write in the student's preferred_language ("EN" = English, "ES" = Spanish).
- Never invent biographical facts. Use ONLY the provided fields.
- Output STRICT JSON only. No prose around it. No markdown fences.

JSON shape: {"header":"…","subheader":"…","body":"…","cta":"…"}`;

const SYSTEM_REEL = `You are a senior copywriter for IE Business School in Madrid, writing
hyper-personalized 8-second Instagram reel scripts. Given a student profile,
output exactly six pieces of copy as JSON:

  - header              — the IE program name, rendered as the largest
                          on-screen title text. Examples: "Master in Strategic
                          Marketing & Communication", "Master in Big Data &
                          Business Analytics", "International MBA". Derive it
                          from top_program_interest (the slug). Use the full
                          official name; do not invent. If top_program_interest
                          is missing, fall back to "IE Business School".
  - subheader           — a 3–6 word punchy tagline that sits under the header.
                          Hooks the prospect's ambition. Do NOT repeat the
                          program name or the student's job title verbatim.
                          Examples: "Where engineers become marketers",
                          "From code to brand strategy", "Your future starts here".
  - body                — 1 short sentence (max 14 words) that connects the
                          student's background or ambition to the program.
                          Concrete, warm, never generic. Renders as smaller
                          on-screen text below the subheader.
  - cta                 — 2–4 words, button copy. Examples: "Apply now",
                          "Start your story", "Talk to IE".
  - voiceover           — the spoken script for the 8-second clip.
                          12–22 words total. Concrete, ends on a hook.
                          IMPORTANT: do NOT use the student's first or full
                          name in the voiceover. Use "you" or generic forms.
                          (Veo's safety filter blocks names + a portrait.)
  - scene_description   — 1–2 sentences describing what's visually happening
                          around the locked hero face + IE logo. Concrete
                          locations, actions, mood, wardrobe. Never logos,
                          never specific brand/company names, never real
                          celebrities. Use industry vibes only ("athletic
                          streetwear" not "Nike"; "a global consultancy
                          office" not "McKinsey").

Rules:
- Respect the student's tone preference. Match it audibly in voiceover and
  in the subheader/body copy.
- Write in the student's preferred_language ("EN" = English, "ES" = Spanish).
- Never invent biographical facts. Use ONLY the provided fields.
- The voiceover MAY mention brand/company names (spoken copy). The
  scene_description must NOT.
- Output STRICT JSON only. No prose around it. No markdown fences.

JSON shape: {"header":"…","subheader":"…","body":"…","cta":"…","voiceover":"…","scene_description":"…"}`;

const client = new Anthropic();

export async function writeCopy(student, { format = "banner" } = {}) {
  const system = format === "reel" ? SYSTEM_REEL : SYSTEM_BANNER;
  const required = format === "reel"
    ? ["header", "subheader", "body", "cta", "voiceover", "scene_description"]
    : ["header", "subheader", "body", "cta"];

  const userPayload = {
    full_name: student.full_name ?? null,
    first_name: (student.full_name ?? "").split(/\s+/)[0] || null,
    country: student.country ?? null,
    city: student.city ?? null,
    preferred_language: student.preferred_language ?? "EN",
    current_role: student.current_role ?? student.job_role ?? null,
    current_company: student.current_company ?? null,
    years_experience: student.years_experience ?? null,
    undergrad_field: student.undergrad_field ?? null,
    top_program_interest: student.top_program_interest ?? null,
    career_goal_one_line: student.career_goal_one_line ?? null,
    dream_company_or_industry: student.dream_company_or_industry ?? null,
    three_words: Array.isArray(student.three_words) ? student.three_words : [],
    visual_vibe: student.visual_vibe ?? "Bold",
    tone_preference: student.tone_preference ?? "Inspirational",
  };

  const t0 = Date.now();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    system,
    messages: [{ role: "user", content: JSON.stringify(userPayload, null, 2) }],
  });

  if (msg.usage) {
    logUsage({
      surface: "copywriter",
      model: MODEL,
      input_tokens: msg.usage.input_tokens ?? 0,
      output_tokens: msg.usage.output_tokens ?? 0,
      cached_tokens: msg.usage.cache_read_input_tokens ?? 0,
      latency_ms: Date.now() - t0,
      meta: { format },
    }).catch(() => {});
  }

  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const stripped = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`Copywriter produced non-JSON output: ${text.slice(0, 200)}`);
  }

  for (const k of required) {
    if (typeof parsed[k] !== "string" || !parsed[k].trim()) {
      throw new Error(`Copywriter response missing field "${k}" for format=${format}`);
    }
  }

  const out = {};
  for (const k of required) out[k] = parsed[k].trim();
  return out;
}

// Back-compat alias for existing callers.
export const writeBannerCopy = (student) => writeCopy(student, { format: "banner" });

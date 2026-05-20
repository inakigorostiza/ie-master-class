// Per-unit USD pricing for every model we touch. Persist both the USD cost
// and the EUR cost on each row so historical rows stay correct when the FX
// rate shifts.

export const USD_TO_EUR = Number(process.env.USD_TO_EUR ?? 0.92);

export const PRICING = {
  // Anthropic — USD per token
  "claude-haiku-4-5": { input: 1.0e-6, output: 5.0e-6, cached: 0.1e-6 },

  // OpenAI Whisper — USD per second of audio (≈ $0.006/min)
  "whisper-1": { audio_second: 0.0001 },

  // ElevenLabs Flash v2.5 — USD per character (≈ $0.30/1k chars on Starter)
  "eleven_flash_v2_5": { char: 0.30e-3 },

  // Google Gemini (Nano Banana) — USD per output image
  "gemini-3-pro-image-preview": { image: 0.15 },
  "gemini-2.5-flash-image": { image: 0.039 },

  // Google Veo — USD per video second
  "veo-3.1-lite-generate-preview": { video_second: 0.05 },
  "veo-3.1-fast-generate-preview": { video_second: 0.15 },
  "veo-3.1-generate-preview": { video_second: 0.40 },

  // HeyGen LiveAvatar — USD per session second (≈ $9/hour = $0.0025/sec)
  // We log session-start with 0 seconds and reconcile actual usage server-side
  // in a future enhancement; for now this is a per-mint marker.
  "liveavatar-default": { video_second: 0.15 / 60 },

  // Outreach providers — USD per message. Logged via image_count = 1 per
  // send (the agent_usage schema has no message_count column; reusing
  // image_count semantically as "one discrete output produced").
  "resend-email": { image: 0.0004 },
  "twilio-sms": { image: 0.0079 },
  "twilio-whatsapp": { image: 0.005 },
};

const PROVIDER_OF = {
  "claude-haiku-4-5": "anthropic",
  "whisper-1": "openai",
  "eleven_flash_v2_5": "elevenlabs",
  "gemini-3-pro-image-preview": "google",
  "gemini-2.5-flash-image": "google",
  "veo-3.1-lite-generate-preview": "google",
  "veo-3.1-fast-generate-preview": "google",
  "veo-3.1-generate-preview": "google",
  "liveavatar-default": "heygen",
  "resend-email": "resend",
  "twilio-sms": "twilio",
  "twilio-whatsapp": "twilio",
};

export function providerFor(model) {
  return PROVIDER_OF[model] ?? "unknown";
}

export function computeUsdCost({
  model,
  input_tokens,
  output_tokens,
  cached_tokens,
  input_chars,
  audio_seconds,
  image_count,
}) {
  const p = PRICING[model];
  if (!p) return 0;
  let usd = 0;
  if (p.input && input_tokens) usd += input_tokens * p.input;
  if (p.output && output_tokens) usd += output_tokens * p.output;
  if (p.cached && cached_tokens) usd += cached_tokens * p.cached;
  if (p.char && input_chars) usd += input_chars * p.char;
  // Note: Whisper, Veo, HeyGen all share the same numeric semantics for
  // "seconds of media generated/consumed". Pricing map uses video_second OR
  // audio_second; pull whichever exists.
  if ((p.audio_second || p.video_second) && audio_seconds) {
    usd += audio_seconds * (p.audio_second ?? p.video_second);
  }
  if (p.image && image_count) usd += image_count * p.image;
  return usd;
}

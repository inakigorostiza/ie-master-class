// Minimal Nano Banana (gemini-2.5-flash-image-preview) wrapper.
//
// Multimodal input: array of `parts` where each part is either a text segment
// or an `inline_data` object carrying a base64-encoded image. Output: a single
// base64 PNG (we extract the first inline_data part from the response).

// Nano Banana Pro — best face consistency and text rendering. Slower than 2.5
// Flash but worth it for marketing banners where typos/distorted faces are
// unacceptable. Configurable via env so we can A/B without redeploying code.
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export async function generateImage({ parts }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "x-goog-api-key": process.env.GEMINI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 500)}`);
  }
  const json = await res.json();
  const candidate = json?.candidates?.[0];
  if (!candidate) {
    throw new Error("Gemini returned no candidates");
  }
  const imagePart = candidate.content?.parts?.find((p) => p.inlineData || p.inline_data);
  if (!imagePart) {
    const blockReason = candidate.finishReason ?? json?.promptFeedback?.blockReason ?? "unknown";
    throw new Error(`Gemini returned no image (finishReason=${blockReason})`);
  }
  const data = imagePart.inlineData ?? imagePart.inline_data;
  return {
    mime: data.mimeType ?? data.mime_type ?? "image/png",
    base64: data.data,
    model: MODEL,
  };
}

export const NANO_BANANA_MODEL = MODEL;

// Veo 3.1 long-running video generation client.
//
// Veo always returns a long-running operation. Flow:
//   1. startVideo() → returns operation name (e.g. "operations/abcd1234")
//   2. getOperation() → poll until done=true
//   3. extractVideoFromResult() → grab the result (either inline base64 or fileUri)
//
// All requests use the existing GEMINI_API_KEY via the `x-goog-api-key` header.

const DEFAULT_MODEL = "veo-3.1-fast-generate-preview";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

function modelId() {
  return process.env.VEO_MODEL || DEFAULT_MODEL;
}

export async function startVideo({
  prompt,
  image,
  referenceImages,
  durationSeconds = 8,
  aspectRatio = "9:16",
  resolution = "720p",
}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  const url = `${BASE}/models/${modelId()}:predictLongRunning`;
  const instance = { prompt };
  if (image && image.base64 && image.mime) {
    instance.image = { bytesBase64Encoded: image.base64, mimeType: image.mime };
  }
  if (Array.isArray(referenceImages) && referenceImages.length) {
    instance.referenceImages = referenceImages.map((r) => ({
      image: { bytesBase64Encoded: r.base64, mimeType: r.mime },
      ...(r.subjectType ? { subjectType: r.subjectType } : {}),
    }));
  }
  // personGeneration accepts different values depending on mode:
  //   - image-to-video: "allow_adult" is accepted
  //   - text-to-video : that value is rejected. Omitting the field uses Veo's
  //     default (which permits adults).
  const params = { aspectRatio, durationSeconds, resolution };
  if (instance.image) params.personGeneration = "allow_adult";

  const body = {
    instances: [instance],
    parameters: params,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": process.env.GEMINI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Veo start ${res.status}: ${errText.slice(0, 500)}`);
  }
  const json = await res.json();
  if (!json.name) throw new Error("Veo response missing operation name");
  return { operationName: json.name, model: modelId() };
}

export async function getOperation(operationName) {
  if (!operationName) throw new Error("operationName is required");
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const url = `${BASE}/${operationName}`;
  const res = await fetch(url, {
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Veo poll ${res.status}: ${errText.slice(0, 500)}`);
  }
  return res.json();
}

// Walk the operation response to find the produced video. Veo returns one of:
//   response.generateVideoResponse.generatedSamples[i].video.uri
//   response.generateVideoResponse.generatedSamples[i].video.bytesBase64Encoded
//   response.predictions[i].video / videoUri / bytesBase64Encoded
// We normalize to either { base64, mime } or { uri, mime }, OR { rejected: <reason> }
// when Veo's RAI filter blocks the generation.
export function extractVideoFromResult(operationResult) {
  const r = operationResult?.response ?? {};
  const gvr = r.generateVideoResponse ?? r.generate_video_response ?? {};

  const candidates = [];
  if (gvr.generatedSamples?.length) {
    for (const s of gvr.generatedSamples) candidates.push(s.video ?? s);
  }
  if (Array.isArray(r.predictions)) {
    for (const p of r.predictions) candidates.push(p.video ?? p);
  }
  for (const c of candidates) {
    if (!c) continue;
    const mime = c.mimeType || c.mime_type || "video/mp4";
    const b64 = c.bytesBase64Encoded || c.bytes_base64_encoded;
    if (b64) return { base64: b64, mime };
    const uri = c.uri || c.fileUri || c.file_uri || c.videoUri || c.video_uri;
    if (uri) return { uri, mime };
  }

  // No video — surface a useful reason if Veo's safety filter rejected it.
  const reasons = gvr.raiMediaFilteredReasons ?? gvr.rai_media_filtered_reasons;
  if (Array.isArray(reasons) && reasons.length) {
    return { rejected: reasons.join(" | ") };
  }
  return null;
}

export async function downloadVideoBytes({ uri, base64 }) {
  if (base64) return Buffer.from(base64, "base64");
  if (!uri) throw new Error("Veo result missing both base64 and uri");
  // Some fileUris are protected and require the API key.
  const headers = process.env.GEMINI_API_KEY
    ? { "x-goog-api-key": process.env.GEMINI_API_KEY }
    : {};
  const res = await fetch(uri, { headers });
  if (!res.ok) throw new Error(`Veo video download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export const VEO_MODEL = modelId();

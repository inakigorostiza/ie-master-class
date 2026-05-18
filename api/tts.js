import { logUsage } from "../lib/usage.js";

export const config = {
  maxDuration: 30,
};

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel — ElevenLabs' canonical demo voice
const DEFAULT_MODEL_ID = "eleven_flash_v2_5"; // lowest-latency English model (~75ms first byte)

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.ELEVENLABS_API_KEY) {
    return res.status(500).json({ error: "ELEVENLABS_API_KEY is not configured" });
  }

  const body = await readJsonBody(req);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return res.status(400).json({ error: "text is required" });
  }

  const voiceId = (body?.voice_id || process.env.ELEVENLABS_DEFAULT_VOICE_ID || DEFAULT_VOICE_ID).trim();
  const modelId = (body?.model_id || process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID).trim();
  const t0 = Date.now();

  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      console.error("[tts] ElevenLabs error:", upstream.status, errText);
      return res.status(502).json({
        error: `TTS request failed: ${upstream.status}`,
        upstream: errText.slice(0, 500),
      });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    const reader = upstream.body.getReader();
    let closed = false;
    res.on("close", () => {
      closed = true;
      reader.cancel().catch(() => {});
    });

    while (true) {
      const { value, done } = await reader.read();
      if (done || closed) break;
      res.write(Buffer.from(value));
    }
    if (!closed) res.end();

    // Log AFTER streaming so latency_ms reflects total wall time.
    logUsage({
      surface: "tts",
      model: modelId,
      input_chars: text.length,
      latency_ms: Date.now() - t0,
      meta: { voice_id: voiceId },
    }).catch(() => {});
  } catch (err) {
    console.error("[tts] error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message ?? "Unknown error" });
    } else {
      res.end();
    }
  }
}

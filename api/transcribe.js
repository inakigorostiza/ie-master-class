import { logUsage } from "../lib/usage.js";

export const config = {
  maxDuration: 30,
  api: {
    bodyParser: false,
  },
};

function readBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
  }

  try {
    const t0 = Date.now();
    const audio = await readBuffer(req);
    if (!audio.length) {
      return res.status(400).json({ error: "empty audio body" });
    }

    const contentType = req.headers["content-type"] || "audio/webm";
    const ext = contentType.includes("mp4") ? "m4a" : contentType.includes("ogg") ? "ogg" : "webm";

    const form = new FormData();
    form.append("file", new Blob([audio], { type: contentType }), `audio.${ext}`);
    form.append("model", "whisper-1");
    form.append("language", "en");
    form.append("response_format", "json");

    const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error("[transcribe] OpenAI error:", upstream.status, errText);
      return res.status(502).json({ error: `Whisper request failed: ${upstream.status}` });
    }

    const data = await upstream.json();
    // Rough estimate of audio duration in seconds. Whisper bills per audio
    // second; opus/webm ≈ 16 KB/s, so bytes / 16000 is a usable approximation.
    const estimatedSeconds = Math.max(1, Math.round(audio.length / 16000));
    logUsage({
      surface: "transcribe",
      model: "whisper-1",
      audio_seconds: estimatedSeconds,
      latency_ms: Date.now() - t0,
      meta: { bytes: audio.length, content_type: contentType },
    }).catch(() => {});
    return res.status(200).json({ text: (data.text ?? "").trim() });
  } catch (err) {
    console.error("[transcribe] error:", err);
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}

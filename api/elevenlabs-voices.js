export const config = {
  maxDuration: 15,
};

// Fallback list so the dropdown isn't empty if the API call fails.
const FALLBACK_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade", labels: { gender: "female", accent: "american" }, preview_url: null },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", category: "premade", labels: { gender: "female", accent: "american" }, preview_url: null },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", category: "premade", labels: { gender: "female", accent: "american" }, preview_url: null },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", category: "premade", labels: { gender: "male", accent: "american" }, preview_url: null },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", category: "premade", labels: { gender: "female", accent: "american" }, preview_url: null },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", category: "premade", labels: { gender: "male", accent: "american" }, preview_url: null },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", category: "premade", labels: { gender: "male", accent: "american" }, preview_url: null },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", category: "premade", labels: { gender: "male", accent: "american" }, preview_url: null },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam", category: "premade", labels: { gender: "male", accent: "american" }, preview_url: null },
];

function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.voice_id || raw.id;
  if (!id) return null;
  return {
    id,
    name: raw.name || id.slice(0, 8),
    category: raw.category || "premade",
    preview_url: raw.preview_url || null,
    labels: raw.labels || {},
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.ELEVENLABS_API_KEY) {
    return res.status(500).json({ error: "ELEVENLABS_API_KEY is not configured" });
  }

  try {
    const upstream = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      console.warn("[elevenlabs-voices] upstream error:", upstream.status, errText);
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.status(200).json({ voices: FALLBACK_VOICES, fallback: true });
    }

    const body = await upstream.json();
    const list = Array.isArray(body?.voices) ? body.voices : [];
    const normalized = list.map(normalize).filter(Boolean);

    // Sort: cloned > generated > professional > premade, then by name
    const rank = { cloned: 0, generated: 1, professional: 2, premade: 3 };
    normalized.sort((a, b) => {
      const ra = rank[a.category] ?? 99;
      const rb = rank[b.category] ?? 99;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });

    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({ voices: normalized.length ? normalized : FALLBACK_VOICES });
  } catch (err) {
    console.error("[elevenlabs-voices] error:", err);
    return res.status(200).json({ voices: FALLBACK_VOICES, fallback: true });
  }
}

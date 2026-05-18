// Consolidated HeyGen LiveAvatar endpoint.
//   POST /api/heygen → mint a session token (avatar lifecycle)
//   GET  /api/heygen → list available avatars (custom + public, deduped)
//
// We logged this as two separate functions originally; consolidated to free
// a Hobby-plan function slot for /api/stats.

import { logUsage } from "../lib/usage.js";

export const config = {
  maxDuration: 15,
};

const DEFAULT_AVATAR_ID = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a"; // Wayne
const DEFAULT_VOICE_ID = "c2527536-6d1f-4412-a643-53a3497dada9";
const DEFAULT_CONTEXT_ID = "5b9dba8a-aa31-11f0-a6ee-066a7fa2e369";

const WAYNE = {
  id: DEFAULT_AVATAR_ID,
  name: "Wayne",
  voice_id: DEFAULT_VOICE_ID,
  context_id: DEFAULT_CONTEXT_ID,
  preview_url: null,
  source: "default",
};

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k];
  }
  return null;
}

function normalize(raw, source) {
  if (!raw || typeof raw !== "object") return null;
  const id = pickFirst(raw, ["avatar_id", "id", "uuid"]);
  if (!id) return null;
  const persona = raw.avatar_persona || raw.persona || {};
  const voiceId =
    pickFirst(persona, ["voice_id"]) ||
    pickFirst(raw, ["voice_id", "default_voice_id"]) ||
    raw.default_voice?.id ||
    null;
  return {
    id,
    name: pickFirst(raw, ["avatar_name", "name", "display_name"]) || id.slice(0, 8),
    voice_id: voiceId,
    context_id: pickFirst(persona, ["context_id"]) || pickFirst(raw, ["context_id"]) || null,
    preview_url: pickFirst(raw, ["preview_url", "preview_image_url", "thumbnail_url"]) || null,
    source,
  };
}

async function fetchList(path) {
  try {
    const res = await fetch(`https://api.liveavatar.com${path}`, {
      headers: { "X-API-KEY": process.env.HEYGEN_API_KEY },
    });
    if (!res.ok) {
      console.warn(`[heygen] ${path} HTTP ${res.status}`);
      return [];
    }
    const body = await res.json();
    return Array.isArray(body?.data?.results) ? body.data.results : [];
  } catch (err) {
    console.warn(`[heygen] ${path} error:`, err);
    return [];
  }
}

export default async function handler(req, res) {
  if (!process.env.HEYGEN_API_KEY) {
    return res.status(500).json({ error: "HEYGEN_API_KEY is not configured" });
  }

  if (req.method === "GET") return listAvatars(req, res);
  if (req.method === "POST") return mintToken(req, res);

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}

async function listAvatars(_req, res) {
  const [customRaw, publicRaw] = await Promise.all([
    fetchList("/v1/avatars?page_size=100"),
    fetchList("/v1/avatars/public?page_size=100"),
  ]);

  const merged = [WAYNE];
  const seen = new Set([WAYNE.id]);
  for (const raw of customRaw) {
    const a = normalize(raw, "custom");
    if (a && !seen.has(a.id)) { merged.push(a); seen.add(a.id); }
  }
  for (const raw of publicRaw) {
    const a = normalize(raw, "public");
    if (a && !seen.has(a.id)) { merged.push(a); seen.add(a.id); }
  }

  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json({ avatars: merged });
}

async function mintToken(req, res) {
  const t0 = Date.now();
  const body = (await readJsonBody(req)) ?? {};
  const avatarId = body.avatar_id || process.env.HEYGEN_AVATAR_ID || DEFAULT_AVATAR_ID;
  const voiceId = body.voice_id || process.env.HEYGEN_VOICE_ID || DEFAULT_VOICE_ID;
  const contextId = body.context_id || process.env.HEYGEN_CONTEXT_ID || DEFAULT_CONTEXT_ID;

  // Auto-clean orphan sessions before minting (concurrency=1 plans).
  try {
    const listRes = await fetch("https://api.liveavatar.com/v1/sessions?type=active", {
      headers: { "X-API-KEY": process.env.HEYGEN_API_KEY },
    });
    if (listRes.ok) {
      const listJson = await listRes.json();
      const active = listJson?.data?.results ?? [];
      await Promise.all(
        active.map((s) =>
          fetch("https://api.liveavatar.com/v1/sessions/stop", {
            method: "POST",
            headers: {
              "X-API-KEY": process.env.HEYGEN_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ session_id: s.id }),
          }).catch((err) => console.warn("[heygen] orphan stop failed:", err)),
        ),
      );
    }
  } catch (err) {
    console.warn("[heygen] orphan cleanup failed:", err);
  }

  try {
    const upstream = await fetch("https://api.liveavatar.com/v1/sessions/token", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.HEYGEN_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "FULL",
        avatar_id: avatarId,
        avatar_persona: { voice_id: voiceId, context_id: contextId, language: "en" },
        is_sandbox: process.env.HEYGEN_IS_SANDBOX !== "false",
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error("[heygen] token upstream error:", upstream.status, errText);
      let upstreamMessage = errText;
      try {
        const parsed = JSON.parse(errText);
        if (Array.isArray(parsed?.data) && parsed.data[0]?.message) upstreamMessage = parsed.data[0].message;
        else if (parsed?.message) upstreamMessage = parsed.message;
      } catch {}
      return res.status(502).json({
        error: `LiveAvatar request failed: ${upstream.status}`,
        upstream: upstreamMessage,
      });
    }

    const data = await upstream.json();
    const token = data?.data?.session_token;
    const sessionId = data?.data?.session_id;
    if (!token) {
      console.error("[heygen] unexpected response shape:", data);
      return res.status(502).json({ error: "Missing session_token in LiveAvatar response" });
    }

    // Log usage as a marker (real billing is per session minute; reconciled later).
    logUsage({
      surface: "avatar",
      model: "liveavatar-default",
      audio_seconds: 0,
      latency_ms: Date.now() - t0,
      meta: { avatar_id: avatarId, session_id: sessionId },
    }).catch(() => {});

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ token, sessionId });
  } catch (err) {
    console.error("[heygen] token error:", err);
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}

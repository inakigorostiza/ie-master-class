import fs from "node:fs";
import path from "node:path";
import { put, del } from "@vercel/blob";
import { getSql } from "../lib/db.js";
import { getOperation, extractVideoFromResult, downloadVideoBytes } from "../lib/veo.js";
import { sendEmail, sendSms, sendWhatsapp } from "../lib/messaging.js";

export const config = { maxDuration: 30 };

// ─── Constants for outbound messaging ─────────────────────────────────────
// Resolve once at boot so personalized emails/WhatsApps always link back to
// the live site rather than to localhost during dev.
const SITE_URL = (process.env.SITE_URL || "https://iechatbot.vercel.app").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/img/ie-logo.svg`;
const CHAT_URL = `${SITE_URL}/?open=chat`;

// Full slug → { name, url } map. We read programs.jsonl directly (not via
// lib/kb.js) so the lookup works for legacy students who picked a program
// outside the current ENABLED_PROGRAM_SLUGS allowlist.
const PROGRAM_BY_SLUG = (() => {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "knowledge_base", "programs.jsonl"), "utf8");
    const map = new Map();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const p = JSON.parse(line);
        if (p?.slug) map.set(p.slug, { name: p.name, url: p.url });
      } catch {}
    }
    return map;
  } catch {
    return new Map();
  }
})();

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPersonalizedEmail({ firstName, bannerUrl, reelUrl, programName, programUrl, careerGoal }) {
  const safeFirst = escapeHtml(firstName);
  const safeBanner = bannerUrl ? escapeHtml(bannerUrl) : null;
  const safeReel = reelUrl ? escapeHtml(reelUrl) : null;
  const safeProgramName = programName ? escapeHtml(programName) : null;
  const safeProgramUrl = programUrl ? escapeHtml(programUrl) : null;
  const safeCareer = careerGoal ? escapeHtml(careerGoal) : null;

  const intro = safeProgramName
    ? `We put together a personalized preview based on your interest in <strong>${safeProgramName}</strong>${safeCareer ? ` and your goal to ${safeCareer.toLowerCase().replace(/\.$/, "")}` : ""}. Take a look:`
    : `Great to meet you. We put together a personalized preview based on your profile${safeCareer ? ` and your goal to ${safeCareer.toLowerCase().replace(/\.$/, "")}` : ""}. Take a look:`;

  // Banner is an image we can embed inline. Reel is an mp4 — most email
  // clients refuse to play <video>, so render a poster card with a play
  // glyph that opens the reel on the live site. If only one exists, show
  // just that; if both, banner inline + reel as a follow-up card.
  let mediaBlocks = "";
  if (safeBanner) {
    mediaBlocks += `<tr><td style="padding:18px 32px 8px;">
        <a href="${safeBanner}" style="display:block;text-decoration:none;">
          <img src="${safeBanner}" alt="Your personalized IE Business School banner" width="536" style="display:block;width:100%;max-width:536px;border-radius:12px;border:0;outline:none;">
        </a>
      </td></tr>`;
  }
  if (safeReel) {
    mediaBlocks += `<tr><td style="padding:${safeBanner ? "8" : "18"}px 32px 8px;">
        <a href="${safeReel}" style="display:block;text-decoration:none;background:#0B1F3A;border-radius:12px;padding:36px 24px;text-align:center;color:#ffffff;">
          <div style="font-size:36px;line-height:1;margin-bottom:10px;">▶</div>
          <div style="font-size:15px;font-weight:600;letter-spacing:0.04em;">Watch your personalized 8-second reel</div>
          <div style="font-size:13px;opacity:0.7;margin-top:4px;">Tap to play in your browser</div>
        </a>
      </td></tr>`;
  }

  const programCta = safeProgramName && safeProgramUrl
    ? `<a href="${safeProgramUrl}" style="display:inline-block;background:#0B1F3A;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:600;font-size:15px;margin-right:8px;margin-bottom:8px;">Explore ${safeProgramName}</a>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your IE Business School preview</title></head>
<body style="margin:0;padding:0;background:#FAF9F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0B1F3A;-webkit-font-smoothing:antialiased;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FAF9F6;">
  <tr><td align="center" style="padding:24px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #EDEAE4;">
      <tr><td style="padding:28px 32px 0;">
        <img src="${LOGO_URL}" alt="IE Business School" width="120" style="display:block;border:0;outline:none;">
      </td></tr>
      <tr><td style="padding:20px 32px 8px;">
        <h1 style="margin:0 0 10px;font-size:26px;font-weight:700;line-height:1.2;color:#0B1F3A;">Hi ${safeFirst},</h1>
        <p style="margin:0;font-size:16px;line-height:1.55;color:#44474d;">${intro}</p>
      </td></tr>
      ${mediaBlocks}
      <tr><td style="padding:8px 32px 24px;">
        ${programCta}<a href="${CHAT_URL}" style="display:inline-block;background:#FF5A5F;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:600;font-size:15px;margin-bottom:8px;">Talk to the AI advisor</a>
      </td></tr>
      <tr><td style="padding:20px 32px;border-top:1px solid #EDEAE4;color:#75777e;font-size:13px;line-height:1.55;">
        <p style="margin:0 0 6px;">If anything in your profile needs an update, just reply to this email.</p>
        <p style="margin:0;">— The IE Creative Studio team</p>
      </td></tr>
    </table>
    <p style="margin:14px 0 0;font-size:12px;color:#75777e;text-align:center;max-width:560px;">Demo built on Claude, Gemini, Veo, Resend &amp; Twilio. Not affiliated with IE Business School.</p>
  </td></tr>
</table>
</body>
</html>`;
}

function buildPersonalizedEmailText({ firstName, bannerUrl, reelUrl, programName, programUrl, careerGoal }) {
  const lines = [
    `Hi ${firstName},`,
    "",
    programName
      ? `We put together a personalized preview based on your interest in ${programName}${careerGoal ? ` and your goal to ${careerGoal.toLowerCase().replace(/\.$/, "")}` : ""}. Take a look:`
      : `Great to meet you. We put together a personalized preview based on your profile${careerGoal ? ` and your goal to ${careerGoal.toLowerCase().replace(/\.$/, "")}` : ""}. Take a look:`,
    "",
  ];
  if (bannerUrl) lines.push(`Banner: ${bannerUrl}`);
  if (reelUrl) lines.push(`Reel (8-sec): ${reelUrl}`);
  lines.push("");
  if (programName && programUrl) lines.push(`Explore ${programName}: ${programUrl}`);
  lines.push(`Talk to the AI advisor: ${CHAT_URL}`);
  lines.push("");
  lines.push("If anything in your profile needs an update, just reply to this email.");
  lines.push("");
  lines.push("— The IE Creative Studio team");
  return lines.join("\n");
}

function buildPersonalizedWhatsapp({ firstName, bannerUrl, reelUrl, programName, programUrl }) {
  const lines = [`Hi ${firstName},`, ""];
  lines.push(
    programName
      ? `Your personalized IE Business School preview is ready — built around your interest in ${programName}.`
      : "Your personalized IE Business School preview is ready.",
  );
  lines.push("");
  if (bannerUrl) lines.push(`Banner: ${bannerUrl}`);
  if (reelUrl) lines.push(`Reel (8-sec): ${reelUrl}`);
  if (programName && programUrl) lines.push(`Program details: ${programUrl}`);
  lines.push(`Chat with the AI advisor: ${CHAT_URL}`);
  lines.push("");
  lines.push("— IE Creative Studio");
  return lines.join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.headers["x-admin-token"] !== adminToken) {
    return res.status(401).json({ error: "invalid admin token" });
  }

  const sql = getSql();
  if (!sql) return res.status(500).json({ error: "DATABASE_URL is not configured" });

  const action = (req.query?.action ?? "students").toString();

  try {
    if (action === "students") return await listStudents(sql, req, res);
    if (action === "creatives") return await listCreatives(sql, req, res);
    if (action === "poll-creative") return await pollCreative(sql, req, res);
    if (action === "delete-lead-creatives") return await deleteLeadCreatives(sql, req, res);
    if (action === "delete-creative") return await deleteCreative(sql, req, res);
    if (action === "send-email" || action === "send-sms" || action === "send-whatsapp") {
      return await sendToLead(sql, req, res, action.replace("send-", ""));
    }
    return res.status(400).json({ error: `unknown action '${action}'` });
  } catch (err) {
    console.error("[admin] error:", err);
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}

async function listStudents(sql, req, res) {
  const limit = Math.min(Number(req.query?.limit ?? 50) || 50, 200);
  const offset = Math.max(Number(req.query?.offset ?? 0) || 0, 0);
  const rows = await sql`
    SELECT
      s.id, s.email, s.full_name, s.country, s.city, s.profile_picture_url,
      s.phone_number,
      s.top_program_interest, s.visual_vibe, s.tone_preference, s.three_words,
      s.career_goal_one_line, s.dream_company_or_industry, s.created_at, s.updated_at,
      (SELECT COUNT(*)::int FROM student_creatives c WHERE c.student_id = s.id) AS creatives_count,
      (SELECT c.url FROM student_creatives c
         WHERE c.student_id = s.id AND c.status = 'completed' AND c.url IS NOT NULL
         ORDER BY c.created_at DESC LIMIT 1) AS latest_creative_url
    FROM students s
    ORDER BY s.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return res.status(200).json({ students: rows });
}

async function listCreatives(sql, req, res) {
  const email = (req.query?.email ?? "").toString().trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email is required" });
  const rows = await sql`
    SELECT c.id, c.format, c.url, c.mime_type, c.width, c.height,
           c.model, c.latency_ms, c.status, c.operation_id, c.error_message, c.created_at
    FROM student_creatives c
    JOIN students s ON s.id = c.student_id
    WHERE s.email = ${email}
    ORDER BY c.created_at DESC
  `;
  return res.status(200).json({ creatives: rows });
}

// Poll a pending video creative; if Veo is done, finalize it (upload to Blob,
// update the row, return the completed record).
async function pollCreative(sql, req, res) {
  const id = (req.query?.id ?? "").toString().trim();
  if (!id) return res.status(400).json({ error: "id is required" });

  const [row] = await sql`
    SELECT c.*, s.email
    FROM student_creatives c
    JOIN students s ON s.id = c.student_id
    WHERE c.id = ${id}
    LIMIT 1
  `;
  if (!row) return res.status(404).json({ error: "creative not found" });

  // Already terminal — return as-is.
  if (row.status === "completed" || row.status === "failed") {
    return res.status(200).json({ creative: row });
  }

  if (!row.operation_id) {
    await sql`UPDATE student_creatives SET status='failed', error_message=${"missing operation_id"} WHERE id = ${id}`;
    return res.status(200).json({ creative: { ...row, status: "failed", error_message: "missing operation_id" } });
  }

  let op;
  try {
    op = await getOperation(row.operation_id);
  } catch (err) {
    console.error("[admin/poll] Veo poll error:", err);
    return res.status(502).json({ error: `Veo poll failed: ${err.message}` });
  }

  if (!op?.done) {
    return res.status(200).json({ creative: { ...row, status: "pending" } });
  }

  // Done — could be success or failure.
  if (op.error) {
    const msg = op.error?.message ?? "Veo reported error";
    await sql`UPDATE student_creatives SET status='failed', error_message=${msg} WHERE id = ${id}`;
    return res.status(200).json({ creative: { ...row, status: "failed", error_message: msg } });
  }

  const videoRef = extractVideoFromResult(op);
  if (!videoRef) {
    const msg = "Veo finished with no video in result";
    await sql`UPDATE student_creatives SET status='failed', error_message=${msg} WHERE id = ${id}`;
    return res.status(200).json({ creative: { ...row, status: "failed", error_message: msg } });
  }
  if (videoRef.rejected) {
    const msg = `Veo safety filter blocked the reel: ${videoRef.rejected}`;
    await sql`UPDATE student_creatives SET status='failed', error_message=${msg} WHERE id = ${id}`;
    return res.status(200).json({ creative: { ...row, status: "failed", error_message: msg } });
  }

  // Download bytes + upload to Blob.
  let blobUrl;
  let mime = videoRef.mime || "video/mp4";
  try {
    const bytes = await downloadVideoBytes(videoRef);
    const safeEmail = row.email.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const filename = `creatives/${safeEmail}/reel-${Date.now()}.mp4`;
    const blob = await put(filename, bytes, {
      access: "public",
      contentType: mime,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    blobUrl = blob.url;
  } catch (err) {
    console.error("[admin/poll] Blob upload error:", err);
    const msg = `Blob upload failed: ${err.message}`;
    await sql`UPDATE student_creatives SET status='failed', error_message=${msg} WHERE id = ${id}`;
    return res.status(502).json({ error: msg });
  }

  // Compute latency from creation time → completion now.
  const latencyMs = Date.now() - new Date(row.created_at).getTime();
  const [updated] = await sql`
    UPDATE student_creatives
    SET status='completed', url=${blobUrl}, mime_type=${mime}, latency_ms=${latencyMs}
    WHERE id = ${id}
    RETURNING id, format, url, mime_type, width, height, model, latency_ms, status, created_at
  `;

  return res.status(200).json({ creative: updated });
}

// Delete every creative row for the given lead's email, and best-effort
// delete the underlying Vercel Blob files. Keeps the student profile.
async function deleteLeadCreatives(sql, req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST required" });
  }

  const body = await readJsonBody(req);
  const email = (body?.email ?? req.query?.email ?? "").toString().trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email is required" });

  const rows = await sql`
    DELETE FROM student_creatives
    WHERE student_id = (SELECT id FROM students WHERE email = ${email})
    RETURNING url
  `;

  const urls = rows.map((r) => r.url).filter(Boolean);
  const blobErrors = [];
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  for (const url of urls) {
    try {
      await del(url, blobToken ? { token: blobToken } : undefined);
    } catch (err) {
      blobErrors.push({ url, error: err?.message ?? String(err) });
    }
  }

  return res.status(200).json({
    deleted: rows.length,
    blob_deleted: urls.length - blobErrors.length,
    blob_errors: blobErrors,
  });
}

// Delete a single creative by id. Returns the deleted row's url and a flag
// indicating whether the Blob file deletion succeeded.
async function deleteCreative(sql, req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST required" });
  }
  const body = await readJsonBody(req);
  const id = (body?.id ?? req.query?.id ?? "").toString().trim();
  if (!id) return res.status(400).json({ error: "id is required" });

  const [row] = await sql`
    DELETE FROM student_creatives WHERE id = ${id} RETURNING id, url
  `;
  if (!row) return res.status(404).json({ error: "creative not found" });

  let blobDeleted = false;
  let blobError = null;
  if (row.url) {
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    try {
      await del(row.url, blobToken ? { token: blobToken } : undefined);
      blobDeleted = true;
    } catch (err) {
      blobError = err?.message ?? String(err);
    }
  }

  return res.status(200).json({ deleted: true, id: row.id, blob_deleted: blobDeleted, blob_error: blobError });
}

// Send a templated demo message to a lead via the chosen channel.
// `channel` is "email" | "sms" | "whatsapp".
async function sendToLead(sql, req, res, channel) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST required" });
  }
  const body = await readJsonBody(req);
  const email = (body?.email ?? "").toString().trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email is required" });

  const [row] = await sql`
    SELECT s.email, s.full_name, s.phone_number,
      s.top_program_interest, s.career_goal_one_line,
      (SELECT c.url FROM student_creatives c
         WHERE c.student_id = s.id AND c.status = 'completed' AND c.url IS NOT NULL AND c.format = 'banner'
         ORDER BY c.created_at DESC LIMIT 1) AS latest_banner_url,
      (SELECT c.url FROM student_creatives c
         WHERE c.student_id = s.id AND c.status = 'completed' AND c.url IS NOT NULL AND c.format = 'reel'
         ORDER BY c.created_at DESC LIMIT 1) AS latest_reel_url
    FROM students s
    WHERE s.email = ${email}
    LIMIT 1
  `;
  if (!row) return res.status(404).json({ error: "student not found" });

  const bannerUrl = row.latest_banner_url;
  const reelUrl = row.latest_reel_url;
  if (!bannerUrl && !reelUrl) {
    return res.status(400).json({ error: "no creative to share yet — generate a banner or reel first" });
  }
  // SMS still wants a single URL — prefer the banner (image preview shows
  // a richer card when pasted into chat clients), fall back to the reel.
  const smsCreativeUrl = bannerUrl || reelUrl;

  const firstName = (row.full_name || "").trim().split(/\s+/)[0] || "there";
  const program = row.top_program_interest ? PROGRAM_BY_SLUG.get(row.top_program_interest) : null;
  const programName = program?.name || null;
  const programUrl = program?.url || null;
  const careerGoal = (row.career_goal_one_line || "").trim() || null;

  try {
    if (channel === "email") {
      const subject = programName
        ? `${firstName}, your IE ${programName} preview is ready`
        : `${firstName}, your IE Business School preview is ready`;
      const html = buildPersonalizedEmail({ firstName, bannerUrl, reelUrl, programName, programUrl, careerGoal });
      const text = buildPersonalizedEmailText({ firstName, bannerUrl, reelUrl, programName, programUrl, careerGoal });
      const { id } = await sendEmail({ to: row.email, subject, body: text, html });
      return res.status(200).json({ ok: true, channel, provider_id: id });
    }

    if (!row.phone_number) {
      return res.status(400).json({ error: "no phone number on file" });
    }

    if (channel === "whatsapp") {
      const waBody = buildPersonalizedWhatsapp({ firstName, bannerUrl, reelUrl, programName, programUrl });
      const { sid } = await sendWhatsapp({ to: row.phone_number, body: waBody });
      return res.status(200).json({ ok: true, channel, provider_id: sid });
    }

    if (channel === "sms") {
      // SMS stays one-liner: 160-char-friendly across carriers.
      const smsBody = `Hi ${firstName}! Your personalized IE Business School preview is ready: ${smsCreativeUrl}`;
      const { sid } = await sendSms({ to: row.phone_number, body: smsBody });
      return res.status(200).json({ ok: true, channel, provider_id: sid });
    }
    return res.status(400).json({ error: `unknown channel '${channel}'` });
  } catch (err) {
    // Surface the error message at the top of the log line so Vercel's log
    // viewer doesn't truncate it. err.message contains the provider's actual
    // failure reason (e.g. "Twilio: Channel could not find To address").
    console.error(`[admin] send-${channel} error: ${err?.message ?? String(err)}`);
    return res.status(502).json({ error: err?.message ?? `send-${channel} failed` });
  }
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise((resolve) => {
    let buf = "";
    req.on("data", (chunk) => { buf += chunk; });
    req.on("end", () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

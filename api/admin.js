import { put, del } from "@vercel/blob";
import { getSql } from "../lib/db.js";
import { getOperation, extractVideoFromResult, downloadVideoBytes } from "../lib/veo.js";

export const config = { maxDuration: 30 };

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

import { getSql } from "../lib/db.js";

export const config = { maxDuration: 15 };

const ALLOWED_FORMATS = new Set(["banner", "reel", "all"]);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sql = getSql();
  if (!sql) return res.status(500).json({ error: "DATABASE_URL is not configured" });

  const rawLimit = Number(req.query?.limit ?? 12);
  const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 12, 48));
  const formatParam = (req.query?.format ?? "banner").toString();
  const format = ALLOWED_FORMATS.has(formatParam) ? formatParam : "banner";

  try {
    let rows;
    if (format === "all") {
      rows = await sql`
        SELECT url, format, width, height, mime_type, created_at
        FROM student_creatives
        WHERE status = 'completed' AND url IS NOT NULL
        ORDER BY RANDOM()
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT url, format, width, height, mime_type, created_at
        FROM student_creatives
        WHERE format = ${format} AND status = 'completed' AND url IS NOT NULL
        ORDER BY RANDOM()
        LIMIT ${limit}
      `;
    }
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
    return res.status(200).json({ creatives: rows });
  } catch (err) {
    console.error("[public-creatives] error:", err);
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}

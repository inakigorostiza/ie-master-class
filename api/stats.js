import { getSql } from "../lib/db.js";

export const config = { maxDuration: 15 };

const WINDOWS = {
  "24h": "1 day",
  "7d": "7 days",
  "30d": "30 days",
  all: null,
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sql = getSql();
  if (!sql) return res.status(500).json({ error: "DATABASE_URL is not configured" });

  const windowParam = (req.query?.window ?? "30d").toString();
  const interval = WINDOWS[windowParam] ?? WINDOWS["30d"];

  // Build a single time-filter SQL fragment we can splice into every query.
  // Neon's sql tag supports embedding sql fragments via sql.unsafe / sql.query;
  // simpler: pass the interval as a parameter and use a NULL-safe boolean.
  const sinceCondition = interval
    ? sql`created_at >= NOW() - (${interval}::interval)`
    : sql`TRUE`;

  try {
    const [
      totalsRows,
      byProvider,
      byModel,
      bySurface,
      daily,
      studentsCount,
    ] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int AS calls,
          COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
          COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
          COALESCE(SUM(cached_tokens), 0)::bigint AS cached_tokens,
          COALESCE(SUM(audio_seconds), 0)::numeric AS audio_seconds,
          COALESCE(SUM(image_count), 0)::int AS image_count,
          COALESCE(SUM(cost_usd), 0)::numeric AS cost_usd,
          COALESCE(SUM(cost_eur), 0)::numeric AS cost_eur
        FROM agent_usage WHERE ${sinceCondition}
      `,
      sql`
        SELECT provider,
               COUNT(*)::int AS calls,
               COALESCE(SUM(cost_eur), 0)::numeric AS cost_eur
        FROM agent_usage WHERE ${sinceCondition}
        GROUP BY provider ORDER BY cost_eur DESC
      `,
      sql`
        SELECT model, provider,
               (ARRAY_AGG(surface ORDER BY created_at DESC))[1] AS surface,
               COUNT(*)::int AS calls,
               COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
               COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
               COALESCE(SUM(audio_seconds), 0)::numeric AS audio_seconds,
               COALESCE(SUM(image_count), 0)::int AS image_count,
               COALESCE(SUM(cost_eur), 0)::numeric AS cost_eur
        FROM agent_usage WHERE ${sinceCondition} AND model IS NOT NULL
        GROUP BY model, provider ORDER BY cost_eur DESC
      `,
      sql`
        SELECT surface,
               COUNT(*)::int AS calls,
               COALESCE(SUM(cost_eur), 0)::numeric AS cost_eur
        FROM agent_usage WHERE ${sinceCondition}
        GROUP BY surface ORDER BY cost_eur DESC
      `,
      sql`
        SELECT DATE_TRUNC('day', created_at)::date AS day,
               COUNT(*)::int AS calls,
               COALESCE(SUM(cost_eur), 0)::numeric AS cost_eur
        FROM agent_usage WHERE ${sinceCondition}
        GROUP BY day ORDER BY day
      `,
      sql`SELECT COUNT(*)::int AS n FROM students`,
    ]);

    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
    return res.status(200).json({
      window: windowParam in WINDOWS ? windowParam : "30d",
      as_of: new Date().toISOString(),
      totals: totalsRows[0] ?? {},
      students_total: studentsCount[0]?.n ?? 0,
      by_provider: byProvider,
      by_model: byModel,
      by_surface: bySurface,
      daily,
    });
  } catch (err) {
    console.error("[stats] error:", err);
    return res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
}

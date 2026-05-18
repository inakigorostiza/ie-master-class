import { getSql } from "./db.js";
import { computeUsdCost, providerFor, USD_TO_EUR } from "./pricing.js";

// Fire-and-forget telemetry logger. DB failure is non-fatal — never break a
// user-facing path because the stats table couldn't accept a row.
export async function logUsage({
  surface,
  model,
  provider,
  input_tokens,
  output_tokens,
  cached_tokens,
  input_chars,
  audio_seconds,
  image_count,
  latency_ms,
  student_email,
  meta,
}) {
  const resolvedProvider = provider ?? providerFor(model);
  const cost_usd = computeUsdCost({
    model,
    input_tokens,
    output_tokens,
    cached_tokens,
    input_chars,
    audio_seconds,
    image_count,
  });
  const cost_eur = cost_usd * USD_TO_EUR;

  const sql = getSql();
  if (!sql) {
    console.log(`[usage] (no db) surface=${surface} model=${model} eur=${cost_eur.toFixed(4)}`);
    return;
  }

  try {
    await sql`
      INSERT INTO agent_usage (
        surface, provider, model,
        input_tokens, output_tokens, cached_tokens,
        input_chars, audio_seconds, image_count,
        cost_usd, cost_eur, latency_ms,
        student_email, meta
      ) VALUES (
        ${surface}, ${resolvedProvider}, ${model ?? null},
        ${input_tokens ?? null}, ${output_tokens ?? null}, ${cached_tokens ?? null},
        ${input_chars ?? null}, ${audio_seconds ?? null}, ${image_count ?? null},
        ${cost_usd}, ${cost_eur}, ${latency_ms ?? null},
        ${student_email ?? null},
        ${meta ? JSON.stringify(meta) : null}::jsonb
      )
    `;
  } catch (err) {
    console.warn("[usage] insert failed (non-fatal):", err.message);
  }
}

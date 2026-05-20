import Anthropic from "@anthropic-ai/sdk";
import { KB_TEXT, FILTERED_KB_TEXT, MODEL, SYSTEM_INSTRUCTIONS, allPrograms } from "../lib/kb.js";
import { getSql } from "../lib/db.js";
import { logUsage } from "../lib/usage.js";

// slug → human-readable program name. Built from the full catalog so a
// student who picked a dual-degree slug on /all/ still gets their program
// name resolved here, even though the landing grid is allowlisted to 6.
const PROGRAM_NAME_BY_SLUG = new Map(allPrograms.map((p) => [p.slug, p.name]));

function buildStudentContext(s) {
  if (!s) return null;
  const first = (s.full_name ?? "").split(/\s+/)[0] || s.full_name || "";
  const programName =
    PROGRAM_NAME_BY_SLUG.get(s.top_program_interest) || s.top_program_interest || null;
  const roleLine =
    [s.job_role, s.current_company && `at ${s.current_company}`]
      .filter(Boolean)
      .join(" ");
  const expLine =
    s.years_experience != null ? `${s.years_experience}y experience` : null;
  const threeWords = Array.isArray(s.three_words) ? s.three_words.filter(Boolean).join(", ") : null;

  const lines = [
    `- Name: ${s.full_name}${first ? ` (first name: ${first})` : ""}`,
    [s.city, s.country].filter(Boolean).length
      ? `- Location: ${[s.city, s.country].filter(Boolean).join(", ")}`
      : null,
    s.preferred_language ? `- Preferred language: ${s.preferred_language}` : null,
    [roleLine, expLine].filter(Boolean).length
      ? `- Current role: ${[roleLine, expLine].filter(Boolean).join(", ")}`
      : null,
    s.undergrad_field ? `- Background: ${s.undergrad_field}` : null,
    programName ? `- Top program of interest: ${programName}` : null,
    s.career_goal_one_line ? `- Career goal: ${s.career_goal_one_line}` : null,
    s.dream_company_or_industry ? `- Dream company / industry: ${s.dream_company_or_industry}` : null,
    threeWords ? `- Three self-descriptors: ${threeWords}` : null,
    s.tone_preference ? `- Tone preference: ${s.tone_preference}` : null,
  ].filter(Boolean);

  return `STUDENT CONTEXT (the visitor identified themselves via the personalization form on this site; weave these facts naturally into your answers when relevant. Address them by first name when it feels natural — don't recite the whole profile back to them in a single reply.):
${lines.join("\n")}

If their question is general (e.g. "what programs do you offer?"), prioritize their top program of interest and adjacent programs. If they ask about specific programs, compare with their career goal and dream company in mind. Match their tone preference in your reply.`;
}

async function lookupStudent(email) {
  if (!email || typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT full_name, country, city, preferred_language,
             job_role, current_company, years_experience, undergrad_field,
             top_program_interest, career_goal_one_line, dream_company_or_industry,
             visual_vibe, tone_preference, three_words
      FROM students
      WHERE email = ${normalized}
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch (err) {
    console.warn("[chat] student lookup failed (continuing anonymously):", err.message);
    return null;
  }
}

export const config = {
  maxDuration: 60,
};

const anthropic = new Anthropic();

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

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured" });
  }

  const body = await readJsonBody(req);
  const messages = body?.messages;
  const studentEmail = body?.student_email;
  // Pages set full_catalog=true (via window.SHOW_ALL_PROGRAMS on /all/) to
  // unlock the entire 23-program KB. Default (/, /agents/) stays scoped
  // to the 6-program FILTERED_KB_TEXT so the marketing demo doesn't
  // surface dual degrees or executive masters in chat.
  const useFullCatalog = body?.full_catalog === true;
  const activeKb = useFullCatalog ? KB_TEXT : FILTERED_KB_TEXT;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array" });
  }

  const cleaned = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }));

  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== "user") {
    return res.status(400).json({ error: "last message must be from the user" });
  }

  // Best-effort student lookup. DB failure is non-fatal; we fall back to
  // the anonymous prompt rather than breaking the chat.
  const student = await lookupStudent(studentEmail);
  const studentContext = buildStudentContext(student);
  if (student) console.log(`[chat] personalized for ${studentEmail}`);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.socket?.setNoDelay?.(true);
  res.write(":ok\n\n");

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  let closed = false;
  res.on("close", () => {
    closed = true;
  });

  const t0 = Date.now();
  try {
    const stream = anthropic.messages
      .stream({
        model: MODEL,
        max_tokens: 1024,
        system: [
          { type: "text", text: SYSTEM_INSTRUCTIONS },
          { type: "text", text: activeKb, cache_control: { type: "ephemeral" } },
          // Per-user student profile (uncached) — placed AFTER the cache
          // breakpoint so the KB cache stays valid across all callers.
          ...(studentContext ? [{ type: "text", text: studentContext }] : []),
        ],
        messages: cleaned,
      })
      .on("text", (delta) => {
        if (closed) return;
        res.write(`data: ${JSON.stringify({ type: "delta", text: delta })}\n\n`);
      });

    const final = await stream.finalMessage();

    if (final.usage) {
      const u = final.usage;
      console.log(
        `[chat] in=${u.input_tokens} out=${u.output_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0}`,
      );
      logUsage({
        surface: "chat",
        model: MODEL,
        input_tokens: u.input_tokens ?? 0,
        output_tokens: u.output_tokens ?? 0,
        cached_tokens: u.cache_read_input_tokens ?? 0,
        latency_ms: Date.now() - t0,
        student_email: studentEmail ?? null,
        meta: { cache_write: u.cache_creation_input_tokens ?? 0, turns: cleaned.length },
      }).catch(() => {});
    }

    if (!closed) {
      send({ type: "done" });
      res.end();
    }
  } catch (err) {
    console.error("[chat] error:", err);
    if (!closed) {
      send({ type: "error", message: err?.message ?? "Unknown error" });
      res.end();
    }
  }
}

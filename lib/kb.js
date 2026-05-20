import fs from "node:fs";
import path from "node:path";

const KB_DIR = path.join(process.cwd(), "knowledge_base");

// TEMPORARY: restrict the chatbot + landing page to a subset of programs.
// To restore the full 23-program catalog, set this to `null` (or delete the
// constant entirely — both branches below handle the null case).
const ENABLED_PROGRAM_SLUGS = new Set([
  "creative-direction-content-branding",
  "customer-experience-innovation",
  "digital-marketing",
  "market-research-consumer-behavior",
  "strategic-marketing-communication",
  "executive-strategic-marketing-communication",
]);

const ALL_RECORDS = fs
  .readFileSync(path.join(KB_DIR, "programs.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const ACTIVE_RECORDS = ENABLED_PROGRAM_SLUGS
  ? ALL_RECORDS.filter((p) => ENABLED_PROGRAM_SLUGS.has(p.slug))
  : ALL_RECORDS;

function flatten(p) {
  return {
    slug: p.slug,
    name: p.name,
    url: p.url,
    category: p.category,
    overview: (p.sections?.overview ?? "").trim(),
    format: (p.sections?.format ?? "").trim(),
  };
}

export const programs = ACTIVE_RECORDS.map(flatten);
// Full unfiltered catalog — used by the /all/ page (and the ?all=1
// query on /api/programs) to bypass the temporary allowlist.
export const allPrograms = ALL_RECORDS.map(flatten);

// When the allowlist is active, rebuild KB_TEXT from JSONL sections so the
// chatbot's system prompt only mentions allowed programs. When disabled,
// fall back to the full combined.md just like before.
const SECTION_ORDER = [
  ["overview", "Overview"],
  ["format", "Format"],
  ["curriculum", "Curriculum"],
  ["admissions", "Admissions"],
  ["fees_and_funding", "Fees and funding"],
  ["career", "Career"],
  ["faculty", "Faculty"],
  ["contact", "Contact"],
];

function buildKbText(records) {
  return records
    .map((p) => {
      const s = p.sections || {};
      const body = SECTION_ORDER.filter(([key]) => s[key])
        .map(([key, label]) => `## ${label}\n\n${String(s[key]).trim()}`)
        .join("\n\n");
      return `# ${p.name}\n\nURL: ${p.url}\nCategory: ${p.category}\n\n${body}`;
    })
    .join("\n\n---\n\n");
}

// KB_TEXT always covers the full 23-program catalog so the chatbot can
// answer about any program the user picks (including dual degrees) even
// when /api/programs is allowlisted down to a subset for the landing
// grid. buildKbText is kept available for callers that want a scoped KB.
export const KB_TEXT = fs.readFileSync(path.join(KB_DIR, "combined.md"), "utf8");
export const FILTERED_KB_TEXT = ENABLED_PROGRAM_SLUGS
  ? buildKbText(ACTIVE_RECORDS)
  : KB_TEXT;

export const MODEL = "claude-haiku-4-5";

export const SYSTEM_INSTRUCTIONS = `You are an admissions advisor for IE Business School's master programs.

Rules:
- Answer ONLY using the knowledge base provided below. If the answer isn't in the KB, say so clearly and suggest contacting IE directly (https://www.ie.edu).
- When you reference a program, cite its exact name and URL (e.g. "Master in Digital Marketing — https://www.ie.edu/business-school/programs/masters/master-in-digital-marketing/").
- Be concise. Use bullet points when comparing programs or listing attributes.
- Tone: warm, professional, helpful — you are talking to a prospective student.
- Do not invent tuition figures, application deadlines, GMAT cutoffs, or contact emails. If the KB lacks the info, say so.

Knowledge base follows.`;

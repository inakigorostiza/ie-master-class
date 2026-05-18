import fs from "node:fs";
import path from "node:path";

const KB_DIR = path.join(process.cwd(), "knowledge_base");

export const KB_TEXT = fs.readFileSync(path.join(KB_DIR, "combined.md"), "utf8");

export const programs = fs
  .readFileSync(path.join(KB_DIR, "programs.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const p = JSON.parse(line);
    return {
      slug: p.slug,
      name: p.name,
      url: p.url,
      category: p.category,
      overview: (p.sections?.overview ?? "").trim(),
      format: (p.sections?.format ?? "").trim(),
    };
  });

export const MODEL = "claude-haiku-4-5";

export const SYSTEM_INSTRUCTIONS = `You are an admissions advisor for IE Business School's master programs.

Rules:
- Answer ONLY using the knowledge base provided below. If the answer isn't in the KB, say so clearly and suggest contacting IE directly (https://www.ie.edu).
- When you reference a program, cite its exact name and URL (e.g. "Master in Digital Marketing — https://www.ie.edu/business-school/programs/masters/master-in-digital-marketing/").
- Be concise. Use bullet points when comparing programs or listing attributes.
- Tone: warm, professional, helpful — you are talking to a prospective student.
- Do not invent tuition figures, application deadlines, GMAT cutoffs, or contact emails. If the KB lacks the info, say so.

Knowledge base follows.`;

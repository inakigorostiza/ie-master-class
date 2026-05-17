import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY. Copy .env.example to .env and set your key.");
  process.exit(1);
}

const KB_DIR = path.join(__dirname, "knowledge_base");
const KB_TEXT = fs.readFileSync(path.join(KB_DIR, "combined.md"), "utf8");

const programs = fs
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

console.log(`Loaded ${programs.length} programs and ${(KB_TEXT.length / 1024).toFixed(1)} KB of KB text.`);

const MODEL = "claude-haiku-4-5";
const SYSTEM_INSTRUCTIONS = `You are an admissions advisor for IE Business School's master programs.

Rules:
- Answer ONLY using the knowledge base provided below. If the answer isn't in the KB, say so clearly and suggest contacting IE directly (https://www.ie.edu).
- When you reference a program, cite its exact name and URL (e.g. "Master in Digital Marketing — https://www.ie.edu/business-school/programs/masters/master-in-digital-marketing/").
- Be concise. Use bullet points when comparing programs or listing attributes.
- Tone: warm, professional, helpful — you are talking to a prospective student.
- Do not invent tuition figures, application deadlines, GMAT cutoffs, or contact emails. If the KB lacks the info, say so.

Knowledge base follows.`;

const anthropic = new Anthropic();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/programs", (_req, res) => {
  res.json(programs);
});

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array" });
  }

  const cleaned = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }));

  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== "user") {
    return res.status(400).json({ error: "last message must be from the user" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.socket?.setNoDelay?.(true);
  // initial keepalive comment to defeat any proxy/browser buffering of the first chunk
  res.write(":ok\n\n");

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  let closed = false;
  res.on("close", () => {
    closed = true;
  });

  try {
    const stream = anthropic.messages
      .stream({
        model: MODEL,
        max_tokens: 1024,
        system: [
          { type: "text", text: SYSTEM_INSTRUCTIONS },
          { type: "text", text: KB_TEXT, cache_control: { type: "ephemeral" } },
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
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`IE chatbot running at http://localhost:${PORT}`);
});

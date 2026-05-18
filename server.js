import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import chatHandler from "./api/chat.js";
import programsHandler from "./api/programs.js";
import transcribeHandler from "./api/transcribe.js";
import ttsHandler from "./api/tts.js";
import heygenHandler from "./api/heygen.js";
import statsHandler from "./api/stats.js";
import elevenlabsVoicesHandler from "./api/elevenlabs-voices.js";
import uploadPhotoHandler from "./api/upload-photo.js";
import personalizeHandler from "./api/personalize.js";
import generateCreativeHandler from "./api/generate-creative.js";
import adminHandler from "./api/admin.js";
import publicCreativesHandler from "./api/public-creatives.js";
import { programs, KB_TEXT } from "./lib/kb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY. Copy .env.example to .env and set your key.");
  process.exit(1);
}

console.log(`Loaded ${programs.length} programs and ${(KB_TEXT.length / 1024).toFixed(1)} KB of KB text.`);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/programs", programsHandler);
app.post("/api/chat", chatHandler);
app.post("/api/transcribe", transcribeHandler);
app.post("/api/tts", ttsHandler);
app.post("/api/heygen", heygenHandler);
app.get("/api/heygen", heygenHandler);
app.get("/api/stats", statsHandler);
app.get("/api/elevenlabs-voices", elevenlabsVoicesHandler);
app.post("/api/upload-photo", uploadPhotoHandler);
app.post("/api/personalize", personalizeHandler);
app.post("/api/generate-creative", generateCreativeHandler);
app.get("/api/admin", adminHandler);
app.get("/api/public-creatives", publicCreativesHandler);

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`IE chatbot running at http://localhost:${PORT}`);
});

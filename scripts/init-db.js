import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const url =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.POSTGRES_PRISMA_URL;
if (!url) {
  console.error("Missing DATABASE_URL. Set it in .env (Vercel → Storage → Neon auto-injects it).");
  process.exit(1);
}

const sqlPath = path.join(__dirname, "..", "lib", "migrations", "students.sql");
const sqlText = fs.readFileSync(sqlPath, "utf8");

const sql = neon(url);

// Split on `;` at end of statements (the migration file uses simple statements).
const statements = sqlText
  .split(/;\s*$/m)
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

console.log(`Running ${statements.length} statement(s) against the database…`);

for (const stmt of statements) {
  const preview = stmt.replace(/\s+/g, " ").slice(0, 80);
  process.stdout.write(`  • ${preview}${stmt.length > 80 ? "…" : ""}  `);
  try {
    await sql.query(stmt);
    console.log("✓");
  } catch (err) {
    console.log("✗");
    console.error("    error:", err?.message ?? err);
    process.exit(1);
  }
}

const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM students`;
console.log(`\n✓ migration complete — students table is ready (${count} rows).`);

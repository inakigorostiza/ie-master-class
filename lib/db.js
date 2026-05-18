import { neon } from "@neondatabase/serverless";

let sql = null;

export function getSql() {
  if (!sql) {
    const url =
      process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.POSTGRES_PRISMA_URL;
    if (!url) return null;
    sql = neon(url);
  }
  return sql;
}

// One-shot script: restore clubos_backup.sql into the Supabase Postgres
// pointed to by DATABASE_URL. Strips psql-only directives, runs the rest
// in a single transaction so any error rolls back cleanly.
//
// Usage:
//   1. Put your Supabase DATABASE_URL in .env (DATABASE_URL=postgresql://...)
//   2. Run:  npx tsx script/restore-to-supabase.ts

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";

function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(resolve(process.cwd(), ".env"));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env and try again.");
  process.exit(1);
}

const dumpPath = resolve(process.cwd(), "clubos_backup.sql");
if (!existsSync(dumpPath)) {
  console.error(`Dump not found at ${dumpPath}`);
  process.exit(1);
}

const raw = readFileSync(dumpPath, "utf8");

// Strip psql-only backslash commands. They're not valid SQL.
const cleaned = raw
  .split("\n")
  .filter((line) => {
    const t = line.trimStart();
    return !(t.startsWith("\\restrict") || t.startsWith("\\unrestrict"));
  })
  .join("\n");

const host = (() => {
  try {
    const u = new URL(DATABASE_URL);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return "(unparseable URL)";
  }
})();

console.log(`→ Connecting to ${host}`);
console.log(`→ Dump size: ${(cleaned.length / 1024 / 1024).toFixed(2)} MB`);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    console.log("→ Beginning restore (single transaction)…");
    const start = Date.now();
    await client.query(cleaned);
    const ms = Date.now() - start;
    console.log(`✓ Restore completed in ${(ms / 1000).toFixed(2)}s`);

    const tables = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
    );
    console.log(`\n→ Tables in public schema (${tables.rowCount}):`);
    for (const r of tables.rows) console.log(`  · ${r.tablename}`);

    console.log("\n→ Row counts (top 10 by size):");
    const counts = await client.query(`
      SELECT relname AS table, n_live_tup AS rows
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY n_live_tup DESC NULLS LAST
      LIMIT 10
    `);
    for (const r of counts.rows) console.log(`  · ${r.table}: ${r.rows}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ Restore failed: ${msg}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();

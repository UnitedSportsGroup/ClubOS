// Direct DB-to-DB data sync. Connects to source (prod Neon, via
// PROD_DATABASE_URL) and destination (Supabase, via DATABASE_URL in .env),
// copies all data table-by-table in dependency-safe order. Schema is assumed
// to already match (from the earlier pg_dump restore).
//
// Usage:
//   PROD_DATABASE_URL="postgresql://prod..." npx tsx script/sync-prod-to-supabase.ts
//
// Safe to run multiple times — TRUNCATE CASCADE wipes target tables first.

import "dotenv/config";
import { Pool } from "pg";

const SOURCE_URL = process.env.PROD_DATABASE_URL;
const TARGET_URL = process.env.DATABASE_URL;

if (!SOURCE_URL) {
  console.error("PROD_DATABASE_URL is not set.");
  process.exit(1);
}
if (!TARGET_URL) {
  console.error("DATABASE_URL is not set in .env.");
  process.exit(1);
}

const source = new Pool({
  connectionString: SOURCE_URL,
  ssl: { rejectUnauthorized: false },
});
const target = new Pool({
  connectionString: TARGET_URL,
  ssl: { rejectUnauthorized: false },
});

async function listPublicTables(pool: Pool): Promise<string[]> {
  const r = await pool.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  return r.rows.map((row) => row.tablename as string);
}

async function getTableColumns(pool: Pool, table: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [table]
  );
  return r.rows.map((row) => row.column_name as string);
}

async function hasGeneratedAlwaysIdentity(pool: Pool, table: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
       AND is_identity='YES' AND identity_generation='ALWAYS'
     LIMIT 1`,
    [table]
  );
  return r.rowCount! > 0;
}

async function getRowCount(pool: Pool, table: string): Promise<number> {
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
  return r.rows[0].n;
}

async function copyTable(table: string): Promise<{ copied: number; skipped: boolean }> {
  const sourceCols = await getTableColumns(source, table);
  const targetCols = await getTableColumns(target, table);

  const targetSet = new Set(targetCols);
  const sharedCols = sourceCols.filter((c) => targetSet.has(c));
  if (sharedCols.length === 0) {
    return { copied: 0, skipped: true };
  }

  const sourceRowCount = await getRowCount(source, table);
  if (sourceRowCount === 0) {
    return { copied: 0, skipped: false };
  }

  const colList = sharedCols.map((c) => `"${c}"`).join(", ");
  const selectQ = `SELECT ${colList} FROM "${table}"`;
  const sourceRes = await source.query(selectQ);

  const needsOverride = await hasGeneratedAlwaysIdentity(target, table);
  const overrideClause = needsOverride ? " OVERRIDING SYSTEM VALUE" : "";

  const client = await target.connect();
  try {
    await client.query("BEGIN");
    await client.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);

    const placeholderRow = (rowIdx: number) =>
      "(" + sharedCols.map((_, i) => `$${rowIdx * sharedCols.length + i + 1}`).join(", ") + ")";

    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < sourceRes.rows.length; i += BATCH) {
      const slice = sourceRes.rows.slice(i, i + BATCH);
      const placeholders = slice.map((_, idx) => placeholderRow(idx)).join(", ");
      const values: unknown[] = [];
      for (const row of slice) {
        for (const c of sharedCols) values.push(row[c]);
      }
      const insertQ = `INSERT INTO "${table}" (${colList})${overrideClause} VALUES ${placeholders}`;
      await client.query(insertQ, values);
      inserted += slice.length;
    }

    await client.query("COMMIT");
    return { copied: inserted, skipped: false };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function resetSequences() {
  // After bulk INSERT with explicit IDs, sequences are stale. Reset each
  // sequence to the max(id)+1 of its owning table.
  const r = await target.query(`
    SELECT pg_get_serial_sequence(quote_ident(table_name), column_name) AS seq,
           table_name AS t, column_name AS c
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_default LIKE 'nextval%'
  `);
  for (const row of r.rows) {
    if (!row.seq) continue;
    try {
      await target.query(
        `SELECT setval($1, COALESCE((SELECT MAX("${row.c}") FROM "${row.t}"), 0) + 1, false)`,
        [row.seq]
      );
    } catch (err) {
      console.warn(
        `  ! sequence reset failed for ${row.t}.${row.c}: ${(err as Error).message.slice(0, 80)}`
      );
    }
  }
}

async function main() {
  const sourceHost = new URL(SOURCE_URL!).hostname;
  const targetHost = new URL(TARGET_URL!).hostname;
  console.log(`→ Source:  ${sourceHost}`);
  console.log(`→ Target:  ${targetHost}\n`);

  const sourceTables = await listPublicTables(source);
  const targetTables = await listPublicTables(target);
  const targetSet = new Set(targetTables);

  // Disable FK checks for the duration of the sync — copy in any order, then
  // re-enable. This avoids needing topological ordering.
  console.log("→ Disabling triggers (FK checks) on target…");
  await target.query("SET session_replication_role = 'replica'");

  let totalRowsCopied = 0;
  const errors: { table: string; msg: string }[] = [];

  for (const table of sourceTables) {
    if (!targetSet.has(table)) {
      console.log(`  ⏭  ${table.padEnd(28)} (not in target schema)`);
      continue;
    }
    try {
      const { copied, skipped } = await copyTable(table);
      if (skipped) {
        console.log(`  ⏭  ${table.padEnd(28)} (no shared columns)`);
      } else {
        const flag = copied > 0 ? "✓" : "·";
        console.log(`  ${flag}  ${table.padEnd(28)} ${String(copied).padStart(8)} rows`);
        totalRowsCopied += copied;
      }
    } catch (err) {
      const msg = (err as Error).message.slice(0, 120);
      console.log(`  ✗  ${table.padEnd(28)} ERROR: ${msg}`);
      errors.push({ table, msg });
    }
  }

  console.log("\n→ Re-enabling triggers on target…");
  await target.query("SET session_replication_role = 'origin'");

  console.log("\n→ Resetting sequences on target…");
  await resetSequences();

  console.log(`\n=== Summary ===`);
  console.log(`  Total rows copied: ${totalRowsCopied}`);
  console.log(`  Tables with errors: ${errors.length}`);
  for (const e of errors) console.log(`    · ${e.table}: ${e.msg}`);

  await source.end();
  await target.end();
  process.exit(errors.length > 0 ? 1 : 0);
}

void main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

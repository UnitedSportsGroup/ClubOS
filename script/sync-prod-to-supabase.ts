// Direct DB-to-DB data sync. Connects to source (prod Neon, via
// PROD_DATABASE_URL) and destination (Supabase, via DATABASE_URL in .env),
// copies all data table-by-table in dependency-safe order. Schema is assumed
// to already match (from the earlier pg_dump restore).
//
// Usage:
//   PROD_DATABASE_URL="postgresql://prod..." npx tsx script/sync-prod-to-supabase.ts
//
// Safe to run multiple times — entire run is one transaction; on any error,
// nothing is written. All target writes go through a single backend session
// so `session_replication_role = replica` (FK checks off) actually applies.

import "dotenv/config";
import { Pool, PoolClient } from "pg";

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

// All target writes (TRUNCATE + INSERTs) go through this single client so the
// `SET session_replication_role` and `BEGIN` are scoped to one backend session.
let writer: PoolClient;

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

// Insert into a table that has already been truncated. Does NOT issue its
// own TRUNCATE (we wipe everything once at the start of the run, so that a
// later table's TRUNCATE CASCADE can't undo earlier inserts).
async function insertTable(table: string): Promise<{ copied: number; skipped: boolean }> {
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
    await writer.query(insertQ, values);
    inserted += slice.length;
  }

  return { copied: inserted, skipped: false };
}

// One-shot truncate of every public table in the target. Runs on the writer
// client so it's inside the same transaction as the inserts. Done once before
// any inserts begin, so later inserts can't be wiped by a CASCADE from a
// later TRUNCATE.
async function truncateAllTargetTables() {
  const targetTables = (await listPublicTables(target)).map((t) => `"${t}"`).join(", ");
  await writer.query(`TRUNCATE ${targetTables} RESTART IDENTITY CASCADE`);
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

  // Single backend session for all writes — makes session_replication_role
  // and the wrapping transaction actually scope to the inserts.
  writer = await target.connect();

  let totalRowsCopied = 0;
  const errors: { table: string; msg: string }[] = [];
  let committed = false;

  try {
    console.log("→ Disabling triggers (FK checks) on writer session…");
    await writer.query("SET session_replication_role = 'replica'");

    console.log("→ BEGIN transaction");
    await writer.query("BEGIN");

    console.log("→ Truncating all target tables (single CASCADE)…");
    await truncateAllTargetTables();

    for (const table of sourceTables) {
      if (!targetSet.has(table)) {
        console.log(`  ⏭  ${table.padEnd(28)} (not in target schema)`);
        continue;
      }
      try {
        const { copied, skipped } = await insertTable(table);
        if (skipped) {
          console.log(`  ⏭  ${table.padEnd(28)} (no shared columns)`);
        } else {
          const flag = copied > 0 ? "✓" : "·";
          console.log(`  ${flag}  ${table.padEnd(28)} ${String(copied).padStart(8)} rows`);
          totalRowsCopied += copied;
        }
      } catch (err) {
        const msg = (err as Error).message.slice(0, 200);
        console.log(`  ✗  ${table.padEnd(28)} ERROR: ${msg}`);
        errors.push({ table, msg });
        // Don't keep going — once a transaction errors, all later queries fail.
        throw err;
      }
    }

    if (errors.length === 0) {
      console.log("\n→ COMMIT");
      await writer.query("COMMIT");
      committed = true;
    } else {
      console.log("\n→ ROLLBACK (errors during sync)");
      await writer.query("ROLLBACK");
    }
  } catch (err) {
    console.error("\n→ ROLLBACK (caught error):", (err as Error).message);
    try { await writer.query("ROLLBACK"); } catch {}
  } finally {
    try { await writer.query("SET session_replication_role = 'origin'"); } catch {}
    writer.release();
  }

  if (committed) {
    console.log("\n→ Resetting sequences on target…");
    await resetSequences();
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Committed: ${committed}`);
  console.log(`  Total rows copied: ${committed ? totalRowsCopied : 0}`);
  console.log(`  Tables with errors: ${errors.length}`);
  for (const e of errors) console.log(`    · ${e.table}: ${e.msg}`);

  await source.end();
  await target.end();
  process.exit(committed && errors.length === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

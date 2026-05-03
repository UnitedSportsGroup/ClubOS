// One-shot fix for sequence drift after the prod-to-Supabase migration.
//
// The original sync-prod-to-supabase.ts only reset sequences for SERIAL
// columns (those with column_default LIKE 'nextval%'). GENERATED ALWAYS AS
// IDENTITY columns — used by most of the schema — got skipped. The result:
// every table's next-insert id collided with rows we'd already INSERT'd
// with explicit ids during the sync.
//
// This script walks every public table that has a primary-key sequence
// (identity OR serial), finds max(id), and bumps the sequence past it.
// Idempotent — safe to re-run.

import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Find every public table with a sequence-backed integer column. Covers
  // both identity and serial via the pg_depend graph.
  const seqRes = await pool.query(`
    SELECT
      n.nspname AS schema,
      tab.relname AS table_name,
      attr.attname AS column_name,
      seq_n.nspname || '.' || seq.relname AS sequence_name
    FROM pg_class seq
    JOIN pg_namespace seq_n ON seq_n.oid = seq.relnamespace
    JOIN pg_depend dep ON dep.objid = seq.oid AND dep.classid = 'pg_class'::regclass
    JOIN pg_class tab ON tab.oid = dep.refobjid
    JOIN pg_namespace n ON n.oid = tab.relnamespace
    JOIN pg_attribute attr ON attr.attrelid = tab.oid AND attr.attnum = dep.refobjsubid
    WHERE seq.relkind = 'S'
      AND n.nspname = 'public'
      AND tab.relkind = 'r'
    ORDER BY tab.relname, attr.attname
  `);

  console.log(`Found ${seqRes.rowCount} sequence-column pairs in public schema.\n`);

  let fixed = 0;
  let alreadyOk = 0;
  let errors = 0;

  for (const r of seqRes.rows) {
    const t = r.table_name;
    const c = r.column_name;
    const seq = r.sequence_name;
    try {
      const max = await pool.query(`SELECT COALESCE(MAX("${c}"), 0)::int AS m FROM "${t}"`);
      const cur = await pool.query(`SELECT last_value::int AS v FROM ${seq}`);
      if (cur.rows[0].v > max.rows[0].m) {
        alreadyOk++;
        continue;
      }
      // setval(seq, max+1, false) → next nextval() returns max+1
      await pool.query(`SELECT setval($1, $2, false)`, [seq, Math.max(max.rows[0].m + 1, 1)]);
      console.log(`  ✓  ${t}.${c}  was at ${cur.rows[0].v}, max(${c})=${max.rows[0].m}, now next=${max.rows[0].m + 1}`);
      fixed++;
    } catch (e: any) {
      console.log(`  ✗  ${t}.${c}  ERROR: ${e.message.slice(0, 100)}`);
      errors++;
    }
  }

  console.log(`\nFixed: ${fixed}   Already OK: ${alreadyOk}   Errors: ${errors}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

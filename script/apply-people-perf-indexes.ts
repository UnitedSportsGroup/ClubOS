// The People page took 4 seconds. Two missing indexes.
//
// Daniel, 2026-09-15: "our clubos seems to be very slow at loading especially
// related to database and needs to be way faster."
//
// ─────────────────────────────────────────────────────────────────────────────
// MEASURED, NOT GUESSED. pg_stat_statements named the cost, then EXPLAIN named
// the cause:
//
//   /api/admin/people?limit=50        4,079 ms
//   /api/admin/registrations?limit=50 1,502 ms
//   /api/admin/contacts?limit=50      1,156 ms
//
// All three share `contactHiddenSql()` — the "if you ain't paid you ain't
// registered" filter. It runs TWO correlated EXISTS per contact, each keyed
// `(r.contact_id = c.id OR r.guardian_id = c.id)`, and `registrations` carried
// NO index on either column. EXPLAIN showed a Seq Scan on registrations
// executed once per contact row (loops=54 for a LIMIT 50), and a planner cost
// of 1,552,773 for the unbounded form the People page actually runs.
//
// 🔴 TWO INDEXES, NOT ONE. An OR across two different columns cannot use a
// single index; with one on each, Postgres can BitmapOr them. Status is the
// second column because every use of this predicate filters on it.
//
//   npx tsx --env-file=.env script/apply-people-perf-indexes.ts [--commit]
// ─────────────────────────────────────────────────────────────────────────────
import pg from "pg";
const COMMIT = process.argv.includes("--commit");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const HIDDEN = `
  SELECT count(*)::int FROM contacts c
  WHERE c.type <> 'staff' AND NOT (
    EXISTS (SELECT 1 FROM registrations r WHERE (r.contact_id = c.id OR r.guardian_id = c.id) AND r.status = 'pending')
    AND NOT EXISTS (SELECT 1 FROM registrations r WHERE (r.contact_id = c.id OR r.guardian_id = c.id) AND r.status IN ('confirmed','refunded','partially_refunded'))
    AND c.friendly_manager_id IS NULL)`;

async function timeIt(c: pg.PoolClient, label: string) {
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) { const t = Date.now(); await c.query(HIDDEN); runs.push(Date.now() - t); }
  const best = Math.min(...runs);
  console.log(`  ${label.padEnd(18)} ${String(best).padStart(6)} ms   (runs: ${runs.join(", ")})`);
  return best;
}

async function main() {
  const c = await pool.connect();
  try {
    console.log("\nThe predicate every slow page shares — counting all contacts:\n");
    const before = await timeIt(c, "before");

    if (!COMMIT) {
      console.log("\nDRY RUN — measuring inside a transaction that is rolled back.\n");
      await c.query("BEGIN");
    }
    // 🔴 Not CONCURRENTLY: `registrations` is 1,760 rows, so this is instant and
    // CONCURRENTLY cannot run inside the dry-run transaction. On a table this
    // size the brief lock is shorter than a single page load.
    await c.query(`CREATE INDEX IF NOT EXISTS registrations_contact_status_idx ON registrations (contact_id, status)`);
    await c.query(`CREATE INDEX IF NOT EXISTS registrations_guardian_status_idx ON registrations (guardian_id, status) WHERE guardian_id IS NOT NULL`);
    await c.query(`ANALYZE registrations`);

    const after = await timeIt(c, "after");
    const faster = before > 0 ? (before / Math.max(after, 1)) : 1;
    console.log(`\n  ${faster.toFixed(1)}× faster  (${before}ms → ${after}ms)`);

    // 🔴 An index that does not change the PLAN has not fixed anything.
    const plan = await c.query(`EXPLAIN ${HIDDEN}`);
    const text = plan.rows.map((r: any) => r["QUERY PLAN"]).join("\n");
    const stillSeq = /Seq Scan on registrations/.test(text);
    console.log(`  registrations is still sequentially scanned: ${stillSeq ? "🔴 YES — the indexes are not being used" : "✓ no — it uses the new indexes"}`);

    if (!COMMIT) { await c.query("ROLLBACK"); console.log("\nRolled back. Re-run with --commit to apply.\n"); }
    else console.log("\nAPPLIED.\n");
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error("\n✗", e.message ?? e); process.exit(1); });

/**
 * Financial Insight — apply the migration and PROVE it.
 *   npx tsx --env-file=.env script/apply-finance-insight.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-finance-insight.ts --commit   # for real
 * Proven: a snapshot without a nodes array is refused; a good one is accepted and node_count is derived; RLS is on; idempotent.
 */
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";
const COMMIT = process.argv.includes("--commit");
const problems: string[] = []; let checks = 0;
const ok = (l: string) => { checks++; console.log(`  ✓ ${l}`); };
const bad = (l: string) => { checks++; problems.push(l); console.log(`  ✗ ${l}`); };
async function mustReject(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try { await c.query(sql, params); await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — was ACCEPTED`); }
  catch { await c.query("ROLLBACK TO SAVEPOINT s"); ok(label); }
}
async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-09-20_finance_insight.sql"), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  console.log(`\n  Financial Insight — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    await c.query(sql); ok("migration applied"); await c.query(sql); ok("migration is idempotent");
    await mustReject(c, "a snapshot whose model has no nodes array is refused", `INSERT INTO finance_insight_snapshots (generated_at, model) VALUES (now(), '{"months":[]}')`);
    await mustReject(c, "a snapshot whose model has no months array is refused", `INSERT INTO finance_insight_snapshots (generated_at, model) VALUES (now(), '{"nodes":[]}')`);
    const { rows } = await c.query(`INSERT INTO finance_insight_snapshots (generated_at, model) VALUES (now(), '{"months":["2026-01"],"nodes":[{"id":"a"},{"id":"b"}]}') RETURNING node_count`);
    rows[0].node_count === 2 ? ok("node_count is derived from the model (2)") : bad(`node_count ${rows[0].node_count}`);
    const rls = await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'finance_insight_snapshots'`);
    rls.rows[0]?.relrowsecurity ? ok("RLS is on") : bad("RLS is OFF");
    await c.query(`DELETE FROM finance_insight_snapshots WHERE model = '{"months":["2026-01"],"nodes":[{"id":"a"},{"id":"b"}]}'`);
    if (COMMIT && !problems.length) { await c.query("COMMIT"); console.log(`\n  COMMITTED · ${checks} checks`); }
    else { await c.query("ROLLBACK"); console.log(`\n  ROLLED BACK · ${checks} checks · ${problems.length} problems`); }
  } catch (e: any) { await c.query("ROLLBACK"); console.error("  failed:", e.message); process.exitCode = 1; }
  finally { await c.end(); }
  if (problems.length) process.exitCode = 1;
}
main();

/**
 * The Mailer's assistant — apply the migration and PROVE its rules.
 *   npx tsx --env-file=.env script/apply-mailer-ai.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-mailer-ai.ts --commit   # for real
 *
 * Proven: idempotent; the users column exists; a usage row can be written and
 * counted for today (NZ); negative tokens and a negative cost are refused; a
 * usage row never blocks deleting a user (SET NULL) but does block deleting
 * its organisation (RESTRICT); RLS on.
 */
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const problems: string[] = [];
let checks = 0;
const ok = (l: string) => { checks++; console.log(`  ✓ ${l}`); };
const bad = (l: string) => { checks++; problems.push(l); console.log(`  ✗ ${l}`); };
async function mustReject(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try { await c.query(sql, params); await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — was ACCEPTED`); }
  catch { await c.query("ROLLBACK TO SAVEPOINT s"); ok(label); }
}
async function mustAccept(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try { const r = await c.query(sql, params); await c.query("RELEASE SAVEPOINT s"); ok(label); return r.rows[0]; }
  catch (e: any) { await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — REFUSED: ${e.message}`); return null; }
}

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-10-26_mailer_ai.sql"), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  Mailer assistant — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    await c.query(sql);
    ok("migration ran");
    await c.query(sql);
    ok("migration is idempotent (ran twice)");

    const col = (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='mailer_ai_daily_limit'`)).rows;
    col.length ? ok("users.mailer_ai_daily_limit exists") : bad("users.mailer_ai_daily_limit missing");

    const org = (await c.query(`SELECT id FROM organizations WHERE slug='christchurch-united'`)).rows[0];
    await c.query("SAVEPOINT fixtures");
    const u = await mustAccept(c, "a throwaway user", `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ('_mailer_ai_probe@usg.co.nz','Probe','Ai','x','team_member',true) RETURNING id`);
    await mustAccept(c, "a usage row can be written", `INSERT INTO mailer_ai_usage (user_id, user_label, organization_id, brand, model, instruction, input_tokens, output_tokens, cost_usd_cents, duration_ms, ok, changed) VALUES ($1,'Probe Ai',$2,'cufc','claude-sonnet-5-5','make it modern',9000,1200,0.0300,4200,true,true)`, [u.id, org.id]);
    const today = await mustAccept(c, "today's prompts can be counted per person (NZ day)", `SELECT count(*)::int AS n FROM mailer_ai_usage WHERE user_id=$1 AND (created_at AT TIME ZONE 'Pacific/Auckland')::date = (now() AT TIME ZONE 'Pacific/Auckland')::date`, [u.id]);
    today?.n === 1 ? ok("…and the count is 1") : bad(`count was ${today?.n}`);
    await mustReject(c, "negative tokens are refused", `INSERT INTO mailer_ai_usage (user_id, organization_id, model, input_tokens) VALUES ($1,$2,'m',-1)`, [u.id, org.id]);
    await mustReject(c, "a negative cost is refused", `INSERT INTO mailer_ai_usage (user_id, organization_id, model, cost_usd_cents) VALUES ($1,$2,'m',-0.01)`, [u.id, org.id]);
    await mustReject(c, "a workspace with usage cannot be deleted out from under it", `DELETE FROM organizations WHERE id=$1`, [org.id]);
    await mustAccept(c, "deleting a person keeps their usage (user_id → NULL)", `DELETE FROM users WHERE id=$1`, [u.id]);
    const orphan = (await c.query(`SELECT count(*)::int AS n FROM mailer_ai_usage WHERE user_id IS NULL AND user_label='Probe Ai'`)).rows[0];
    orphan.n === 1 ? ok("…the row survived with its label") : bad(`orphan rows: ${orphan.n}`);
    await mustAccept(c, "a per-person limit can be set to 0 (switched off)", `UPDATE users SET mailer_ai_daily_limit = 0 WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)`);
    await c.query("ROLLBACK TO SAVEPOINT fixtures");
    ok("probe rows discarded");

    const rls = (await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'mailer_ai_usage' AND relkind = 'r'`)).rows;
    rls.length === 1 && rls[0].relrowsecurity ? ok("RLS on mailer_ai_usage") : bad(`RLS: ${JSON.stringify(rls)}`);

    if (problems.length) throw new Error("checks failed");
    await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(`\n  ${checks} checks, ${problems.length} problems — ${COMMIT ? "COMMITTED" : "rolled back"}\n`);
  } catch (err: any) {
    await c.query("ROLLBACK").catch(() => {});
    console.error(`\n  FAILED: ${err.message}\n  ${problems.join("\n  ")}\n`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();

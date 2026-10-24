/**
 * Mailer Automations — apply the migration and PROVE its rules.
 *   npx tsx --env-file=.env script/apply-mailer-automations.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-mailer-automations.ts --commit   # for real
 *
 * Proven: a family enters an automation once (dedupe key); one email per step
 * per family; timing amounts are sane; a name is required; RLS on; idempotent.
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
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-10-25_mailer_automations.sql"), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  Mailer Automations — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    await c.query(sql);
    ok("migration ran");
    await c.query(sql);
    ok("migration is idempotent (ran twice)");
    const org = (await c.query(`SELECT id FROM organizations WHERE slug='christchurch-united'`)).rows[0];
    const prog = (await c.query(`SELECT id FROM programs WHERE organization_id=$1 ORDER BY id LIMIT 1`, [org.id])).rows[0];
    await c.query("SAVEPOINT fixtures");
    await mustReject(c, "an automation needs a name", `INSERT INTO mailer_automations (organization_id, name, trigger_type) VALUES ($1, '  ', 'registration_paid')`, [org.id]);
    const a = await mustAccept(c, "an automation can be created", `INSERT INTO mailer_automations (organization_id, name, trigger_type, program_ids) VALUES ($1,'probe','registration_started',$2) RETURNING id`, [org.id, [prog.id]]);
    const s = await mustAccept(c, "an email step can be created", `INSERT INTO mailer_automation_steps (automation_id, timing_unit, timing_amount, subject, body_html) VALUES ($1,'hours',2,'s','<p>hi</p>') RETURNING id`, [a.id]);
    await mustReject(c, "a negative timing is refused", `INSERT INTO mailer_automation_steps (automation_id, timing_unit, timing_amount) VALUES ($1,'days',-1)`, [a.id]);
    const e = await mustAccept(c, "a family can enter", `INSERT INTO mailer_automation_enrollments (automation_id, organization_id, dedupe_key, email, anchor_at) VALUES ($1,$2,'start:1:x@y.z','x@y.z',now()) RETURNING id`, [a.id, org.id]);
    await mustReject(c, "the same family cannot enter twice", `INSERT INTO mailer_automation_enrollments (automation_id, organization_id, dedupe_key, email, anchor_at) VALUES ($1,$2,'start:1:x@y.z','x@y.z',now())`, [a.id, org.id]);
    await mustAccept(c, "one send per email per family", `INSERT INTO mailer_automation_sends (enrollment_id, step_id, due_at) VALUES ($1,$2,now())`, [e.id, s.id]);
    await mustReject(c, "never a second send of the same email", `INSERT INTO mailer_automation_sends (enrollment_id, step_id, due_at) VALUES ($1,$2,now())`, [e.id, s.id]);
    await mustReject(c, "an automation in use cannot be hard-deleted out from under its org", `DELETE FROM organizations WHERE id=$1`, [org.id]);
    await c.query("ROLLBACK TO SAVEPOINT fixtures");
    ok("probe rows discarded");
    const rls = (await c.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'mailer_automation%' AND relkind = 'r'`)).rows;
    rls.length === 4 && rls.every((r) => r.relrowsecurity) ? ok("RLS on all four tables") : bad(`RLS: ${JSON.stringify(rls)}`);
    if (problems.length) throw new Error("checks failed");
    await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(`\n  ${checks} checks, ${problems.length} problems — ${COMMIT ? "COMMITTED" : "rolled back"}\n`);
  } catch (err: any) {
    await c.query("ROLLBACK").catch(() => {});
    console.error(`\n  ROLLED BACK: ${err.message}\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}
main();

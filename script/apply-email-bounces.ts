/**
 * Rehearse / apply migrations/2026-10-25_email_bounces_and_sponsor_logo_ground.sql
 * against the live database, inside one transaction that is ROLLED BACK unless
 * --commit is given. Every invariant is proven by an insert that must be refused.
 *
 *   npx tsx --env-file=.env script/apply-email-bounces.ts            # dry run
 *   npx tsx --env-file=.env script/apply-email-bounces.ts --commit   # for real
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
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-10-25_email_bounces_and_sponsor_logo_ground.sql"), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  Email bounces + sponsor logo ground — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    await c.query(sql); ok("migration ran");
    await c.query(sql); ok("migration is idempotent (ran twice)");
    await c.query("SAVEPOINT fixtures");
    await mustAccept(c, "a permanent bounce can be recorded", `INSERT INTO email_bounces (email, kind, bounce_type, reason) VALUES ('probe@example.invalid','permanent','Permanent','probe')`);
    await mustReject(c, "the same address twice is an UPDATE, never a second row", `INSERT INTO email_bounces (email, kind) VALUES ('probe@example.invalid','permanent')`);
    await mustReject(c, "an address that is not lowercased/trimmed is refused", `INSERT INTO email_bounces (email, kind) VALUES (' Probe2@Example.invalid','permanent')`);
    await mustReject(c, "something that is not an address is refused", `INSERT INTO email_bounces (email, kind) VALUES ('not-an-email','permanent')`);
    await mustReject(c, "a zero count is refused", `INSERT INTO email_bounces (email, kind, count) VALUES ('probe3@example.invalid','transient',0)`);
    const g = await mustAccept(c, "sponsorship_partners has logo_ground defaulting to light", `SELECT logo_ground FROM sponsorship_partners LIMIT 1`);
    if (g && g.logo_ground !== "light") bad(`default ground is ${g.logo_ground}`);
    await c.query("ROLLBACK TO SAVEPOINT fixtures"); ok("probe rows discarded");
    const rls = (await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'email_bounces' AND relkind = 'r'`)).rows[0];
    rls?.relrowsecurity ? ok("RLS on email_bounces") : bad("RLS off on email_bounces");
    if (problems.length) throw new Error("checks failed");
    await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(`\n  ${checks} checks, ${problems.length} problems — ${COMMIT ? "COMMITTED" : "rolled back"}\n`);
  } catch (err: any) {
    await c.query("ROLLBACK").catch(() => {});
    console.error(`\n  FAILED: ${err.message}\n  ${problems.join("\n  ")}\n`);
    process.exitCode = 1;
  } finally { await c.end(); }
}
main();

/**
 * Sales outreach email tracking — apply the migration and PROVE its rules.
 *   npx tsx --env-file=.env script/apply-sales-emails.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-sales-emails.ts --commit   # for real
 */
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const problems: string[] = []; let checks = 0;
const ok = (l: string) => { checks++; console.log(`  ✓ ${l}`); };
const bad = (l: string) => { checks++; problems.push(l); console.log(`  ✗ ${l}`); };
async function mustReject(c: pg.Client, label: string, sql: string, p: any[] = []) {
  await c.query("SAVEPOINT s");
  try { await c.query(sql, p); await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — was ACCEPTED`); }
  catch { await c.query("ROLLBACK TO SAVEPOINT s"); ok(label); }
}
async function mustAccept(c: pg.Client, label: string, sql: string, p: any[] = []) {
  await c.query("SAVEPOINT s");
  try { const r = await c.query(sql, p); await c.query("RELEASE SAVEPOINT s"); ok(label); return r.rows[0]; }
  catch (e: any) { await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — REFUSED: ${e.message}`); return null; }
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query("BEGIN");
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-09-23_sales_emails.sql"), "utf8");
  await c.query(sql); ok("migration ran");
  await c.query(sql); ok("migration is idempotent");

  const org = (await c.query(`SELECT id FROM organizations WHERE id = 8`)).rows[0].id;
  const p = (await c.query(`INSERT INTO sales_prospects (organization_id, name, source, stage) VALUES ($1,'ZZ migration probe','manual','new') RETURNING id`, [org])).rows[0].id;
  const tok = "t".repeat(32);
  const e = await mustAccept(c, "an accepted email is stored", `INSERT INTO sales_emails (organization_id, prospect_id, token, to_email, subject, body, links) VALUES ($1,$2,$3,'a@b.nz','s','body','[{"url":"https://unitedprints.co.nz"}]') RETURNING id`, [org, p, tok]);
  await mustReject(c, "a short (guessable) token is refused", `INSERT INTO sales_emails (organization_id, prospect_id, token, to_email, subject, body) VALUES ($1,$2,'short','a@b.nz','s','b')`, [org, p]);
  await mustReject(c, "the same token twice is refused", `INSERT INTO sales_emails (organization_id, prospect_id, token, to_email, subject, body) VALUES ($1,$2,$3,'a@b.nz','s','b')`, [org, p, tok]);
  await mustReject(c, "links must be a list", `INSERT INTO sales_emails (organization_id, prospect_id, token, to_email, subject, body, links) VALUES ($1,$2,$3,'a@b.nz','s','b','{}')`, [org, p, "u".repeat(32)]);
  await mustAccept(c, "a delivered event", `INSERT INTO sales_email_events (sales_email_id, type, provider_event_id) VALUES ($1,'delivered','evt_1')`, [e.id]);
  await mustReject(c, "a webhook retry (same event id) is refused", `INSERT INTO sales_email_events (sales_email_id, type, provider_event_id) VALUES ($1,'delivered','evt_1')`, [e.id]);
  await mustReject(c, "an unknown event type is refused", `INSERT INTO sales_email_events (sales_email_id, type) VALUES ($1,'read')`, [e.id]);
  await mustReject(c, "a click must say which link", `INSERT INTO sales_email_events (sales_email_id, type) VALUES ($1,'clicked')`, [e.id]);
  await mustAccept(c, "a click on link 0", `INSERT INTO sales_email_events (sales_email_id, type, link_index, url) VALUES ($1,'clicked',0,'https://unitedprints.co.nz')`, [e.id]);
  await mustReject(c, "an open cannot carry a link", `INSERT INTO sales_email_events (sales_email_id, type, link_index) VALUES ($1,'opened',0)`, [e.id]);
  const rls = (await c.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('sales_emails','sales_email_events')`)).rows;
  rls.length === 2 && rls.every((r: any) => r.relrowsecurity) ? ok("RLS on both tables") : bad("RLS not on");
  // Clean the probe out before any COMMIT.
  await c.query(`DELETE FROM sales_prospects WHERE id = $1`, [p]);
  if (problems.length || !COMMIT) { await c.query("ROLLBACK"); console.log(COMMIT ? "\nROLLED BACK — problems above" : "\nDry run — rolled back"); }
  else { await c.query("COMMIT"); console.log("\nCOMMITTED"); }
} catch (err) { await c.query("ROLLBACK").catch(() => {}); throw err; }
finally { await c.end(); console.log(`${checks} checks, ${problems.length} problems`); if (problems.length) process.exit(1); }

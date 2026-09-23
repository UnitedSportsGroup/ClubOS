/**
 * Energy — apply the migration and PROVE its rules.
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
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-09-23_energy.sql"), "utf8");
  await c.query(sql); ok("migration ran");
  await c.query(sql); ok("migration is idempotent");

  const site = await mustAccept(c, "a site", `INSERT INTO energy_sites (name, utility, icp) VALUES ('ZZ probe','electricity','ZZPROBEICP') RETURNING id`);
  await mustReject(c, "two sites on one ICP are refused", `INSERT INTO energy_sites (name, utility, icp) VALUES ('ZZ probe 2','electricity','ZZPROBEICP')`);
  await mustReject(c, "an unknown utility is refused", `INSERT INTO energy_sites (name, utility) VALUES ('x','steam')`);
  await mustAccept(c, "a bill", `INSERT INTO energy_bills (site_id, source, source_key, cents, units, unit, period_start, period_end) VALUES ($1,'meridian','zz:1',1000,10,'kWh','2026-01-01','2026-01-31') RETURNING id`, [site.id]);
  await mustReject(c, "the same bill twice is refused", `INSERT INTO energy_bills (site_id, source, source_key, cents) VALUES ($1,'meridian','zz:1',1000)`, [site.id]);
  await mustReject(c, "a period that ends before it starts is refused", `INSERT INTO energy_bills (site_id, source, source_key, cents, period_start, period_end) VALUES ($1,'manual','zz:2',1,'2026-02-01','2026-01-01')`, [site.id]);
  await mustReject(c, "a credit must be negative", `INSERT INTO energy_bills (site_id, source, source_key, kind, cents) VALUES ($1,'manual','zz:3','credit',500)`, [site.id]);
  await mustReject(c, "a bill cannot be negative", `INSERT INTO energy_bills (site_id, source, source_key, kind, cents) VALUES ($1,'manual','zz:4','bill',-500)`, [site.id]);
  await mustAccept(c, "a credit note", `INSERT INTO energy_bills (site_id, source, source_key, kind, cents) VALUES ($1,'meridian','zz:5','credit',-500) RETURNING id`, [site.id]);
  await mustReject(c, "a site with bills cannot be deleted", `DELETE FROM energy_sites WHERE id = $1`, [site.id]);
  await mustReject(c, "a zero payment is refused", `INSERT INTO energy_payments (supplier, paid_on, cents, source_key) VALUES ('x','2026-01-01',0,'zz:p0')`);
  await c.query(`DELETE FROM energy_bills WHERE site_id = $1`, [site.id]); await c.query(`DELETE FROM energy_sites WHERE id = $1`, [site.id]);
  const rls = (await c.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('energy_sites','energy_bills','energy_payments')`)).rows;
  rls.length === 3 && rls.every((r: any) => r.relrowsecurity) ? ok("RLS on all three tables") : bad("RLS not on");
  if (problems.length || !COMMIT) { await c.query("ROLLBACK"); console.log(COMMIT ? "\nROLLED BACK — problems above" : "\nDry run — rolled back"); }
  else { await c.query("COMMIT"); console.log("\nCOMMITTED"); }
} catch (err) { await c.query("ROLLBACK").catch(() => {}); throw err; }
finally { await c.end(); console.log(`${checks} checks, ${problems.length} problems`); if (problems.length) process.exit(1); }

// Apply migrations/2026-10-19_registration_refunds.sql (the refund history ledger).
// Dry run by default: one transaction, rolled back.
//   npx tsx --env-file=.env script/apply-registration-refunds.ts [--commit]
import { Pool } from "pg";
import { readFileSync } from "fs";

const commit = process.argv.includes("--commit");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const c = await pool.connect();
let ok = true;
const check = (label: string, pass: boolean) => { console.log(`${pass ? "ok  " : "FAIL"} ${label}`); if (!pass) ok = false; };
try {
  await c.query("BEGIN");
  await c.query(readFileSync(new URL("../migrations/2026-10-19_registration_refunds.sql", import.meta.url), "utf8"));
  const want = await c.query(`SELECT count(*)::int n FROM registrations WHERE COALESCE(refunded_amount_cents,0) > 0`);
  const got = await c.query(`SELECT count(*)::int n, COALESCE(sum(amount_cents),0)::bigint s FROM registration_refunds`);
  const wantSum = await c.query(`SELECT COALESCE(sum(refunded_amount_cents),0)::bigint s FROM registrations WHERE COALESCE(refunded_amount_cents,0) > 0`);
  check(`backfilled one row per refunded registration (${got.rows[0].n} of ${want.rows[0].n})`, got.rows[0].n === want.rows[0].n);
  check(`backfilled money matches to the cent ($${(Number(got.rows[0].s) / 100).toFixed(2)})`, String(got.rows[0].s) === String(wantSum.rows[0].s));
  const named = await c.query(`SELECT count(*) FILTER (WHERE issued_by_user_id IS NOT NULL)::int n FROM registration_refunds`);
  console.log(`     ${named.rows[0].n} of ${got.rows[0].n} carry who issued them; the rest predate the audit trail`);
  const brz = await c.query(`SELECT issued_by_user_id, amount_cents FROM registration_refunds WHERE registration_id = 2996`);
  check("Brazukas FC (#2996) recorded: $300 by user 1", brz.rows[0]?.amount_cents === 30000 && brz.rows[0]?.issued_by_user_id === 1);
  const rls = await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname='registration_refunds'`);
  check("RLS on", rls.rows[0]?.relrowsecurity === true);
  for (const [label, sql] of [["UPDATE refused", "UPDATE registration_refunds SET amount_cents = 1"], ["DELETE refused", "DELETE FROM registration_refunds"]] as const) {
    await c.query("SAVEPOINT s");
    let refused = false;
    try { await c.query(sql); refused = (await c.query("SELECT count(*)::int n FROM registration_refunds")).rows[0].n === 0 && got.rows[0].n > 0 ? false : false; } catch { refused = true; }
    check(label, refused);
    await c.query("ROLLBACK TO SAVEPOINT s");
  }
  await c.query("SAVEPOINT z");
  let zero = false;
  try { await c.query(`INSERT INTO registration_refunds (registration_id, amount_cents) VALUES (2996, 0)`); } catch { zero = true; }
  check("a $0 refund is refused", zero);
  await c.query("ROLLBACK TO SAVEPOINT z");
  if (ok && commit) { await c.query("COMMIT"); console.log("\nCOMMITTED."); }
  else { await c.query("ROLLBACK"); console.log(ok ? "\nROLLED BACK (dry run)." : "\nROLLED BACK — checks failed."); }
} catch (e) { await c.query("ROLLBACK"); throw e; }
finally { c.release(); await pool.end(); }
process.exit(ok ? 0 : 1);

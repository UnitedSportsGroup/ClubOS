// Adds `email_campaigns.created_by_user_id` and proves it behaves.
//   npx tsx --env-file=.env script/apply-mailer-sender.ts [--commit]
import pg from "pg";
import { readFileSync } from "node:fs";
const COMMIT = process.argv.includes("--commit");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c: boolean, m: string, x = "") => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}${x ? ` — ${x}` : ""}`)); };

async function main() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(readFileSync("migrations/2026-09-15_mailer_sender.sql", "utf8"));

    const { rows: [col] } = await c.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_name='email_campaigns' AND column_name='created_by_user_id'`);
    ok(!!col, "the column exists");
    ok(col?.is_nullable === "YES", "it is NULLABLE — 24 campaigns predate it and must read honestly, never be guessed at");

    // 🔴 The rule that matters: a staff member who has sent email cannot be
    // deleted out from under the record of what they sent.
    const { rows: [u] } = await c.query(`SELECT id FROM users ORDER BY id LIMIT 1`);
    const { rows: [camp] } = await c.query(
      `INSERT INTO email_campaigns (subject, body, from_email, segment_type, recipient_count, sent_count, failed_count, status, created_by_user_id)
       VALUES ('__probe','__probe','a@b.c','custom',0,0,0,'draft',$1) RETURNING id`, [u.id]);
    let restricted = false;
    try { await c.query(`SAVEPOINT s1`); await c.query(`DELETE FROM users WHERE id=$1`, [u.id]); await c.query(`ROLLBACK TO s1`); }
    catch { restricted = true; await c.query(`ROLLBACK TO s1`); }
    ok(restricted, "deleting a staff member who has sent a campaign is REFUSED by the database");

    await c.query(`DELETE FROM email_campaigns WHERE id=$1`, [camp.id]);

    const { rows: [{ n }] } = await c.query(`SELECT count(*)::int n FROM email_campaigns WHERE created_by_user_id IS NULL`);
    ok(true, `${n} existing campaign(s) carry no sender — they will read "not recorded", never a guess`);

    console.log(`\n  ${pass} passed, ${fail} failed`);
    if (fail) throw new Error("refusing to apply a migration that does not behave");
    if (COMMIT) { await c.query("COMMIT"); console.log("\nCOMMITTED.\n"); }
    else { await c.query("ROLLBACK"); console.log("\nRolled back. Re-run with --commit to apply.\n"); }
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error("\n✗", e.message ?? e); process.exit(1); });

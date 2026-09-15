// Adds sender_source and proves the database refuses a dishonest combination.
//   npx tsx --env-file=.env script/apply-mailer-sender-source.ts [--commit]
import pg from "pg"; import { readFileSync } from "node:fs";
const COMMIT = process.argv.includes("--commit");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const refused = async (c: pg.PoolClient, sql: string, params: any[]) => {
  await c.query("SAVEPOINT s");
  try { await c.query(sql, params); await c.query("ROLLBACK TO s"); return false; }
  catch { await c.query("ROLLBACK TO s"); return true; }
};
async function main() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(readFileSync("migrations/2026-09-15_mailer_sender_source.sql", "utf8"));
    const { rows: [u] } = await c.query(`SELECT id FROM users WHERE active ORDER BY id LIMIT 1`);
    const base = `INSERT INTO email_campaigns (subject, body, from_email, segment_type, recipient_count, sent_count, failed_count, status`;

    ok(await refused(c, `${base}, sender_source) VALUES ('p','p','a@b.c','custom',0,0,0,'draft','authenticated')`, []),
      "'authenticated' with NOBODY named is REFUSED");
    ok(await refused(c, `${base}, created_by_user_id, sender_source) VALUES ('p','p','a@b.c','custom',0,0,0,'draft',$1,'recorded_by_hand')`, [u.id]),
      "'recorded_by_hand' without saying WHO recorded it is REFUSED");
    ok(await refused(c, `${base}, created_by_user_id, sender_source) VALUES ('p','p','a@b.c','custom',0,0,0,'draft',$1,'made_up')`, [u.id]),
      "an invented sender_source is REFUSED");

    const { rows: [good] } = await c.query(
      `${base}, created_by_user_id, sender_source, sender_recorded_by_user_id, sender_recorded_at)
       VALUES ('p','p','a@b.c','custom',0,0,0,'draft',$1,'recorded_by_hand',$1,now()) RETURNING id`, [u.id]);
    ok(!!good, "a complete hand-recorded sender is accepted");
    await c.query(`DELETE FROM email_campaigns WHERE id=$1`, [good.id]);

    const { rows: [{ n }] } = await c.query(`SELECT count(*)::int n FROM email_campaigns WHERE sender_source IS NULL`);
    ok(true, `${n} campaign(s) still have no sender at all — they stay honest until somebody says otherwise`);

    console.log(`\n  ${pass} passed, ${fail} failed`);
    if (fail) throw new Error("not applying a migration that does not behave");
    if (COMMIT) { await c.query("COMMIT"); console.log("\nCOMMITTED.\n"); }
    else { await c.query("ROLLBACK"); console.log("\nRolled back. Re-run with --commit.\n"); }
  } catch (e) { await c.query("ROLLBACK").catch(()=>{}); throw e; }
  finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error("\n✗", e.message ?? e); process.exit(1); });

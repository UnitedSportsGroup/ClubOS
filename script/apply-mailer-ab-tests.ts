/**
 * A/B tests in the Mailer — apply the migration and PROVE its rules.
 *   npx tsx --env-file=.env script/apply-mailer-ab-tests.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-mailer-ab-tests.ts --commit   # for real
 *
 * Proven: idempotent; the recipients table takes a queued row with a variant
 * and refuses a third letter or a negative click count; one person per
 * campaign (the unique index the upsert stands on); a test row needs two
 * DIFFERENT versions, a share between 1 and 100, a kind and a metric from the
 * list; a verdict is all-or-nothing (winner + reason + time); the rest cannot
 * be marked sent before a winner exists; one test per campaign; a link must be
 * http(s) and is unique per (campaign, idx); a click must point at a real link
 * and a real recipient; deleting the campaign takes the lot with it; RLS on.
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
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-10-27_mailer_ab_tests.sql"), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  Mailer A/B tests — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    // The unique index needs a clean table. Proven 0 pairs on 27 Oct; checked
    // again here so a later duplicate fails loudly instead of inside the index.
    const dupes = (await c.query(`SELECT count(*)::int AS n FROM (SELECT campaign_id, lower(email) FROM email_campaign_recipients GROUP BY 1,2 HAVING count(*) > 1) d`)).rows[0];
    dupes.n === 0 ? ok("no duplicate (campaign, email) pairs in email_campaign_recipients") : bad(`${dupes.n} duplicate pairs — dedupe before applying`);

    await c.query(sql);
    ok("migration ran");
    await c.query(sql);
    ok("migration is idempotent (ran twice)");

    await c.query("SAVEPOINT fixtures");
    const camp = await mustAccept(c, "a throwaway campaign",
      `INSERT INTO email_campaigns (subject, body, from_email, segment_type, status) VALUES ('probe A', '<p>x <a href="https://cufc.co.nz/register">Register now</a></p>', 'probe@usg.co.nz', 'custom', 'sending') RETURNING id`);
    const r1 = await mustAccept(c, "a queued recipient with variant A, in the test",
      `INSERT INTO email_campaign_recipients (campaign_id, email, status, variant, in_test) VALUES ($1, 'one@example.com', 'queued', 'A', true) RETURNING id`, [camp.id]);
    await mustAccept(c, "a queued recipient with no variant (waiting for the winner)",
      `INSERT INTO email_campaign_recipients (campaign_id, email, status) VALUES ($1, 'two@example.com', 'queued') RETURNING id`, [camp.id]);
    await mustReject(c, "a third letter as a variant is refused",
      `INSERT INTO email_campaign_recipients (campaign_id, email, status, variant) VALUES ($1, 'three@example.com', 'queued', 'C')`, [camp.id]);
    await mustReject(c, "the same person twice on one campaign is refused (case-insensitive)",
      `INSERT INTO email_campaign_recipients (campaign_id, email, status) VALUES ($1, 'ONE@example.com', 'queued')`, [camp.id]);
    await mustReject(c, "a negative click count is refused",
      `UPDATE email_campaign_recipients SET click_count = -1 WHERE id = $1`, [r1.id]);
    await mustAccept(c, "a queued row becomes sent (the upsert the queue does)",
      `UPDATE email_campaign_recipients SET status = 'sent', sent_at = now() WHERE id = $1 AND status = 'queued' RETURNING id`, [r1.id]);

    const tIns = `INSERT INTO email_campaign_tests (campaign_id, kind, metric, variant_a, variant_b, sample_pct, wait_minutes, a_count, b_count, rest_count, decide_at) VALUES ($1,$2,$3,$4,$5,$6,$7,1,1,1, now() + interval '2 hours') RETURNING id`;
    await mustReject(c, "a test whose two versions are the same is refused", tIns, [camp.id, "subject", "opens", "Same", "Same", 20, 120]);
    await mustReject(c, "a test with an empty second version is refused", tIns, [camp.id, "subject", "opens", "A", "", 20, 120]);
    await mustReject(c, "a share of 0% is refused", tIns, [camp.id, "subject", "opens", "A", "B", 0, 120]);
    await mustReject(c, "a share of 101% is refused", tIns, [camp.id, "subject", "opens", "A", "B", 101, 120]);
    await mustReject(c, "an unknown kind is refused", tIns, [camp.id, "colour", "opens", "A", "B", 20, 120]);
    await mustReject(c, "an unknown metric is refused", tIns, [camp.id, "subject", "likes", "A", "B", 20, 120]);
    await mustReject(c, "a negative wait is refused", tIns, [camp.id, "subject", "opens", "A", "B", 20, -1]);
    const t = await mustAccept(c, "a subject test, 20%, 2 hours", tIns, [camp.id, "subject", "opens", "Subject A", "Subject B", 20, 120]);
    await mustReject(c, "a second test on the same campaign is refused", tIns, [camp.id, "link", "clicks", "Register now", "Save my spot", 20, 120]);
    await mustReject(c, "a winner without a reason and a time is refused",
      `UPDATE email_campaign_tests SET winner = 'B' WHERE id = $1`, [t.id]);
    await mustReject(c, "the rest cannot be marked sent before a winner exists",
      `UPDATE email_campaign_tests SET rest_sent_at = now() WHERE id = $1`, [t.id]);
    await mustAccept(c, "a full verdict: winner B, by opens, now",
      `UPDATE email_campaign_tests SET winner = 'B', decided_by = 'opens', decided_at = now() WHERE id = $1 RETURNING id`, [t.id]);
    await mustAccept(c, "…and then the rest can be marked sent",
      `UPDATE email_campaign_tests SET rest_sent_at = now() WHERE id = $1 RETURNING id`, [t.id]);
    await mustReject(c, "an unknown reason is refused",
      `UPDATE email_campaign_tests SET decided_by = 'vibes' WHERE id = $1`, [t.id]);

    const lIns = `INSERT INTO email_campaign_links (campaign_id, idx, url, label, kind) VALUES ($1,$2,$3,$4,$5) RETURNING id`;
    const link = await mustAccept(c, "a link with its wording and kind", lIns, [camp.id, 0, "https://cufc.co.nz/register", "Register now", "button"]);
    await mustReject(c, "the same (campaign, idx) twice is refused", lIns, [camp.id, 0, "https://cufc.co.nz/other", "Other", "link"]);
    await mustReject(c, "a link that is not http(s) is refused", lIns, [camp.id, 1, "javascript:alert(1)", "x", "link"]);
    await mustReject(c, "an unknown link kind is refused", lIns, [camp.id, 2, "https://cufc.co.nz", "x", "banner"]);

    const kIns = `INSERT INTO email_campaign_clicks (campaign_id, link_id, recipient_id, variant, user_agent, suspected_bot) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`;
    await mustAccept(c, "a click on that link by that recipient", kIns, [camp.id, link.id, r1.id, "A", "Mozilla/5.0", false]);
    await mustReject(c, "a click on a link that does not exist is refused", kIns, [camp.id, 999999999, r1.id, "A", "Mozilla/5.0", false]);
    await mustReject(c, "a click by a recipient that does not exist is refused", kIns, [camp.id, link.id, 999999999, "A", "Mozilla/5.0", false]);
    await mustAccept(c, "the recipient's click is counted", `UPDATE email_campaign_recipients SET click_count = click_count + 1, first_clicked_at = coalesce(first_clicked_at, now()) WHERE id = $1 RETURNING click_count`, [r1.id]);

    await mustAccept(c, "deleting the campaign takes the test, the links and the clicks with it", `DELETE FROM email_campaigns WHERE id = $1`, [camp.id]);
    const left = (await c.query(`SELECT (SELECT count(*) FROM email_campaign_tests WHERE id=$1)::int + (SELECT count(*) FROM email_campaign_links WHERE id=$2)::int AS n`, [t.id, link.id])).rows[0];
    left.n === 0 ? ok("…nothing left behind") : bad(`${left.n} rows left behind`);
    await c.query("ROLLBACK TO SAVEPOINT fixtures");
    ok("probe rows discarded");

    for (const tbl of ["email_campaign_tests", "email_campaign_links", "email_campaign_clicks"]) {
      const rls = (await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname = $1 AND relkind = 'r'`, [tbl])).rows;
      rls.length === 1 && rls[0].relrowsecurity ? ok(`RLS on ${tbl}`) : bad(`RLS on ${tbl}: ${JSON.stringify(rls)}`);
    }

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

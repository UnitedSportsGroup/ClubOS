/**
 * Campaigns — apply the migration and PROVE its rules.
 *
 *   npx tsx --env-file=.env script/apply-campaigns.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-campaigns.ts --commit   # for real
 */
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const MIGRATION = "2026-11-10_campaigns.sql";

type Client = pg.Client;
const problems: string[] = [];
let checks = 0;
function ok(label: string) { checks++; console.log(`  ✓ ${label}`); }
function bad(label: string) { checks++; problems.push(label); console.log(`  ✗ ${label}`); }

async function mustReject(c: Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try {
    await c.query(sql, params);
    await c.query("ROLLBACK TO SAVEPOINT s");
    bad(`${label} — was ACCEPTED, the database is not enforcing this`);
  } catch {
    await c.query("ROLLBACK TO SAVEPOINT s");
    ok(label);
  }
}
async function mustAccept(c: Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  let r: any;
  try { r = await c.query(sql, params); }
  catch (e: any) { await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — was REFUSED: ${e.message}`); return null; }
  await c.query("RELEASE SAVEPOINT s");
  ok(label);
  return r?.rows?.[0];
}

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", MIGRATION), "utf8");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log(`\n  Campaigns — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    ok("migration ran");
    await client.query(sql);
    ok("migration ran a second time (idempotent)");
    for (const t of ["cmp_campaigns", "cmp_channels", "cmp_tasks", "cmp_tests", "cmp_test_variants"]) {
      const r = await client.query(`select relrowsecurity from pg_class where relname = $1 and relkind = 'r'`, [t]);
      r.rowCount ? ok(`${t} exists`) : bad(`${t} was not created`);
      r.rows[0]?.relrowsecurity ? ok(`${t} has RLS on`) : bad(`${t} has RLS OFF`);
    }

    await client.query("SAVEPOINT fixtures");
    const c = await mustAccept(client, "a campaign can be made with no goal",
      `insert into cmp_campaigns (name) values ('__fixture__') returning id, goal_signups, goal_revenue_cents, program_ids`);
    c && c.goal_signups === null && c.goal_revenue_cents === null ? ok("…and no goal is NULL, not zero") : bad("a missing goal was stored as a number");
    await mustReject(client, "a campaign with a blank name is refused", `insert into cmp_campaigns (name) values ('  ')`);
    await mustReject(client, "a negative goal is refused", `insert into cmp_campaigns (name, goal_signups) values ('x', -1)`);
    await mustReject(client, "a negative revenue goal is refused", `insert into cmp_campaigns (name, goal_revenue_cents) values ('x', -100)`);
    await mustReject(client, "a selling window that ends before it starts is refused",
      `insert into cmp_campaigns (name, starts_on, ends_on) values ('x', '2026-12-10', '2026-12-01')`);
    await mustAccept(client, "a one-day selling window is fine",
      `insert into cmp_campaigns (name, starts_on, ends_on) values ('x', '2026-12-10', '2026-12-10')`);
    if (c) {
      const ch = await mustAccept(client, "a channel can be added",
        `insert into cmp_channels (campaign_id, kind, name) values ($1, 'meta_ads', 'Ads') returning id`, [c.id]);
      await mustReject(client, "a channel with a negative budget is refused",
        `insert into cmp_channels (campaign_id, kind, name, budget_cents) values ($1, 'email', 'E', -5)`, [c.id]);
      await mustReject(client, "a channel on a campaign that does not exist is refused",
        `insert into cmp_channels (campaign_id, kind, name) values (-1, 'email', 'E')`);
      const t = await mustAccept(client, "a task can be added to a channel",
        `insert into cmp_tasks (campaign_id, channel_id, title, due_on) values ($1, $2, 'Shoot', '2026-12-01') returning id`, [c.id, ch?.id]);
      await mustReject(client, "a task marked done by someone but with no time is refused",
        `insert into cmp_tasks (campaign_id, title, done_by) values ($1, 'x', (select id from users limit 1))`, [c.id]);
      const test = await mustAccept(client, "a split test can be added",
        `insert into cmp_tests (campaign_id, name) values ($1, 'Headline') returning id`, [c.id]);
      if (test) {
        await mustAccept(client, "a version can be added", `insert into cmp_test_variants (test_id, label) values ($1, 'A')`, [test.id]);
        await mustReject(client, "two versions with the same label are refused", `insert into cmp_test_variants (test_id, label) values ($1, 'A')`, [test.id]);
        await mustReject(client, "a negative typed-in visitor count is refused",
          `insert into cmp_test_variants (test_id, label, manual_visitors) values ($1, 'B', -1)`, [test.id]);
      }
      if (ch && t) {
        await client.query(`delete from cmp_channels where id = $1`, [ch.id]);
        const kept = await client.query(`select channel_id from cmp_tasks where id = $1`, [t.id]);
        kept.rowCount === 1 && kept.rows[0].channel_id === null ? ok("removing a channel keeps its tasks, unlinked") : bad("removing a channel lost or kept-linked its task");
      }
    }
    await client.query("ROLLBACK TO SAVEPOINT fixtures");

    if (problems.length) throw new Error(`${problems.length} of ${checks} checks failed`);
    if (COMMIT) {
      await client.query("COMMIT");
      console.log(`\n  COMMITTED — ${checks} checks passed.\n`);
    } else {
      await client.query("ROLLBACK");
      console.log(`\n  Dry run rolled back — ${checks} checks passed. Re-run with --commit to apply.\n`);
    }
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`\n  ROLLED BACK — ${e.message}`);
    for (const p of problems) console.error(`    - ${p}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();

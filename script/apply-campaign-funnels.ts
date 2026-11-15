/**
 * Campaign funnels — apply the migration and PROVE its rules.
 *
 *   npx tsx --env-file=.env script/apply-campaign-funnels.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-campaign-funnels.ts --commit   # for real
 */
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const MIGRATION = "2026-11-14_campaign_funnels.sql";

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
  console.log(`\n  Campaign funnels — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    ok("migration ran");
    await client.query(sql);
    ok("migration ran a second time (idempotent)");
    const r = await client.query(`select relrowsecurity from pg_class where relname = 'cmp_funnels' and relkind = 'r'`);
    r.rowCount ? ok("cmp_funnels exists") : bad("cmp_funnels was not created");
    r.rows[0]?.relrowsecurity ? ok("cmp_funnels has RLS on") : bad("cmp_funnels has RLS OFF");
    for (const idx of ["web_events_slim_pv_path_ts_idx", "registrations_program_visitor_idx"]) {
      const i = await client.query(`select 1 from pg_indexes where indexname = $1`, [idx]);
      i.rowCount ? ok(`index ${idx} exists`) : bad(`index ${idx} is missing`);
    }

    await client.query("SAVEPOINT fixtures");
    const c = await mustAccept(client, "a campaign to hang funnels on", `insert into cmp_campaigns (name) values ('__fixture__') returning id`);
    if (c) {
      const ch = await mustAccept(client, "a channel", `insert into cmp_channels (campaign_id, kind, name) values ($1, 'meta_ads', 'Ads') returning id`, [c.id]);
      const f = await mustAccept(client, "a funnel can be made with nothing but a name",
        `insert into cmp_funnels (campaign_id, name) values ($1, 'Everyone') returning id, channel_id, program_ids, landing_pages, starts_on`, [c.id]);
      f && f.channel_id === null && f.program_ids.length === 0 && f.landing_pages.length === 0 && f.starts_on === null
        ? ok("…and nothing is filled in for it") : bad("a bare funnel was given values nobody chose");
      const f2 = await mustAccept(client, "a second funnel in the same campaign, following a channel",
        `insert into cmp_funnels (campaign_id, name, channel_id, landing_pages, checkout_pages) values ($1, 'Ads', $2, '{join.cufc.co.nz/fundamentals}', '{join.cufc.co.nz/fundamentals/book}') returning id`, [c.id, ch?.id]);
      await mustReject(client, "a funnel with a blank name is refused", `insert into cmp_funnels (campaign_id, name) values ($1, '  ')`, [c.id]);
      await mustReject(client, "a funnel on a campaign that does not exist is refused", `insert into cmp_funnels (campaign_id, name) values (-1, 'x')`);
      await mustReject(client, "a funnel following a channel that does not exist is refused", `insert into cmp_funnels (campaign_id, name, channel_id) values ($1, 'x', -1)`, [c.id]);
      await mustReject(client, "a window that ends before it starts is refused",
        `insert into cmp_funnels (campaign_id, name, starts_on, ends_on) values ($1, 'x', '2026-12-10', '2026-12-01')`, [c.id]);
      await mustReject(client, "more than 20 landing pages is refused",
        `insert into cmp_funnels (campaign_id, name, landing_pages) values ($1, 'x', (select array_agg('a.nz/' || g) from generate_series(1, 21) g))`, [c.id]);
      if (ch && f2) {
        await client.query(`delete from cmp_channels where id = $1`, [ch.id]);
        const kept = await client.query(`select channel_id from cmp_funnels where id = $1`, [f2.id]);
        kept.rowCount === 1 && kept.rows[0].channel_id === null ? ok("removing a channel keeps its funnel, counting everyone") : bad("removing a channel lost its funnel");
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

/**
 * Marketing hub — apply the migration and PROVE its rules.
 *
 *   npx tsx --env-file=.env script/apply-marketing-hub.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-marketing-hub.ts --commit   # for real
 *
 * Runs migrations/2026-09-15_marketing_hub.sql inside ONE transaction (twice —
 * it must be idempotent), then asserts every invariant by trying to break it
 * against throwaway fixtures discarded before COMMIT. There is no local
 * Postgres; this is the rehearsal.
 *
 * Proven here:
 *   1. every table exists with RLS on; the lease has exactly one row; the page
 *      view index exists
 *   2. one account is registered once; one number per source × day × dimension ×
 *      metric, so a re-pull is an update and never a second copy
 *   3. a negative value is refused
 *   4. an account that has numbers cannot be deleted
 *   5. a second lease row is refused, and a live lease cannot be taken by a
 *      second machine
 */
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const MIGRATION = "2026-09-15_marketing_hub.sql";

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
  console.log(`\n  Marketing hub — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    ok("migration ran");
    await client.query(sql);
    ok("migration ran a second time (idempotent)");

    for (const t of ["marketing_sources", "marketing_daily", "marketing_sync_runs", "marketing_sync_lease"]) {
      const r = await client.query(`select relrowsecurity from pg_class where relname = $1 and relkind = 'r'`, [t]);
      r.rowCount ? ok(`${t} exists`) : bad(`${t} was not created`);
      r.rows[0]?.relrowsecurity ? ok(`${t} has RLS on`) : bad(`${t} has RLS OFF`);
    }
    const lease = await client.query(`select count(*)::int n from marketing_sync_lease`);
    lease.rows[0].n === 1 ? ok("the lease has exactly one row") : bad(`the lease has ${lease.rows[0].n} rows`);
    const idx = await client.query(`select 1 from pg_indexes where indexname = 'analytics_events_page_view_ts_idx'`);
    idx.rowCount ? ok("page-view index exists on analytics_events") : bad("page-view index is missing");
    const vt = await client.query(
      `select data_type from information_schema.columns where table_name = 'marketing_daily' and column_name = 'value'`,
    );
    vt.rows[0]?.data_type === "bigint" ? ok("marketing_daily.value is bigint") : bad(`marketing_daily.value is ${vt.rows[0]?.data_type}`);

    // ── fixtures (discarded) ─────────────────────────────────────────────
    await client.query("SAVEPOINT fixtures");
    const org = (await client.query(`select id from organizations where slug = 'christchurch-united'`)).rows[0];
    if (!org) throw new Error("no CUFC org");

    const src = await mustAccept(client, "an account can be registered",
      `insert into marketing_sources (platform, external_id, label, organization_id)
       values ('ga4', '__fixture_property__', 'Fixture', $1) returning id`, [org.id]);
    await mustReject(client, "the same account registered twice is refused",
      `insert into marketing_sources (platform, external_id, label) values ('ga4', '__fixture_property__', 'Dup')`);
    await mustAccept(client, "the same id on a different platform is a different account",
      `insert into marketing_sources (platform, external_id, label) values ('instagram', '__fixture_property__', 'Other')`);

    if (src) {
      await mustAccept(client, "a daily number can be stored",
        `insert into marketing_daily (source_id, day, metric, value) values ($1, '2026-01-01', 'sessions', 10)`, [src.id]);
      await mustReject(client, "a second copy of the same day and metric is refused",
        `insert into marketing_daily (source_id, day, metric, value) values ($1, '2026-01-01', 'sessions', 11)`, [src.id]);
      const up = await mustAccept(client, "a re-pull onto the same key updates the number",
        `insert into marketing_daily (source_id, day, metric, value) values ($1, '2026-01-01', 'sessions', 12)
         on conflict (source_id, day, dim_type, dim_key, metric) do update set value = excluded.value
         returning value`, [src.id]);
      Number(up?.value) === 12 ? ok("…and the stored value is the new one, not a sum") : bad(`re-pull stored ${up?.value}`);
      await mustAccept(client, "the same day and metric under a campaign is a separate number",
        `insert into marketing_daily (source_id, day, dim_type, dim_key, metric, value)
         values ($1, '2026-01-01', 'campaign', '123', 'sessions', 3)`, [src.id]);
      await mustReject(client, "a negative number is refused",
        `insert into marketing_daily (source_id, day, metric, value) values ($1, '2026-01-02', 'impressions', -1)`, [src.id]);
      await mustReject(client, "deleting an account that has numbers is refused",
        `delete from marketing_sources where id = $1`, [src.id]);
      await mustAccept(client, "a pull can be recorded against the account",
        `insert into marketing_sync_runs (source_id, platform, status) values ($1, 'ga4', 'ok')`, [src.id]);
    }

    await mustReject(client, "a second lease row is refused",
      `insert into marketing_sync_lease (id) values (2)`);
    const a = await client.query(
      `update marketing_sync_lease set holder = 'machine-a', expires_at = now() + interval '5 minutes'
       where id = 1 and (expires_at < now() or holder = 'machine-a') returning id`);
    a.rowCount === 1 ? ok("the first machine takes the free lease") : bad("the free lease could not be taken");
    const b = await client.query(
      `update marketing_sync_lease set holder = 'machine-b', expires_at = now() + interval '5 minutes'
       where id = 1 and (expires_at < now() or holder = 'machine-b') returning id`);
    b.rowCount === 0 ? ok("a second machine cannot take a live lease") : bad("a second machine took a live lease");

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

/**
 * Social media — apply the migration and PROVE its rules.
 *
 *   npx tsx --env-file=.env script/apply-social-media.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-social-media.ts --commit   # for real
 *
 * Proven: tables exist with RLS on · one account per platform id and per live
 * handle (an archived handle can be re-added) · one row per post, a re-pull
 * updates it · a negative metric is refused · a blank metric stays NULL · an
 * account with posts or readings cannot be deleted · one reading per day.
 */
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const MIGRATION = "2026-11-10_social_media.sql";

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
  console.log(`\n  Social media — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    ok("migration ran");
    await client.query(sql);
    ok("migration ran a second time (idempotent)");

    for (const t of ["social_accounts", "social_account_daily", "social_posts", "social_sync_runs"]) {
      const r = await client.query(`select relrowsecurity from pg_class where relname = $1 and relkind = 'r'`, [t]);
      r.rowCount ? ok(`${t} exists`) : bad(`${t} was not created`);
      r.rows[0]?.relrowsecurity ? ok(`${t} has RLS on`) : bad(`${t} has RLS OFF`);
    }

    await client.query("SAVEPOINT fixtures");
    const acct = await mustAccept(client, "an account can be added",
      `insert into social_accounts (platform, external_id, handle, connection) values ('instagram', '__fx__', '__Fixture__', 'api') returning id`);
    await mustReject(client, "the same platform id twice is refused",
      `insert into social_accounts (platform, external_id, handle) values ('instagram', '__fx__', '__other__')`);
    await mustReject(client, "the same handle twice on one platform is refused, whatever the case",
      `insert into social_accounts (platform, handle) values ('instagram', '__FIXTURE__')`);
    await mustAccept(client, "the same handle on another platform is a different account",
      `insert into social_accounts (platform, handle) values ('tiktok', '__fixture__')`);
    const arch = await mustAccept(client, "a link-only account needs no platform id",
      `insert into social_accounts (platform, handle) values ('x', '__fx_arch__') returning id`);
    if (arch) {
      await client.query(`update social_accounts set archived_at = now() where id = $1`, [arch.id]);
      await mustAccept(client, "an archived handle can be added again",
        `insert into social_accounts (platform, handle) values ('x', '__fx_arch__')`);
    }
    if (acct) {
      await mustAccept(client, "a post can be stored with blank metrics",
        `insert into social_posts (account_id, external_id, posted_at) values ($1, 'p1', now())`, [acct.id]);
      const blank = await client.query(`select likes, views from social_posts where account_id = $1 and external_id = 'p1'`, [acct.id]);
      blank.rows[0].likes === null && blank.rows[0].views === null ? ok("…and a blank metric is NULL, not zero") : bad("a blank metric was stored as a number");
      await mustReject(client, "the same post twice is refused",
        `insert into social_posts (account_id, external_id, posted_at) values ($1, 'p1', now())`, [acct.id]);
      const up = await mustAccept(client, "a re-pull updates the same post",
        `insert into social_posts (account_id, external_id, posted_at, likes) values ($1, 'p1', now(), 7)
         on conflict (account_id, external_id) do update set likes = excluded.likes returning likes`, [acct.id]);
      Number(up?.likes) === 7 ? ok("…with the new number") : bad(`re-pull stored ${up?.likes}`);
      await mustReject(client, "a negative metric is refused",
        `insert into social_posts (account_id, external_id, posted_at, views) values ($1, 'p2', now(), -1)`, [acct.id]);
      await mustAccept(client, "a follower reading can be stored",
        `insert into social_account_daily (account_id, day, followers) values ($1, '2026-01-01', 100)`, [acct.id]);
      await mustReject(client, "a second reading for the same day is refused",
        `insert into social_account_daily (account_id, day, followers) values ($1, '2026-01-01', 101)`, [acct.id]);
      await mustReject(client, "a negative follower count is refused",
        `insert into social_account_daily (account_id, day, followers) values ($1, '2026-01-02', -5)`, [acct.id]);
      await mustReject(client, "deleting an account that has posts is refused",
        `delete from social_accounts where id = $1`, [acct.id]);
      await mustAccept(client, "a pull can be recorded",
        `insert into social_sync_runs (account_id, trigger, status) values ($1, 'script', 'ok')`, [acct.id]);
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

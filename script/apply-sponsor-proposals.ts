/**
 * Sponsor proposals — apply the migration and PROVE its rules.
 *
 *   npx tsx --env-file=.env script/apply-sponsor-proposals.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-sponsor-proposals.ts --commit   # for real
 */
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const MIGRATION = "2026-11-14_sponsor_proposals.sql";
const TOKEN = "fixture_token_AAAAAAAAAAAAAAAA";

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
  console.log(`\n  Sponsor proposals — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    ok("migration ran");
    await client.query(sql);
    ok("migration ran a second time (idempotent)");
    for (const t of ["sponsor_proposals", "sponsor_proposal_events"]) {
      const r = await client.query(`select relrowsecurity from pg_class where relname = $1 and relkind = 'r'`, [t]);
      r.rowCount ? ok(`${t} exists`) : bad(`${t} was not created`);
      r.rows[0]?.relrowsecurity ? ok(`${t} has RLS on`) : bad(`${t} has RLS OFF`);
    }

    await client.query("SAVEPOINT fixtures");
    const org = (await client.query(`select id from organizations where slug = 'united-sports-group'`)).rows[0]?.id;
    org ? ok("United Sports Group workspace found") : bad("no united-sports-group organisation");
    const base = `insert into sponsor_proposals (organization_id, token, brand, sponsor_company`;
    const p = await mustAccept(client, "a draft can be made with only a sponsor name",
      `${base}) values ($1, $2, 'siu', '__fixture__') returning id, fee_cents, published_at, accepted_held`, [org, TOKEN]);
    p && p.fee_cents === null ? ok("…and a fee nobody set is NULL, not zero") : bad("a missing fee was stored as a number");
    p && p.published_at === null ? ok("…and it starts unpublished") : bad("a new proposal was born published");

    await mustReject(client, "the same token twice is refused", `${base}) values ($1, $2, 'siu', 'x')`, [org, TOKEN]);
    await mustReject(client, "a short, guessable token is refused", `${base}) values ($1, 'abc', 'siu', 'x')`, [org]);
    await mustReject(client, "a blank sponsor name is refused", `${base}) values ($1, 'fixture_token_BBBBBBBBBBBBBBBB', 'siu', '  ')`, [org]);
    await mustReject(client, "a negative fee is refused", `${base}, fee_cents) values ($1, 'fixture_token_CCCCCCCCCCCCCCCC', 'siu', 'x', -1)`, [org]);
    await mustReject(client, "a term that ends before it starts is refused",
      `${base}, term_start, term_end) values ($1, 'fixture_token_DDDDDDDDDDDDDDDD', 'siu', 'x', '2027-12-31', '2027-01-01')`, [org]);
    await mustReject(client, "a logo ground that is neither light nor dark is refused",
      `${base}, logo_ground) values ($1, 'fixture_token_EEEEEEEEEEEEEEEE', 'siu', 'x', 'blue')`, [org]);
    await mustReject(client, "assets that are not a list are refused",
      `${base}, assets) values ($1, 'fixture_token_FFFFFFFFFFFFFFFF', 'siu', 'x', '{"a":1}'::jsonb)`, [org]);
    await mustReject(client, "a proposal for a workspace that does not exist is refused", `${base}) values (-1, 'fixture_token_GGGGGGGGGGGGGGGG', 'siu', 'x')`);

    if (p) {
      await mustReject(client, "an acceptance on an UNPUBLISHED proposal is refused",
        `update sponsor_proposals set accepted_at = now(), accepted_name = 'A Person' where id = $1`, [p.id]);
      await mustAccept(client, "publishing is a timestamp", `update sponsor_proposals set published_at = now() where id = $1`, [p.id]);
      await mustReject(client, "an acceptance with no name is refused", `update sponsor_proposals set accepted_at = now() where id = $1`, [p.id]);
      await mustReject(client, "a name with no acceptance time is refused", `update sponsor_proposals set accepted_name = 'A Person' where id = $1`, [p.id]);
      await mustAccept(client, "an acceptance with a name and a time is kept",
        `update sponsor_proposals set accepted_at = now(), accepted_name = 'A Person', accepted_email = 'a@example.com' where id = $1`, [p.id]);
      await mustReject(client, "a partner contract with no signed agreement behind it is refused",
        `update sponsor_proposals set partner_contract_id = (select id from sponsorship_partner_contracts limit 1) where id = $1
           and exists (select 1 from sponsorship_partner_contracts)`, [p.id]);
      await mustReject(client, "an agreement that does not exist cannot be linked",
        `update sponsor_proposals set esign_document_id = -1 where id = $1`, [p.id]);

      await mustAccept(client, "a page open is recorded", `insert into sponsor_proposal_events (proposal_id, kind, visitor_id, device) values ($1, 'open', 'v1', 'phone')`, [p.id]);
      await mustReject(client, "an event of an unknown kind is refused", `insert into sponsor_proposal_events (proposal_id, kind) values ($1, 'clicked')`, [p.id]);
      await mustReject(client, "an event on a proposal that does not exist is refused", `insert into sponsor_proposal_events (proposal_id, kind) values (-1, 'open')`);

      // One agreement, one proposal.
      const doc = (await client.query(`select id, organization_id from esign_documents order by id desc limit 1`)).rows[0];
      if (doc) {
        await mustAccept(client, "an agreement can be linked", `update sponsor_proposals set esign_document_id = $2 where id = $1`, [p.id, doc.id]);
        await mustReject(client, "the same agreement on a second proposal is refused",
          `${base}, esign_document_id) values ($1, 'fixture_token_HHHHHHHHHHHHHHHH', 'siu', 'second', $2)`, [org, doc.id]);
      } else {
        console.log("  · no e-Sign document exists to test the one-agreement rule against");
      }
      await client.query(`delete from sponsor_proposals where id = $1`, [p.id]);
      const left = await client.query(`select count(*)::int as n from sponsor_proposal_events where proposal_id = $1`, [p.id]);
      left.rows[0].n === 0 ? ok("removing a proposal removes its events") : bad("events were orphaned");
    }
    await client.query("ROLLBACK TO SAVEPOINT fixtures");
    const stray = await client.query(`select count(*)::int as n from sponsor_proposals where sponsor_company in ('__fixture__', 'x', 'second')`);
    stray.rows[0].n === 0 ? ok("no fixture rows left behind") : bad("fixture rows were left behind");

    if (problems.length) throw new Error(`${problems.length} check(s) failed`);
    if (COMMIT) { await client.query("COMMIT"); console.log(`\n  ✅ ${checks} checks passed. COMMITTED.\n`); }
    else { await client.query("ROLLBACK"); console.log(`\n  ✅ ${checks} checks passed. Rolled back: nothing was changed.\n`); }
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(`\n  ❌ ${e.message}\n`);
    for (const p of problems) console.error(`     - ${p}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
main();

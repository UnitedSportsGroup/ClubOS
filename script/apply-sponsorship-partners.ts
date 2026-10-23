/**
 * Sponsorship Partners — apply the migration and PROVE its rules.
 *
 *   npx tsx --env-file=.env script/apply-sponsorship-partners.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-sponsorship-partners.ts --commit   # for real
 *
 * Runs migrations/2026-10-23_sponsorship_partners.sql inside ONE transaction,
 * then asserts every invariant by trying to break it (mustReject) and every
 * legitimate write by doing it (mustAccept), against throwaway fixtures that
 * are discarded before COMMIT. There is no local Postgres; this is the rehearsal.
 *
 * Proven here:
 *   1. a term cannot end before it starts; an open-ended deal has no end date
 *   2. money is never negative; an instalment is never zero
 *   3. "paid" carries what was paid — paid_on and paid_cents travel together
 *   4. one live partner row per company per workspace (archive, never duplicate)
 *   5. a deliverable belongs to a deal OR a partner contract, never neither
 *   6. a contract's file node cannot be hard-deleted from under it (RESTRICT)
 *   7. the three tables have RLS on; the migration is idempotent
 *   8. the existing deal-deliverable write path still works unchanged
 */
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const MIGRATION = "2026-10-23_sponsorship_partners.sql";

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
  return r?.rows?.[0] ?? null;
}

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", MIGRATION), "utf8");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log(`\n  Sponsorship Partners — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    console.log("  migration ran");
    await client.query(sql);
    ok("migration is idempotent (ran twice)");

    for (const t of ["sponsorship_partners", "sponsorship_partner_contracts", "sponsorship_partner_payments"]) {
      const r = await client.query(`select relrowsecurity from pg_class where relname = $1`, [t]);
      r.rowCount ? ok(`${t} exists`) : bad(`${t} was not created`);
      r.rows[0]?.relrowsecurity ? ok(`${t} has RLS on`) : bad(`${t} has RLS OFF`);
    }
    const col = await client.query(`select is_nullable from information_schema.columns where table_name='sponsorship_deliverables' and column_name='deal_id'`);
    col.rows[0]?.is_nullable === "YES" ? ok("sponsorship_deliverables.deal_id is nullable") : bad("deal_id still NOT NULL");
    const col2 = await client.query(`select 1 from information_schema.columns where table_name='sponsorship_deliverables' and column_name='partner_contract_id'`);
    col2.rowCount ? ok("sponsorship_deliverables.partner_contract_id exists") : bad("partner_contract_id missing");

    // ── fixtures (org 7 = United Sports Group; a throwaway drive node) ──
    const org = (await client.query(`select id from organizations where slug='united-sports-group'`)).rows[0]?.id;
    if (!org) throw new Error("United Sports Group org not found");
    const node = (await client.query(`insert into drive_nodes (kind, name, brand) values ('file', '__partners_rehearsal.pdf', 'all') returning id`)).rows[0].id;

    const p = await mustAccept(client, "a partner can be created",
      `insert into sponsorship_partners (organization_id, company, brand_tags) values ($1, '__Rehearsal Sponsor', '{cufc}') returning id`, [org]);
    const pid = p?.id;
    await mustReject(client, "the same company cannot be live twice in one workspace (case-insensitive)",
      `insert into sponsorship_partners (organization_id, company) values ($1, '__rehearsal sponsor')`, [org]);
    // 🔴 Two statements, not one CTE — every sub-statement of ONE command sees
    // the same snapshot, so "archive then insert" inside a WITH never sees the
    // archive and the unique index fires (or, worse, admits a duplicate).
    await client.query(`update sponsorship_partners set archived_at = now() where id = $1`, [pid]);
    const again = await mustAccept(client, "an archived row does not block a new live one",
      `insert into sponsorship_partners (organization_id, company) values ($1, '__Rehearsal Sponsor') returning id`, [org]);
    await client.query(`delete from sponsorship_partners where id = $1`, [again?.id]);
    await client.query(`update sponsorship_partners set archived_at = null where id = $1`, [pid]);

    const c = await mustAccept(client, "a contract with a file, a term and money can be created",
      `insert into sponsorship_partner_contracts (partner_id, title, start_date, end_date, cash_per_year_cents, contract_node_id, signature_status)
       values ($1, 'Rehearsal deal', '2026-01-15', '2027-01-14', 6000000, $2, 'both_parties') returning id`, [pid, node]);
    const cid = c?.id;
    await mustReject(client, "a term that ends before it starts is refused",
      `insert into sponsorship_partner_contracts (partner_id, start_date, end_date) values ($1, '2026-06-01', '2026-05-31')`, [pid]);
    await mustReject(client, "an open-ended contract cannot also carry an end date",
      `insert into sponsorship_partner_contracts (partner_id, open_ended, end_date) values ($1, true, '2027-01-01')`, [pid]);
    await mustReject(client, "negative money is refused",
      `insert into sponsorship_partner_contracts (partner_id, cash_per_year_cents) values ($1, -1)`, [pid]);
    await mustReject(client, "a negative notice period is refused",
      `insert into sponsorship_partner_contracts (partner_id, notice_days) values ($1, -5)`, [pid]);
    await mustReject(client, "the contract's file node cannot be deleted from under it (RESTRICT)",
      `delete from drive_nodes where id = $1`, [node]);
    await mustReject(client, "a partner with contracts cannot be deleted (RESTRICT)",
      `delete from sponsorship_partners where id = $1`, [pid]);

    await mustAccept(client, "an instalment can be scheduled",
      `insert into sponsorship_partner_payments (contract_id, label, due_on, amount_cents, gst_included) values ($1, 'Year 1', '2026-01-15', 6900000, true) returning id`, [cid]);
    await mustReject(client, "a zero instalment is refused",
      `insert into sponsorship_partner_payments (contract_id, amount_cents) values ($1, 0)`, [cid]);
    await mustReject(client, "paid_on without paid_cents is refused",
      `insert into sponsorship_partner_payments (contract_id, amount_cents, paid_on) values ($1, 100, '2026-02-01')`, [cid]);
    await mustReject(client, "paid_cents without paid_on is refused",
      `insert into sponsorship_partner_payments (contract_id, amount_cents, paid_cents) values ($1, 100, 100)`, [cid]);
    await mustAccept(client, "marking an instalment paid carries the amount",
      `update sponsorship_partner_payments set paid_on = '2026-02-13', paid_cents = 6900000 where contract_id = $1`, [cid]);

    await mustAccept(client, "a deliverable can hang off a partner contract (no deal)",
      `insert into sponsorship_deliverables (partner_contract_id, title, category) values ($1, 'Front of shirt', 'contract') returning id`, [cid]);
    await mustReject(client, "a deliverable with neither a deal nor a contract is refused",
      `insert into sponsorship_deliverables (title, category) values ('Orphan', 'contract')`);
    const deal = (await client.query(`select id from sponsorship_deals where organization_id = $1 limit 1`, [org])).rows[0]?.id;
    if (deal) {
      await mustAccept(client, "the existing deal-deliverable write path still works",
        `insert into sponsorship_deliverables (deal_id, title, category) values ($1, '__rehearsal', 'contract') returning id`, [deal]);
      await client.query(`delete from sponsorship_deliverables where deal_id = $1 and title = '__rehearsal'`, [deal]);
    }
    await mustAccept(client, "deleting the contract cascades its payments and deliverables",
      `delete from sponsorship_partner_contracts where id = $1`, [cid]);
    const left = await client.query(`select (select count(*) from sponsorship_partner_payments where contract_id = $1)::int + (select count(*) from sponsorship_deliverables where partner_contract_id = $1)::int as n`, [cid]);
    left.rows[0].n === 0 ? ok("no payment or deliverable survived the contract") : bad("rows survived the contract's deletion");

    // ── cleanup fixtures ──
    await client.query(`delete from sponsorship_partners where id = $1`, [pid]);
    await client.query(`delete from drive_nodes where id = $1`, [node]);

    if (problems.length) {
      await client.query("ROLLBACK");
      console.log(`\n  ✗ ${problems.length} of ${checks} checks failed — rolled back\n`);
      for (const p of problems) console.log(`    - ${p}`);
      process.exit(1);
    }
    if (COMMIT) { await client.query("COMMIT"); console.log(`\n  ✓ ${checks} checks passed — COMMITTED\n`); }
    else { await client.query("ROLLBACK"); console.log(`\n  ✓ ${checks} checks passed — rolled back (dry run)\n`); }
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\n  ✗ failed:", e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}
main();

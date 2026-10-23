/**
 * Give every live partner the org's onboarding checklist, carrying over what
 * was already ticked on the pipeline deal that won them.
 *
 *   npx tsx --env-file=.env script/apply-partner-onboarding.ts            # dry run
 *   npx tsx --env-file=.env script/apply-partner-onboarding.ts --commit
 *
 * Same rule as the server's applyOnboardingToPartner: one 'onboarding'
 * deliverable per active template item on the partner's CURRENT contract,
 * skipping titles the partner already has; a partner with no contract row gets
 * a placeholder contract that says there is no document. Then, where the
 * partner is linked to a pipeline deal, each item's status / delivered date /
 * owner / proof / notes are copied from the deal's own onboarding row of the
 * same title — but only onto a partner row that is still pending, so a tick
 * made in the Partners tab is never overwritten. Idempotent.
 */
import pg from "pg";
import { currentContract } from "../shared/sponsorship-partners";

const COMMIT = process.argv.includes("--commit");
pg.types.setTypeParser(1082, (v: string) => v);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const today = new Date(Date.now() + 13 * 3600 * 1000).toISOString().slice(0, 10);
const ORG = 7;
await c.query("BEGIN");
try {
  const templates = (await c.query(`select id, title, description, default_owner_id, display_order from sponsorship_onboarding_templates where organization_id=$1 and is_active order by display_order`, [ORG])).rows;
  const partners = (await c.query(`select id, company, deal_id from sponsorship_partners where organization_id=$1 and archived_at is null order by company`, [ORG])).rows;
  console.log(`\n  Partner onboarding — ${COMMIT ? "COMMIT" : "DRY RUN"} · ${partners.length} partners · ${templates.length} template items\n`);
  let added = 0, carried = 0, placeholders = 0;
  for (const p of partners) {
    const contracts = (await c.query(`select id, partner_id, start_date, end_date, open_ended, signed_on, signature_status, cash_per_year_cents, contra_per_year_cents, notice_days from sponsorship_partner_contracts where partner_id=$1`, [p.id])).rows
      .map(r => ({ ...r, partnerId: r.partner_id, startDate: r.start_date, endDate: r.end_date, openEnded: r.open_ended, signedOn: r.signed_on, signatureStatus: r.signature_status, cashPerYearCents: r.cash_per_year_cents, contraPerYearCents: r.contra_per_year_cents, noticeDays: r.notice_days }));
    let cur = currentContract(contracts, today);
    if (!cur) {
      const r = await c.query(`insert into sponsorship_partner_contracts (partner_id, title, signature_status, flags) values ($1, 'Partnership (no document on file)', 'unsigned', $2::jsonb) returning id`, [p.id, JSON.stringify(["Created by the onboarding checklist — no agreement on file. Attach the signed document when it exists."])]);
      cur = { id: r.rows[0].id } as any; placeholders++;
    }
    const cids = contracts.map(x => x.id).concat(cur!.id);
    const have = new Map<string, any>((await c.query(`select id, title, status from sponsorship_deliverables where partner_contract_id = any($1) and category='onboarding'`, [cids])).rows.map(r => [r.title, r]));
    for (const t of templates) {
      if (have.has(t.title)) continue;
      const r = await c.query(`insert into sponsorship_deliverables (partner_contract_id, title, type, category, trigger_type, status, owner_id, notes, display_order) values ($1,$2,'onboarding','onboarding','once','pending',$3,$4,$5) returning id, title, status`, [cur!.id, t.title, t.default_owner_id, t.description, t.display_order]);
      have.set(t.title, r.rows[0]); added++;
    }
    let carriedHere = 0;
    if (p.deal_id) {
      const dealRows = (await c.query(`select title, status, delivered_at, owner_id, proof_url, notes, used_qty from sponsorship_deliverables where deal_id=$1 and category='onboarding'`, [p.deal_id])).rows;
      for (const d of dealRows) {
        const mine = have.get(d.title);
        if (!mine || mine.status !== "pending" || d.status === "pending") continue;
        await c.query(`update sponsorship_deliverables set status=$2, delivered_at=$3, owner_id=coalesce($4, owner_id), proof_url=coalesce($5, proof_url), notes=coalesce($6, notes), updated_at=now() where id=$1`, [mine.id, d.status, d.delivered_at, d.owner_id, d.proof_url, d.notes]);
        carriedHere++; carried++;
      }
    }
    console.log(`  ${p.company.padEnd(38)} ${have.size} items${carriedHere ? ` · ${carriedHere} carried over from deal #${p.deal_id}` : p.deal_id ? ` · deal #${p.deal_id} had nothing ticked` : ""}`);
  }
  console.log(`\n  ${COMMIT ? "Wrote" : "Would write"}: ${added} checklist items · ${carried} statuses carried over · ${placeholders} placeholder contracts\n`);
  await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
} catch (e: any) {
  await c.query("ROLLBACK"); console.error("  ✗", e.message); process.exit(1);
} finally { await c.end(); }

/**
 * Partners → bring every sponsor's instalments in line with LIVE Xero (4 Nov 2026)
 * and add the four sponsors paying us that the Partners tab did not hold.
 *
 *   npx tsx --env-file=.env script/apply-partner-payments-2026-11-04.ts            # dry run (rolled back)
 *   npx tsx --env-file=.env script/apply-partner-payments-2026-11-04.ts --commit
 *
 * Source: outputs/sponsorship/2026-11-04-ryan-sponsor-breakdown/xero_sponsor_invoices.json
 * (every ACCREC invoice on account 107/217 since 1 Jul 2025). Nothing here is
 * invented: an amount, a date and a paid date come off a Xero invoice, a deal
 * shape off the invoice's own wording. Idempotent — a row is found by its
 * Xero invoice number (or label) before it is written. Never deletes.
 */
import pg from "pg";
const commit = process.argv.includes("--commit");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SRC = "Xero, pulled 2026-11-04";

async function main() {
  const cx = await pool.connect();
  const log: string[] = [];
  try {
    await cx.query("BEGIN");
    const { rows: [org] } = await cx.query(`SELECT id FROM organizations WHERE slug = 'united-sports-group'`);
    const contractOf = async (company: string) => {
      const { rows } = await cx.query(
        `SELECT c.id FROM sponsorship_partner_contracts c JOIN sponsorship_partners p ON p.id = c.partner_id
          WHERE p.company = $1 AND p.organization_id = $2 ORDER BY c.start_date DESC NULLS LAST, c.id DESC LIMIT 1`, [company, org.id]);
      if (!rows[0]) throw new Error(`no contract for ${company}`);
      return rows[0].id as number;
    };
    /** Upsert one instalment, keyed on (contract, invoice number) else (contract, label). */
    const pay = async (cid: number, r: { label: string; due: string; ex: number; paidOn?: string | null; paid?: number | null; inv?: string | null; note: string }) => {
      const { rows } = r.inv
        ? await cx.query(`SELECT id FROM sponsorship_partner_payments WHERE contract_id = $1 AND (xero_invoice_number = $2 AND label = $3)`, [cid, r.inv, r.label])
        : await cx.query(`SELECT id FROM sponsorship_partner_payments WHERE contract_id = $1 AND label = $2`, [cid, r.label]);
      const vals = [r.label, r.due, r.ex, r.paidOn ?? null, r.paid ?? null, r.inv ?? null, `${r.note} (${SRC})`];
      if (rows[0]) {
        await cx.query(`UPDATE sponsorship_partner_payments SET label=$1, due_on=$2, amount_cents=$3, paid_on=$4, paid_cents=$5, xero_invoice_number=$6, notes=$7, updated_at=now() WHERE id=$8`, [...vals, rows[0].id]);
        log.push(`  ~ payment ${rows[0].id} ${r.label}`);
      } else {
        await cx.query(`INSERT INTO sponsorship_partner_payments (contract_id,label,due_on,amount_cents,gst_included,paid_on,paid_cents,xero_invoice_number,notes) VALUES ($1,$2,$3,$4,false,$5,$6,$7,$8)`, [cid, ...vals]);
        log.push(`  + payment ${r.label} on contract ${cid}`);
      }
    };
    const partner = async (o: { company: string; brands: string[]; name?: string; email?: string; phone?: string; notes: string;
      contract: { title: string; club: string; start: string | null; end: string | null; cashYear: number; terms: string; sig: string; flags: string[] } }) => {
      let { rows: [p] } = await cx.query(`SELECT id FROM sponsorship_partners WHERE organization_id=$1 AND lower(company)=lower($2) AND archived_at IS NULL`, [org.id, o.company]);
      if (!p) {
        ({ rows: [p] } = await cx.query(`INSERT INTO sponsorship_partners (organization_id,company,brand_tags,primary_contact_name,primary_contact_email,primary_contact_phone,notes,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,1) RETURNING id`, [org.id, o.company, o.brands, o.name ?? null, o.email ?? null, o.phone ?? null, o.notes]));
        log.push(`+ partner ${o.company} (${p.id})`);
      } else log.push(`= partner ${o.company} (${p.id}) already here`);
      let { rows: [c] } = await cx.query(`SELECT id FROM sponsorship_partner_contracts WHERE partner_id=$1 ORDER BY id LIMIT 1`, [p.id]);
      if (!c) {
        const k = o.contract;
        ({ rows: [c] } = await cx.query(`INSERT INTO sponsorship_partner_contracts (partner_id,title,club_entity,start_date,end_date,open_ended,cash_per_year_cents,payment_terms,signature_status,flags,created_by)
          VALUES ($1,$2,$3,$4,$5,false,$6,$7,$8,$9::jsonb,1) RETURNING id`, [p.id, k.title, k.club, k.start, k.end, k.cashYear, k.terms, k.sig, JSON.stringify(k.flags)]));
        log.push(`  + contract ${c.id}`);
      }
      return c.id as number;
    };

    // ── Existing partners ──
    await pay(await contractOf("Formosa Foods"), { label: "Year 3", due: "2026-10-20", ex: 400000, paid: 124000, inv: "INV-17537",
      note: "INV-17537 $4,600: $400 credit from the Aug 2025 overpayment + $420 on 30 Sep + $420 on 30 Oct = $1,240 in; $3,360 left. Invoice asked for 4 × $1,050 from 20 Oct; they are paying $420 a month" });
    await pay(await contractOf("Milano Tiling"), { label: "Year 3", due: "2026-06-30", ex: 195000, inv: null,
      note: "2026 season (1 Jul 2026 – 1 Jul 2027). NOT invoiced in Xero yet" });

    const vf = await contractOf("Victoria Foods");
    const VF: [string, string, string, string | null][] = [
      ["INV-15666", "Month 1 of 6", "2026-02-16", "2026-03-23"], ["INV-15723", "Month 2 of 6", "2026-03-15", null],
      ["INV-15877", "Month 3 of 6", "2026-04-15", null], ["INV-16089", "Month 4 of 6", "2026-05-15", "2026-07-06"],
      ["INV-16719", "Month 5 of 6", "2026-06-15", null], ["INV-16872", "Month 6 of 6", "2026-07-15", null],
    ];
    for (const [inv, label, due, paidOn] of VF) await pay(vf, { label, due, ex: 133333, paidOn, paid: paidOn ? 153333 : null, inv,
      note: `${inv} $1,533.33 'SIU Catering partner. Shorts Logo'${paidOn ? `, paid ${paidOn}` : ", unpaid"}. Agreement unsigned and its price contradicts itself` });

    await pay(await contractOf("SMC Design Studio"), { label: "2026 season", due: "2026-01-20", ex: 1500000, inv: null,
      note: "Contract: $15,000 + GST on 20 Jan 2026 or 6 × $2,500. INV-15455 $17,250 was raised 27 Jan and CREDIT-NOTED in full 28 Feb (CN-15846), no reason recorded. Nothing received" });

    await pay(await contractOf("Pak'nSave Tamatea"), { label: "Month 13 (term ended 7 Nov)", due: "2026-11-10", ex: 100000, inv: "INV-17848",
      note: "INV-17848 $1,150 raised 1 Nov, due 10 Nov — the signed 12-month term ends 7 Nov 2026" });

    // ── Paying us, but not on the Partners tab ──
    const sb = await partner({ company: "Signbiz", brands: ["cufc", "academy"], name: "Angela", email: "angela@signbiz.co.nz",
      notes: "Added 4 Nov 2026 from Xero INV-17538. No agreement uploaded to the Partners tab yet.",
      contract: { title: "Academy front of shirt, 2026", club: "Christchurch United", start: "2026-10-20", end: null, cashYear: 1500000,
        terms: "INV-17538: $15,000 + GST ($17,250), payable in five instalments of $3,450 incl GST on the 20th of each month: 20 Oct, 20 Nov, 20 Dec 2026, 20 Jan, 20 Feb 2027.",
        sig: "not_checked", flags: ["No signed agreement on the Partners tab — upload it, or confirm the deal with Ryan.", "End date not known; the invoice covers 2026."] } });
    for (const [i, due] of ["2026-10-20", "2026-11-20", "2026-12-20", "2027-01-20", "2027-02-20"].entries())
      await pay(sb, { label: `Instalment ${i + 1} of 5`, due, ex: 300000, inv: "INV-17538", note: "INV-17538, nothing paid against it yet" });

    const ch = await partner({ company: "Core Hygiene", brands: ["cufc"], email: "will@corehygiene.co.nz",
      notes: "Added 4 Nov 2026 from Xero INV-15667 ('CUFC Hygiene Partners – Community sponsorship'). Core Hygiene is also our supplier (bathroom servicing).",
      contract: { title: "CUFC Hygiene Partner — community sponsorship", club: "Christchurch United", start: null, end: null, cashYear: 300000,
        terms: "INV-15667: $3,000 + GST ($3,450). Figure from Ryan's 3 Nov 2025 list.", sig: "unsigned",
        flags: ["No signed agreement anywhere in the club Drive."] } });
    await pay(ch, { label: "2026", due: "2026-02-16", ex: 300000, paidOn: "2026-10-13", paid: 345000, inv: "INV-15667", note: "INV-15667 paid in full 13 Oct 2026" });

    const lg = await partner({ company: "Legacy Sport Group", brands: ["cufc", "cic"], name: "Richard Gorrett", email: "rich@legacysport.co.nz", phone: "022 455 9102",
      notes: "Added 4 Nov 2026. Sports travel agency (ran the U19 Napier tour). Richard visiting Christchurch ~11–12 Nov.",
      contract: { title: "Legacy Sport × United Sports Group partnership — Year 1", club: "United Sports Group", start: "2026-11-04", end: null, cashYear: 1600000,
        terms: "INV-18000: $16,000 + GST ($18,400) Year 1 upfront partnership fee, due 20 Nov 2026 (replaced INV-17847 at $20,000 + GST, voided 4 Nov).", sig: "unsigned",
        flags: ["No partnership agreement sent or signed — the invoice went out ahead of it."] } });
    await pay(lg, { label: "Year 1 upfront", due: "2026-11-20", ex: 1600000, inv: "INV-18000", note: "INV-18000 sent 4 Nov" });

    const us = await partner({ company: "United Steel FC", brands: ["siu"],
      notes: "Added 4 Nov 2026 from Xero. Also a United Prints merch customer (INV-16506 hotel shirts; INV-17816 merch is NOT sponsorship).",
      contract: { title: "SIU player sponsorship", club: "South Island United", start: "2026-04-28", end: null, cashYear: 500000,
        terms: "INV-16506 $1,150: hotel player shirt sponsorship, 50 shirts. INV-18001 $4,600: South Island United player sponsorship — Haris Zeb.", sig: "not_checked",
        flags: ["No agreement on the Partners tab."] } });
    await pay(us, { label: "Hotel player shirts", due: "2026-04-29", ex: 100000, paidOn: "2026-05-01", paid: 115000, inv: "INV-16506", note: "INV-16506 paid 1 May" });
    await pay(us, { label: "Player sponsorship — Haris Zeb", due: "2026-11-18", ex: 400000, inv: "INV-18001", note: "INV-18001 sent 4 Nov" });

    console.log(log.join("\n"));
    if (commit) { await cx.query("COMMIT"); console.log("\nCOMMITTED"); }
    else { await cx.query("ROLLBACK"); console.log("\nDRY RUN — rolled back. Re-run with --commit."); }
  } catch (e) { await cx.query("ROLLBACK"); throw e; } finally { cx.release(); await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });

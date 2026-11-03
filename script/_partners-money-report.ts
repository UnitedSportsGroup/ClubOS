/**
 * Every live partner's current deal and its money, through the SAME decider the
 * Partners tab draws (shared/sponsorship-partners.ts moneySummary) — so a
 * written breakdown for Ryan can never disagree with the screen.
 *   npx tsx --env-file=.env script/_partners-money-report.ts > partners_money.json
 */
import pg from "pg";
import { currentContract, moneySummary, contractState, leftInclCents, paymentState, fmtDateNz } from "../shared/sponsorship-partners";
import { nzTodayIso } from "../shared/dashboard";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const iso = (d: any): string | null => {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return String(d).slice(0, 10);
};
const today = nzTodayIso();
const P = (await pool.query(`select * from sponsorship_partners where archived_at is null order by company`)).rows;
const C = (await pool.query(`select * from sponsorship_partner_contracts`)).rows;
const Y = (await pool.query(`select * from sponsorship_partner_payments order by due_on`)).rows;
const out: any[] = [];
for (const p of P) {
  const cs = C.filter(c => c.partner_id === p.id).map(c => ({
    ...c, startDate: iso(c.start_date), endDate: iso(c.end_date), openEnded: c.open_ended, signedOn: iso(c.signed_on),
    signatureStatus: c.signature_status, cashPerYearCents: c.cash_per_year_cents, contraPerYearCents: c.contra_per_year_cents, noticeDays: c.notice_days,
  }));
  const cur: any = currentContract(cs, today);
  const pays = Y.filter(y => cur && y.contract_id === cur.id).map(y => ({
    id: y.id, contractId: y.contract_id, label: y.label, dueOn: iso(y.due_on), amountCents: y.amount_cents,
    paidOn: iso(y.paid_on), paidCents: y.paid_cents, gstIncluded: y.gst_included, inv: y.xero_invoice_number,
  }));
  const m = moneySummary(pays, today);
  out.push({
    company: p.company, brands: p.brand_tags,
    contact: [p.primary_contact_name, p.primary_contact_email, p.primary_contact_phone].filter(Boolean).join(" · "),
    title: cur?.title, start: cur?.startDate, end: cur?.endDate, state: cur ? contractState(cur, today) : null, sig: cur?.signature_status,
    cashYear: cur?.cashPerYearCents, contraYear: cur?.contraPerYearCents, contra: cur?.contra_description, m,
    overdue: pays.filter(x => paymentState(x, today) === "overdue").map(x => `${x.label}${x.inv ? ` ${x.inv}` : ""} $${(leftInclCents(x) / 100).toFixed(2)} due ${fmtDateNz(x.dueOn)}`),
    next: pays.filter(x => !x.paidOn && paymentState(x, today) !== "overdue").map(x => `${x.label} $${(leftInclCents(x) / 100).toFixed(2)} due ${fmtDateNz(x.dueOn)}`).slice(0, 2),
  });
}
console.log(JSON.stringify({ today, partners: out }, null, 1));
await pool.end();

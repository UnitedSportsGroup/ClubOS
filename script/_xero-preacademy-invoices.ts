// READ-ONLY. Are Pre-Academy (and other academy) card payments being matched to
// Xero INVOICES rather than coded as Receive Money? Payments into the ANZ account
// on 21–25 Sep, with what they paid.
import { withXero } from "../server/xero";
const iso = (d: any) => new Date(d).toISOString().slice(0, 10);
await withXero(1, async (xero, t) => {
  const r = await xero.accountingApi.getPayments(t, new Date("2026-09-15"), `Date >= DateTime(2026,09,15)`, "Date ASC");
  const ps = r.body.payments ?? [];
  console.log(`payments since 15 Sep: ${ps.length}`);
  for (const p of ps) {
    if (!/600|ANZ - Business Premium/.test(`${p.account?.code} ${p.account?.name}`)) continue;
    console.log(`${iso(p.date)}  $${p.amount}  ${p.invoice?.invoiceNumber ?? ""} ${p.invoice?.contact?.name ?? ""} · ${p.reference ?? ""} · rec=${p.isReconciled}`);
  }
});

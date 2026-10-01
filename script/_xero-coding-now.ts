// READ-ONLY. What the chart of accounts looks like NOW, and how the accounts team
// have coded Stripe payouts since the automatic poster started failing (15 Sep).
//   npx tsx --env-file=.env script/_xero-coding-now.ts
import { withXero } from "../server/xero";
const iso = (d: any) => new Date(d).toISOString().slice(0, 10);
await withXero(1, async (xero, tenantId) => {
  const accs = (await xero.accountingApi.getAccounts(tenantId)).body.accounts ?? [];
  const banks = accs.filter((a) => String(a.type) === "BANK");
  console.log("BANK ACCOUNTS:");
  for (const b of banks) console.log(`  ${b.code ?? "(no code)"} · ${b.name} · ${b.status} · ${b.bankAccountNumber ?? ""} · id ${b.accountID}`);
  console.log("\nREVENUE + relevant (status ACTIVE):");
  for (const a of accs.filter((a) => /REVENUE|SALES|OTHERINCOME/.test(String(a.type)) || /^(01|02|03|04|05|06|07|08|09|10|11|12|13)/.test(a.code ?? "") || ["200","203","200/05","200/07","200/11","203/02","301","484/01","147"].includes(a.code ?? "")).slice(0, 400))
    console.log(`  ${(a.code ?? "").padEnd(10)} ${String(a.status).padEnd(9)} ${String(a.type).padEnd(10)} ${a.taxType ?? ""} · ${a.name}`);
  // Olga's hand-coded Stripe entries since 1 Sep, across every bank account
  const txns: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await xero.accountingApi.getBankTransactions(tenantId, new Date("2026-09-01"), `Type=="RECEIVE"`, "Date DESC", page);
    const t = r.body.bankTransactions ?? []; txns.push(...t); if (t.length < 100) break;
  }
  const stripe = txns.filter((t) => /stripe/i.test(t.contact?.name ?? "") || /stripe|payout/i.test(t.reference ?? ""));
  console.log(`\nSTRIPE RECEIVE-MONEY ENTRIES since 1 Sep: ${stripe.length}`);
  for (const t of stripe) {
    console.log(`  ${iso(t.date)} $${t.total} · bank ${t.bankAccount?.code ?? ""} ${t.bankAccount?.name ?? ""} · ${t.status} · rec=${t.isReconciled} · ${t.lineAmountTypes} · contact ${t.contact?.name} · ref ${t.reference ?? ""}`);
    for (const l of t.lineItems ?? []) console.log(`      ${String(l.accountCode).padEnd(10)} ${String(l.taxType ?? "").padEnd(8)} ${String(l.lineAmount).padStart(10)}  ${l.description ?? ""}`);
  }
});

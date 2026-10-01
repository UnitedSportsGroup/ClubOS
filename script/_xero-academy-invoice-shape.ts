// READ-ONLY. The shape of Olga's per-child academy invoices, and the open ones.
import { withXero } from "../server/xero";
const iso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : "");
await withXero(1, async (xero, t) => {
  const one = (await xero.accountingApi.getInvoiceByNumber?.(t, "INV-17543").catch(() => null)) as any;
  const inv = one?.body?.invoices?.[0] ?? (await xero.accountingApi.getInvoices(t, undefined, `InvoiceNumber=="INV-17543"`)).body.invoices?.[0];
  console.log("INV-17543:", inv?.contact?.name, iso(inv?.date), iso(inv?.dueDate), inv?.status, inv?.lineAmountTypes, inv?.reference, inv?.brandingThemeID ? "theme" : "");
  for (const l of inv?.lineItems ?? []) console.log("   ", l.accountCode, l.taxType, l.unitAmount, l.quantity, "·", l.description, "· item", l.itemCode ?? "", "· tracking", JSON.stringify(l.tracking ?? []));
  const open = (await xero.accountingApi.getInvoices(t, new Date("2026-09-01"), `Type=="ACCREC" AND Status=="AUTHORISED"`, "Date DESC", undefined, undefined, undefined, undefined, 1)).body.invoices ?? [];
  console.log(`\nopen (AUTHORISED, unpaid) sales invoices since 1 Sep: ${open.length}`);
  for (const i of open.filter((i: any) => /^\(A/.test(i.contact?.name ?? "")).slice(0, 40)) console.log(`  ${i.invoiceNumber} ${iso(i.date)} due ${i.amountDue} of ${i.total} · ${i.contact?.name} · ${(i.lineItems ?? []).map((l: any) => l.accountCode).join(",")}`);
});

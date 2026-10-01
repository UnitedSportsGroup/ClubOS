// READ-ONLY. One of Olga's per-child academy invoices, in full, plus its contact.
import { withXero } from "../server/xero";
const num = process.argv[2] ?? "INV-17545";
await withXero(1, async (xero, t) => {
  const list = (await xero.accountingApi.getInvoices(t, undefined, `InvoiceNumber=="${num}"`)).body.invoices ?? [];
  const inv: any = (await xero.accountingApi.getInvoice(t, list[0].invoiceID!)).body.invoices?.[0];
  const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
  console.log(JSON.stringify(pick(inv, ["invoiceNumber","type","status","date","dueDate","reference","lineAmountTypes","brandingThemeID","currencyCode","total","totalTax","sentToContact","url"]), null, 1));
  for (const l of inv.lineItems ?? []) console.log(JSON.stringify(pick(l, ["description","quantity","unitAmount","accountCode","taxType","itemCode","tracking","lineAmount"])));
  const c: any = (await xero.accountingApi.getContact(t, inv.contact.contactID)).body.contacts?.[0];
  console.log("contact:", JSON.stringify(pick(c, ["name","firstName","lastName","emailAddress","accountNumber","contactGroups","isCustomer"])));
});

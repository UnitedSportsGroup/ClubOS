// Barça Academy camp, Jan 2027 — the facility-hire invoice to Akaw Sports Agency, raised in Xero.
//
//   npx tsx --env-file=.env script/issue-barca-camp-invoice.ts            → dry run: prints what it would do
//   npx tsx --env-file=.env script/issue-barca-camp-invoice.ts --commit   → creates contact + AUTHORISED invoice
//   … --commit --email                                                    → and has Xero email it to Marina
//
// Why Xero and not an invoice page: Daniel (1 Oct 2026) wanted it issued "the proper way for our
// accounting team … once the money comes in, they're reconciled against it". A Xero sales invoice is
// what the bank-feed line gets matched to.
//
// The figure is Marina's own written acceptance of 23 Sep 2026: "$6,000 facility hire fee (fields +
// changing rooms + meeting room) together with the rebate model". Daniel confirmed 1 Oct: $6,000
// INCLUDING GST, and the rebate stays off the invoice (it is money Akaw pays us, contracted separately).
// GST: hire of a ground in NZ is a service directly connected with NZ land → 15% even for an overseas
// buyer. Account 106 Field / Facility Hire Income, OUTPUT2.
//
// Idempotent: refuses if an invoice with this reference already exists for the contact.
import { withXero } from "../server/xero";

const CONTACT = { name: "Akaw Sports Agency", firstName: "Marina", lastName: "Llasera Casañas", email: "marina.llasera@akawsports.com", website: "https://www.akawsports.com" };
const REFERENCE = "Barça Academy Camp — Jan 2027";
const ISSUED = "2026-10-01";
const DUE = "2026-10-15";
const AMOUNT_INCL_GST = 6000.0;
const DESCRIPTION = [
  "Facility hire — Barça Academy Camp, Monday 25 – Friday 29 January 2027, United Sports Centre, 466 Yaldhurst Road, Christchurch.",
  "Two synthetic turf pitches (S1 + S2), two changing rooms (equipment storage + staff) and the meeting room with screen for two days.",
  "Partnership facility rate as agreed 23 September 2026.",
  "",
  "Payment by bank transfer: Christchurch United Football Club Inc, ANZ 01-0635-0374823-00, SWIFT ANZBNZ22. Please quote the invoice number.",
].join("\n");

const commit = process.argv.includes("--commit");
const email = process.argv.includes("--email");

await withXero(1, async (xero, tenantId) => {
  const api = xero.accountingApi;

  const found = await api.getContacts(tenantId, undefined, `Name=="${CONTACT.name}"`);
  let contact = found.body.contacts?.[0];
  console.log(contact ? `contact exists: ${contact.name} ${contact.contactID}` : `contact to create: ${CONTACT.name} <${CONTACT.email}>`);

  if (contact) {
    const inv = await api.getInvoices(tenantId, undefined, `Contact.ContactID==guid("${contact.contactID}") AND Reference=="${REFERENCE}" AND Status!="VOIDED" AND Status!="DELETED"`);
    if (inv.body.invoices?.length) {
      const i = inv.body.invoices[0];
      console.log(`🔴 already raised: ${i.invoiceNumber} ${i.status} ${i.total} — not creating a second one`);
      if (email && commit) { await api.emailInvoice(tenantId, i.invoiceID!, {}); console.log(`emailed ${i.invoiceNumber} via Xero`); }
      return;
    }
  }

  console.log(`invoice: ${REFERENCE} · ${ISSUED} due ${DUE} · $${AMOUNT_INCL_GST.toFixed(2)} incl GST · acct 106 OUTPUT2 · AUTHORISED`);
  if (!commit) { console.log("\ndry run — add --commit"); return; }

  if (!contact) {
    const made = await api.createContacts(tenantId, { contacts: [{
      name: CONTACT.name, firstName: CONTACT.firstName, lastName: CONTACT.lastName,
      emailAddress: CONTACT.email, website: CONTACT.website,
    }] });
    contact = made.body.contacts![0];
    console.log(`created contact ${contact.contactID}`);
  }

  const res = await api.createInvoices(tenantId, { invoices: [{
    type: "ACCREC" as any,
    contact: { contactID: contact.contactID },
    date: ISSUED, dueDate: DUE, reference: REFERENCE,
    lineAmountTypes: "Inclusive" as any,
    status: "AUTHORISED" as any,
    currencyCode: "NZD" as any,
    lineItems: [{ description: DESCRIPTION, quantity: 1, unitAmount: AMOUNT_INCL_GST, accountCode: "106", taxType: "OUTPUT2" }],
  }] }, undefined, true);
  const i = res.body.invoices![0];
  if (i.hasErrors) { console.error("Xero refused:", JSON.stringify(i.validationErrors)); process.exit(1); }
  console.log(`🟢 ${i.invoiceNumber} ${i.status} · subtotal ${i.subTotal} · GST ${i.totalTax} · total ${i.total} · ${i.invoiceID}`);
  if (Math.abs(Number(i.total) - AMOUNT_INCL_GST) > 0.001) { console.error("🔴 total is not $6,000.00 — check before sending"); process.exit(1); }

  if (email) { await api.emailInvoice(tenantId, i.invoiceID!, {}); console.log(`emailed ${i.invoiceNumber} to ${CONTACT.email} via Xero`); }
});
process.exit(0);

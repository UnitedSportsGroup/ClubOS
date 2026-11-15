// Read-only: renders a real Reminder + Escalation preview for the most-overdue family. Sends nothing.
import { writeFileSync } from "fs";
import { paymentsDue } from "../server/payments-due";
import { previewChase } from "../server/payments-chase";
const out = process.argv[2] ?? "/tmp";
const snap = await paymentsDue();
const r = snap.rows.find((x) => x.status === "overdue" && x.parentEmail && snap.rows.filter((y) => y.familyKey === x.familyKey).length > 1)
  ?? snap.rows.find((x) => x.status === "overdue" && x.parentEmail)!;
for (const kind of ["reminder", "escalation"] as const) {
  const p = await previewChase(kind, r.familyKey, kind === "escalation" ? null : "Test note line.");
  console.log(kind, "→", p.to.replace(/^(.).*@/, "$1***@"), "|", p.subject, "|", p.invoices.map((i) => `${i.invoiceNumber} ${i.owedCents / 100} link:${i.hasPayLink}`).join(", "));
  writeFileSync(`${out}/chase-${kind}.html`, p.html);
}
process.exit(0);

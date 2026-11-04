// Payments due — CUFC workspace, the Registrations tab's permission (same gate as Xero payments).
// Read only. 🔴 The PDF route serves only an invoice in the current snapshot, so it
// can never be used to pull any other invoice (a sponsor's, a staff member's) out of Xero.
import type { Express, Request, Response } from "express";
import { requireTab } from "./auth";
import { getXeroForOrg } from "./xero";
import { paymentsDue, isInLatestSnapshot } from "./payments-due";

const cufcOnly = (req: Request, res: Response) => {
  if (String(req.headers["x-workspace-slug"] ?? "") !== "christchurch-united") { res.status(404).json({ message: "Not found" }); return false; }
  return true;
};

export function registerPaymentsDueRoutes(app: Express) {
  const gate = requireTab("registrations");

  app.get("/api/admin/payments-due", gate, async (req, res) => {
    if (!cufcOnly(req, res)) return;
    try {
      res.json(await paymentsDue(req.query.refresh === "1"));
    } catch (e: any) {
      // 🔴 never print a raw xero-node error: it can carry the bearer token
      console.error("[payments-due]", typeof e === "string" ? e.slice(0, 200) : String(e?.message ?? "error").slice(0, 200));
      res.status(502).json({ message: "Couldn't read Xero just now — try again in a minute. Nothing has changed." });
    }
  });

  // Bank direct debits that are clearing (2–3 working days) or failed. Read from
  // ClubOS, not Xero: these are registrations still waiting on their money.
  // 🔴 Registered BEFORE `/:invoiceId/pdf` only for readability — the paths differ.
  app.get("/api/admin/payments-due/bank-debits", gate, async (req, res) => {
    if (!cufcOnly(req, res)) return;
    try {
      const { listBankDebits } = await import("./bank-debit");
      const rows = await listBankDebits(1);
      res.json({
        rows: rows.map((r: any) => ({
          registrationId: Number(r.id),
          state: r.payment_failed_at ? "failed" : "clearing",
          amountCents: Number(r.total_cents ?? 0),
          programme: r.programme, term: r.term_name ?? null,
          sentAt: r.payment_processing_at, failedAt: r.payment_failed_at, failureReason: r.payment_failure_reason,
          childName: `${r.child_first ?? ""} ${r.child_last ?? ""}`.trim(),
          childKey: r.child_id ? `contact-${r.child_id}` : null,
          parentName: `${r.guardian_first ?? ""} ${r.guardian_last ?? ""}`.trim(),
          parentKey: r.guardian_id ? `contact-${r.guardian_id}` : null,
          email: r.guardian_email ?? null, phone: r.guardian_phone ?? null,
        })),
      });
    } catch (e: any) {
      console.error("[payments-due bank-debits]", String(e?.message ?? e).slice(0, 200));
      res.status(500).json({ message: "Couldn't read bank payments just now." });
    }
  });

  app.get("/api/admin/payments-due/:invoiceId/pdf", gate, async (req, res) => {
    if (!cufcOnly(req, res)) return;
    const id = String(req.params.invoiceId);
    if (!/^[0-9a-f-]{36}$/i.test(id) || !isInLatestSnapshot(id)) return res.status(404).json({ message: "Not found" });
    try {
      const { xero, tenantId } = await getXeroForOrg(1);
      const r: any = await xero.accountingApi.getInvoiceAsPdf(tenantId, id);
      const buf = Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.body);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="invoice.pdf"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.send(buf);
    } catch (e: any) {
      console.error("[payments-due pdf]", typeof e === "string" ? e.slice(0, 200) : e?.message);
      res.status(502).json({ message: "Xero didn't send the PDF — try again in a minute." });
    }
  });
}

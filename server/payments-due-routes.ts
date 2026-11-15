// Payments due — CUFC workspace, the Registrations tab's permission (same gate as Xero payments).
// Read only, except the Reminder/Escalation emails (payments-chase.ts), which write only their own log. 🔴 The PDF route serves only an invoice in the current snapshot, so it
// can never be used to pull any other invoice (a sponsor's, a staff member's) out of Xero.
import type { Express, Request, Response } from "express";
import { requireTab } from "./auth";
import { getXeroForOrg } from "./xero";
import { paymentsDue, isInLatestSnapshot } from "./payments-due";
import { previewChase, sendChase, chaseHistory, canEscalate, ChaseError, type ChaseKind } from "./payments-chase";

const cufcOnly = (req: Request, res: Response) => {
  if (String(req.headers["x-workspace-slug"] ?? "") !== "christchurch-united") { res.status(404).json({ message: "Not found" }); return false; }
  return true;
};

export function registerPaymentsDueRoutes(app: Express) {
  const gate = requireTab("registrations");

  app.get("/api/admin/payments-due", gate, async (req, res) => {
    if (!cufcOnly(req, res)) return;
    try {
      const snap = await paymentsDue(req.query.refresh === "1");
      const uid = Number((req as any).session?.userId);
      const [chase, mayEscalate] = await Promise.all([chaseHistory(snap.rows.map((r) => r.invoiceId)).catch(() => ({})), uid ? canEscalate(uid).catch(() => false) : false]);
      res.json({ ...snap, chase, canEscalate: mayEscalate });
    } catch (e: any) {
      // 🔴 never print a raw xero-node error: it can carry the bearer token
      console.error("[payments-due]", typeof e === "string" ? e.slice(0, 200) : String(e?.message ?? "error").slice(0, 200));
      res.status(502).json({ message: "Couldn't read Xero just now — try again in a minute. Nothing has changed." });
    }
  });

  // Reminder / Escalation emails to a family (Ryan, 2026-11-04). Preview is a GET so it works
  // inside View As; the send is a POST, which View As refuses like every other write.
  const kindOf = (v: unknown): ChaseKind | null => (v === "reminder" || v === "escalation" ? v : null);
  const noteOf = (v: unknown) => { const t = typeof v === "string" ? v.trim().slice(0, 1000) : ""; return t || null; };
  const fail = (res: Response, e: any, tag: string) => {
    if (e instanceof ChaseError) return res.status(e.status).json({ message: e.message });
    console.error(tag, typeof e === "string" ? e.slice(0, 200) : String(e?.message ?? "error").slice(0, 200));
    res.status(502).json({ message: "Couldn't reach Xero just now — nothing was sent. Try again in a minute." });
  };

  app.get("/api/admin/payments-due/chase/preview", gate, async (req, res) => {
    if (!cufcOnly(req, res)) return;
    const kind = kindOf(req.query.kind), family = String(req.query.family ?? "");
    if (!kind || !family) return res.status(400).json({ message: "kind and family are required" });
    try { res.json(await previewChase(kind, family, noteOf(req.query.note))); } catch (e) { fail(res, e, "[payments-chase preview]"); }
  });

  app.post("/api/admin/payments-due/chase/send", gate, async (req, res) => {
    if (!cufcOnly(req, res)) return;
    const kind = kindOf(req.body?.kind), family = String(req.body?.family ?? "");
    const uid = Number((req as any).session?.userId);
    if (!kind || !family) return res.status(400).json({ message: "kind and family are required" });
    if (!uid) return res.status(401).json({ message: "Sign in again" });
    try { res.json(await sendChase(kind, family, noteOf(req.body?.note), uid)); } catch (e) { fail(res, e, "[payments-chase send]"); }
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

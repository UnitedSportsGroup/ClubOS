// Xero payments — what the Xero → registration sync decided, and the queue a
// person clears (Olga). CUFC workspace, the Registrations tab's permission.
//
// 🔴 A person's choice is stamped with WHO (decided_by_user_id, from the
// session — never the body) and links that Xero contact to that child for good.
import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { requireTab } from "./auth";
import { getXeroForOrg } from "./xero";
import { applyInvoice, runXeroRegistrationSync, syncMode } from "./xero-registration-sync";
import type { ProgrammeKey } from "@shared/xero-reg-match";

const ORG = 1;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const cufcOnly = (req: Request, res: Response) => {
  if (String(req.headers["x-workspace-slug"] ?? "") !== "christchurch-united") { res.status(404).json({ message: "Not found" }); return false; }
  return true;
};

async function progs(): Promise<Map<ProgrammeKey, number>> {
  const r = rowsOf(await db.execute(sql`SELECT id, slug FROM programs WHERE organization_id = ${ORG}`));
  const by = new Map(r.map((x: any) => [String(x.slug), Number(x.id)]));
  const m = new Map<ProgrammeKey, number>();
  for (const [k, s] of [["funino", "u4-u8"], ["pre_academy", "pre-academy-u9-u12"], ["academy", "academy-u13-u17"], ["technification", "technification"]] as const) {
    if (by.has(s)) m.set(k, by.get(s)!);
  }
  return m;
}

/** Fresh from Xero: one invoice + its contact's email. */
async function freshInvoice(invoiceId: string) {
  const { xero, tenantId } = await getXeroForOrg(ORG);
  const inv: any = (await xero.accountingApi.getInvoice(tenantId, invoiceId)).body.invoices?.[0];
  if (!inv) return null;
  const c: any = (await xero.accountingApi.getContact(tenantId, inv.contact.contactID)).body.contacts?.[0];
  return { inv, email: c?.emailAddress ?? null };
}

export function registerXeroRegistrationRoutes(app: Express) {
  const gate = requireTab("registrations");

  app.get("/api/admin/xero-registrations", gate, async (req, res) => {
    if (!cufcOnly(req, res)) return;
    try {
      const decision = String(req.query.decision ?? "needs_review");
      const state = rowsOf(await db.execute(sql`SELECT * FROM xero_registration_sync_state WHERE organization_id = ${ORG}`))[0] ?? null;
      const counts = rowsOf(await db.execute(sql`
        SELECT decision, count(*)::int n, COALESCE(sum(amount_due_cents), 0)::int due, COALESCE(sum(amount_paid_cents), 0)::int paid
          FROM xero_invoice_registrations x LEFT JOIN terms t ON t.id = x.term_id
         WHERE x.organization_id = ${ORG} GROUP BY 1`));
      const rows = rowsOf(await db.execute(sql`
        SELECT x.invoice_id, x.invoice_number, x.xero_contact_name, x.parent_email, x.reference, x.payment_state,
               x.total_cents, x.amount_paid_cents, x.amount_due_cents, x.paid_on::text, x.invoice_date::text,
               x.decision, x.reason, x.candidates, x.registration_id, x.registered_by_sync, x.decided_at,
               p.name AS programme, t.term_number, t.year,
               c.id AS child_id, c.first_name || ' ' || c.last_name AS child_name, c.date_of_birth::text AS child_dob,
               u.first_name || ' ' || u.last_name AS decided_by
          FROM xero_invoice_registrations x
          LEFT JOIN programs p ON p.id = x.program_id
          LEFT JOIN terms t ON t.id = x.term_id
          LEFT JOIN contacts c ON c.id = x.child_contact_id
          LEFT JOIN users u ON u.id = x.decided_by_user_id
         WHERE x.organization_id = ${ORG} AND x.decision = ${decision}
         ORDER BY t.year DESC NULLS LAST, t.term_number DESC NULLS LAST, x.invoice_date DESC NULLS LAST
         LIMIT 400`));
      // Candidates, with what a person needs to tell them apart.
      const ids = Array.from(new Set(rows.flatMap((r: any) => r.candidates ?? []).map(Number)));
      const cands = ids.length ? rowsOf(await db.execute(sql`
        SELECT c.id, c.first_name || ' ' || c.last_name AS name, c.date_of_birth::text AS dob,
               (SELECT string_agg(DISTINCT g.first_name || ' ' || g.last_name || COALESCE(' <' || g.email || '>', ''), '; ')
                  FROM contact_relationships cr JOIN contacts g ON g.id = cr.guardian_id WHERE cr.player_id = c.id) AS parents,
               (SELECT string_agg(DISTINCT p.name, ', ') FROM registrations r JOIN programs p ON p.id = r.program_id WHERE r.contact_id = c.id) AS programmes
          FROM contacts c WHERE c.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)) : [];
      res.json({ mode: syncMode(), state, counts, rows, candidates: Object.fromEntries(cands.map((c: any) => [c.id, c])) });
    } catch (e: any) {
      console.error("[xero-registrations]", e?.message);
      res.status(500).json({ message: "Couldn't load Xero payments." });
    }
  });

  // Find a child to attach (when the right one isn't a candidate).
  app.get("/api/admin/xero-registrations/children", gate, async (req, res) => {
    if (!cufcOnly(req, res)) return;
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) return res.json([]);
    const like = `%${q.toLowerCase()}%`;
    const r = rowsOf(await db.execute(sql`
      SELECT c.id, c.first_name || ' ' || c.last_name AS name, c.date_of_birth::text AS dob,
             (SELECT string_agg(DISTINCT g.first_name || ' ' || g.last_name || COALESCE(' <' || g.email || '>', ''), '; ')
                FROM contact_relationships cr JOIN contacts g ON g.id = cr.guardian_id WHERE cr.player_id = c.id) AS parents
        FROM contacts c
       WHERE c.type = 'player' AND c.merged_into_contact_id IS NULL
         AND lower(c.first_name || ' ' || c.last_name) LIKE ${like}
       ORDER BY c.last_name, c.first_name LIMIT 20`));
    res.json(r);
  });

  // A person picks the child. Links that Xero contact for good and applies the invoice now.
  app.post("/api/admin/xero-registrations/:invoiceId/assign", gate, async (req, res) => {
    if (!cufcOnly(req, res)) return;
    try {
      const childId = Number(req.body?.contactId);
      if (!Number.isInteger(childId) || childId <= 0) return res.status(400).json({ message: "Pick a child." });
      const kid = rowsOf(await db.execute(sql`SELECT id FROM contacts WHERE id = ${childId} AND type = 'player' AND merged_into_contact_id IS NULL`))[0];
      if (!kid) return res.status(400).json({ message: "That isn't a player in ClubOS." });
      const existing = rowsOf(await db.execute(sql`SELECT contact_id FROM xero_contact_links WHERE organization_id = ${ORG} AND xero_contact_id = (SELECT xero_contact_id FROM xero_invoice_registrations WHERE organization_id = ${ORG} AND invoice_id = ${req.params.invoiceId})`))[0];
      if (existing && Number(existing.contact_id) !== childId) {
        return res.status(409).json({ message: "This Xero contact is already linked to a different child. Unlink it first." });
      }
      const fresh = await freshInvoice(String(req.params.invoiceId));
      if (!fresh) return res.status(404).json({ message: "Xero has no such invoice." });
      const d = await applyInvoice(fresh.inv, fresh.email, syncMode() === "off" ? "shadow" : syncMode(), await progs(),
        { userId: req.session.userId!, childId });
      res.json({ ok: true, decision: d?.decision ?? null, reason: d?.reason ?? null, registrationId: d?.registrationId ?? null });
    } catch (e: any) {
      console.error("[xero-registrations assign]", typeof e === "string" ? e.slice(0, 200) : e?.message);
      res.status(500).json({ message: "Couldn't apply that — nothing was changed." });
    }
  });

  // Not a registration (or not ours to decide) — taken off the queue, kept on record.
  app.post("/api/admin/xero-registrations/:invoiceId/dismiss", gate, async (req, res) => {
    if (!cufcOnly(req, res)) return;
    const reason = String(req.body?.reason ?? "").trim().slice(0, 300) || "Dismissed";
    const r = rowsOf(await db.execute(sql`
      UPDATE xero_invoice_registrations SET decision = 'dismissed', reason = ${reason}, decided_by_user_id = ${req.session.userId!}, decided_at = now()
       WHERE organization_id = ${ORG} AND invoice_id = ${req.params.invoiceId} AND decision IN ('needs_review', 'past_term', 'part_paid', 'awaiting_payment')
       RETURNING id`));
    if (!r.length) return res.status(404).json({ message: "Nothing to dismiss." });
    res.json({ ok: true });
  });

  // "Check Xero now" — the same sweep the timer runs.
  app.post("/api/admin/xero-registrations/run", gate, async (req, res) => {
    if (!cufcOnly(req, res)) return;
    try { res.json(await runXeroRegistrationSync()); }
    catch (e: any) { res.status(502).json({ message: `Xero check failed: ${String(e?.message ?? "error").slice(0, 160)}` }); }
  });
}

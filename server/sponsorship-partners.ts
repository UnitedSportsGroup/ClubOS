// ─────────────────────────────────────────────────────────────────────────────
// Sponsorship Partners — USG → Sponsorship → Partners.
//
// The sponsors we have already SIGNED: the company, the person, the signed
// document one click away, the term and the money, the instalments, the
// promises (deliverables) and the ideas for going beyond them. The Pipeline is
// for the deals we are chasing; this is for the ones we must keep.
//
// Gate: requireTab("sponsorship") + a membership in the workspace the header
// names. The workspace decides the organisation — a page can never pick another
// org by query string. Every derived state (current contract, renewal due,
// overdue) comes from shared/sponsorship-partners.ts against the NZ date the
// server holds, never from a stored flag.
//
// The signed file itself is a Club Drive node under the gated "Sponsor
// Contracts" folder (server/sponsorship-partner-files.ts); the client opens it
// through Drive's own /api/admin/drive/file/:id/open — a plain link, so it needs
// no workspace header, and Drive's node gate is the same rule as this tab's.
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import multer from "multer";
import { db } from "./db";
import { storage } from "./storage";
import { requireAuth, requireTab } from "./auth";
import {
  organizations, driveNodes, sponsorshipDeals, sponsorshipDeliverables, sponsorshipOnboardingTemplates,
  sponsorshipPartners, sponsorshipPartnerContracts, sponsorshipPartnerPayments, users as usersTable,
} from "@shared/schema";
import { nzTodayIso } from "@shared/dashboard";
import {
  SIGNATURE_STATUSES, annualValueCents, contractState, currentContract, daysBetween, isIsoDate, nextPayment,
  partnerFlags, partnerSince, partnerStatus, paymentState,
} from "@shared/sponsorship-partners";
import { storeContractFile } from "./sponsorship-partner-files";

const PARTNERS_WORKSPACE = "united-sports-group";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

const DELIVERABLE_CATEGORIES = new Set(["contract", "activation", "idea", "onboarding", "other"]);
const TRIGGERS = new Set(["once", "per_match", "weekly", "monthly", "quarterly", "annually"]);

type Scope = { userId: number; orgId: number; orgSlug: string };

/** The workspace in the header decides the org; the caller must belong to it. */
async function scope(req: Request, res: Response): Promise<Scope | null> {
  const userId = req.session.userId!;
  const slug = String(req.headers["x-workspace-slug"] || "");
  if (!slug) { res.status(400).json({ message: "X-Workspace-Slug header required" }); return null; }
  // 🔴 Partners lives in the United Sports Group workspace only. requireTab
  // lets an admin/manager of ANY workspace through (canAccessTab grants every
  // tab to that role), so without this a CUFC admin reads the list from their
  // own workspace — empty, but 200. Same guard as the Breweries routes.
  if (slug !== PARTNERS_WORKSPACE) { res.status(404).json({ message: "Not found" }); return null; }
  const [org] = await db.select({ id: organizations.id, slug: organizations.slug }).from(organizations).where(eq(organizations.slug, slug));
  if (!org) { res.status(404).json({ message: "Not found" }); return null; }
  const mine = await storage.getUserOrganizations(userId);
  if (!mine.some((o: any) => o.id === org.id)) { res.status(403).json({ message: "Forbidden" }); return null; }
  return { userId, orgId: org.id, orgSlug: org.slug };
}

const str = (v: unknown, max = 4000): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const cents = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};
const dateOrNull = (v: unknown): string | null => (typeof v === "string" && isIsoDate(v) ? v : null);
const bool = (v: unknown): boolean | null => (v === undefined || v === null ? null : !!v);

async function partnerInScope(s: Scope, id: number) {
  const [p] = await db.select().from(sponsorshipPartners).where(and(eq(sponsorshipPartners.id, id), eq(sponsorshipPartners.organizationId, s.orgId)));
  return p ?? null;
}
async function contractInScope(s: Scope, cid: number) {
  const [row] = await db.select({ c: sponsorshipPartnerContracts, p: sponsorshipPartners })
    .from(sponsorshipPartnerContracts)
    .innerJoin(sponsorshipPartners, eq(sponsorshipPartners.id, sponsorshipPartnerContracts.partnerId))
    .where(and(eq(sponsorshipPartnerContracts.id, cid), eq(sponsorshipPartners.organizationId, s.orgId)));
  return row ?? null;
}

function nodeView(n: any | null) {
  if (!n) return null;
  return {
    id: n.id, name: n.name, mimeType: n.mimeType, sizeBytes: n.sizeBytes == null ? null : Number(n.sizeBytes),
    openUrl: `/api/admin/drive/file/${n.id}/open`, downloadUrl: `/api/admin/drive/file/${n.id}/download`,
    sourceUrl: n.sourceUrl ?? null, hasText: n.extractStatus === "done",
  };
}

/** A deliverable's proof is either a pasted link or a file we stored in Club
 *  Drive (proof_url = /api/admin/drive/file/<id>/open). Give the client the
 *  file's name so the chip can say what it is. */
async function withProof<T extends { proofUrl: string | null }>(rows: T[]): Promise<(T & { proof: { url: string; name: string; isFile: boolean } | null })[]> {
  const ids = rows.map(r => /\/api\/admin\/drive\/file\/(\d+)\//.exec(r.proofUrl ?? "")?.[1]).filter((x): x is string => !!x).map(Number);
  const nodes = ids.length ? ((await db.select({ id: driveNodes.id, name: driveNodes.name }).from(driveNodes).where(inArray(driveNodes.id, ids))) as any[]) : [];
  const names = new Map(nodes.map(n => [n.id, n.name]));
  return rows.map(r => {
    if (!r.proofUrl) return { ...r, proof: null };
    const id = /\/api\/admin\/drive\/file\/(\d+)\//.exec(r.proofUrl)?.[1];
    if (id) return { ...r, proof: { url: r.proofUrl, name: names.get(Number(id)) ?? "Proof file", isFile: true } };
    let host = r.proofUrl; try { host = new URL(r.proofUrl).hostname; } catch { /* keep as typed */ }
    return { ...r, proof: { url: r.proofUrl, name: host, isFile: false } };
  });
}

export function registerSponsorshipPartnerRoutes(app: Express) {
  const gate = [requireAuth, requireTab("sponsorship")] as const;

  // ── The list ──────────────────────────────────────────────────────────────
  app.get("/api/admin/sponsorship/partners", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const today = nzTodayIso();
      const includeArchived = req.query.archived === "1";
      const partners = await db.select().from(sponsorshipPartners)
        .where(includeArchived ? eq(sponsorshipPartners.organizationId, s.orgId) : and(eq(sponsorshipPartners.organizationId, s.orgId), isNull(sponsorshipPartners.archivedAt)))
        .orderBy(asc(sponsorshipPartners.company));
      const ids = partners.map(p => p.id);
      const contracts = ids.length ? await db.select().from(sponsorshipPartnerContracts).where(inArray(sponsorshipPartnerContracts.partnerId, ids)) : [];
      const cids = contracts.map(c => c.id);
      const payments = cids.length ? await db.select().from(sponsorshipPartnerPayments).where(inArray(sponsorshipPartnerPayments.contractId, cids)) : [];
      const nodeIds = contracts.map(c => c.contractNodeId).filter((x): x is number => !!x);
      const nodes = nodeIds.length ? ((await db.select().from(driveNodes).where(inArray(driveNodes.id, nodeIds))) as any[]) : [];
      const nodeMap = new Map(nodes.map(n => [n.id, n]));

      const rows = partners.map(p => {
        const mine = contracts.filter(c => c.partnerId === p.id);
        const cur = currentContract(mine, today);
        const pays = payments.filter(x => mine.some(c => c.id === x.contractId));
        const flags = partnerFlags({ contracts: mine, payments: pays, today });
        const status = partnerStatus(flags, cur, today);
        const next = nextPayment(pays, today);
        return {
          ...p,
          since: partnerSince(mine),
          renewalOn: cur && !cur.openEnded ? cur.endDate : null,
          annualValueCents: annualValueCents(cur),
          cashPerYearCents: cur?.cashPerYearCents ?? 0,
          contraPerYearCents: cur?.contraPerYearCents ?? 0,
          status,
          flags,
          contractsCount: mine.length,
          current: cur ? { ...cur, state: contractState(cur, today), node: nodeView(cur.contractNodeId ? nodeMap.get(cur.contractNodeId) : null) } : null,
          nextPayment: next ? { ...next, state: paymentState(next, today) } : null,
          paidCents: pays.reduce((sum, x) => sum + (x.paidCents ?? 0), 0),
          overdueCents: pays.filter(x => paymentState(x, today) === "overdue").reduce((sum, x) => sum + x.amountCents, 0),
        };
      });
      const live = rows.filter(r => r.status !== "expired" && r.status !== "no_contract");
      res.json({
        today,
        partners: rows,
        totals: {
          partners: rows.length,
          active: live.length,
          annualCashCents: live.reduce((sum, r) => sum + r.cashPerYearCents, 0),
          annualContraCents: live.reduce((sum, r) => sum + r.contraPerYearCents, 0),
          renewalsDue: rows.filter(r => r.flags.some(f => f.kind === "renewal_due" || f.kind === "notice_passed")).length,
          overdueCents: rows.reduce((sum, r) => sum + r.overdueCents, 0),
          needsAttention: rows.filter(r => r.status === "attention" || r.status === "expired" || r.status === "no_contract").length,
        },
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/admin/sponsorship/partners", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const company = str(req.body?.company, 200);
      if (!company) return res.status(400).json({ message: "Company name required" });
      const [row] = await db.insert(sponsorshipPartners).values({
        organizationId: s.orgId,
        company,
        tradingName: str(req.body?.tradingName, 200),
        website: str(req.body?.website, 500),
        brandTags: Array.isArray(req.body?.brandTags) ? req.body.brandTags.map(String).slice(0, 12) : [],
        primaryContactName: str(req.body?.primaryContactName, 200),
        primaryContactRole: str(req.body?.primaryContactRole, 200),
        primaryContactEmail: str(req.body?.primaryContactEmail, 200),
        primaryContactPhone: str(req.body?.primaryContactPhone, 60),
        dealId: cents(req.body?.dealId),
        notes: str(req.body?.notes, 10000),
        ownerId: cents(req.body?.ownerId),
        createdBy: s.userId,
      }).returning();
      res.json(row);
    } catch (e: any) {
      if (String(e?.message ?? "").includes("sponsorship_partners_company_live_idx")) return res.status(409).json({ message: "That company is already a partner here" });
      res.status(500).json({ message: e.message });
    }
  });

  // ── Deliverables across every partner (the Partners → Deliverables and
  //    Onboarding views). Static path: registered BEFORE /partners/:id, or
  //    Express parses "deliverables" as an id. ─────────────────────────────
  app.get("/api/admin/sponsorship/partners/deliverables", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const today = nzTodayIso();
      const category = str(req.query.category, 40);
      const partners = await db.select().from(sponsorshipPartners).where(and(eq(sponsorshipPartners.organizationId, s.orgId), isNull(sponsorshipPartners.archivedAt)));
      const ids = partners.map(p => p.id);
      if (!ids.length) return res.json([]);
      const contracts = await db.select().from(sponsorshipPartnerContracts).where(inArray(sponsorshipPartnerContracts.partnerId, ids));
      const cids = contracts.map(c => c.id);
      if (!cids.length) return res.json([]);
      const rows = await db.select().from(sponsorshipDeliverables)
        .where(category ? and(inArray(sponsorshipDeliverables.partnerContractId, cids), eq(sponsorshipDeliverables.category, category)) : inArray(sponsorshipDeliverables.partnerContractId, cids))
        .orderBy(asc(sponsorshipDeliverables.partnerContractId), asc(sponsorshipDeliverables.displayOrder), asc(sponsorshipDeliverables.id));
      const pMap = new Map(partners.map(p => [p.id, p]));
      const cMap = new Map(contracts.map(c => [c.id, c]));
      const currentByPartner = new Map(partners.map(p => [p.id, currentContract(contracts.filter(c => c.partnerId === p.id), today)?.id ?? null]));
      const withP = await withProof(rows);
      res.json(withP.map(r => {
        const c = cMap.get(r.partnerContractId!)!; const p = pMap.get(c.partnerId)!;
        return { ...r, deal: null, partner: { id: p.id, company: p.company, brandTags: p.brandTags }, contract: { id: c.id, title: c.title, isCurrent: currentByPartner.get(p.id) === c.id, state: contractState(c, today), signatureStatus: c.signatureStatus } };
      }));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Proof that a promise was kept: a photo, a PDF, a clip. Into Club Drive
  // beside the partner's contract (same gated folder), and the deliverable's
  // proof_url points at Drive's own open route. Status is NOT changed here —
  // ticking done is the person's call, the proof is the evidence for it.
  app.post(
    "/api/admin/sponsorship/partners/deliverables/:id/proof",
    ...gate,
    (req, res, next) => upload.single("file")(req, res, (err: any) => (err ? res.status(400).json({ message: err.message ?? "Upload failed" }) : next())),
    async (req, res) => {
      try {
        const s = await scope(req, res); if (!s) return;
        const id = Number(req.params.id);
        const [d] = await db.select().from(sponsorshipDeliverables).where(eq(sponsorshipDeliverables.id, id));
        if (!d || !d.partnerContractId) return res.status(404).json({ message: "Not found" });
        const row = await contractInScope(s, d.partnerContractId);
        if (!row) return res.status(404).json({ message: "Not found" });
        const file = (req as any).file as { buffer: Buffer; mimetype: string; originalname: string } | undefined;
        if (!file) return res.status(400).json({ message: "No file" });
        const node = await storeContractFile({
          buffer: file.buffer, name: `Proof — ${(d.title || "deliverable").slice(0, 80)} — ${file.originalname || "file"}`.slice(0, 240),
          contentType: file.mimetype, company: row.p.company, userId: s.userId,
          description: `Proof for "${d.title}" (${row.p.company})`,
        });
        const [updated] = await db.update(sponsorshipDeliverables)
          .set({ proofUrl: `/api/admin/drive/file/${node.id}/open`, updatedAt: new Date() })
          .where(eq(sponsorshipDeliverables.id, id)).returning();
        const [withP] = await withProof([updated]);
        res.json({ deliverable: withP, node: nodeView(node) });
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    },
  );

  // The org's onboarding template, applied to a partner: one 'onboarding'
  // deliverable per active template item on the CURRENT contract, skipping
  // titles the partner already has on any contract. A partner with no
  // contract row (Go Media) gets a placeholder contract so the checklist has
  // somewhere to live — signature status says there is no document.
  async function applyOnboardingToPartner(s: Scope, partnerId: number) {
    const today = nzTodayIso();
    const contracts = await db.select().from(sponsorshipPartnerContracts).where(eq(sponsorshipPartnerContracts.partnerId, partnerId));
    let cur = currentContract(contracts, today);
    if (!cur) {
      const [made] = await db.insert(sponsorshipPartnerContracts).values({ partnerId, title: "Partnership (no document on file)", signatureStatus: "unsigned", flags: ["Created by the onboarding checklist — no agreement on file. Attach the signed document when it exists."], createdBy: s.userId }).returning();
      cur = made;
    }
    const cids = contracts.map(c => c.id).concat(cur.id);
    const have = new Set((await db.select({ title: sponsorshipDeliverables.title }).from(sponsorshipDeliverables).where(and(inArray(sponsorshipDeliverables.partnerContractId, cids), eq(sponsorshipDeliverables.category, "onboarding")))).map(x => x.title));
    const templates = await db.select().from(sponsorshipOnboardingTemplates)
      .where(and(eq(sponsorshipOnboardingTemplates.organizationId, s.orgId), eq(sponsorshipOnboardingTemplates.isActive, true)))
      .orderBy(asc(sponsorshipOnboardingTemplates.displayOrder));
    const toInsert = templates.filter(t => !have.has(t.title));
    if (toInsert.length) {
      await db.insert(sponsorshipDeliverables).values(toInsert.map(t => ({
        partnerContractId: cur!.id, title: t.title, type: "onboarding", category: "onboarding", triggerType: "once" as const,
        status: "pending" as const, ownerId: t.defaultOwnerId, notes: t.description, displayOrder: t.displayOrder, createdBy: s.userId,
      })) as any);
    }
    return { contractId: cur.id, added: toInsert.length, alreadyHad: have.size };
  }

  app.post("/api/admin/sponsorship/partners/apply-onboarding-all", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const partners = await db.select({ id: sponsorshipPartners.id, company: sponsorshipPartners.company }).from(sponsorshipPartners).where(and(eq(sponsorshipPartners.organizationId, s.orgId), isNull(sponsorshipPartners.archivedAt)));
      const out = [] as any[];
      for (const p of partners) out.push({ partnerId: p.id, company: p.company, ...(await applyOnboardingToPartner(s, p.id)) });
      res.json({ ok: true, partners: out.length, added: out.reduce((n, x) => n + x.added, 0), detail: out });
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // A won deal becomes a partner in one click: the company, the person, the
  // brands and the deal's own dates and value become the partner and its first
  // contract (signature "not checked" until somebody attaches the signed file).
  // Idempotent: a partner already linked to the deal, or a live partner with the
  // same company name, is returned (and linked) rather than duplicated.
  app.post("/api/admin/sponsorship/partners/from-deal/:dealId", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const dealId = Number(req.params.dealId);
      const [deal] = await db.select().from(sponsorshipDeals).where(and(eq(sponsorshipDeals.id, dealId), eq(sponsorshipDeals.organizationId, s.orgId)));
      if (!deal) return res.status(404).json({ message: "Not found" });
      const [linked] = await db.select().from(sponsorshipPartners).where(and(eq(sponsorshipPartners.dealId, dealId), isNull(sponsorshipPartners.archivedAt)));
      if (linked) return res.json({ partner: linked, created: false, linked: true });
      const [same] = await db.select().from(sponsorshipPartners).where(and(eq(sponsorshipPartners.organizationId, s.orgId), isNull(sponsorshipPartners.archivedAt), sql`lower(${sponsorshipPartners.company}) = lower(${deal.sponsorCompany})`));
      if (same) {
        const [upd] = await db.update(sponsorshipPartners).set({ dealId, updatedAt: new Date() }).where(eq(sponsorshipPartners.id, same.id)).returning();
        return res.json({ partner: upd, created: false, linked: true });
      }
      const [partner] = await db.insert(sponsorshipPartners).values({
        organizationId: s.orgId, company: deal.sponsorCompany, brandTags: deal.brandTags ?? [],
        primaryContactName: deal.primaryContactName, primaryContactEmail: deal.primaryContactEmail, primaryContactPhone: deal.primaryContactPhone,
        dealId, ownerId: deal.ownerId, createdBy: s.userId, notes: `Created from pipeline deal "${deal.title}" on ${nzTodayIso()}.`,
      }).returning();
      const termMonths = deal.termMonths ?? (deal.startDate && deal.endDate ? Math.max(1, Math.round(daysBetween(deal.startDate, deal.endDate) / 30.4375)) : null);
      const [contract] = await db.insert(sponsorshipPartnerContracts).values({
        partnerId: partner.id, title: deal.title || deal.assetCategory || "Sponsorship agreement",
        startDate: deal.startDate ?? null, endDate: deal.endDate ?? null, termMonths,
        cashPerYearCents: deal.dealValueCents || null, contraPerYearCents: deal.contraValueCents || null,
        exclusivity: deal.exclusivity, signatureStatus: "not_checked",
        flags: ["Created from the pipeline deal — attach the signed document and check the signature, term and money against it."],
        createdBy: s.userId,
      }).returning();
      res.json({ partner, contract, created: true, linked: true });
    } catch (e: any) {
      if (String(e?.message ?? "").includes("sponsorship_partners_company_live_idx")) return res.status(409).json({ message: "That company is already a partner here" });
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/admin/sponsorship/partners/:id/apply-onboarding", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const id = Number(req.params.id);
      const p = await partnerInScope(s, id);
      if (!p) return res.status(404).json({ message: "Not found" });
      res.json({ ok: true, ...(await applyOnboardingToPartner(s, id)) });
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // ── One partner, in full ─────────────────────────────────────────────────
  app.get("/api/admin/sponsorship/partners/:id", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Bad id" });
      const p = await partnerInScope(s, id);
      if (!p) return res.status(404).json({ message: "Not found" });
      const today = nzTodayIso();
      const contracts = await db.select().from(sponsorshipPartnerContracts).where(eq(sponsorshipPartnerContracts.partnerId, id)).orderBy(desc(sponsorshipPartnerContracts.startDate), desc(sponsorshipPartnerContracts.id));
      const cids = contracts.map(c => c.id);
      const payments = cids.length ? await db.select().from(sponsorshipPartnerPayments).where(inArray(sponsorshipPartnerPayments.contractId, cids)).orderBy(asc(sponsorshipPartnerPayments.dueOn), asc(sponsorshipPartnerPayments.id)) : [];
      const deliverables = cids.length ? await withProof(await db.select().from(sponsorshipDeliverables).where(inArray(sponsorshipDeliverables.partnerContractId, cids)).orderBy(asc(sponsorshipDeliverables.displayOrder), asc(sponsorshipDeliverables.id))) : [];
      const nodeIds = contracts.map(c => c.contractNodeId).filter((x): x is number => !!x);
      const nodes = nodeIds.length ? ((await db.select().from(driveNodes).where(inArray(driveNodes.id, nodeIds))) as any[]) : [];
      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      const cur = currentContract(contracts, today);
      const flags = partnerFlags({ contracts, payments, today });
      const deal = p.dealId ? (await db.select().from(sponsorshipDeals).where(eq(sponsorshipDeals.id, p.dealId)))[0] ?? null : null;
      const ownerIds = [p.ownerId, ...deliverables.map(d => d.ownerId)].filter((x): x is number => !!x);
      const people = ownerIds.length ? await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable).where(inArray(usersTable.id, Array.from(new Set(ownerIds)))) : [];
      res.json({
        today,
        partner: { ...p, since: partnerSince(contracts), status: partnerStatus(flags, cur, today), flags, annualValueCents: annualValueCents(cur), currentContractId: cur?.id ?? null },
        deal: deal ? { id: deal.id, title: deal.title, stage: deal.stage } : null,
        contracts: contracts.map(c => ({
          ...c,
          state: contractState(c, today),
          isCurrent: cur?.id === c.id,
          node: nodeView(c.contractNodeId ? nodeMap.get(c.contractNodeId) : null),
          payments: payments.filter(x => x.contractId === c.id).map(x => ({ ...x, state: paymentState(x, today) })),
          deliverables: deliverables.filter(d => d.partnerContractId === c.id),
        })),
        people: people.map(u => ({ id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(" ") })),
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch("/api/admin/sponsorship/partners/:id", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const id = Number(req.params.id);
      const p = await partnerInScope(s, id);
      if (!p) return res.status(404).json({ message: "Not found" });
      const b = req.body ?? {};
      const patch: any = { updatedAt: new Date() };
      if (b.company !== undefined) { const v = str(b.company, 200); if (!v) return res.status(400).json({ message: "Company name required" }); patch.company = v; }
      for (const f of ["tradingName", "website", "primaryContactName", "primaryContactRole", "primaryContactEmail", "primaryContactPhone", "xeroContactName", "logoUrl"]) if (b[f] !== undefined) patch[f] = str(b[f], 500);
      // Which background the artwork was drawn for; anything else is ignored.
      if (b.logoGround === "light" || b.logoGround === "dark") patch.logoGround = b.logoGround;
      if (b.notes !== undefined) patch.notes = str(b.notes, 10000);
      if (b.brandTags !== undefined) patch.brandTags = Array.isArray(b.brandTags) ? b.brandTags.map(String).slice(0, 12) : [];
      if (b.dealId !== undefined) patch.dealId = cents(b.dealId);
      if (b.ownerId !== undefined) patch.ownerId = cents(b.ownerId);
      if (b.archived !== undefined) patch.archivedAt = b.archived ? new Date() : null;
      const [row] = await db.update(sponsorshipPartners).set(patch).where(eq(sponsorshipPartners.id, id)).returning();
      res.json(row);
    } catch (e: any) {
      if (String(e?.message ?? "").includes("sponsorship_partners_company_live_idx")) return res.status(409).json({ message: "That company is already a partner here" });
      res.status(500).json({ message: e.message });
    }
  });

  // Archive, never delete: a partner with contracts is a legal record.
  app.delete("/api/admin/sponsorship/partners/:id", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const id = Number(req.params.id);
      const p = await partnerInScope(s, id);
      if (!p) return res.status(404).json({ message: "Not found" });
      await db.update(sponsorshipPartners).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(sponsorshipPartners.id, id));
      res.json({ ok: true, archived: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── Contracts ─────────────────────────────────────────────────────────────
  function contractPatch(b: any, strict: boolean) {
    const patch: any = {};
    const S = (f: string, max = 4000) => { if (b[f] !== undefined) patch[f] = str(b[f], max); };
    const D = (f: string) => { if (b[f] !== undefined) patch[f] = dateOrNull(b[f]); };
    const N = (f: string) => { if (b[f] !== undefined) patch[f] = cents(b[f]); };
    for (const f of ["title", "clubEntity", "termText", "renewalTerms", "gstNote", "contraDescription", "paymentTerms", "exclusivity", "termination", "otherClauses", "signedBy", "signatureEvidence", "contractSourceUrl"]) S(f, f === "otherClauses" || f === "paymentTerms" ? 20000 : 4000);
    for (const f of ["signedOn", "startDate", "endDate"]) D(f);
    for (const f of ["termMonths", "noticeDays", "cashPerYearCents", "cashTotalCents", "contraPerYearCents"]) N(f);
    if (b.openEnded !== undefined) patch.openEnded = !!b.openEnded;
    if (b.autoRenews !== undefined) patch.autoRenews = bool(b.autoRenews);
    if (b.signatureStatus !== undefined) {
      if (!SIGNATURE_STATUSES.includes(b.signatureStatus)) { if (strict) throw new Error("Unknown signature status"); }
      else patch.signatureStatus = b.signatureStatus;
    }
    if (b.flags !== undefined) patch.flags = Array.isArray(b.flags) ? b.flags.map((x: unknown) => String(x).slice(0, 1000)).slice(0, 50) : [];
    if (patch.openEnded && patch.endDate !== undefined && patch.endDate) throw new Error("An ongoing contract cannot carry an end date");
    return patch;
  }

  app.post("/api/admin/sponsorship/partners/:id/contracts", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const id = Number(req.params.id);
      const p = await partnerInScope(s, id);
      if (!p) return res.status(404).json({ message: "Not found" });
      const patch = contractPatch(req.body ?? {}, true);
      const [row] = await db.insert(sponsorshipPartnerContracts).values({ ...patch, partnerId: id, createdBy: s.userId }).returning();
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.patch("/api/admin/sponsorship/partners/contracts/:cid", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const cid = Number(req.params.cid);
      const row = await contractInScope(s, cid);
      if (!row) return res.status(404).json({ message: "Not found" });
      const patch = contractPatch(req.body ?? {}, true);
      if (patch.signatureStatus !== undefined && patch.signatureStatus !== row.c.signatureStatus) { patch.signatureCheckedAt = new Date(); patch.signatureCheckedBy = s.userId; }
      const [updated] = await db.update(sponsorshipPartnerContracts).set({ ...patch, updatedAt: new Date() }).where(eq(sponsorshipPartnerContracts.id, cid)).returning();
      res.json(updated);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.delete("/api/admin/sponsorship/partners/contracts/:cid", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const cid = Number(req.params.cid);
      const row = await contractInScope(s, cid);
      if (!row) return res.status(404).json({ message: "Not found" });
      // Payments and deliverables cascade; the file node stays in Club Drive.
      await db.delete(sponsorshipPartnerContracts).where(eq(sponsorshipPartnerContracts.id, cid));
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // Attach (or replace) THE signed document. Lands in Club Drive under
  // "Sponsor Contracts / <Company>" with the sponsorship gate.
  app.post(
    "/api/admin/sponsorship/partners/contracts/:cid/file",
    ...gate,
    (req, res, next) => upload.single("file")(req, res, (err: any) => (err ? res.status(400).json({ message: err.message ?? "Upload failed" }) : next())),
    async (req, res) => {
      try {
        const s = await scope(req, res); if (!s) return;
        const cid = Number(req.params.cid);
        const row = await contractInScope(s, cid);
        if (!row) return res.status(404).json({ message: "Not found" });
        const file = (req as any).file as { buffer: Buffer; mimetype: string; originalname: string } | undefined;
        if (!file) return res.status(400).json({ message: "No file" });
        const node = await storeContractFile({
          buffer: file.buffer, name: (str(req.body?.name, 250) ?? file.originalname ?? "contract.pdf"), contentType: file.mimetype,
          company: row.p.company, userId: s.userId, description: `Signed agreement — ${row.p.company}`,
        });
        const [updated] = await db.update(sponsorshipPartnerContracts)
          .set({ contractNodeId: node.id, updatedAt: new Date() })
          .where(eq(sponsorshipPartnerContracts.id, cid)).returning();
        res.json({ contract: updated, node: nodeView(node) });
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    },
  );

  // ── Payments (instalments) ────────────────────────────────────────────────
  function paymentPatch(b: any) {
    const patch: any = {};
    if (b.label !== undefined) patch.label = str(b.label, 200);
    if (b.dueOn !== undefined) patch.dueOn = dateOrNull(b.dueOn);
    if (b.amountCents !== undefined) { const n = cents(b.amountCents); if (!n || n <= 0) throw new Error("Amount must be more than zero"); patch.amountCents = n; }
    if (b.gstIncluded !== undefined) patch.gstIncluded = !!b.gstIncluded;
    if (b.xeroInvoiceNumber !== undefined) patch.xeroInvoiceNumber = str(b.xeroInvoiceNumber, 60);
    if (b.xeroInvoiceId !== undefined) patch.xeroInvoiceId = str(b.xeroInvoiceId, 80);
    if (b.notes !== undefined) patch.notes = str(b.notes, 4000);
    if (b.paidOn !== undefined) {
      const d = dateOrNull(b.paidOn);
      if (d) { patch.paidOn = d; patch.paidCents = cents(b.paidCents) ?? patch.amountCents ?? null; }
      else { patch.paidOn = null; patch.paidCents = null; }
    } else if (b.paidCents !== undefined) {
      patch.paidCents = cents(b.paidCents);
    }
    return patch;
  }

  app.post("/api/admin/sponsorship/partners/contracts/:cid/payments", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const cid = Number(req.params.cid);
      const row = await contractInScope(s, cid);
      if (!row) return res.status(404).json({ message: "Not found" });
      const patch = paymentPatch(req.body ?? {});
      if (!patch.amountCents) return res.status(400).json({ message: "Amount must be more than zero" });
      if (patch.paidOn && patch.paidCents == null) patch.paidCents = patch.amountCents;
      const [p] = await db.insert(sponsorshipPartnerPayments).values({ ...patch, contractId: cid }).returning();
      res.json(p);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.patch("/api/admin/sponsorship/partners/payments/:pid", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const pid = Number(req.params.pid);
      const [existing] = await db.select().from(sponsorshipPartnerPayments).where(eq(sponsorshipPartnerPayments.id, pid));
      if (!existing) return res.status(404).json({ message: "Not found" });
      const row = await contractInScope(s, existing.contractId);
      if (!row) return res.status(404).json({ message: "Not found" });
      const patch = paymentPatch(req.body ?? {});
      if (patch.paidOn && patch.paidCents == null) patch.paidCents = patch.amountCents ?? existing.amountCents;
      const [p] = await db.update(sponsorshipPartnerPayments).set({ ...patch, updatedAt: new Date() }).where(eq(sponsorshipPartnerPayments.id, pid)).returning();
      res.json(p);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.delete("/api/admin/sponsorship/partners/payments/:pid", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const pid = Number(req.params.pid);
      const [existing] = await db.select().from(sponsorshipPartnerPayments).where(eq(sponsorshipPartnerPayments.id, pid));
      if (!existing) return res.status(404).json({ message: "Not found" });
      const row = await contractInScope(s, existing.contractId);
      if (!row) return res.status(404).json({ message: "Not found" });
      await db.delete(sponsorshipPartnerPayments).where(eq(sponsorshipPartnerPayments.id, pid));
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // ── Deliverables and ideas on a contract ─────────────────────────────────
  // category 'contract' = promised in the signed document · 'activation' =
  // something we scheduled for them · 'idea' = above-and-beyond, not promised.
  // PATCH / DELETE reuse the existing /api/admin/sponsorship/deliverables/:id
  // routes, which now understand a partner-owned row.
  app.post("/api/admin/sponsorship/partners/contracts/:cid/deliverables", ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const cid = Number(req.params.cid);
      const row = await contractInScope(s, cid);
      if (!row) return res.status(404).json({ message: "Not found" });
      const b = req.body ?? {};
      const title = str(b.title, 300);
      if (!title) return res.status(400).json({ message: "Title required" });
      const category = DELIVERABLE_CATEGORIES.has(b.category) ? b.category : "contract";
      const triggerType = TRIGGERS.has(b.triggerType) ? b.triggerType : "once";
      const [maxRow] = await db.select({ m: sponsorshipDeliverables.displayOrder }).from(sponsorshipDeliverables).where(eq(sponsorshipDeliverables.partnerContractId, cid)).orderBy(desc(sponsorshipDeliverables.displayOrder)).limit(1);
      const [d] = await db.insert(sponsorshipDeliverables).values({
        partnerContractId: cid,
        title,
        type: str(b.type, 100),
        category,
        triggerType,
        scheduledDate: dateOrNull(b.scheduledDate),
        entitlementQty: cents(b.entitlementQty) ?? 1,
        usedQty: cents(b.usedQty) ?? 0,
        status: b.status && ["pending", "in_progress", "delivered", "overdue", "waived"].includes(b.status) ? b.status : "pending",
        ownerId: cents(b.ownerId),
        proofUrl: str(b.proofUrl, 1000),
        notes: str(b.notes, 4000),
        displayOrder: (maxRow?.m ?? 0) + 1,
        createdBy: s.userId,
      } as any).returning();
      res.json(d);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
}

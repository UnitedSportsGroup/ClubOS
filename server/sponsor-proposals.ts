/**
 * Sponsor proposals — United Sports Group → Sponsorship → Prospects →
 * Proposals & contracts, and the public page a sponsor opens.
 *
 * Staff routes: requireAuth → requireTab("sponsorship") → the United Sports
 * Group workspace only (404 from anywhere else, the Partners rule) → a
 * membership in it.
 *
 * Public routes: found by a random token and nothing else. A draft, a withdrawn
 * or an archived proposal answers 404.
 *
 * 🔴 Where a proposal is up to is worked out on read (proposalStage). Nothing
 *    here stores a status.
 * 🔴 The acceptance form never emails the address typed into it. Staff are told
 *    at their own account address; a caught submission is still kept, flagged,
 *    and the answer to the browser is the same either way.
 * 🔴 The contract is an ordinary e-Sign document made by e-Sign's own
 *    from-template route; this file only records which document belongs to
 *    which proposal, and what a completed one turns into (a Partner and its
 *    contract row, once).
 */
import crypto from "crypto";
import type { Express, Request, Response } from "express";
import multer from "multer";
import { nzTodayIso } from "@shared/dashboard";
import { MAILER_IMAGE_MAX_UPLOAD_BYTES } from "@shared/mailer-images";
import { fromForOrg } from "@shared/org-domains";
import {
  AUDIENCE_STATS, PROPOSAL_TOKEN, SPONSOR_PROPOSALS_TAB, SPONSOR_PROPOSALS_WORKSPACE, STANDARD_BENEFITS,
  cleanProposal, contractProblems, contractVariablesFor, dollars, esignIsLive, longDay, pickAudience, proposalBrand,
  proposalStage, proposalUrl, publishProblems,
  type ProposalInput, type ProposalRow, type PublicProposal,
} from "@shared/sponsor-proposals";
import { requireAuth, requireTab } from "./auth";
import { pool } from "./db";
import { guardPublicForm, mintFormToken } from "./form-guard";
import { shrinkForEmail } from "./mailer-image-shrink";
import { storeMailerImage } from "./mailer-images";
import { storage } from "./storage";

const BASE = "/api/admin/sponsorship/proposals";
const PUBLIC = "/api/public/sponsor-proposal";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAILER_IMAGE_MAX_UPLOAD_BYTES } });

async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(text, params as any[]);
  return r.rows as T[];
}

type Scope = { userId: number; orgId: number };

/** The workspace in the header decides the org; the caller must belong to it. */
async function scope(req: Request, res: Response): Promise<Scope | null> {
  const userId = req.session.userId!;
  const slug = String(req.headers["x-workspace-slug"] || "");
  if (!slug) { res.status(400).json({ message: "X-Workspace-Slug header required" }); return null; }
  // requireTab lets an admin of ANY workspace through, so the workspace is named here.
  if (slug !== SPONSOR_PROPOSALS_WORKSPACE) { res.status(404).json({ message: "Not found" }); return null; }
  const [org] = await q<{ id: number }>(`SELECT id FROM organizations WHERE slug = $1`, [slug]);
  if (!org) { res.status(404).json({ message: "Not found" }); return null; }
  const mine = await storage.getUserOrganizations(userId);
  if (!mine.some((o: any) => o.id === org.id)) { res.status(403).json({ message: "Forbidden" }); return null; }
  return { userId, orgId: org.id };
}

const COLUMNS = `p.id, p.token, p.brand, p.sponsor_company, p.sponsor_legal_name, p.contact_name, p.contact_email, p.contact_phone,
  p.logo_url, p.logo_ground, p.partnership_title, p.season_label, p.intro, p.assets, p.benefits, p.audience_keys,
  p.term_start::text, p.term_end::text, p.fee_cents, p.payment_terms, p.contra, p.special_conditions,
  p.published_at, p.withdrawn_at, p.archived_at, p.accepted_at, p.accepted_name, p.accepted_email, p.accepted_role, p.accepted_held,
  p.esign_document_id, p.partner_id, p.partner_contract_id, p.created_by, p.created_at, p.updated_at,
  (SELECT d.status FROM esign_documents d WHERE d.id = p.esign_document_id) AS esign_status,
  (SELECT btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) FROM public.users u WHERE u.id = p.created_by) AS created_by_name,
  (SELECT count(*)::int FROM sponsor_proposal_events e WHERE e.proposal_id = p.id AND e.kind = 'open' AND NOT e.is_staff) AS opens,
  (SELECT count(DISTINCT e.visitor_id)::int FROM sponsor_proposal_events e WHERE e.proposal_id = p.id AND e.kind = 'open' AND NOT e.is_staff) AS visitors,
  (SELECT max(e.created_at) FROM sponsor_proposal_events e WHERE e.proposal_id = p.id AND e.kind = 'open' AND NOT e.is_staff) AS last_opened_at`;

const iso = (v: unknown): string | null => (v ? new Date(v as any).toISOString() : null);

function inputOf(r: any): ProposalInput {
  return cleanProposal({
    brand: r.brand, sponsorCompany: r.sponsor_company, sponsorLegalName: r.sponsor_legal_name, contactName: r.contact_name,
    contactEmail: r.contact_email, contactPhone: r.contact_phone, logoUrl: r.logo_url, logoGround: r.logo_ground,
    partnershipTitle: r.partnership_title, seasonLabel: r.season_label, intro: r.intro, assets: r.assets, benefits: r.benefits,
    audienceKeys: r.audience_keys, termStart: r.term_start, termEnd: r.term_end,
    feeCents: r.fee_cents == null ? null : Number(r.fee_cents), paymentTerms: r.payment_terms, contra: r.contra,
    specialConditions: r.special_conditions,
  });
}

function toRow(r: any): ProposalRow {
  const input = inputOf(r);
  // A contract that was voided or declined no longer counts.
  const esignStatus: string | null = r.esign_status ?? null;
  const live = esignIsLive(esignStatus);
  return {
    ...input,
    id: r.id,
    token: r.token,
    url: proposalUrl(r.brand, r.token),
    stage: proposalStage({
      archivedAt: iso(r.archived_at), withdrawnAt: iso(r.withdrawn_at), publishedAt: iso(r.published_at),
      acceptedAt: iso(r.accepted_at), opens: r.opens ?? 0, esignStatus: live ? esignStatus : null,
    }),
    publishedAt: iso(r.published_at),
    withdrawnAt: iso(r.withdrawn_at),
    archivedAt: iso(r.archived_at),
    acceptedAt: iso(r.accepted_at),
    acceptedName: r.accepted_name,
    acceptedEmail: r.accepted_email,
    acceptedRole: r.accepted_role,
    acceptedHeld: Boolean(r.accepted_held),
    opens: r.opens ?? 0,
    visitors: r.visitors ?? 0,
    lastOpenedAt: iso(r.last_opened_at),
    esignDocumentId: live ? r.esign_document_id : null,
    esignStatus: live ? esignStatus : null,
    partnerId: r.partner_id,
    createdByName: r.created_by_name || null,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    publishProblems: publishProblems(input),
    contractProblems: contractProblems(input),
  };
}

async function one(s: Scope, id: number): Promise<any | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [r] = await q(`SELECT ${COLUMNS} FROM sponsor_proposals p WHERE p.id = $1 AND p.organization_id = $2`, [id, s.orgId]);
  return r ?? null;
}

/** The published Sponsorship Agreement template for a brand in this workspace, if there is one. */
async function templateFor(orgId: number, brand: string): Promise<{ id: number; name: string; published: boolean } | null> {
  const [t] = await q<{ id: number; name: string; settings: any }>(
    `SELECT id, name, settings FROM esign_templates WHERE organization_id = $1 AND slug = $2 AND active = true ORDER BY id DESC LIMIT 1`,
    [orgId, proposalBrand(brand).templateSlug],
  );
  if (!t) return null;
  return { id: t.id, name: t.name, published: (t.settings ?? {}).published !== false };
}

const WRITE_COLUMNS = [
  "brand", "sponsor_company", "sponsor_legal_name", "contact_name", "contact_email", "contact_phone", "logo_url", "logo_ground",
  "partnership_title", "season_label", "intro", "assets", "benefits", "audience_keys", "term_start", "term_end", "fee_cents",
  "payment_terms", "contra", "special_conditions",
] as const;
function writeValues(p: ProposalInput): unknown[] {
  return [
    p.brand, p.sponsorCompany, p.sponsorLegalName, p.contactName, p.contactEmail, p.contactPhone, p.logoUrl, p.logoGround,
    p.partnershipTitle, p.seasonLabel, p.intro, JSON.stringify(p.assets), JSON.stringify(p.benefits), p.audienceKeys,
    p.termStart, p.termEnd, p.feeCents, p.paymentTerms, p.contra, p.specialConditions,
  ];
}

const newToken = () => crypto.randomBytes(24).toString("base64url");

/**
 * A completed agreement becomes a Partner and its contract row, once.
 * Called by e-Sign when a document completes, and again whenever the list is
 * read (so a miss heals itself). Never throws: signing must not fail on it.
 */
export async function sponsorProposalOnSigned(docId: number): Promise<void> {
  try {
    const [p] = await q(
      `SELECT ${COLUMNS}, p.organization_id, d.completed_at, d.signed_pdf IS NOT NULL AS has_pdf
       FROM sponsor_proposals p JOIN esign_documents d ON d.id = p.esign_document_id
       WHERE p.esign_document_id = $1 AND d.status = 'completed' AND p.partner_contract_id IS NULL`,
      [docId],
    );
    if (!p) return;
    const input = inputOf(p);
    const brand = proposalBrand(input.brand);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Two servers finishing the same signature: the second waits, then finds it done.
      const locked = await client.query(`SELECT partner_contract_id FROM sponsor_proposals WHERE id = $1 FOR UPDATE`, [p.id]);
      if (locked.rows[0]?.partner_contract_id) { await client.query("ROLLBACK"); return; }

      const company = input.sponsorCompany;
      let partnerId: number;
      const existing = await client.query(
        `SELECT id FROM sponsorship_partners WHERE organization_id = $1 AND archived_at IS NULL AND lower(company) = lower($2)`,
        [p.organization_id, company],
      );
      if (existing.rows[0]) partnerId = existing.rows[0].id;
      else {
        const made = await client.query(
          `INSERT INTO sponsorship_partners (organization_id, company, trading_name, logo_url, brand_tags, primary_contact_name, primary_contact_email,
                                             primary_contact_phone, deal_id, owner_id, created_by, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11) RETURNING id`,
          [
            p.organization_id, company, input.sponsorLegalName && input.sponsorLegalName !== company ? null : null, input.logoUrl,
            [brand.short], p.accepted_name || input.contactName, input.contactEmail, input.contactPhone, null, p.created_by,
            `Created when the Sponsorship Agreement from proposal #${p.id} was signed on ${nzTodayIso()}.`,
          ],
        );
        partnerId = made.rows[0].id;
      }
      const signedOn = p.completed_at
        ? new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date(p.completed_at))
        : nzTodayIso();
      const contract = await client.query(
        `INSERT INTO sponsorship_partner_contracts
           (partner_id, title, club_entity, signed_on, start_date, end_date, cash_per_year_cents, gst_note, contra_description, payment_terms,
            other_clauses, signature_status, signed_by, signature_evidence, signature_checked_at, flags, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'both_parties', $12, $13, now(), $14::jsonb, $15) RETURNING id`,
        [
          partnerId, `${input.partnershipTitle} (${brand.name})`, brand.name, signedOn, input.termStart, input.termEnd,
          input.feeCents != null && input.feeCents <= 2_000_000_000 ? input.feeCents : null, "Fee is exclusive of GST",
          input.contra, input.paymentTerms, input.specialConditions,
          p.accepted_name || input.contactName,
          `Signed by both parties in ClubOS e-Sign, document #${docId}. The signed PDF and its certificate are in e-Sign.`,
          JSON.stringify(["Made from a signed e-Sign agreement. Add the instalments from its payment schedule so they can be tracked against Xero."]),
          p.created_by,
        ],
      );
      await client.query(`UPDATE sponsor_proposals SET partner_id = $2, partner_contract_id = $3, updated_at = now() WHERE id = $1`, [p.id, partnerId, contract.rows[0].id]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("[sponsor-proposals] could not turn a signed agreement into a partner:", e);
  }
}

async function healSigned(orgId: number): Promise<void> {
  const rows = await q<{ esign_document_id: number }>(
    `SELECT p.esign_document_id FROM sponsor_proposals p JOIN esign_documents d ON d.id = p.esign_document_id
     WHERE p.organization_id = $1 AND d.status = 'completed' AND p.partner_contract_id IS NULL`,
    [orgId],
  );
  for (const r of rows) await sponsorProposalOnSigned(r.esign_document_id);
}

const deviceOf = (ua: string | undefined): string => (/iPad|Tablet/i.test(ua ?? "") ? "tablet" : /Mobi|iPhone|Android/i.test(ua ?? "") ? "phone" : "desktop");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export function registerSponsorProposalRoutes(app: Express) {
  const gate = [requireAuth, requireTab(SPONSOR_PROPOSALS_TAB)] as const;

  // ── Staff ────────────────────────────────────────────────────────────────
  app.get(BASE, ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      await healSigned(s.orgId);
      const rows = await q(`SELECT ${COLUMNS} FROM sponsor_proposals p WHERE p.organization_id = $1 ORDER BY p.archived_at IS NOT NULL, p.updated_at DESC`, [s.orgId]);
      const templates: Record<string, { id: number; name: string; published: boolean } | null> = {
        siu: await templateFor(s.orgId, "siu"),
        cufc: await templateFor(s.orgId, "cufc"),
      };
      res.json({ today: nzTodayIso(), proposals: rows.map(toRow), audience: AUDIENCE_STATS, standardBenefits: STANDARD_BENEFITS, templates });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post(BASE, ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const p = cleanProposal(req.body);
      if (!p.sponsorCompany) return res.status(400).json({ message: "Add the sponsor's name." });
      const cols = [...WRITE_COLUMNS];
      const [made] = await q<{ id: number }>(
        `INSERT INTO sponsor_proposals (organization_id, token, created_by, ${cols.join(", ")})
         VALUES ($1, $2, $3, ${cols.map((_, i) => `$${i + 4}`).join(", ")}) RETURNING id`,
        [s.orgId, newToken(), s.userId, ...writeValues(p)],
      );
      res.json(toRow(await one(s, made.id)));
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.patch(`${BASE}/:id`, ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const cur = await one(s, Number(req.params.id));
      if (!cur) return res.status(404).json({ message: "Not found" });
      // What they accepted (or are signing) cannot change underneath them.
      if (cur.accepted_at || esignIsLive(cur.esign_status)) {
        return res.status(409).json({ message: "This version has been accepted. Make a copy to change the terms." });
      }
      const p = cleanProposal({ ...inputOf(cur), ...(req.body ?? {}) });
      if (!p.sponsorCompany) return res.status(400).json({ message: "Add the sponsor's name." });
      if (cur.published_at && !cur.withdrawn_at && publishProblems(p).length) {
        return res.status(400).json({ message: "This proposal is live. Fix these first:", problems: publishProblems(p) });
      }
      const cols = [...WRITE_COLUMNS];
      await q(
        `UPDATE sponsor_proposals SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(", ")}, updated_at = now() WHERE id = $1 AND organization_id = $2`,
        [cur.id, s.orgId, ...writeValues(p)],
      );
      res.json(toRow(await one(s, cur.id)));
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.post(`${BASE}/:id/duplicate`, ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const cur = await one(s, Number(req.params.id));
      if (!cur) return res.status(404).json({ message: "Not found" });
      const p = inputOf(cur);
      const cols = [...WRITE_COLUMNS];
      const [made] = await q<{ id: number }>(
        `INSERT INTO sponsor_proposals (organization_id, token, created_by, ${cols.join(", ")})
         VALUES ($1, $2, $3, ${cols.map((_, i) => `$${i + 4}`).join(", ")}) RETURNING id`,
        [s.orgId, newToken(), s.userId, ...writeValues(p)],
      );
      res.json(toRow(await one(s, made.id)));
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // publish · withdraw · archive · restore. Each is a timestamp, never a status.
  const act = (action: "publish" | "withdraw" | "archive" | "restore") => async (req: Request, res: Response) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const cur = await one(s, Number(req.params.id));
      if (!cur) return res.status(404).json({ message: "Not found" });
      if (action === "publish") {
        const problems = publishProblems(inputOf(cur));
        if (problems.length) return res.status(400).json({ message: "Fix these first:", problems });
        await q(`UPDATE sponsor_proposals SET published_at = COALESCE(published_at, now()), withdrawn_at = NULL, updated_at = now() WHERE id = $1`, [cur.id]);
      } else if (action === "withdraw") {
        await q(`UPDATE sponsor_proposals SET withdrawn_at = now(), updated_at = now() WHERE id = $1 AND published_at IS NOT NULL`, [cur.id]);
      } else if (action === "archive") {
        await q(`UPDATE sponsor_proposals SET archived_at = now(), updated_at = now() WHERE id = $1`, [cur.id]);
      } else {
        await q(`UPDATE sponsor_proposals SET archived_at = NULL, updated_at = now() WHERE id = $1`, [cur.id]);
      }
      res.json(toRow(await one(s, cur.id)));
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  };
  // Express 5 takes no pattern inside a path, so each action is its own route.
  for (const a of ["publish", "withdraw", "archive", "restore"] as const) app.post(`${BASE}/:id/${a}`, ...gate, act(a));

  // The sponsor's logo: shrunk and hosted by ClubOS itself (the Mailer's image store).
  app.post(
    `${BASE}/logo`,
    ...gate,
    (req: Request, res: Response, next) =>
      upload.single("file")(req, res, (err: any) => {
        if (!err) return next();
        res.status(400).json({ message: err?.code === "LIMIT_FILE_SIZE" ? "That file is too big. Export a smaller copy and try again." : (err?.message || "Upload failed") });
      }),
    async (req: Request, res: Response) => {
      try {
        const s = await scope(req, res); if (!s) return;
        const file = (req as any).file as { buffer: Buffer; originalname: string; size: number } | undefined;
        if (!file?.buffer?.length) return res.status(400).json({ message: "No file arrived. Pick a picture and try again." });
        const shrunk = await shrinkForEmail(file.buffer);
        if (!shrunk.ok) return res.status(400).json({ message: shrunk.message });
        const stored = await storeMailerImage({
          orgId: s.orgId, userId: s.userId, originalName: (file.originalname || "").slice(0, 200) || null,
          originalBytes: file.size ?? file.buffer.length, image: shrunk.image,
        });
        res.json({ url: stored.url.replace(/^https:\/\/app\.usg\.co\.nz/, ""), width: stored.width, height: stored.height, format: stored.format });
      } catch (e: any) { res.status(500).json({ message: e.message }); }
    },
  );

  // What the agreement will be pre-filled with. The page hands this to e-Sign's
  // own from-template route, then tells us which document came back.
  app.get(`${BASE}/:id/contract`, ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const cur = await one(s, Number(req.params.id));
      if (!cur) return res.status(404).json({ message: "Not found" });
      const p = inputOf(cur);
      const template = await templateFor(s.orgId, p.brand);
      const problems = contractProblems(p);
      if (!template) problems.push(`There is no Sponsorship Agreement template for ${proposalBrand(p.brand).name} in e-Sign yet.`);
      else if (!template.published) problems.push(`The ${proposalBrand(p.brand).name} Sponsorship Agreement template is still a draft. Publish it in e-Sign → Templates.`);
      res.json({
        template,
        variables: contractVariablesFor(p),
        signerName: cur.accepted_name || p.contactName || "",
        signerEmail: p.contactEmail || "",
        acceptedEmail: cur.accepted_email || null,
        problems,
        summary: {
          sponsor: p.sponsorLegalName || p.sponsorCompany,
          term: p.termStart && p.termEnd ? `${longDay(p.termStart)} to ${longDay(p.termEnd)}` : "",
          fee: p.feeCents == null ? "" : `${dollars(p.feeCents)} plus GST`,
        },
      });
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.post(`${BASE}/:id/contract`, ...gate, async (req, res) => {
    try {
      const s = await scope(req, res); if (!s) return;
      const cur = await one(s, Number(req.params.id));
      if (!cur) return res.status(404).json({ message: "Not found" });
      if (esignIsLive(cur.esign_status)) return res.status(409).json({ message: "This proposal already has a contract." });
      const docId = Number(req.body?.esignDocumentId);
      if (!Number.isInteger(docId) || docId <= 0) return res.status(400).json({ message: "No agreement to link." });
      const template = await templateFor(s.orgId, cur.brand);
      const [doc] = await q<{ id: number; template_id: number | null; status: string }>(
        `SELECT id, template_id, status FROM esign_documents WHERE id = $1 AND organization_id = $2`, [docId, s.orgId]);
      // Only an agreement made from this club's Sponsorship Agreement template, in this workspace.
      if (!doc || !template || doc.template_id !== template.id) return res.status(400).json({ message: "That is not a Sponsorship Agreement from this workspace." });
      await q(`UPDATE sponsor_proposals SET esign_document_id = $2, updated_at = now() WHERE id = $1`, [cur.id, docId]);
      res.json(toRow(await one(s, cur.id)));
    } catch (e: any) {
      if (String(e?.message ?? "").includes("sponsor_proposals_esign_doc_idx")) return res.status(409).json({ message: "That agreement already belongs to another proposal." });
      res.status(400).json({ message: e.message });
    }
  });

  // ── Public ───────────────────────────────────────────────────────────────

  /** A proposal a stranger may see: published, not withdrawn, not archived. Staff of its workspace may preview a draft. */
  async function visible(req: Request): Promise<{ row: any; staff: boolean } | null> {
    const token = String(req.params.token || "");
    if (!PROPOSAL_TOKEN.test(token)) return null;
    const [row] = await q(`SELECT ${COLUMNS}, p.organization_id FROM sponsor_proposals p WHERE p.token = $1`, [token]);
    if (!row) return null;
    let staff = false;
    const userId = req.session?.userId;
    if (userId) {
      try { staff = (await storage.getUserOrganizations(userId)).some((o: any) => o.id === row.organization_id); } catch { staff = false; }
    }
    const open = row.published_at && !row.withdrawn_at && !row.archived_at;
    if (!open && !staff) return null;
    return { row, staff };
  }

  app.get(`${PUBLIC}/:token`, async (req, res) => {
    try {
      const v = await visible(req);
      if (!v) return res.status(404).json({ message: "This proposal is not available." });
      const p = inputOf(v.row);
      let preparedBy: PublicProposal["preparedBy"] = null;
      if (v.row.created_by) {
        const [u] = await q<{ name: string; email: string }>(
          `SELECT btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS name, email FROM public.users WHERE id = $1`, [v.row.created_by]);
        if (u?.email) preparedBy = { name: u.name || proposalBrand(p.brand).name, email: u.email };
      }
      const out: PublicProposal = {
        brand: p.brand, sponsorCompany: p.sponsorCompany, logoUrl: p.logoUrl, logoGround: p.logoGround,
        partnershipTitle: p.partnershipTitle, seasonLabel: p.seasonLabel, intro: p.intro, assets: p.assets, benefits: p.benefits,
        audience: pickAudience(p.brand, p.audienceKeys), termStart: p.termStart, termEnd: p.termEnd, feeCents: p.feeCents,
        paymentTerms: p.paymentTerms, contra: p.contra, specialConditions: p.specialConditions,
        accepted: Boolean(v.row.accepted_at), preparedBy, formToken: mintFormToken(),
      };
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Cache-Control", "no-store");
      res.json({ proposal: out, preview: !(v.row.published_at && !v.row.withdrawn_at && !v.row.archived_at) });
    } catch (e: any) { res.status(500).json({ message: "Something went wrong." }); }
  });

  // Stamped by a POST the page makes after it has drawn, never by the GET: a
  // mail scanner fetches links and does not run the page.
  app.post(`${PUBLIC}/:token/open`, async (req, res) => {
    try {
      const v = await visible(req);
      if (v) {
        const visitor = String(req.body?.visitorId ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || null;
        const recent = await q<{ n: number }>(
          `SELECT count(*)::int AS n FROM sponsor_proposal_events WHERE proposal_id = $1 AND kind = 'open' AND created_at > now() - interval '1 hour'`, [v.row.id]);
        // A page that is being hammered stops counting; it never stops opening.
        if ((recent[0]?.n ?? 0) < 200) {
          await q(`INSERT INTO sponsor_proposal_events (proposal_id, kind, visitor_id, device, is_staff) VALUES ($1, 'open', $2, $3, $4)`,
            [v.row.id, visitor, deviceOf(req.headers["user-agent"]), v.staff]);
        }
      }
      res.json({ ok: true });
    } catch { res.json({ ok: true }); }
  });

  // "Accept" is not the contract. It records who said yes and tells staff, who
  // then send the agreement. 🔴 Nothing is emailed to the address typed here.
  app.post(`${PUBLIC}/:token/accept`, async (req, res) => {
    const same = { ok: true }; // the one answer, whatever happened
    try {
      const v = await visible(req);
      if (!v || !v.row.published_at || v.row.withdrawn_at || v.row.archived_at) return res.status(404).json({ message: "This proposal is not available." });
      const b = req.body ?? {};
      const name = String(b.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      const role = String(b.role ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
      if (name.length < 2) return res.status(400).json({ message: "Please enter your full name." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ message: "Please enter a valid email address." });
      if (b.agree !== true) return res.status(400).json({ message: "Please tick the box to confirm." });

      const verdict = await guardPublicForm({ form: "sponsor_proposal_accept", req, email, name, names: [role], page: `/proposal/${v.row.token}` });
      if (verdict.reasons.includes("honeypot")) return res.json(same); // nothing is written for a bot
      if (v.row.accepted_at) return res.json(same);

      const done = await q<{ id: number }>(
        `UPDATE sponsor_proposals SET accepted_at = now(), accepted_name = $2, accepted_email = $3, accepted_role = $4,
                accepted_held = $5, accepted_reasons = $6, updated_at = now()
         WHERE id = $1 AND accepted_at IS NULL RETURNING id`,
        [v.row.id, name, email, role || null, !verdict.ok, verdict.reasons.length ? verdict.reasons : null],
      );
      if (done.length) {
        await q(`INSERT INTO sponsor_proposal_events (proposal_id, kind, device, is_staff) VALUES ($1, 'accept', $2, false)`, [v.row.id, deviceOf(req.headers["user-agent"])]);
        // Staff are told at their OWN account address. A caught submission is kept and flagged, not announced.
        if (verdict.ok && v.row.created_by) {
          const [u] = await q<{ email: string }>(`SELECT email FROM public.users WHERE id = $1`, [v.row.created_by]);
          if (u?.email) {
            const p = inputOf(v.row);
            const { sendEmail } = await import("./email");
            await sendEmail({
              to: u.email,
              from: fromForOrg(v.row.organization_id, "ClubOS Sponsorship"),
              subject: `Accepted: ${p.sponsorCompany} — ${p.partnershipTitle}`,
              html: `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;padding:24px">
  <p style="font-size:15px;line-height:1.6"><strong>${esc(name)}</strong>${role ? ` (${esc(role)})` : ""} accepted the ${esc(proposalBrand(p.brand).name)} proposal for <strong>${esc(p.sponsorCompany)}</strong>.</p>
  <p style="font-size:14px;line-height:1.6;color:#444">Their email as typed: ${esc(email)}<br/>Check it against the contact you have before sending the contract.</p>
  <p style="font-size:14px;line-height:1.6"><a href="https://app.usg.co.nz/admin/sponsorship#prospects-proposals/${v.row.id}">Open it in ClubOS and send the contract</a></p>
  <p style="font-size:12px;color:#888;margin-top:24px">ClubOS · Sponsorship</p>
</div>`,
            }).catch(() => false);
          }
        }
      }
      res.json(same);
    } catch (e: any) {
      console.error("[sponsor-proposals] accept failed:", e);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });
}

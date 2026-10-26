/**
 * Content Studio — the routes. A universal tab (every workspace, requireAuth):
 * pieces belong to the WORKSPACE for seeing and to their MAKER for changing.
 *
 * Daniel, 2026-10-27: "everyone can kind of be building in there … as long as
 * it wouldn't be people deleting or overriding other people's content … it
 * could all come on our subdomains."
 *
 *   - A piece is seen by everyone in its workspace; changed, published and
 *     archived only by the person who made it or a super admin; anyone may
 *     DUPLICATE it into a piece of their own.
 *   - Every change to a document is a new numbered version. Nothing is
 *     overwritten in place.
 *   - A published page is served on the brand's own host
 *     (join.cufc.co.nz/p/<slug>): the host names the brand, the slug the page.
 *     A page is 'unlisted' (noindex) unless its owner says otherwise.
 *   - Graphics are drawn in the browser (html-to-image) and the PNG is posted
 *     back here, so a link exists for WhatsApp without the browser.
 *   - Every generation counts against the person's daily allowance — the same
 *     one Rambo's chat and the Mailer use.
 */
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import multer from "multer";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { studioPieces, studioRenders, studioVersions } from "@shared/schema";
import {
  checkGraphicDoc, checkPageDoc, checkVideoDoc, graphicSize, GRAPHIC_SIZE_DEFAULT, isAllowedPicture, STUDIO_BRIEF_MAX,
  STUDIO_RESERVED_SLUGS, STUDIO_SLUG_RE, STUDIO_TITLE_MAX, studioBrand, studioBrandForHost, studioBrandForOrgSlug, studioPageUrl, studioSlug,
  type GraphicDoc, type PageDoc, type StudioKind, type VideoDoc,
} from "@shared/studio";
import { renderPage } from "@shared/studio-render";
import { generateStudioPiece, pictureLibrary, STUDIO_EDIT_MODEL, STUDIO_MODEL } from "./studio-ai";
import { ramboDailyLimitFor, ramboUsedToday } from "./rambo-usage";
import { shrinkForEmail } from "./mailer-image-shrink";
import { storeMailerImage } from "./mailer-images";
import { MAILER_IMAGE_MAX_UPLOAD_BYTES } from "@shared/mailer-images";

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];
export const STUDIO_RENDER_MAX_BYTES = 8 * 1024 * 1024;

// ── Who, where ──────────────────────────────────────────────────────────────

interface Where { orgId: number; orgSlug: string; orgName: string; brandKey: string }

async function whereFor(req: Request): Promise<Where | null> {
  const slug = String(req.headers["x-workspace-slug"] || "").trim();
  if (!slug) return null;
  const r = rowsOf(await db.execute(sql`SELECT id, slug, name FROM organizations WHERE slug = ${slug} LIMIT 1`))[0];
  if (!r) return null;
  const brand = studioBrandForOrgSlug(String(r.slug));
  return { orgId: Number(r.id), orgSlug: String(r.slug), orgName: String(r.name), brandKey: brand?.key ?? "usg" };
}

/** May this person change the piece? Its maker, or a super admin. Never a
 *  workspace admin: "nobody overriding other people's content". */
function canEdit(piece: { createdByUserId: number }, user: { id: number; role: string | null }): boolean {
  return piece.createdByUserId === user.id || user.role === "super_admin";
}

function shapePiece(p: any, extra: { ownerName?: string | null; canEdit?: boolean; renderUrl?: string | null } = {}) {
  return {
    id: p.id, brand: p.brand, kind: p.kind as StudioKind, title: p.title, slug: p.slug, size: p.size, status: p.status, unlisted: p.unlisted,
    doc: p.doc, version: p.version, brief: p.brief, createdByUserId: p.createdByUserId, createdAt: p.createdAt, updatedAt: p.updatedAt, publishedAt: p.publishedAt,
    publicViews: p.publicViews,
    publicUrl: p.kind === "page" && p.slug ? studioPageUrl(p.brand, p.slug) : null,
    ownerName: extra.ownerName ?? null, canEdit: extra.canEdit ?? false, renderUrl: extra.renderUrl ?? null,
  };
}

const renderUrl = (key: string, mime: string) => `https://app.usg.co.nz/studio/r/${key}.${mime === "image/png" ? "png" : "jpg"}`;

async function latestRenders(pieceIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!pieceIds.length) return out;
  const rows = rowsOf(await db.execute(sql`
    SELECT DISTINCT ON (piece_id) piece_id, key, mime FROM studio_renders
    WHERE piece_id IN (${sql.join(pieceIds.map((id) => sql`${id}`), sql`, `)}) ORDER BY piece_id, version DESC, id DESC`));
  for (const r of rows) out.set(Number(r.piece_id), renderUrl(String(r.key), String(r.mime)));
  return out;
}

async function pieceOr404(id: number, orgId: number) {
  if (!Number.isFinite(id)) return null;
  const [p] = await db.select().from(studioPieces).where(and(eq(studioPieces.id, id), eq(studioPieces.organizationId, orgId)));
  return p ?? null;
}

/** A new numbered version, and the piece moved on to it. */
async function saveVersion(pieceId: number, doc: unknown, how: "made" | "asked" | "edited" | "duplicated", userId: number | null, note: string | null, patch: Record<string, unknown> = {}) {
  const [cur] = await db.select({ version: studioPieces.version }).from(studioPieces).where(eq(studioPieces.id, pieceId));
  const version = (cur?.version ?? 0) + 1;
  await db.insert(studioVersions).values({ pieceId, version, doc: doc as any, how, note, createdByUserId: userId });
  const [updated] = await db.update(studioPieces).set({ doc: doc as any, version, updatedAt: new Date(), ...patch }).where(eq(studioPieces.id, pieceId)).returning();
  return updated;
}

function checkDocFor(kind: StudioKind, raw: unknown) {
  if (kind === "graphic") return checkGraphicDoc(raw, isAllowedPicture);
  if (kind === "page") return checkPageDoc(raw, isAllowedPicture);
  return checkVideoDoc(raw);
}

async function uniqueSlug(brand: string, wanted: string, exceptId: number): Promise<string> {
  let base = STUDIO_SLUG_RE.test(wanted) ? wanted : studioSlug(wanted);
  if (STUDIO_RESERVED_SLUGS.has(base)) base = `${base}-page`;
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base.slice(0, 56)}-${i + 1}`;
    const clash = rowsOf(await db.execute(sql`SELECT id FROM studio_pieces WHERE brand = ${brand} AND slug = ${slug} AND status <> 'archived' AND id <> ${exceptId} LIMIT 1`));
    if (!clash.length) return slug;
  }
  return `${base.slice(0, 48)}-${Date.now().toString(36)}`;
}

const uploadPicture = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAILER_IMAGE_MAX_UPLOAD_BYTES, files: 1 } });
const uploadRender = multer({ storage: multer.memoryStorage(), limits: { fileSize: STUDIO_RENDER_MAX_BYTES, files: 1 } });

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerStudioRoutes(app: Express) {
  /** Today's count against the shared allowance, the models, the brand here. */
  app.get("/api/admin/content-studio/usage", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ message: "Unknown workspace" });
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Not signed in" });
      const brand = studioBrand(w.brandKey)!;
      res.json({
        used: await ramboUsedToday(user.id), limit: ramboDailyLimitFor((user as any).mailerAiDailyLimit),
        model: STUDIO_MODEL, editModel: STUDIO_EDIT_MODEL, enabled: !!process.env.ANTHROPIC_API_KEY,
        brand: { key: brand.key, name: brand.name, host: brand.host }, firstName: user.firstName || "", isSuperAdmin: user.role === "super_admin",
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** The club's pictures this piece may use — every kit, plus uploads here. */
  app.get("/api/admin/content-studio/pictures", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ message: "Unknown workspace" });
      const brandKey = studioBrand(String(req.query.brand || "")) ? String(req.query.brand) : w.brandKey;
      res.json({ pictures: await pictureLibrary(w.orgId, brandKey) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** Upload a picture of your own: shrunk and hosted the way the Mailer's are. */
  app.post("/api/admin/content-studio/pictures", requireAuth, (req: Request, res: Response, next) => uploadPicture.single("file")(req, res, (err: any) => {
    if (!err) return next();
    res.status(400).json({ ok: false, message: err?.code === "LIMIT_FILE_SIZE" ? `That file is over ${Math.round(MAILER_IMAGE_MAX_UPLOAD_BYTES / 1024 / 1024)}MB.` : (err?.message || "Upload failed") });
  }), async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ ok: false, message: "Unknown workspace" });
      const file = (req as any).file as { buffer: Buffer; originalname: string; size: number } | undefined;
      if (!file?.buffer?.length) return res.status(400).json({ ok: false, message: "No file arrived." });
      const shrunk = await shrinkForEmail(file.buffer);
      if (!shrunk.ok) return res.status(400).json({ ok: false, message: shrunk.message });
      const stored = await storeMailerImage({ orgId: w.orgId, userId: req.session.userId ?? null, originalName: (file.originalname || "").slice(0, 200) || null, originalBytes: file.size ?? file.buffer.length, image: shrunk.image });
      res.json({ ok: true, url: stored.url, width: stored.width, height: stored.height, bytes: stored.bytes });
    } catch (e: any) { res.status(500).json({ ok: false, message: e.message }); }
  });

  /** Everyone's pieces in this workspace, newest first. */
  app.get("/api/admin/content-studio/pieces", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ message: "Unknown workspace" });
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Not signed in" });
      const kind = String(req.query.kind || "");
      const rows = rowsOf(await db.execute(sql`
        SELECT p.*, u.first_name, u.last_name FROM studio_pieces p LEFT JOIN users u ON u.id = p.created_by_user_id
        WHERE p.organization_id = ${w.orgId} AND p.status <> 'archived' ${kind === "graphic" || kind === "page" || kind === "video" ? sql`AND p.kind = ${kind}` : sql``}
        ORDER BY p.updated_at DESC LIMIT 200`));
      const renders = await latestRenders(rows.filter((r) => r.kind === "graphic").map((r) => Number(r.id)));
      res.json({
        pieces: rows.map((r) => shapePiece({
          id: Number(r.id), brand: r.brand, kind: r.kind, title: r.title, slug: r.slug, size: r.size, status: r.status, unlisted: r.unlisted, doc: r.doc, version: r.version, brief: r.brief,
          createdByUserId: Number(r.created_by_user_id), createdAt: r.created_at, updatedAt: r.updated_at, publishedAt: r.published_at, publicViews: r.public_views,
        }, { ownerName: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || null, canEdit: canEdit({ createdByUserId: Number(r.created_by_user_id) }, user), renderUrl: renders.get(Number(r.id)) ?? null })),
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** One prompt → a new graphic or page, as a draft of your own. */
  app.post("/api/admin/content-studio/generate", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ ok: false, message: "Unknown workspace" });
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ ok: false, message: "Not signed in" });
      if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ ok: false, message: "Rambo isn't switched on — ANTHROPIC_API_KEY isn't set on the server." });
      const kind = req.body?.kind === "page" ? "page" : req.body?.kind === "graphic" ? "graphic" : null;
      if (!kind) return res.status(400).json({ ok: false, message: "Say whether you want a graphic or a landing page." });
      const brief = String(req.body?.brief ?? "").trim();
      if (!brief) return res.status(400).json({ ok: false, message: "Say what you want — who it is for, what it is about, what they should do." });
      if (brief.length > STUDIO_BRIEF_MAX) return res.status(400).json({ ok: false, message: `Keep the brief under ${STUDIO_BRIEF_MAX} characters.` });
      const brandKey = studioBrand(String(req.body?.brand || "")) ? String(req.body.brand) : w.brandKey;
      const sizeKey = kind === "graphic" ? graphicSize(String(req.body?.size || GRAPHIC_SIZE_DEFAULT)).key : null;
      const limit = ramboDailyLimitFor((user as any).mailerAiDailyLimit);
      const used = await ramboUsedToday(user.id);
      if (used >= limit) return res.status(429).json({ ok: false, message: limit === 0 ? "Rambo is switched off for your account. A super admin can turn it on in Team." : `You've used today's ${limit} prompts. It resets at midnight NZ time, or a super admin can raise your limit in Team.`, usage: { used, limit } });

      // A page can take a while; keep the line open with whitespace.
      res.status(200); res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.flushHeaders?.();
      const beat = setInterval(() => { try { res.write(" "); } catch { /* gone */ } }, 15_000);
      try {
        const out = await generateStudioPiece({ kind, brandKey, orgId: w.orgId, userId: user.id, userLabel: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email, brief, sizeKey: sizeKey ?? undefined });
        if (!out.ok || !out.doc) { clearInterval(beat); return res.end(JSON.stringify({ ok: false, message: out.error || "Rambo couldn't make that.", usage: { used: used + 1, limit } })); }
        const [piece] = await db.insert(studioPieces).values({
          organizationId: w.orgId, brand: brandKey, kind, title: (out.title || "Untitled").slice(0, STUDIO_TITLE_MAX), size: sizeKey, status: "draft", doc: out.doc as any, version: 1, brief, createdByUserId: user.id,
        }).returning();
        await db.insert(studioVersions).values({ pieceId: piece.id, version: 1, doc: out.doc as any, how: "made", note: brief.slice(0, 500), createdByUserId: user.id });
        clearInterval(beat);
        res.end(JSON.stringify({ ok: true, piece: shapePiece(piece, { ownerName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(), canEdit: true }), reply: out.reply, model: out.model, costCents: out.costCents, usage: { used: used + 1, limit } }));
      } catch (e: any) {
        clearInterval(beat);
        res.end(JSON.stringify({ ok: false, message: `Rambo hit a snag: ${String(e?.message || "").slice(0, 200)}` }));
      }
    } catch (e: any) { res.status(500).json({ ok: false, message: e.message }); }
  });

  /** A video request — no model, a brief and the footage for the editing kit. */
  app.post("/api/admin/content-studio/video", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ message: "Unknown workspace" });
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Not signed in" });
      const c = checkVideoDoc({ ...req.body, status: "requested", deliveredUrl: null });
      if (!c.ok) return res.status(400).json({ message: c.problems[0] });
      const brandKey = studioBrand(String(req.body?.brand || "")) ? String(req.body.brand) : w.brandKey;
      const title = String(req.body?.title || c.doc.brief.split(/[.\n]/)[0]).trim().slice(0, STUDIO_TITLE_MAX) || "Video request";
      const [piece] = await db.insert(studioPieces).values({ organizationId: w.orgId, brand: brandKey, kind: "video", title, status: "draft", doc: c.doc as any, version: 1, brief: c.doc.brief, createdByUserId: user.id }).returning();
      await db.insert(studioVersions).values({ pieceId: piece.id, version: 1, doc: c.doc as any, how: "made", createdByUserId: user.id });
      res.json({ ok: true, piece: shapePiece(piece, { canEdit: true, ownerName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() }) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/admin/content-studio/pieces/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ message: "Unknown workspace" });
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Not signed in" });
      const p = await pieceOr404(parseInt(String(req.params.id), 10), w.orgId);
      if (!p || p.status === "archived") return res.status(404).json({ message: "Not found" });
      const owner = await storage.getUser(p.createdByUserId);
      const versions = rowsOf(await db.execute(sql`SELECT v.version, v.how, v.note, v.created_at, u.first_name, u.last_name FROM studio_versions v LEFT JOIN users u ON u.id = v.created_by_user_id WHERE v.piece_id = ${p.id} ORDER BY v.version DESC LIMIT 50`));
      const renders = rowsOf(await db.execute(sql`SELECT version, key, mime, width, height, bytes, created_at FROM studio_renders WHERE piece_id = ${p.id} ORDER BY version DESC, id DESC LIMIT 20`));
      res.json({
        piece: shapePiece(p, { ownerName: owner ? `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() : null, canEdit: canEdit(p, user), renderUrl: renders[0] ? renderUrl(String(renders[0].key), String(renders[0].mime)) : null }),
        versions: versions.map((v) => ({ version: v.version, how: v.how, note: v.note, createdAt: v.created_at, by: `${v.first_name ?? ""} ${v.last_name ?? ""}`.trim() || null })),
        renders: renders.map((r) => ({ version: r.version, url: renderUrl(String(r.key), String(r.mime)), width: r.width, height: r.height, bytes: r.bytes, createdAt: r.created_at })),
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** A specific version's document (to look back, or to put it back). */
  app.get("/api/admin/content-studio/pieces/:id/versions/:version", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ message: "Unknown workspace" });
      const p = await pieceOr404(parseInt(String(req.params.id), 10), w.orgId);
      if (!p) return res.status(404).json({ message: "Not found" });
      const [v] = await db.select().from(studioVersions).where(and(eq(studioVersions.pieceId, p.id), eq(studioVersions.version, parseInt(String(req.params.version), 10))));
      if (!v) return res.status(404).json({ message: "No such version" });
      res.json({ version: v.version, how: v.how, note: v.note, doc: v.doc, createdAt: v.createdAt });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** Ask Rambo to change it (a re-prompt). Owner only; counts as a prompt. */
  app.post("/api/admin/content-studio/pieces/:id/ask", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ ok: false, message: "Unknown workspace" });
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ ok: false, message: "Not signed in" });
      const p = await pieceOr404(parseInt(String(req.params.id), 10), w.orgId);
      if (!p || p.status === "archived") return res.status(404).json({ ok: false, message: "Not found" });
      if (!canEdit(p, user)) return res.status(403).json({ ok: false, message: "This is someone else's piece. Duplicate it to make your own version." });
      if (p.kind === "video") return res.status(400).json({ ok: false, message: "A video request is edited by hand, not by Rambo." });
      const instruction = String(req.body?.instruction ?? "").trim();
      if (!instruction) return res.status(400).json({ ok: false, message: "Say what you'd like changed." });
      const limit = ramboDailyLimitFor((user as any).mailerAiDailyLimit);
      const used = await ramboUsedToday(user.id);
      if (used >= limit) return res.status(429).json({ ok: false, message: `You've used today's ${limit} prompts. It resets at midnight NZ time, or a super admin can raise your limit in Team.`, usage: { used, limit } });
      res.status(200); res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.flushHeaders?.();
      const beat = setInterval(() => { try { res.write(" "); } catch { /* gone */ } }, 15_000);
      try {
        const history = Array.isArray(req.body?.history) ? req.body.history.filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-6).map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) })) : [];
        const out = await generateStudioPiece({ kind: p.kind as "graphic" | "page", brandKey: p.brand, orgId: w.orgId, userId: user.id, userLabel: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email, brief: instruction, sizeKey: p.size ?? undefined, current: p.doc as any, history, pieceId: p.id });
        if (!out.ok || !out.doc) { clearInterval(beat); return res.end(JSON.stringify({ ok: false, message: out.error || "Rambo couldn't make that change.", usage: { used: used + 1, limit } })); }
        const changed = JSON.stringify(out.doc) !== JSON.stringify(p.doc);
        const updated = changed ? await saveVersion(p.id, out.doc, "asked", user.id, instruction.slice(0, 500)) : p;
        clearInterval(beat);
        res.end(JSON.stringify({ ok: true, changed, piece: shapePiece(updated, { canEdit: true }), reply: out.reply, model: out.model, costCents: out.costCents, usage: { used: used + 1, limit } }));
      } catch (e: any) {
        clearInterval(beat);
        res.end(JSON.stringify({ ok: false, message: `Rambo hit a snag: ${String(e?.message || "").slice(0, 200)}` }));
      }
    } catch (e: any) { res.status(500).json({ ok: false, message: e.message }); }
  });

  /** Edit by hand: the document (a field changed), the title, the slug, the
   *  listing flag, a video's status. Owner only; a doc change is a version. */
  app.patch("/api/admin/content-studio/pieces/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ message: "Unknown workspace" });
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Not signed in" });
      const p = await pieceOr404(parseInt(String(req.params.id), 10), w.orgId);
      if (!p || p.status === "archived") return res.status(404).json({ message: "Not found" });
      if (!canEdit(p, user)) return res.status(403).json({ message: "This is someone else's piece. Duplicate it to make your own version." });
      const patch: Record<string, unknown> = {};
      if (typeof req.body?.title === "string") {
        const t = req.body.title.trim().slice(0, STUDIO_TITLE_MAX);
        if (!t) return res.status(400).json({ message: "A piece needs a name." });
        patch.title = t;
      }
      if (p.kind === "page" && typeof req.body?.slug === "string") {
        const s = studioSlug(req.body.slug);
        patch.slug = await uniqueSlug(p.brand, s, p.id);
      }
      if (p.kind === "page" && typeof req.body?.unlisted === "boolean") patch.unlisted = req.body.unlisted;
      if (p.kind === "graphic" && typeof req.body?.size === "string") patch.size = graphicSize(req.body.size).key;
      if (p.kind === "video" && user.role === "super_admin" && (req.body?.status === "requested" || req.body?.status === "in_progress" || req.body?.status === "delivered")) {
        const doc = { ...(p.doc as VideoDoc), status: req.body.status, deliveredUrl: typeof req.body?.deliveredUrl === "string" ? req.body.deliveredUrl.trim() || null : (p.doc as VideoDoc).deliveredUrl ?? null, notes: typeof req.body?.notes === "string" ? req.body.notes.slice(0, 2000) : (p.doc as VideoDoc).notes ?? null };
        const c = checkVideoDoc(doc);
        if (!c.ok) return res.status(400).json({ message: c.problems[0] });
        const updated = await saveVersion(p.id, c.doc, "edited", user.id, `status → ${c.doc.status}`, patch);
        return res.json({ ok: true, piece: shapePiece(updated, { canEdit: true }) });
      }
      if (req.body?.doc !== undefined) {
        const c = checkDocFor(p.kind as StudioKind, p.kind === "video" ? { ...(req.body.doc ?? {}), status: (p.doc as VideoDoc).status, deliveredUrl: (p.doc as VideoDoc).deliveredUrl } : req.body.doc);
        if (!c.ok) return res.status(400).json({ message: c.problems[0], problems: c.problems });
        const changed = JSON.stringify(c.doc) !== JSON.stringify(p.doc);
        const updated = changed ? await saveVersion(p.id, c.doc, "edited", user.id, typeof req.body?.note === "string" ? req.body.note.slice(0, 200) : null, patch)
          : Object.keys(patch).length ? (await db.update(studioPieces).set({ ...patch, updatedAt: new Date() }).where(eq(studioPieces.id, p.id)).returning())[0] : p;
        return res.json({ ok: true, changed, piece: shapePiece(updated, { canEdit: true }) });
      }
      const updated = Object.keys(patch).length ? (await db.update(studioPieces).set({ ...patch, updatedAt: new Date() }).where(eq(studioPieces.id, p.id)).returning())[0] : p;
      res.json({ ok: true, piece: shapePiece(updated, { canEdit: true }) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** Put a page on its brand's host. */
  app.post("/api/admin/content-studio/pieces/:id/publish", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ message: "Unknown workspace" });
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Not signed in" });
      const p = await pieceOr404(parseInt(String(req.params.id), 10), w.orgId);
      if (!p || p.status === "archived") return res.status(404).json({ message: "Not found" });
      if (!canEdit(p, user)) return res.status(403).json({ message: "Only the person who made this page can publish it." });
      if (p.kind !== "page") return res.status(400).json({ message: "Only a landing page is published. A graphic is downloaded; a video is delivered." });
      const c = checkPageDoc(p.doc, isAllowedPicture);
      if (!c.ok) return res.status(400).json({ message: `The page isn't ready: ${c.problems[0]}`, problems: c.problems });
      const slug = await uniqueSlug(p.brand, typeof req.body?.slug === "string" && req.body.slug.trim() ? req.body.slug : (p.slug || p.title), p.id);
      const [updated] = await db.update(studioPieces).set({ slug, status: "published", publishedAt: p.publishedAt ?? new Date(), updatedAt: new Date() }).where(eq(studioPieces.id, p.id)).returning();
      res.json({ ok: true, piece: shapePiece(updated, { canEdit: true }), url: studioPageUrl(updated.brand, slug) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/admin/content-studio/pieces/:id/unpublish", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ message: "Unknown workspace" });
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Not signed in" });
      const p = await pieceOr404(parseInt(String(req.params.id), 10), w.orgId);
      if (!p || p.status === "archived") return res.status(404).json({ message: "Not found" });
      if (!canEdit(p, user)) return res.status(403).json({ message: "Only the person who made this page can take it down." });
      const [updated] = await db.update(studioPieces).set({ status: "draft", updatedAt: new Date() }).where(eq(studioPieces.id, p.id)).returning();
      res.json({ ok: true, piece: shapePiece(updated, { canEdit: true }) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** Anyone in the workspace may make their own copy of a piece. */
  app.post("/api/admin/content-studio/pieces/:id/duplicate", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ message: "Unknown workspace" });
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Not signed in" });
      const p = await pieceOr404(parseInt(String(req.params.id), 10), w.orgId);
      if (!p || p.status === "archived") return res.status(404).json({ message: "Not found" });
      const [copy] = await db.insert(studioPieces).values({
        organizationId: w.orgId, brand: p.brand, kind: p.kind, title: `${p.title} (copy)`.slice(0, STUDIO_TITLE_MAX), size: p.size, status: "draft", unlisted: true,
        doc: p.kind === "video" ? { ...(p.doc as VideoDoc), status: "requested", deliveredUrl: null } as any : p.doc as any, version: 1, brief: p.brief, createdByUserId: user.id,
      }).returning();
      await db.insert(studioVersions).values({ pieceId: copy.id, version: 1, doc: copy.doc as any, how: "duplicated", note: `from #${p.id}`, createdByUserId: user.id });
      res.json({ ok: true, piece: shapePiece(copy, { canEdit: true, ownerName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() }) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** Archive (never a hard delete — versions and renders stay). Owner only. */
  app.delete("/api/admin/content-studio/pieces/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ message: "Unknown workspace" });
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Not signed in" });
      const p = await pieceOr404(parseInt(String(req.params.id), 10), w.orgId);
      if (!p) return res.status(404).json({ message: "Not found" });
      if (!canEdit(p, user)) return res.status(403).json({ message: "Only the person who made this can remove it." });
      await db.update(studioPieces).set({ status: "archived", updatedAt: new Date() }).where(eq(studioPieces.id, p.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** The browser drew the graphic; keep the PNG so a link exists. */
  app.post("/api/admin/content-studio/pieces/:id/render", requireAuth, (req: Request, res: Response, next) => uploadRender.single("file")(req, res, (err: any) => {
    if (!err) return next();
    res.status(400).json({ ok: false, message: err?.code === "LIMIT_FILE_SIZE" ? "That picture is over 8MB." : (err?.message || "Upload failed") });
  }), async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ ok: false, message: "Unknown workspace" });
      const p = await pieceOr404(parseInt(String(req.params.id), 10), w.orgId);
      if (!p || p.kind !== "graphic") return res.status(404).json({ ok: false, message: "Not found" });
      const file = (req as any).file as { buffer: Buffer; mimetype: string } | undefined;
      if (!file?.buffer?.length) return res.status(400).json({ ok: false, message: "No picture arrived." });
      const mime = file.mimetype === "image/jpeg" ? "image/jpeg" : "image/png";
      // Read the real dimensions off the bytes (PNG IHDR / JPEG SOF), never the form.
      let width = 0, height = 0;
      if (mime === "image/png" && file.buffer.length > 24 && file.buffer.toString("ascii", 1, 4) === "PNG") { width = file.buffer.readUInt32BE(16); height = file.buffer.readUInt32BE(20); }
      else { const m = await import("sharp").then((s) => s.default(file.buffer).metadata()); width = m.width ?? 0; height = m.height ?? 0; }
      if (!width || !height) return res.status(400).json({ ok: false, message: "That is not a PNG or JPEG." });
      const key = crypto.createHash("sha256").update(file.buffer).digest("hex").slice(0, 24);
      await db.insert(studioRenders).values({ pieceId: p.id, version: p.version, key, mime, width, height, bytes: file.buffer.length, data: file.buffer }).onConflictDoNothing();
      res.json({ ok: true, url: renderUrl(key, mime), width, height, bytes: file.buffer.length, version: p.version });
    } catch (e: any) { res.status(500).json({ ok: false, message: e.message }); }
  });

  /** A graphic's PNG, public and immutable (the key is its content). */
  app.get("/studio/r/:file", async (req: Request, res: Response) => {
    const m = /^([a-f0-9]{24})\.(png|jpg)$/.exec(String(req.params.file || ""));
    if (!m) return res.status(404).end();
    try {
      const [r] = await db.select({ mime: studioRenders.mime, data: studioRenders.data, bytes: studioRenders.bytes }).from(studioRenders).where(eq(studioRenders.key, m[1]));
      if (!r) return res.status(404).end();
      res.setHeader("Content-Type", r.mime);
      res.setHeader("Content-Length", String(r.bytes));
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("ETag", `"${m[1]}"`);
      if (req.headers["if-none-match"] === `"${m[1]}"`) return res.status(304).end();
      res.end(r.data);
    } catch { res.status(404).end(); }
  });

  /** A page as it will look, for the editor's preview (drafts included). */
  app.get("/api/admin/content-studio/pieces/:id/html", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).send("Unknown workspace");
      const p = await pieceOr404(parseInt(String(req.params.id), 10), w.orgId);
      if (!p || p.kind !== "page") return res.status(404).send("Not found");
      const html = renderPage(p.doc as PageDoc, p.brand, { noindex: true, url: p.slug ? studioPageUrl(p.brand, p.slug) : undefined, draftNote: p.status === "published" ? undefined : "Draft — only people with this preview can see it. Publish to put it on the club's site." });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(html);
    } catch (e: any) { res.status(500).send(e.message); }
  });

  /** THE PUBLIC PAGE. The host names the brand (join.cufc.co.nz → cufc); on
   *  the app host a ?b= names it. Only a published page is served. */
  app.get("/p/:slug", async (req: Request, res: Response) => {
    const slug = String(req.params.slug || "").toLowerCase();
    if (!STUDIO_SLUG_RE.test(slug)) return res.status(404).send("Not found");
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").toLowerCase();
    const brand = studioBrandForHost(host) ?? (host.startsWith("app.usg.co.nz") || host.startsWith("localhost") ? studioBrand(String(req.query.b || "")) : undefined);
    if (!brand) return res.status(404).send("Not found");
    try {
      const [p] = await db.select().from(studioPieces).where(and(eq(studioPieces.brand, brand.key), eq(studioPieces.slug, slug), eq(studioPieces.status, "published")));
      if (!p) return res.status(404).send("Not found");
      const url = studioPageUrl(brand.key, slug);
      const html = renderPage(p.doc as PageDoc, brand.key, { noindex: p.unlisted, url });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=60");
      res.setHeader("X-Robots-Tag", p.unlisted ? "noindex, nofollow" : "all");
      res.send(html);
      if (req.method === "GET") db.update(studioPieces).set({ publicViews: sql`${studioPieces.publicViews} + 1` }).where(eq(studioPieces.id, p.id)).catch(() => {});
    } catch { res.status(404).send("Not found"); }
  });
}

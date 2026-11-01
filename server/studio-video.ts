// Content Studio — the video editor's server side.
//
// Staff upload clips straight from the browser into the club's PRIVATE Vercel
// Blob store (the file never passes through ClubOS), ask Rambo to edit it, and
// a worker (the editing kit's renderer, on the club Mac for now) claims the job
// here, plans and renders it, and hands back the edit and the MP4. The finished
// video is played back through ClubOS (private files, read with the store's
// key), so footage of children never sits at a public address.
//
// Contract: shared/studio-video.ts. Queue: studio_video_jobs (one live job per
// piece, enforced by Postgres).

import type { Express, Request, Response } from "express";
import { Readable } from "node:stream";
import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { db } from "./db";
import { storage } from "./storage";
import { requireAuth } from "./auth";
import { studioGenerations } from "@shared/schema";
import { brandPack } from "@shared/studio-brand-packs";
import { studioBrand } from "@shared/studio";
import { CLUB_LOGOS } from "../client/src/components/marketing/grapes/templates/brand-kit";
import { VIDEO_CLIP_MAX_BYTES, VIDEO_CLIPS_MAX, type VideoJob, type VideoTheme } from "@shared/studio-video";
import { checkClips, checkEdl, FOOTAGE_HOST_RE } from "@shared/studio-video-check";
import { canEdit, pieceOr404, saveVersion, whereFor } from "./studio";
import { ramboDailyLimitFor, ramboUsedToday } from "./rambo-usage";

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];
const blobToken = () => process.env.STUDIO_FOOTAGE_BLOB_TOKEN || "";

/** The public site each brand's end card names. */
const SITE: Record<string, string> = {
  cufc: "cufc.co.nz", siu: "southislandunited.com", mfl: "minifootball.co.nz", cic: "cicyouth.com",
  cugc: "cugc.co.nz", usc: "unitedsportscentre.com", usg: "unitedsportsgroup.co.nz", prints: "unitedprints.co.nz",
};
/** Which brand-pack colours a video card uses: [primary, light, ink, accent]. */
const THEME_TOKENS: Record<string, [string, string, string, string]> = {
  cufc: ["--brand-royal", "--brand-mist", "--brand-navy", "--brand-gold"],
  siu: ["--brand-black", "--brand-bone", "--brand-black", "--brand-gold"],
  mfl: ["--brand-ink", "--brand-paper", "--brand-ink", "--brand-gold"],
  cic: ["--brand-ink", "--brand-white", "--brand-ink", "--brand-gold"],
  cugc: ["--brand-navy", "--brand-cream", "--brand-ink", "--brand-sky"],
  usc: ["--brand-midnight", "--brand-paper", "--brand-midnight", "--brand-indigo"],
  usg: ["--brand-navy", "--brand-paper", "--brand-midnight", "--brand-gold"],
  prints: ["--brand-royal", "--brand-mist", "--brand-navy", "--brand-grass"],
};

export function videoTheme(brandKey: string): VideoTheme {
  const p = brandPack(brandKey);
  const hex = (t: string) => p.palette.find((c) => c.token === t)?.hex ?? "#111111";
  const [a, b, c, d] = THEME_TOKENS[brandKey] ?? THEME_TOKENS.cufc;
  return {
    name: studioBrand(brandKey)?.name ?? p.name,
    primary: hex(a), light: hex(b), ink: hex(c), accent: hex(d),
    displayFont: p.fonts.display, bodyFont: p.fonts.body,
    crestUrl: CLUB_LOGOS.find((l) => l.key === brandKey)?.src ?? null,
    site: SITE[brandKey] ?? "usg.co.nz",
  };
}

function workerOk(req: Request): boolean {
  const expected = process.env.STUDIO_WORKER_KEY || "";
  const got = String(req.headers["x-worker-key"] || "");
  if (!expected || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

async function latestJob(pieceId: number) {
  return rowsOf(await db.execute(sql`SELECT id, kind, status, stage, error, created_at, claimed_at, finished_at, cost_usd_cents FROM studio_video_jobs WHERE piece_id = ${pieceId} ORDER BY id DESC LIMIT 1`))[0] ?? null;
}
const shapeJob = (j: any) => j && ({ id: Number(j.id), kind: j.kind, status: j.status, stage: j.stage, error: j.error, createdAt: j.created_at, claimedAt: j.claimed_at, finishedAt: j.finished_at, costCents: j.cost_usd_cents == null ? null : Number(j.cost_usd_cents) });

/** A job left running by a worker that died: give it back after 50 minutes. */
async function sweepStale() {
  await db.execute(sql`UPDATE studio_video_jobs SET status = 'failed', finished_at = now(), error = 'The editor stopped part-way (no word from it for 50 minutes). Press the button again to retry.' WHERE status = 'running' AND claimed_at < now() - interval '50 minutes'`);
}

/** Who may watch a piece's video: anyone in its workspace, or a super admin. */
async function mayView(userId: number, orgId: number): Promise<boolean> {
  const u = await storage.getUser(userId);
  if (!u) return false;
  if (u.role === "super_admin") return true;
  return rowsOf(await db.execute(sql`SELECT 1 FROM user_organizations WHERE user_id = ${userId} AND organization_id = ${orgId} LIMIT 1`)).length > 0;
}

export function registerStudioVideoRoutes(app: Express) {
  // ── Uploading footage (browser → private store, direct) ──────────────────
  app.post("/api/admin/content-studio/footage/upload", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!blobToken()) return res.status(503).json({ error: "Footage storage isn't switched on yet (STUDIO_FOOTAGE_BLOB_TOKEN)." });
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ error: "Not signed in" });
      const body = req.body as HandleUploadBody;
      const out = await handleUpload({
        body, request: req, token: blobToken(),
        onBeforeGenerateToken: async (_pathname, clientPayload) => {
          const pieceId = Number(JSON.parse(clientPayload || "{}").pieceId);
          const [p] = rowsOf(await db.execute(sql`SELECT id, kind, created_by_user_id, doc FROM studio_pieces WHERE id = ${pieceId}`));
          if (!p || p.kind !== "video" || !canEdit({ createdByUserId: Number(p.created_by_user_id) }, user)) throw new Error("Only the person who made this video can add footage to it.");
          if ((p.doc?.clips?.length ?? 0) >= VIDEO_CLIPS_MAX) throw new Error(`A video takes up to ${VIDEO_CLIPS_MAX} clips.`);
          return { allowedContentTypes: ["video/*"], maximumSizeInBytes: VIDEO_CLIP_MAX_BYTES, addRandomSuffix: true, tokenPayload: JSON.stringify({ pieceId, userId: user.id }) };
        },
      });
      res.json(out);
    } catch (e: any) { res.status(400).json({ error: e.message || "Upload refused" }); }
  });

  /** After the browser has uploaded a clip: add it to the piece. */
  app.post("/api/admin/content-studio/pieces/:id/clips", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ ok: false, message: "Unknown workspace" });
      const user = await storage.getUser(req.session.userId!);
      const p = await pieceOr404(parseInt(String(req.params.id), 10), w.orgId);
      if (!user || !p || p.kind !== "video") return res.status(404).json({ ok: false, message: "Not found" });
      if (!canEdit(p, user)) return res.status(403).json({ ok: false, message: "Only its maker can add footage." });
      const [clip] = checkClips([{ url: req.body?.url, name: req.body?.name, bytes: req.body?.bytes }]);
      if (!clip) return res.status(400).json({ ok: false, message: "That isn't a clip from the club's footage store." });
      const doc: any = p.doc ?? {};
      const clips = [...(doc.clips ?? []), clip].slice(0, VIDEO_CLIPS_MAX);
      const updated = await saveVersion(p.id, { ...doc, clips }, "edited", user.id, `added footage: ${clip.name}`);
      res.json({ ok: true, doc: updated.doc });
    } catch (e: any) { res.status(500).json({ ok: false, message: e.message }); }
  });

  /** Take a clip off (the file stays in the store until the piece is cleared). */
  app.delete("/api/admin/content-studio/pieces/:id/clips/:index", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ ok: false, message: "Unknown workspace" });
      const user = await storage.getUser(req.session.userId!);
      const p = await pieceOr404(parseInt(String(req.params.id), 10), w.orgId);
      if (!user || !p || p.kind !== "video") return res.status(404).json({ ok: false, message: "Not found" });
      if (!canEdit(p, user)) return res.status(403).json({ ok: false, message: "Only its maker can change the footage." });
      const doc: any = p.doc ?? {};
      const i = parseInt(String(req.params.index), 10);
      const clips = (doc.clips ?? []).filter((_: any, j: number) => j !== i);
      // An edit points at clips by number — taking one away invalidates it.
      const updated = await saveVersion(p.id, { ...doc, clips, edl: null }, "edited", user.id, "removed a clip");
      res.json({ ok: true, doc: updated.doc });
    } catch (e: any) { res.status(500).json({ ok: false, message: e.message }); }
  });

  /** "Edit it" (plan + render, one prompt against the allowance) or "Render again" (words changed; free). */
  app.post("/api/admin/content-studio/pieces/:id/video-job", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ ok: false, message: "Unknown workspace" });
      const user = await storage.getUser(req.session.userId!);
      const p = await pieceOr404(parseInt(String(req.params.id), 10), w.orgId);
      if (!user || !p || p.kind !== "video") return res.status(404).json({ ok: false, message: "Not found" });
      if (!canEdit(p, user)) return res.status(403).json({ ok: false, message: "Duplicate it to make your own edit." });
      const kind = req.body?.kind === "render" ? "render" : "plan";
      const doc: any = p.doc ?? {};
      if (!(doc.clips ?? []).length) return res.status(400).json({ ok: false, message: "Upload at least one clip first." });
      if (kind === "render" && !doc.edl) return res.status(400).json({ ok: false, message: "There is no edit yet — press Edit it first." });
      if (kind === "plan") {
        const limit = ramboDailyLimitFor((user as any).mailerAiDailyLimit);
        const used = await ramboUsedToday(user.id);
        if (used >= limit) return res.status(429).json({ ok: false, message: `You've used today's ${limit} prompts. It resets at midnight NZ time.` });
      }
      await sweepStale();
      try {
        await db.execute(sql`INSERT INTO studio_video_jobs (piece_id, kind, requested_by_user_id) VALUES (${p.id}, ${kind}, ${user.id})`);
      } catch {
        return res.status(409).json({ ok: false, message: "Rambo is already working on this video." });
      }
      await saveVersion(p.id, { ...doc, status: "in_progress" }, "edited", user.id, kind === "plan" ? "asked Rambo to edit it" : "render again");
      res.json({ ok: true, job: shapeJob(await latestJob(p.id)) });
    } catch (e: any) { res.status(500).json({ ok: false, message: e.message }); }
  });

  app.get("/api/admin/content-studio/pieces/:id/video-job", requireAuth, async (req: Request, res: Response) => {
    try {
      const w = await whereFor(req);
      if (!w) return res.status(400).json({ message: "Unknown workspace" });
      const p = await pieceOr404(parseInt(String(req.params.id), 10), w.orgId);
      if (!p || p.kind !== "video") return res.status(404).json({ message: "Not found" });
      const queued = rowsOf(await db.execute(sql`SELECT count(*)::int n FROM studio_video_jobs WHERE status = 'queued'`))[0]?.n ?? 0;
      res.setHeader("Cache-Control", "no-store");
      res.json({ job: shapeJob(await latestJob(p.id)), queued, version: p.version });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** The finished video and its poster, streamed from the private store (Range passed through so it scrubs). */
  app.get("/api/admin/content-studio/pieces/:id/media/:which", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const [p] = rowsOf(await db.execute(sql`SELECT id, organization_id, kind, doc FROM studio_pieces WHERE id = ${id}`));
      if (!p || p.kind !== "video" || !(await mayView(req.session.userId!, Number(p.organization_id)))) return res.status(404).end();
      const url = req.params.which === "poster" ? p.doc?.posterUrl : p.doc?.videoUrl;
      if (!url || !FOOTAGE_HOST_RE.test(String(url))) return res.status(404).end();
      const upstream = await fetch(String(url), { headers: { authorization: `Bearer ${blobToken()}`, ...(req.headers.range ? { range: String(req.headers.range) } : {}) } });
      if (!upstream.ok && upstream.status !== 206) return res.status(upstream.status === 404 ? 404 : 502).end();
      res.status(upstream.status);
      for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) { const v = upstream.headers.get(h); if (v) res.setHeader(h, v); }
      res.setHeader("Cache-Control", "private, max-age=3600");
      if (req.query.download === "1") res.setHeader("Content-Disposition", `attachment; filename="video-${id}.${req.params.which === "poster" ? "jpg" : "mp4"}"`);
      if (!upstream.body) return res.end();
      Readable.fromWeb(upstream.body as any).pipe(res);
    } catch (e: any) { if (!res.headersSent) res.status(500).end(); }
  });

  // ── The worker ───────────────────────────────────────────────────────────
  app.get("/api/worker/studio/videos/next", async (req: Request, res: Response) => {
    if (!workerOk(req)) return res.status(401).json({ error: "unauthorised" });
    try {
      await sweepStale();
      const [j] = rowsOf(await db.execute(sql`
        UPDATE studio_video_jobs SET status = 'running', claimed_at = now(), stage = 'Picked up by the editor'
        WHERE id = (SELECT id FROM studio_video_jobs WHERE status = 'queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id, piece_id, kind`));
      if (!j) return res.status(204).end();
      const [p] = rowsOf(await db.execute(sql`SELECT id, brand, doc, brief FROM studio_pieces WHERE id = ${j.piece_id}`));
      const doc: any = p?.doc ?? {};
      const job: VideoJob = {
        id: Number(j.id), pieceId: Number(j.piece_id), kind: j.kind, brand: p.brand,
        brief: String(doc.brief ?? p.brief ?? ""), format: doc.format === "landscape" ? "landscape" : "vertical",
        lengthSeconds: Number(doc.lengthSeconds) || 45, clips: doc.clips ?? [], edl: doc.edl ?? null, theme: videoTheme(p.brand),
      };
      res.json({ job });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/worker/studio/videos/:id/progress", async (req: Request, res: Response) => {
    if (!workerOk(req)) return res.status(401).json({ error: "unauthorised" });
    const stage = String(req.body?.stage ?? "").slice(0, 200);
    await db.execute(sql`UPDATE studio_video_jobs SET stage = ${stage} WHERE id = ${parseInt(String(req.params.id), 10)} AND status = 'running'`);
    res.json({ ok: true });
  });

  app.post("/api/worker/studio/videos/:id/done", async (req: Request, res: Response) => {
    if (!workerOk(req)) return res.status(401).json({ error: "unauthorised" });
    try {
      const id = parseInt(String(req.params.id), 10);
      const [j] = rowsOf(await db.execute(sql`SELECT j.id, j.kind, j.piece_id, j.requested_by_user_id, p.doc, p.organization_id, p.brand FROM studio_video_jobs j JOIN studio_pieces p ON p.id = j.piece_id WHERE j.id = ${id} AND j.status = 'running'`));
      if (!j) return res.status(404).json({ error: "no such running job" });
      const r = req.body ?? {};
      const cents = Number.isFinite(Number(r.costCents)) && Number(r.costCents) >= 0 ? Math.round(Number(r.costCents) * 100) / 100 : null;
      const doc: any = j.doc ?? {};
      if (!r.ok) {
        await db.execute(sql`UPDATE studio_video_jobs SET status = 'failed', finished_at = now(), error = ${String(r.error || "The editor couldn't finish.").slice(0, 1000)}, cost_usd_cents = ${cents} WHERE id = ${id}`);
        await saveVersion(j.piece_id, { ...doc, status: doc.videoUrl ? "delivered" : "requested" }, "edited", null, "the edit failed");
        return res.json({ ok: true });
      }
      const clips = r.clips ? checkClips(r.clips) : doc.clips ?? [];
      const edl = r.edl ? checkEdl(r.edl, clips.length) : doc.edl ?? null;
      const media = (v: unknown) => (typeof v === "string" && FOOTAGE_HOST_RE.test(v) ? v : null);
      const videoUrl = media(r.videoUrl);
      if (!videoUrl) return res.status(400).json({ error: "videoUrl must be a file in the footage store" });
      const next = { ...doc, clips, edl, videoUrl, posterUrl: media(r.posterUrl), seconds: Number(r.seconds) || null, editNote: typeof r.note === "string" ? r.note.slice(0, 2000) : doc.editNote ?? null, status: "delivered", deliveredUrl: `https://app.usg.co.nz/api/admin/content-studio/pieces/${j.piece_id}/media/video` };
      await saveVersion(j.piece_id, next, j.kind === "plan" ? "made" : "edited", j.requested_by_user_id ? Number(j.requested_by_user_id) : null, j.kind === "plan" ? "Rambo edited the footage" : "rendered again with the new words");
      await db.execute(sql`UPDATE studio_video_jobs SET status = 'done', finished_at = now(), stage = 'Done', cost_usd_cents = ${cents} WHERE id = ${id}`);
      // A plan is a paid prompt: it counts in the person's daily allowance and the usage report.
      if (j.kind === "plan") {
        const u = j.requested_by_user_id ? await storage.getUser(Number(j.requested_by_user_id)) : null;
        await db.insert(studioGenerations).values({
          pieceId: j.piece_id, userId: u?.id ?? null, userLabel: u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email : "video editor", organizationId: Number(j.organization_id), brand: j.brand,
          kind: "video", model: "claude-opus-5-5", instruction: String(doc.brief ?? "").slice(0, 4000), costUsdCents: String(cents ?? 0), ok: true,
        } as any).catch((e) => console.error("[studio-video] usage row failed:", e));
      }
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}

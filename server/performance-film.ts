/**
 * SIU Performance → Video: session film the club hosts itself.
 *
 * Daniel, 2026-11-27: "create a video analysis portal for siu and upload the
 * video there and allow them to download it from there as well so i can share
 * the video with scott hales our head coach and the rest of the performance team".
 *
 * A film (one session or match) holds, per camera clip, a small WATCH copy that
 * plays in the page and optionally the camera's ORIGINAL to download. Staff add
 * notes pinned to a moment. One share link per film lets a coach with no ClubOS
 * login watch and download it at join.southislandunited.com/film/<token>.
 *
 * Rules:
 *   • The bytes sit in the PRIVATE Vercel Blob store "siu-film" (SIU_FILM_BLOB_TOKEN).
 *     Nothing is ever served from a public address: every byte is streamed
 *     through here after a check, with Range passed on so the player can seek.
 *   • A <video> tag and a download link cannot send the workspace header the
 *     performance gate needs, so the gated JSON hands out file addresses signed
 *     for twelve hours (HMAC over file id + expiry); the file route checks the
 *     signature AND that a staff member is signed in.
 *   • A share link is a random 128-bit token, off until a staff member turns it
 *     on, and switching it off bites on the next request. The public JSON carries
 *     no staff names and no ids beyond the file ids it needs.
 *   • Nothing is deleted: films, files and notes are archived.
 */
import type { Express, Request, Response, RequestHandler } from "express";
import { Readable } from "node:stream";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { pool } from "./db";
import { requireAuth } from "./auth";

const BASE = "/api/admin/performance";
const PUB = "/api/public/film";
const LIB = "/api/public/film-library";
const STORE_RE = /^https:\/\/[a-z0-9]+\.private\.blob\.vercel-storage\.com\//;
const MAX_FILE_BYTES = 40 * 1024 * 1024 * 1024; // 40 GB: a long 4K camera file
const SIGN_HOURS = 12;
const KINDS = ["training", "match", "other"] as const;

type Row = Record<string, any>;
const q = async <T = Row>(text: string, params: unknown[] = []): Promise<T[]> => (await pool.query(text, params)).rows as T[];
const one = async <T = Row>(text: string, params: unknown[] = []): Promise<T | undefined> => (await q<T>(text, params))[0];
const blobToken = () => process.env.SIU_FILM_BLOB_TOKEN || "";
const secret = () => process.env.SESSION_SECRET || "cufc-dev-secret";
const isIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isoOf = (d: unknown): string | null => {
  if (d == null) return null;
  if (typeof d === "string") return d.slice(0, 10);
  const x = d as Date; // pg returns DATE as a local-midnight Date; read its LOCAL parts.
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const shareBase = () => process.env.SIU_ATHLETE_URL || "https://join.southislandunited.com";

function sign(fileId: number, exp: number): string {
  return createHmac("sha256", secret()).update(`perf-film:${fileId}:${exp}`).digest("base64url");
}
function signedOk(fileId: number, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const want = Buffer.from(sign(fileId, exp));
  const got = Buffer.from(String(sig || ""));
  return want.length === got.length && timingSafeEqual(want, got);
}

interface FileOut { id: number; clip: number; role: "watch" | "original"; label: string; bytes: number; seconds: number | null; width: number | null; height: number | null; downloadName: string; videoUrl: string; downloadUrl: string; posterUrl: string | null }

function fileOut(f: Row, urls: (id: number, which: "video" | "poster", download?: boolean) => string): FileOut {
  return {
    id: f.id, clip: f.clip, role: f.role, label: f.label, bytes: Number(f.bytes), seconds: f.seconds == null ? null : Number(f.seconds),
    width: f.width, height: f.height, downloadName: f.download_name,
    videoUrl: urls(f.id, "video"), downloadUrl: urls(f.id, "video", true), posterUrl: f.poster_url ? urls(f.id, "poster") : null,
  };
}
const filesOf = (filmId: number) => q(`select * from perf_film_files where film_id = $1 and archived_at is null order by clip, role desc, id`, [filmId]);
const notesOf = (filmId: number) => q(
  `select n.id, n.clip, n.at_seconds, n.body, n.created_at, nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), '') author
   from perf_film_notes n left join users u on u.id = n.created_by
   where n.film_id = $1 and n.archived_at is null order by n.clip, n.at_seconds, n.id`, [filmId]);

/** Stream one stored file to the browser, passing Range through so the player can seek. */
async function streamBlob(req: Request, res: Response, url: string, opts: { downloadName?: string }) {
  if (!blobToken()) return res.status(503).json({ message: "Film storage isn't switched on (SIU_FILM_BLOB_TOKEN)." });
  if (!STORE_RE.test(url)) return res.status(404).end();
  const ac = new AbortController();
  res.on("close", () => ac.abort());
  let upstream: globalThis.Response;
  try {
    upstream = await fetch(url, { signal: ac.signal, headers: { authorization: `Bearer ${blobToken()}`, ...(req.headers.range ? { range: String(req.headers.range) } : {}) } });
  } catch { if (!res.headersSent) res.status(502).end(); return; }
  if (!upstream.ok && upstream.status !== 206) return res.status(upstream.status === 404 ? 404 : upstream.status === 416 ? 416 : 502).end();
  res.status(upstream.status);
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) { const v = upstream.headers.get(h); if (v) res.setHeader(h, v); }
  if (!upstream.headers.get("accept-ranges")) res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (opts.downloadName) res.setHeader("Content-Disposition", `attachment; filename="${opts.downloadName.replace(/[^A-Za-z0-9._ -]+/g, "-")}"`);
  if (!upstream.body) return res.end();
  const body = Readable.fromWeb(upstream.body as any);
  body.on("error", () => { if (!res.writableEnded) res.destroy(); });
  body.pipe(res);
}

export interface FilmDeps {
  gate: readonly RequestHandler[];
  viewer: (req: Request) => { userId: number; org: number };
  siuOrg: () => Promise<number>;
  handle: (fn: (req: Request, res: Response) => Promise<unknown>) => RequestHandler;
}

export function registerPerformanceFilmRoutes(app: Express, d: FilmDeps) {
  const { gate, viewer, handle } = d;
  const exp = () => Date.now() + SIGN_HOURS * 3600_000;
  const staffUrls = (e: number) => (id: number, which: "video" | "poster", download?: boolean) =>
    `${BASE}/film-file/${id}/${which}?e=${e}&s=${sign(id, e)}${download ? "&download=1" : ""}`;
  const shareUrl = (f: Row) => (f.share_token ? `${shareBase()}/film/${f.share_token}` : null);

  const filmFor = (id: number, org: number) => one(`select * from perf_films where id = $1 and organization_id = $2 and archived_at is null`, [id, org]);

  async function detail(f: Row) {
    const e = exp();
    const [files, notes] = await Promise.all([filesOf(f.id), notesOf(f.id)]);
    return {
      id: f.id, title: f.title, filmDate: isoOf(f.film_date), kind: f.kind, note: f.note,
      share: { on: !!f.share_enabled, url: shareUrl(f), createdAt: f.share_created_at ? new Date(f.share_created_at).toISOString() : null },
      inLibrary: !!f.in_library,
      files: files.map((x) => fileOut(x, staffUrls(e))),
      notes: notes.map((n) => ({ id: n.id, clip: n.clip, atSeconds: Number(n.at_seconds), body: n.body, author: n.author, createdAt: new Date(n.created_at).toISOString() })),
    };
  }

  // ── the club's film library: ONE standing link that shows every film in it ──
  const libraryUrl = (token: string) => `${shareBase()}/films/${token}`;
  async function libraryOut(org: number) {
    const l = await one(`select * from perf_film_libraries where organization_id = $1`, [org]);
    return { on: !!l?.enabled, url: l ? libraryUrl(l.token) : null };
  }
  app.post(`${BASE}/films/library`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const b = req.body ?? {};
    const l = await one(`select * from perf_film_libraries where organization_id = $1`, [v.org]);
    if (b.on === false) {
      if (l) await pool.query(`update perf_film_libraries set enabled = false where id = $1`, [l.id]);
    } else if (!l) {
      await pool.query(`insert into perf_film_libraries (organization_id, token, enabled, created_by) values ($1,$2,true,$3)`, [v.org, randomBytes(16).toString("base64url"), v.userId]);
    } else if (b.renew === true) {
      // A new link: the old one is dead from now on.
      await pool.query(`update perf_film_libraries set token = $1, enabled = true, created_by = $2, created_at = now() where id = $3`, [randomBytes(16).toString("base64url"), v.userId, l.id]);
    } else {
      await pool.query(`update perf_film_libraries set enabled = true where id = $1`, [l.id]);
    }
    res.json({ ok: true, library: await libraryOut(v.org) });
  }));

  // ── staff: the list ──────────────────────────────────────────────────────
  app.get(`${BASE}/films`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const e = exp();
    const rows = await q(`
      select f.*,
        (select count(distinct x.clip)::int from perf_film_files x where x.film_id = f.id and x.archived_at is null) clips,
        (select coalesce(sum(x.seconds), 0)::float from perf_film_files x where x.film_id = f.id and x.archived_at is null and x.role = 'watch') seconds,
        (select coalesce(sum(x.bytes), 0)::float from perf_film_files x where x.film_id = f.id and x.archived_at is null) bytes,
        (select count(*)::int from perf_film_notes n where n.film_id = f.id and n.archived_at is null) notes,
        (select x.id from perf_film_files x where x.film_id = f.id and x.archived_at is null and x.poster_url is not null order by x.clip, x.role desc limit 1) poster_file
      from perf_films f where f.organization_id = $1 and f.archived_at is null
      order by f.film_date desc nulls last, f.id desc limit 200`, [v.org]);
    res.json({
      storageOn: !!blobToken(),
      library: await libraryOut(v.org),
      films: rows.map((f) => ({
        id: f.id, title: f.title, filmDate: isoOf(f.film_date), kind: f.kind, note: f.note, clips: f.clips, seconds: f.seconds, bytes: f.bytes, notes: f.notes,
        shared: !!f.share_enabled, inLibrary: !!f.in_library, posterUrl: f.poster_file ? staffUrls(e)(f.poster_file, "poster") : null,
      })),
    });
  }));

  app.get(`${BASE}/films/:id`, ...gate, handle(async (req, res) => {
    const f = await filmFor(Number(req.params.id), viewer(req).org);
    if (!f) return res.status(404).json({ message: "Film not found." });
    res.json({ film: await detail(f) });
  }));

  app.post(`${BASE}/films`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const b = req.body ?? {};
    const title = String(b.title || "").trim().slice(0, 140);
    if (!title) return res.status(400).json({ message: "Give the film a title." });
    const kind = (KINDS as readonly string[]).includes(b.kind) ? b.kind : "training";
    const r = await one(`insert into perf_films (organization_id, title, film_date, kind, note, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
      [v.org, title, isIso(b.filmDate) ? b.filmDate : null, kind, String(b.note || "").trim().slice(0, 1000) || null, v.userId]);
    res.json({ ok: true, id: r!.id });
  }));

  app.patch(`${BASE}/films/:id`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const f = await filmFor(Number(req.params.id), v.org);
    if (!f) return res.status(404).json({ message: "Film not found." });
    const b = req.body ?? {};
    const title = b.title === undefined ? f.title : String(b.title || "").trim().slice(0, 140);
    if (!title) return res.status(400).json({ message: "Give the film a title." });
    const filmDate = b.filmDate === undefined ? isoOf(f.film_date) : isIso(b.filmDate) ? b.filmDate : null;
    const kind = (KINDS as readonly string[]).includes(b.kind) ? b.kind : f.kind;
    const note = b.note === undefined ? f.note : String(b.note || "").trim().slice(0, 1000) || null;
    const inLibrary = typeof b.inLibrary === "boolean" ? b.inLibrary : !!f.in_library;
    await pool.query(`update perf_films set title = $1, film_date = $2, kind = $3, note = $4, in_library = $5 where id = $6`, [title, filmDate, kind, note, inLibrary, f.id]);
    res.json({ ok: true });
  }));

  app.delete(`${BASE}/films/:id`, ...gate, handle(async (req, res) => {
    // Archived, and its share link stops working at once.
    await pool.query(`update perf_films set archived_at = now(), share_enabled = false where id = $1 and organization_id = $2`, [Number(req.params.id), viewer(req).org]);
    res.json({ ok: true });
  }));

  // ── staff: the share link ────────────────────────────────────────────────
  app.post(`${BASE}/films/:id/share`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const f = await filmFor(Number(req.params.id), v.org);
    if (!f) return res.status(404).json({ message: "Film not found." });
    const b = req.body ?? {};
    if (b.on === false) {
      await pool.query(`update perf_films set share_enabled = false where id = $1`, [f.id]);
    } else if (b.renew === true || !f.share_token) {
      // A new token: the old link, if there was one, is dead from now on.
      await pool.query(`update perf_films set share_token = $1, share_enabled = true, share_created_by = $2, share_created_at = now() where id = $3`,
        [randomBytes(16).toString("base64url"), v.userId, f.id]);
    } else {
      await pool.query(`update perf_films set share_enabled = true where id = $1`, [f.id]);
    }
    res.json({ ok: true, film: await detail((await filmFor(f.id, v.org))!) });
  }));

  // ── staff: uploading (browser → the private store, direct) ───────────────
  app.post(`${BASE}/films/upload`, ...gate, handle(async (req, res) => {
    if (!blobToken()) return res.status(503).json({ message: "Film storage isn't switched on (SIU_FILM_BLOB_TOKEN)." });
    const v = viewer(req);
    try {
      const out = await handleUpload({
        body: req.body as HandleUploadBody, request: req as any, token: blobToken(),
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          const filmId = Number(JSON.parse(clientPayload || "{}").filmId);
          const f = await filmFor(filmId, v.org);
          if (!f) throw new Error("That film doesn't exist.");
          if (!pathname.startsWith(`siu/film-${filmId}/`)) throw new Error("Unexpected file path.");
          return { allowedContentTypes: ["video/*", "image/jpeg"], maximumSizeInBytes: MAX_FILE_BYTES, addRandomSuffix: true, tokenPayload: JSON.stringify({ filmId, userId: v.userId }) };
        },
      });
      res.json(out);
    } catch (e: any) { res.status(400).json({ message: e?.message || "Upload refused." }); }
  }));

  /** After the bytes have landed: record the file on the film. */
  app.post(`${BASE}/films/:id/files`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const f = await filmFor(Number(req.params.id), v.org);
    if (!f) return res.status(404).json({ message: "Film not found." });
    const b = req.body ?? {};
    const url = String(b.url || "");
    if (!STORE_RE.test(url)) return res.status(400).json({ message: "That isn't a file in the club's film store." });
    const posterUrl = b.posterUrl ? String(b.posterUrl) : null;
    if (posterUrl && !STORE_RE.test(posterUrl)) return res.status(400).json({ message: "That poster isn't in the club's film store." });
    const role = b.role === "original" ? "original" : "watch";
    const bytes = Math.floor(Number(b.bytes));
    if (!Number.isFinite(bytes) || bytes <= 0) return res.status(400).json({ message: "The file has no size." });
    const next = await one<{ n: number }>(`select coalesce(max(clip), 0)::int + 1 n from perf_film_files where film_id = $1 and archived_at is null`, [f.id]);
    const clip = Number.isInteger(Number(b.clip)) && Number(b.clip) > 0 ? Number(b.clip) : next!.n;
    const name = String(b.name || "film.mp4").replace(/[^A-Za-z0-9._ -]+/g, "-").slice(-120) || "film.mp4";
    const numOrNull = (x: unknown) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
    try {
      const r = await one(`insert into perf_film_files (film_id, clip, role, label, blob_url, download_name, content_type, bytes, seconds, width, height, poster_url, created_by)
                           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [f.id, clip, role, String(b.label || "").trim().slice(0, 80) || `Clip ${clip}${role === "original" ? " · original" : ""}`, url, name,
          /^video\/[a-z0-9.+-]+$/i.test(String(b.contentType || "")) ? String(b.contentType) : "video/mp4", bytes, numOrNull(b.seconds), numOrNull(b.width), numOrNull(b.height), posterUrl, v.userId]);
      res.json({ ok: true, id: r!.id });
    } catch (e: any) {
      if (e?.code === "23505") return res.status(409).json({ message: `Clip ${clip} already has ${role === "original" ? "an original" : "a watching copy"}. Remove it first.` });
      throw e;
    }
  }));

  app.delete(`${BASE}/films/:id/files/:fileId`, ...gate, handle(async (req, res) => {
    const f = await filmFor(Number(req.params.id), viewer(req).org);
    if (!f) return res.status(404).json({ message: "Film not found." });
    await pool.query(`update perf_film_files set archived_at = now() where id = $1 and film_id = $2`, [Number(req.params.fileId), f.id]);
    res.json({ ok: true });
  }));

  // ── staff: notes pinned to a moment ──────────────────────────────────────
  app.post(`${BASE}/films/:id/notes`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const f = await filmFor(Number(req.params.id), v.org);
    if (!f) return res.status(404).json({ message: "Film not found." });
    const b = req.body ?? {};
    const body = String(b.body || "").trim().slice(0, 1000);
    const at = Number(b.atSeconds);
    if (!body) return res.status(400).json({ message: "Write the note first." });
    if (!Number.isFinite(at) || at < 0) return res.status(400).json({ message: "The note needs a moment in the film." });
    const clip = Number.isInteger(Number(b.clip)) && Number(b.clip) > 0 ? Number(b.clip) : 1;
    const r = await one(`insert into perf_film_notes (film_id, clip, at_seconds, body, created_by) values ($1,$2,$3,$4,$5) returning id`, [f.id, clip, Math.round(at * 100) / 100, body, v.userId]);
    res.json({ ok: true, id: r!.id });
  }));

  app.delete(`${BASE}/films/:id/notes/:noteId`, ...gate, handle(async (req, res) => {
    const f = await filmFor(Number(req.params.id), viewer(req).org);
    if (!f) return res.status(404).json({ message: "Film not found." });
    await pool.query(`update perf_film_notes set archived_at = now() where id = $1 and film_id = $2`, [Number(req.params.noteId), f.id]);
    res.json({ ok: true });
  }));

  // ── staff: the bytes (signed address + a staff session; no workspace header) ──
  app.get(`${BASE}/film-file/:fileId/:which`, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.fileId);
      if (!Number.isInteger(id) || !signedOk(id, Number(req.query.e), String(req.query.s || ""))) return res.status(404).end();
      const f = await one(`select x.* from perf_film_files x join perf_films f on f.id = x.film_id where x.id = $1 and x.archived_at is null and f.archived_at is null`, [id]);
      if (!f) return res.status(404).end();
      if (req.params.which === "poster") return f.poster_url ? streamBlob(req, res, f.poster_url, {}) : res.status(404).end();
      return streamBlob(req, res, f.blob_url, { downloadName: req.query.download === "1" ? f.download_name : undefined });
    } catch (e) { console.error("[Performance film] file failed:", e); if (!res.headersSent) res.status(500).end(); }
  });

  // ── the share link (no login) ────────────────────────────────────────────
  const sharedFilm = (token: string) => (/^[A-Za-z0-9_-]{16,64}$/.test(token)
    ? one(`select * from perf_films where share_token = $1 and share_enabled and archived_at is null`, [token]) : Promise.resolve(undefined));

  app.get(`${PUB}/:token`, async (req: Request, res: Response) => {
    try {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Cache-Control", "no-store");
      const f = await sharedFilm(String(req.params.token));
      if (!f) return res.status(404).json({ message: "This link isn't active." });
      const urls = (id: number, which: "video" | "poster", download?: boolean) => `${PUB}/${f.share_token}/file/${id}/${which}${download ? "?download=1" : ""}`;
      const [files, notes] = await Promise.all([filesOf(f.id), notesOf(f.id)]);
      res.json({
        film: {
          title: f.title, filmDate: isoOf(f.film_date), kind: f.kind, note: f.note,
          files: files.map((x) => fileOut(x, urls)),
          notes: notes.map((n) => ({ id: n.id, clip: n.clip, atSeconds: Number(n.at_seconds), body: n.body })),
        },
      });
    } catch (e) { console.error("[Performance film] share failed:", e); res.status(500).json({ message: "Something went wrong." }); }
  });

  app.get(`${PUB}/:token/file/:fileId/:which`, async (req: Request, res: Response) => {
    try {
      const f = await sharedFilm(String(req.params.token));
      const id = Number(req.params.fileId);
      if (!f || !Number.isInteger(id)) return res.status(404).end();
      const x = await one(`select * from perf_film_files where id = $1 and film_id = $2 and archived_at is null`, [id, f.id]);
      if (!x) return res.status(404).end();
      if (req.params.which === "poster") return x.poster_url ? streamBlob(req, res, x.poster_url, {}) : res.status(404).end();
      return streamBlob(req, res, x.blob_url, { downloadName: req.query.download === "1" ? x.download_name : undefined });
    } catch (e) { console.error("[Performance film] share file failed:", e); if (!res.headersSent) res.status(500).end(); }
  });

  // ── the library link (no login): every film in the library, newest first ──
  const libraryFor = (token: string) => (/^[A-Za-z0-9_-]{16,64}$/.test(token)
    ? one(`select * from perf_film_libraries where token = $1 and enabled`, [token]) : Promise.resolve(undefined));
  const libraryFilm = (orgId: number, filmId: number) => (Number.isInteger(filmId)
    ? one(`select * from perf_films where id = $1 and organization_id = $2 and in_library and archived_at is null`, [filmId, orgId]) : Promise.resolve(undefined));

  app.get(`${LIB}/:token`, async (req: Request, res: Response) => {
    try {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Cache-Control", "no-store");
      const l = await libraryFor(String(req.params.token));
      if (!l) return res.status(404).json({ message: "This link isn't active." });
      const rows = await q(`
        select f.id, f.title, f.film_date, f.kind, f.note,
          (select count(distinct x.clip)::int from perf_film_files x where x.film_id = f.id and x.archived_at is null) clips,
          (select coalesce(sum(x.seconds), 0)::float from perf_film_files x where x.film_id = f.id and x.archived_at is null and x.role = 'watch') seconds,
          (select x.id from perf_film_files x where x.film_id = f.id and x.archived_at is null and x.poster_url is not null order by x.clip, x.role desc limit 1) poster_file
        from perf_films f
        where f.organization_id = $1 and f.in_library and f.archived_at is null
          and exists (select 1 from perf_film_files x where x.film_id = f.id and x.archived_at is null)
        order by f.film_date desc nulls last, f.id desc limit 500`, [l.organization_id]);
      res.json({
        films: rows.map((f) => ({
          id: f.id, title: f.title, filmDate: isoOf(f.film_date), kind: f.kind, note: f.note, clips: f.clips, seconds: f.seconds,
          posterUrl: f.poster_file ? `${LIB}/${l.token}/films/${f.id}/file/${f.poster_file}/poster` : null,
        })),
      });
    } catch (e) { console.error("[Performance film] library failed:", e); res.status(500).json({ message: "Something went wrong." }); }
  });

  app.get(`${LIB}/:token/films/:filmId`, async (req: Request, res: Response) => {
    try {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Cache-Control", "no-store");
      const l = await libraryFor(String(req.params.token));
      const f = l ? await libraryFilm(l.organization_id, Number(req.params.filmId)) : undefined;
      if (!l || !f) return res.status(404).json({ message: "This film isn't in the library." });
      const urls = (id: number, which: "video" | "poster", download?: boolean) => `${LIB}/${l.token}/films/${f.id}/file/${id}/${which}${download ? "?download=1" : ""}`;
      const [files, notes] = await Promise.all([filesOf(f.id), notesOf(f.id)]);
      res.json({
        film: {
          id: f.id, title: f.title, filmDate: isoOf(f.film_date), kind: f.kind, note: f.note,
          files: files.map((x) => fileOut(x, urls)),
          notes: notes.map((n) => ({ id: n.id, clip: n.clip, atSeconds: Number(n.at_seconds), body: n.body })),
        },
      });
    } catch (e) { console.error("[Performance film] library film failed:", e); res.status(500).json({ message: "Something went wrong." }); }
  });

  app.get(`${LIB}/:token/films/:filmId/file/:fileId/:which`, async (req: Request, res: Response) => {
    try {
      const l = await libraryFor(String(req.params.token));
      const f = l ? await libraryFilm(l.organization_id, Number(req.params.filmId)) : undefined;
      const id = Number(req.params.fileId);
      if (!f || !Number.isInteger(id)) return res.status(404).end();
      const x = await one(`select * from perf_film_files where id = $1 and film_id = $2 and archived_at is null`, [id, f.id]);
      if (!x) return res.status(404).end();
      if (req.params.which === "poster") return x.poster_url ? streamBlob(req, res, x.poster_url, {}) : res.status(404).end();
      return streamBlob(req, res, x.blob_url, { downloadName: req.query.download === "1" ? x.download_name : undefined });
    } catch (e) { console.error("[Performance film] library file failed:", e); if (!res.headersSent) res.status(500).end(); }
  });
}

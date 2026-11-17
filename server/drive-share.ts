// Club Drive sharing — Google-Drive style (16 Nov 2026), grown out of the
// sponsor content links (14 Nov).
//
// Two ways to share a file or folder, from the Share button on the Drive page:
//   • WITH A PERSON — any ClubOS staff login, picked by name. They can open and
//     download it (and everything under a folder), even inside a locked folder.
//     Read only, cannot pass it on. Stored in drive_node_shares; read by
//     sharedReach()/viewableNode() in drive-routes.ts.
//   • ANYONE WITH THE LINK — a public page at app.usg.co.nz/share/<code> that
//     shows those files and nothing else.
//
// 🔴 THE PUBLIC RULE: a link only works for a node that is OPEN (no lock on it
// or any folder above it) or that sits inside "Sponsor Content" (locked to
// staff, built to be shared). Club Drive also holds contracts, payroll and
// children's records, all locked, so none of it can ever go public. Inside a
// shared folder, a locked sub-folder or file is LEFT OUT of the public view.
// `shareableNode()` + `publicOk()` decide, on create AND on every public read,
// so locking a folder or moving it kills its link on the next request.
//
// 🔴 The token is the whole authentication. Every public failure answers the
// same 404. Trashed files are never listed or served. The public side is GETs
// only and touches nothing under /api/admin.
// 🔴 Only someone who can open the node through their OWN access may share it
// (a person it was shared with cannot reshare).
import type { Express } from "express";
import { randomBytes, createHash } from "crypto";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import os from "os";
import { db } from "./db";
import { requireAuth } from "./auth";
import { buildViewer } from "./rambo";
import { readableNode } from "./drive-routes";
import { sendEmail } from "./email";
import { driveStorage } from "./drive-storage";

export const SPONSOR_CONTENT_FOLDER = "Sponsor Content";
const CONTENT_TAB = "sponsorship";
const CONTENT_WORKSPACE = "united-sports-group";

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
// The address a sponsor is given: the club's own domain, the sponsor's name and
// a short code. `media.southislandunited.com` is this same app on another host.
const shareBase = () => process.env.SPONSOR_SHARE_BASE || "https://media.southislandunited.com";
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "content";
const appBase = () => process.env.DRIVE_SHARE_BASE || "https://app.usg.co.nz";
/** A sponsor's folder keeps its sponsor address; everything else is app.usg.co.nz/share/<code>. */
export const shareUrl = (name: string, code: string, sponsor = true) => sponsor ? `${shareBase()}/${slugOf(name)}/${code}` : `${appBase()}/share/${code}`;
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alikes (0 O 1 l I o)
const newShortCode = () => Array.from(randomBytes(12)).map((b) => ALPHABET[b % ALPHABET.length]).join("");

/** The root every shareable folder lives under. Staff-side it is gated like the
 *  contracts folder (Sponsorship tab, United Sports Group). */
export async function ensureSponsorContentRoot(userId: number | null): Promise<number> {
  const ex = rowsOf(await db.execute(sql`SELECT id FROM drive_nodes WHERE parent_id IS NULL AND kind = 'folder' AND lower(name) = lower(${SPONSOR_CONTENT_FOLDER}) AND trashed_at IS NULL LIMIT 1`));
  if (ex[0]) return Number(ex[0].id);
  const ins = rowsOf(await db.execute(sql`
    INSERT INTO drive_nodes (parent_id, kind, name, brand, required_tab, required_workspace, description, owner_user_id, created_by)
    VALUES (NULL, 'folder', ${SPONSOR_CONTENT_FOLDER}, 'all', ${CONTENT_TAB}, ${CONTENT_WORKSPACE},
      'Pictures and videos each sponsor appears in, one folder per sponsor. A folder in here can be shared with the sponsor by link.', ${userId}, ${userId})
    RETURNING id`));
  return Number(ins[0].id);
}

type ShareNode = { id: number; name: string; kind: "folder" | "file"; sponsor: boolean; locked: boolean };

/** A live (not binned) node, whether it sits inside Sponsor Content, and
 *  whether it carries a lock (its own or any folder's above it). */
async function shareableNode(nodeId: number): Promise<ShareNode | null> {
  if (!Number.isFinite(nodeId)) return null;
  const r = rowsOf(await db.execute(sql`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, name, kind, trashed_at, 0 AS depth FROM drive_nodes WHERE id = ${nodeId}
      UNION ALL
      SELECT n.id, n.parent_id, n.name, n.kind, n.trashed_at, up.depth + 1 FROM drive_nodes n JOIN up ON n.id = up.parent_id
    )
    SELECT (SELECT name FROM up WHERE depth = 0) AS name,
           (SELECT kind FROM up WHERE depth = 0) AS kind,
           bool_or(trashed_at IS NOT NULL) AS trashed,
           bool_or(parent_id IS NULL AND depth > 0 AND lower(name) = lower(${SPONSOR_CONTENT_FOLDER})) AS under_root,
           (SELECT cardinality(gates) FROM drive_node_gates WHERE id = ${nodeId}) AS gates
    FROM up`));
  const x = r[0];
  if (!x || !x.kind || x.trashed) return null;
  return { id: nodeId, name: x.name, kind: x.kind, sponsor: !!x.under_root && x.kind === "folder", locked: Number(x.gates ?? 0) > 0 };
}

/** May this node have an "Anyone with the link" page? */
const publicOk = (n: ShareNode) => n.sponsor || !n.locked;
const PUBLIC_REFUSED = "This is in a locked part of the Drive, so it can't be opened by anyone with the link. Share it with people by name instead.";

/** Every live file a link shows: the file itself, or every file under the
 *  folder with the path of folders it sits in. Outside Sponsor Content a file
 *  carrying ANY lock (its own or a sub-folder's) is left out. */
async function filesUnder(root: number | ShareNode): Promise<any[]> {
  const n = typeof root === "number" ? await shareableNode(root) : root;
  if (!n) return [];
  if (n.kind === "file") {
    if (n.locked && !n.sponsor) return [];
    return rowsOf(await db.execute(sql`SELECT id, name, ''::text AS folder, mime_type, size_bytes, storage_key FROM drive_nodes WHERE id = ${n.id} AND storage_key IS NOT NULL AND trashed_at IS NULL`));
  }
  const rows = rowsOf(await db.execute(sql`
    WITH RECURSIVE down AS (
      SELECT id, parent_id, kind, name, ''::text AS folder FROM drive_nodes WHERE parent_id = ${n.id} AND trashed_at IS NULL
      UNION ALL
      SELECT n.id, n.parent_id, n.kind, n.name, CASE WHEN down.folder = '' THEN down.name ELSE down.folder || ' / ' || down.name END
      FROM drive_nodes n JOIN down ON n.parent_id = down.id AND down.kind = 'folder' WHERE n.trashed_at IS NULL
    )
    SELECT d.id, d.name, d.folder, n.mime_type, n.size_bytes, n.storage_key, cardinality(coalesce(g.gates, '{}')) AS gate_count
    FROM down d JOIN drive_nodes n ON n.id = d.id LEFT JOIN drive_node_gates g ON g.id = d.id
    WHERE d.kind = 'file' AND n.storage_key IS NOT NULL
    ORDER BY d.folder, d.name`));
  return n.sponsor ? rows : rows.filter((f) => Number(f.gate_count) === 0);
}

async function liveLink(token: string): Promise<{ id: number; nodeId: number; label: string | null; folder: ShareNode } | null> {
  // Either the long token (links sent before the clean address existed) or the short code.
  const long = /^[A-Za-z0-9_-]{32,80}$/.test(token); const short = /^[A-Za-z0-9]{12,20}$/.test(token);
  if (!long && !short) return null;
  const r = rowsOf(await db.execute(long
    ? sql`SELECT id, node_id, label FROM drive_share_links WHERE token = ${token} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`
    : sql`SELECT id, node_id, label FROM drive_share_links WHERE short_code = ${token} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`));
  if (!r[0]) return null;
  const folder = await shareableNode(Number(r[0].node_id));
  if (!folder || !publicOk(folder)) return null; // locked since it was shared → the link stops working
  return { id: Number(r[0].id), nodeId: Number(r[0].node_id), label: r[0].label, folder };
}

const kindOf = (mime: string | null, name: string) =>
  /^image\//.test(mime || "") || /\.(jpe?g|png|webp|gif)$/i.test(name) ? "image"
  : /^video\//.test(mime || "") || /\.(mp4|mov|m4v)$/i.test(name) ? "video" : "file";

// ── A tiny store-only zip writer (no dependency; pictures and video do not compress) ──
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

const THUMB_DIR = path.join(os.tmpdir(), "drive-share-thumbs");

export function registerDriveShareRoutes(app: Express) {
  const notFound = (res: any) => res.status(404).json({ message: "This link is not available" });
  const noIndex = (res: any) => { res.setHeader("X-Robots-Tag", "noindex, nofollow"); res.setHeader("Referrer-Policy", "no-referrer"); };

  // ── Public: what is in the folder ─────────────────────────────────────────
  app.get("/api/public/drive-share/:token", async (req, res) => {
    try {
      noIndex(res);
      const link = await liveLink(String(req.params.token));
      if (!link) return notFound(res);
      const files = await filesUnder(link.folder);
      // A staff member looking from inside ClubOS is not the sponsor opening it.
      if (req.query.preview !== "1") await db.execute(sql`UPDATE drive_share_links SET view_count = view_count + 1, last_viewed_at = now() WHERE id = ${link.id}`);
      res.setHeader("Cache-Control", "no-store");
      const sc = rowsOf(await db.execute(sql`SELECT short_code FROM drive_share_links WHERE id = ${link.id}`))[0]?.short_code;
      res.json({
        title: link.label || link.folder.name,
        url: sc ? shareUrl(link.folder.name, sc, link.folder.sponsor) : null,
        kind: link.folder.kind,
        sponsor: link.folder.sponsor,
        files: files.map((f) => ({ id: Number(f.id), name: f.name, folder: f.folder || "", kind: kindOf(f.mime_type, f.name), sizeBytes: f.size_bytes === null ? null : Number(f.size_bytes) })),
      });
    } catch (e: any) { console.error("[drive-share] list failed:", e); res.status(500).json({ message: "Something went wrong" }); }
  });

  const fileIn = async (token: string, id: number) => {
    const link = await liveLink(token);
    if (!link || !Number.isFinite(id)) return null;
    const f = (await filesUnder(link.folder)).find((x) => Number(x.id) === id);
    return f ? { link, f } : null;
  };

  // ── Public: one file (redirect to a 5-minute signed URL) ──────────────────
  app.get("/api/public/drive-share/:token/file/:id", async (req, res) => {
    try {
      noIndex(res);
      const hit = await fileIn(String(req.params.token), Number(req.params.id));
      if (!hit) return notFound(res);
      const dl = req.query.dl === "1";
      const url = await driveStorage().signedUrl(hit.f.storage_key, { download: dl ? hit.f.name : undefined, expiresIn: 300 });
      if (dl) await db.execute(sql`UPDATE drive_share_links SET download_count = download_count + 1 WHERE id = ${hit.link.id}`);
      res.redirect(url);
    } catch (e: any) { console.error("[drive-share] file failed:", e); res.status(500).json({ message: "Something went wrong" }); }
  });

  // ── Public: a small picture for the grid (made once, kept on disk) ────────
  app.get("/api/public/drive-share/:token/thumb/:id", async (req, res) => {
    try {
      noIndex(res);
      const hit = await fileIn(String(req.params.token), Number(req.params.id));
      if (!hit || kindOf(hit.f.mime_type, hit.f.name) !== "image") return notFound(res);
      const key = createHash("sha1").update(String(hit.f.storage_key)).digest("hex");
      const file = path.join(THUMB_DIR, `${key}.webp`);
      if (!fs.existsSync(file)) {
        fs.mkdirSync(THUMB_DIR, { recursive: true });
        const buf = await driveStorage().get(hit.f.storage_key);
        await sharp(buf).rotate().resize(640, 640, { fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(file);
      }
      res.setHeader("Content-Type", "image/webp");
      res.setHeader("Cache-Control", "private, max-age=86400");
      fs.createReadStream(file).pipe(res);
    } catch (e: any) { console.error("[drive-share] thumb failed:", e); res.status(500).end(); }
  });

  // ── Public: everything as one zip (optionally one sub-folder) ─────────────
  app.get("/api/public/drive-share/:token/zip", async (req, res) => {
    try {
      noIndex(res);
      const link = await liveLink(String(req.params.token));
      if (!link) return notFound(res);
      const only = typeof req.query.folder === "string" ? req.query.folder : null;
      const files = (await filesUnder(link.folder)).filter((f) => only === null || (f.folder || "") === only);
      if (!files.length) return notFound(res);
      const zipName = `${(link.label || link.folder.name).replace(/[^A-Za-z0-9 _-]+/g, "").trim() || "content"}${only ? " - " + only.replace(/[^A-Za-z0-9 _-]+/g, " ").trim() : ""}.zip`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
      await db.execute(sql`UPDATE drive_share_links SET download_count = download_count + 1 WHERE id = ${link.id}`);
      const central: Buffer[] = []; let offset = 0; const seen = new Set<string>();
      for (const f of files) {
        let name = `${f.folder ? f.folder.replace(/ \/ /g, "/") + "/" : ""}${f.name}`;
        while (seen.has(name)) name = name.replace(/(\.[^./]+)?$/, " (2)$1"); seen.add(name);
        const data = await driveStorage().get(f.storage_key);
        const nameBuf = Buffer.from(name, "utf8"); const crc = crc32(data);
        const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
        local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
        res.write(local); res.write(nameBuf); res.write(data);
        const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(0, 10);
        cen.writeUInt16LE(0, 12); cen.writeUInt16LE(0x21, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28);
        cen.writeUInt32LE(0, 30); cen.writeUInt32LE(0, 34); cen.writeUInt32LE(0, 38); cen.writeUInt32LE(offset, 42);
        central.push(cen, nameBuf); offset += 30 + nameBuf.length + data.length;
      }
      const cd = Buffer.concat(central); const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
      res.write(cd); res.end(end);
    } catch (e: any) { console.error("[drive-share] zip failed:", e); if (!res.headersSent) res.status(500).json({ message: "Something went wrong" }); else res.end(); }
  });

  // ── Staff: who may share this node ────────────────────────────────────────
  // Their OWN access decides (readableNode — gates only, never a share), so a
  // person something was shared with cannot pass it on.
  const staffNode = async (req: any, nodeId: number) => {
    const viewer = await buildViewer(req.session.userId!);
    if (!viewer || !Number.isFinite(nodeId)) return null;
    if (!(await readableNode(viewer, nodeId))) return null;
    const node = await shareableNode(nodeId);
    return node ? { viewer, node } : null;
  };

  // ── Public: the sponsor's one-page report ─────────────────────────────────
  // Numbers for the sponsor whose folder this link opens: the club's own posts
  // that carry the sponsor's label (same name as the folder), CONFIRMED labels
  // only. Nothing is stored; it is added up from the posts each time, so the
  // page is always current. A number a platform did not give is left out of a
  // sum and a total with nothing in it is null (drawn "—"), never 0.
  const PERIODS: Record<string, { label: string; where: string }> = {
    "this-month": { label: "This month", where: "date_trunc('month', d) = date_trunc('month', t)" },
    "last-month": { label: "Last month", where: "date_trunc('month', d) = date_trunc('month', t) - interval '1 month'" },
    "last-90": { label: "Last 90 days", where: "d > t - 90" },
    "ytd": { label: "This year so far", where: "date_trunc('year', d) = date_trunc('year', t)" },
    "all": { label: "All time", where: "true" },
  };
  const reportLabel = async (folderName: string) => rowsOf(await db.execute(sql`
    SELECT l.id, l.name, p.logo_url, p.logo_ground FROM social_labels l LEFT JOIN sponsorship_partners p ON p.id = l.partner_id
    WHERE l.kind = 'sponsor' AND l.archived_at IS NULL AND lower(l.name) = lower(${folderName}) LIMIT 1`))[0] ?? null;

  app.get("/api/public/drive-share/:token/report", async (req, res) => {
    try {
      noIndex(res);
      const link = await liveLink(String(req.params.token));
      if (!link) return notFound(res);
      const key = typeof req.query.period === "string" && PERIODS[req.query.period] ? req.query.period : "ytd";
      const label = link.folder.sponsor ? await reportLabel(link.folder.name) : null;
      res.setHeader("Cache-Control", "no-store");
      if (!label) return res.json({ sponsor: link.folder.name, available: false, period: key, periods: Object.entries(PERIODS).map(([k, v]) => ({ key: k, label: v.label })) });
      const base = sql`
        WITH x AS (
          SELECT p.id, a.platform, a.brand, p.views, p.likes, p.comments, p.shares, p.saves, p.permalink, p.kind,
                 (p.posted_at AT TIME ZONE 'Pacific/Auckland')::date AS d, (now() AT TIME ZONE 'Pacific/Auckland')::date AS t,
                 cardinality(coalesce(p.collab_with, '{}')) > 0 AS collab
          FROM social_post_labels pl JOIN social_posts p ON p.id = pl.post_id JOIN social_accounts a ON a.id = p.account_id
          WHERE pl.label_id = ${Number(label.id)} AND pl.confirmed_at IS NOT NULL
        ), w AS (SELECT * FROM x WHERE ${sql.raw(PERIODS[key].where)})`;
      const tot = rowsOf(await db.execute(sql`${base}
        SELECT count(*)::int AS posts, sum(views)::bigint AS views, sum(likes)::bigint AS likes, sum(comments)::bigint AS comments, sum(shares)::bigint AS shares, sum(saves)::bigint AS saves,
               count(*) FILTER (WHERE collab)::int AS collab_posts, sum(views) FILTER (WHERE collab)::bigint AS collab_views,
               to_char(min(d), 'YYYY-MM-DD') AS first_day, to_char(max(t), 'YYYY-MM-DD') AS today FROM w`))[0];
      const plat = rowsOf(await db.execute(sql`${base} SELECT platform, count(*)::int AS posts, sum(views)::bigint AS views FROM w GROUP BY 1 ORDER BY 3 DESC NULLS LAST`));
      const months = rowsOf(await db.execute(sql`${base} SELECT to_char(date_trunc('month', d), 'YYYY-MM') AS month, count(*)::int AS posts, sum(views)::bigint AS views FROM w GROUP BY 1 ORDER BY 1`));
      const top = rowsOf(await db.execute(sql`${base} SELECT id, platform, kind, views, permalink, to_char(d, 'YYYY-MM-DD') AS day FROM w WHERE views IS NOT NULL ORDER BY views DESC LIMIT 6`));
      const today = rowsOf(await db.execute(sql`SELECT to_char((now() AT TIME ZONE 'Pacific/Auckland')::date, 'YYYY-MM-DD') AS d`))[0].d;
      const n = (v: any) => (v === null || v === undefined ? null : Number(v));
      const parts = [n(tot.likes), n(tot.comments), n(tot.shares), n(tot.saves)].filter((v) => v !== null) as number[];
      res.json({
        sponsor: label.name, available: true, logoUrl: label.logo_url ?? null, logoGround: label.logo_ground ?? null,
        period: key, periodLabel: PERIODS[key].label, periods: Object.entries(PERIODS).map(([k, v]) => ({ key: k, label: v.label })), today,
        totals: { posts: Number(tot.posts), views: n(tot.views), likes: n(tot.likes), comments: n(tot.comments), shares: n(tot.shares), saves: n(tot.saves),
          engagements: parts.length ? parts.reduce((a, b) => a + b, 0) : null, collabPosts: Number(tot.collab_posts), collabViews: n(tot.collab_views) },
        byPlatform: plat.map((r) => ({ platform: r.platform, posts: Number(r.posts), views: n(r.views) })),
        byMonth: months.map((r) => ({ month: r.month, posts: Number(r.posts), views: n(r.views) })),
        topPosts: top.map((r) => ({ id: Number(r.id), platform: r.platform, kind: r.kind, views: n(r.views), day: r.day, permalink: r.permalink })),
      });
    } catch (e: any) { console.error("[drive-share] report failed:", e); res.status(500).json({ message: "Something went wrong" }); }
  });

  // The picture of one of the sponsor's own labelled posts (for the report).
  app.get("/api/public/drive-share/:token/post/:postId/picture", async (req, res) => {
    try {
      noIndex(res);
      const link = await liveLink(String(req.params.token)); const postId = Number(req.params.postId);
      if (!link || !Number.isFinite(postId)) return notFound(res);
      const label = link.folder.sponsor ? await reportLabel(link.folder.name) : null;
      const okRow = label ? rowsOf(await db.execute(sql`SELECT 1 FROM social_post_labels WHERE post_id = ${postId} AND label_id = ${Number(label.id)} AND confirmed_at IS NOT NULL LIMIT 1`))[0] : null;
      if (!okRow) return notFound(res);
      const { smallThumb } = await import("./social/routes");
      const buf = await smallThumb(postId, "large");
      if (!buf) return res.status(404).end();
      res.setHeader("Content-Type", "image/webp"); res.setHeader("Cache-Control", "private, max-age=86400"); res.end(buf);
    } catch (e: any) { console.error("[drive-share] post picture failed:", e); res.status(500).end(); }
  });

  // ── Staff: every sponsor's content folder in one list ─────────────────────
  // Used by Sponsorship → Content and Marketing → Social media → Labels.
  // Whoever cannot read the Sponsor Content root in the Drive gets an empty list.
  app.get("/api/admin/sponsor-content", requireAuth, async (req: any, res) => {
    try {
      const viewer = await buildViewer(req.session.userId!);
      const root = rowsOf(await db.execute(sql`SELECT id FROM drive_nodes WHERE parent_id IS NULL AND kind = 'folder' AND lower(name) = lower(${SPONSOR_CONTENT_FOLDER}) AND trashed_at IS NULL LIMIT 1`))[0];
      if (!viewer || !root || !(await readableNode(viewer, Number(root.id)))) return res.json({ rootId: null, sponsors: [] });
      const folders = rowsOf(await db.execute(sql`SELECT id, name FROM drive_nodes WHERE parent_id = ${Number(root.id)} AND kind = 'folder' AND trashed_at IS NULL ORDER BY lower(name)`));
      const sponsors: any[] = [];
      for (const f of folders) {
        const files = await filesUnder(Number(f.id));
        const l = rowsOf(await db.execute(sql`SELECT token, short_code, view_count, download_count, last_viewed_at FROM drive_share_links WHERE node_id = ${Number(f.id)} AND revoked_at IS NULL LIMIT 1`))[0];
        const covers = files.filter((x) => kindOf(x.mime_type, x.name) === "image").slice(0, 3).map((x) => Number(x.id));
        sponsors.push({
          nodeId: Number(f.id), name: f.name, files: files.length,
          pictures: files.filter((x) => kindOf(x.mime_type, x.name) === "image").length,
          videos: files.filter((x) => kindOf(x.mime_type, x.name) === "video").length,
          sizeBytes: files.reduce((n, x) => n + Number(x.size_bytes ?? 0), 0),
          link: l ? { token: l.token, url: shareUrl(f.name, l.short_code, true), views: Number(l.view_count), downloads: Number(l.download_count), lastViewedAt: l.last_viewed_at } : null,
          covers,
        });
      }
      res.json({ rootId: Number(root.id), sponsors });
    } catch (e: any) { console.error("[sponsor-content] list failed:", e); res.status(500).json({ message: e.message }); }
  });

  const shareState = async (node: ShareNode) => {
    const l = rowsOf(await db.execute(sql`SELECT short_code, created_at, view_count, download_count, last_viewed_at FROM drive_share_links WHERE node_id = ${node.id} AND revoked_at IS NULL LIMIT 1`))[0];
    const people = rowsOf(await db.execute(sql`
      SELECT s.user_id, s.created_at, u.first_name, u.last_name, u.email, u.avatar_url,
             trim(coalesce(g.first_name,'') || ' ' || coalesce(g.last_name,'')) AS granted_by
      FROM drive_node_shares s JOIN users u ON u.id = s.user_id LEFT JOIN users g ON g.id = s.granted_by
      WHERE s.node_id = ${node.id} AND s.revoked_at IS NULL ORDER BY s.created_at`));
    const gateLabel = rowsOf(await db.execute(sql`SELECT gates FROM drive_node_gates WHERE id = ${node.id}`))[0]?.gates ?? [];
    return {
      node: { id: node.id, name: node.name, kind: node.kind },
      // Who can already open it without being added.
      everyone: node.locked ? "Only staff who hold its lock can open it" : "Everyone with a ClubOS staff login can open it",
      locked: node.locked, gates: gateLabel,
      publicAllowed: publicOk(node), publicRefusedReason: publicOk(node) ? null : PUBLIC_REFUSED,
      // kept for the older share bar
      shareable: publicOk(node),
      link: l ? { url: shareUrl(node.name, l.short_code, node.sponsor), createdAt: l.created_at, views: Number(l.view_count), downloads: Number(l.download_count), lastViewedAt: l.last_viewed_at } : null,
      people: people.map((p) => ({ userId: Number(p.user_id), name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(), email: p.email, avatarUrl: p.avatar_url, grantedBy: p.granted_by || null, sharedAt: p.created_at })),
    };
  };

  app.get("/api/admin/drive/share/:nodeId", requireAuth, async (req: any, res) => {
    try {
      const s = await staffNode(req, Number(req.params.nodeId));
      if (!s) return res.status(404).json({ message: "Not found" });
      res.json(await shareState(s.node));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Anyone with the link: on.
  app.post("/api/admin/drive/share/:nodeId", requireAuth, async (req: any, res) => {
    try {
      const s = await staffNode(req, Number(req.params.nodeId));
      if (!s) return res.status(404).json({ message: "Not found" });
      if (!publicOk(s.node)) return res.status(400).json({ message: PUBLIC_REFUSED });
      await createShareLink(s.node.id, s.viewer.userId);
      await db.execute(sql`INSERT INTO drive_access_log (node_id, user_id, action, detail) VALUES (${s.node.id}, ${s.viewer.userId}, 'share-link-on', ${s.node.name})`).catch(() => {});
      res.json(await shareState(s.node));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Anyone with the link: off (restricted).
  app.delete("/api/admin/drive/share/:nodeId", requireAuth, async (req: any, res) => {
    try {
      const s = await staffNode(req, Number(req.params.nodeId));
      if (!s) return res.status(404).json({ message: "Not found" });
      await db.execute(sql`UPDATE drive_share_links SET revoked_at = now(), revoked_by = ${s.viewer.userId} WHERE node_id = ${s.node.id} AND revoked_at IS NULL`);
      await db.execute(sql`INSERT INTO drive_access_log (node_id, user_id, action, detail) VALUES (${s.node.id}, ${s.viewer.userId}, 'share-link-off', ${s.node.name})`).catch(() => {});
      res.json(await shareState(s.node));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Staff a node can be shared with: an ACTIVE login that belongs to the club
  // (a super admin or a member of at least one workspace). Fan/parent accounts
  // never appear.
  const staffWhere = sql`u.active = true AND (u.role = 'super_admin' OR EXISTS (SELECT 1 FROM user_organizations uo WHERE uo.user_id = u.id))`;
  app.get("/api/admin/drive/share-people", requireAuth, async (req: any, res) => {
    try {
      const q = String(req.query.q ?? "").trim().toLowerCase().slice(0, 80);
      const like = `%${q}%`;
      const rows = rowsOf(await db.execute(sql`
        SELECT u.id, u.first_name, u.last_name, u.email, u.avatar_url FROM users u
        WHERE ${staffWhere} AND u.id <> ${req.session.userId}
          AND (${q} = '' OR lower(u.first_name || ' ' || coalesce(u.last_name,'')) LIKE ${like} OR lower(u.email) LIKE ${like})
          AND u.email NOT ILIKE '%@resend.dev' AND u.email NOT ILIKE '%@example.%' AND u.email NOT ILIKE 'verify%'
        ORDER BY u.first_name, u.last_name LIMIT 20`));
      res.json({ people: rows.map((u) => ({ userId: Number(u.id), name: `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim(), email: u.email, avatarUrl: u.avatar_url })) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Share with a person.
  app.post("/api/admin/drive/share/:nodeId/people", requireAuth, async (req: any, res) => {
    try {
      const s = await staffNode(req, Number(req.params.nodeId));
      if (!s) return res.status(404).json({ message: "Not found" });
      const userId = Number(req.body?.userId);
      const u = rowsOf(await db.execute(sql`SELECT u.id, u.first_name, u.email FROM users u WHERE u.id = ${userId} AND ${staffWhere}`))[0];
      if (!u) return res.status(400).json({ message: "Pick someone with a ClubOS staff login" });
      if (userId === s.viewer.userId) return res.status(400).json({ message: "You already have access" });
      const ins = rowsOf(await db.execute(sql`
        INSERT INTO drive_node_shares (node_id, user_id, granted_by)
        SELECT ${s.node.id}, ${userId}, ${s.viewer.userId}
        WHERE NOT EXISTS (SELECT 1 FROM drive_node_shares WHERE node_id = ${s.node.id} AND user_id = ${userId} AND revoked_at IS NULL)
        RETURNING id`));
      if (ins[0]) {
        await db.execute(sql`INSERT INTO drive_access_log (node_id, user_id, action, detail) VALUES (${s.node.id}, ${s.viewer.userId}, 'share-person', ${`${s.node.name} → user ${userId}`})`).catch(() => {});
        // Tell them, like Google does. Best effort: a failed email never undoes the share.
        const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 1000) : "";
        const href = `${appBase()}/admin/drive?${s.node.kind === "folder" ? `folder=${s.node.id}` : `file=${s.node.id}`}`;
        const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
        sendEmail({
          to: u.email, from: "ClubOS Drive <noreply@cufc.co.nz>",
          subject: `${s.viewer.name} shared "${s.node.name}" with you`,
          html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#161616">
            <p style="font-size:15px">Hi ${esc(u.first_name ?? "there")},</p>
            <p style="font-size:15px"><b>${esc(s.viewer.name)}</b> shared a ${s.node.kind} with you in ClubOS Drive:</p>
            <p style="font-size:17px;font-weight:600;margin:16px 0">${esc(s.node.name)}</p>
            ${message ? `<p style="font-size:15px;border-left:3px solid #ddd;padding-left:12px;color:#444">${esc(message).replace(/\n/g, "<br>")}</p>` : ""}
            <p style="margin:24px 0"><a href="${href}" style="background:#22399B;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px">Open in Drive</a></p>
            <p style="font-size:13px;color:#666">You'll also find it under "Shared with you" at the top of Drive.</p></div>`,
        }).catch(() => {});
      }
      res.json(await shareState(s.node));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Remove a person's access.
  app.delete("/api/admin/drive/share/:nodeId/people/:userId", requireAuth, async (req: any, res) => {
    try {
      const s = await staffNode(req, Number(req.params.nodeId));
      if (!s) return res.status(404).json({ message: "Not found" });
      await db.execute(sql`UPDATE drive_node_shares SET revoked_at = now(), revoked_by = ${s.viewer.userId} WHERE node_id = ${s.node.id} AND user_id = ${Number(req.params.userId)} AND revoked_at IS NULL`);
      await db.execute(sql`INSERT INTO drive_access_log (node_id, user_id, action, detail) VALUES (${s.node.id}, ${s.viewer.userId}, 'unshare-person', ${`${s.node.name} → user ${req.params.userId}`})`).catch(() => {});
      res.json(await shareState(s.node));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}

/** The node's one live link (made if there is none). */
export async function createShareLink(nodeId: number, userId: number | null): Promise<{ token: string; shortCode: string; url: string }> {
  const node = await shareableNode(nodeId);
  if (!node || !publicOk(node)) throw new Error(PUBLIC_REFUSED);
  const ex = rowsOf(await db.execute(sql`SELECT token, short_code FROM drive_share_links WHERE node_id = ${nodeId} AND revoked_at IS NULL LIMIT 1`));
  if (ex[0]) return { token: ex[0].token, shortCode: ex[0].short_code, url: shareUrl(node.name, ex[0].short_code, node.sponsor) };
  const token = randomBytes(32).toString("base64url"); const shortCode = newShortCode();
  await db.execute(sql`INSERT INTO drive_share_links (token, short_code, node_id, label, created_by) VALUES (${token}, ${shortCode}, ${nodeId}, ${node.name}, ${userId})`);
  return { token, shortCode, url: shareUrl(node.name, shortCode, node.sponsor) };
}

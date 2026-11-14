// Club Drive share links — one folder, read-only, for someone outside the club.
//
// Built 14 Nov 2026 for sponsor content packs: every sponsor gets a folder of
// the pictures and videos they appear in, and a private link to it.
//
// 🔴 THE ONE RULE: a link only ever works for a folder inside the
// "Sponsor Content" root. `shareableFolder()` is the one decider and it runs on
// create AND on every public read, so moving a shared folder out of that root
// kills its link on the next request. Club Drive also holds contracts, payroll
// and children's records; a share feature that could point anywhere would be
// the biggest hole in the building.
//
// 🔴 The token is the whole authentication (32 random bytes). Every public
// failure answers the same 404. Trashed files are never listed or served.
// 🔴 Nothing here can write: the public side has GETs only.
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
import { driveStorage } from "./drive-storage";

export const SPONSOR_CONTENT_FOLDER = "Sponsor Content";
const CONTENT_TAB = "sponsorship";
const CONTENT_WORKSPACE = "united-sports-group";

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const publicBase = () => process.env.PUBLIC_APP_URL || "https://app.usg.co.nz";
export const shareUrl = (token: string) => `${publicBase()}/share/${token}`;

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

/** Is this node a live FOLDER strictly inside the Sponsor Content root? */
async function shareableFolder(nodeId: number): Promise<{ id: number; name: string } | null> {
  const r = rowsOf(await db.execute(sql`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, name, kind, trashed_at, 0 AS depth FROM drive_nodes WHERE id = ${nodeId}
      UNION ALL
      SELECT n.id, n.parent_id, n.name, n.kind, n.trashed_at, up.depth + 1 FROM drive_nodes n JOIN up ON n.id = up.parent_id
    )
    SELECT (SELECT name FROM up WHERE depth = 0) AS name,
           (SELECT kind FROM up WHERE depth = 0) AS kind,
           bool_or(trashed_at IS NOT NULL) AS trashed,
           bool_or(parent_id IS NULL AND depth > 0 AND lower(name) = lower(${SPONSOR_CONTENT_FOLDER})) AS under_root
    FROM up`));
  const x = r[0];
  if (!x || x.kind !== "folder" || x.trashed || !x.under_root) return null;
  return { id: nodeId, name: x.name };
}

/** Every live file under a shared folder, with the path of folders it sits in. */
async function filesUnder(rootId: number): Promise<any[]> {
  return rowsOf(await db.execute(sql`
    WITH RECURSIVE down AS (
      SELECT id, parent_id, kind, name, ''::text AS folder FROM drive_nodes WHERE parent_id = ${rootId} AND trashed_at IS NULL
      UNION ALL
      SELECT n.id, n.parent_id, n.kind, n.name, CASE WHEN down.folder = '' THEN down.name ELSE down.folder || ' / ' || down.name END
      FROM drive_nodes n JOIN down ON n.parent_id = down.id AND down.kind = 'folder' WHERE n.trashed_at IS NULL
    )
    SELECT d.id, d.name, d.folder, n.mime_type, n.size_bytes, n.storage_key
    FROM down d JOIN drive_nodes n ON n.id = d.id
    WHERE d.kind = 'file' AND n.storage_key IS NOT NULL
    ORDER BY d.folder, d.name`));
}

async function liveLink(token: string): Promise<{ id: number; nodeId: number; label: string | null; folder: { id: number; name: string } } | null> {
  if (!/^[A-Za-z0-9_-]{32,80}$/.test(token)) return null;
  const r = rowsOf(await db.execute(sql`SELECT id, node_id, label FROM drive_share_links WHERE token = ${token} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`));
  if (!r[0]) return null;
  const folder = await shareableFolder(Number(r[0].node_id));
  if (!folder) return null;
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
      const files = await filesUnder(link.nodeId);
      await db.execute(sql`UPDATE drive_share_links SET view_count = view_count + 1, last_viewed_at = now() WHERE id = ${link.id}`);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        title: link.label || link.folder.name,
        files: files.map((f) => ({ id: Number(f.id), name: f.name, folder: f.folder || "", kind: kindOf(f.mime_type, f.name), sizeBytes: f.size_bytes === null ? null : Number(f.size_bytes) })),
      });
    } catch (e: any) { console.error("[drive-share] list failed:", e); res.status(500).json({ message: "Something went wrong" }); }
  });

  const fileIn = async (token: string, id: number) => {
    const link = await liveLink(token);
    if (!link || !Number.isFinite(id)) return null;
    const f = (await filesUnder(link.nodeId)).find((x) => Number(x.id) === id);
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
      const files = (await filesUnder(link.nodeId)).filter((f) => only === null || (f.folder || "") === only);
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

  // ── Staff: the link on a folder (read · create · switch off) ──────────────
  const staffFolder = async (req: any, nodeId: number) => {
    const viewer = await buildViewer(req.session.userId!);
    if (!viewer || !Number.isFinite(nodeId)) return null;
    const node = await readableNode(viewer, nodeId); // the folder's own gates decide who may share it
    if (!node) return null;
    const folder = await shareableFolder(nodeId);
    return folder ? { viewer, folder } : { viewer, folder: null };
  };

  app.get("/api/admin/drive/share/:nodeId", requireAuth, async (req: any, res) => {
    try {
      const s = await staffFolder(req, Number(req.params.nodeId));
      if (!s) return res.status(404).json({ message: "Not found" });
      if (!s.folder) return res.json({ shareable: false, link: null });
      const r = rowsOf(await db.execute(sql`SELECT token, created_at, view_count, download_count, last_viewed_at FROM drive_share_links WHERE node_id = ${s.folder.id} AND revoked_at IS NULL LIMIT 1`));
      res.json({ shareable: true, link: r[0] ? { url: shareUrl(r[0].token), createdAt: r[0].created_at, views: Number(r[0].view_count), downloads: Number(r[0].download_count), lastViewedAt: r[0].last_viewed_at } : null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/admin/drive/share/:nodeId", requireAuth, async (req: any, res) => {
    try {
      const s = await staffFolder(req, Number(req.params.nodeId));
      if (!s) return res.status(404).json({ message: "Not found" });
      if (!s.folder) return res.status(400).json({ message: "Only a folder inside Sponsor Content can be shared by link" });
      const link = await createShareLink(s.folder.id, s.viewer.userId);
      res.json({ shareable: true, link: { url: shareUrl(link.token), views: 0, downloads: 0 } });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/admin/drive/share/:nodeId", requireAuth, async (req: any, res) => {
    try {
      const s = await staffFolder(req, Number(req.params.nodeId));
      if (!s) return res.status(404).json({ message: "Not found" });
      await db.execute(sql`UPDATE drive_share_links SET revoked_at = now(), revoked_by = ${s.viewer.userId} WHERE node_id = ${Number(req.params.nodeId)} AND revoked_at IS NULL`);
      res.json({ shareable: !!s.folder, link: null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}

/** The folder's one live link (made if there is none). */
export async function createShareLink(nodeId: number, userId: number | null): Promise<{ token: string }> {
  const folder = await shareableFolder(nodeId);
  if (!folder) throw new Error("Only a folder inside Sponsor Content can be shared by link");
  const ex = rowsOf(await db.execute(sql`SELECT token FROM drive_share_links WHERE node_id = ${nodeId} AND revoked_at IS NULL LIMIT 1`));
  if (ex[0]) return { token: ex[0].token };
  const token = randomBytes(32).toString("base64url");
  await db.execute(sql`INSERT INTO drive_share_links (token, node_id, label, created_by) VALUES (${token}, ${nodeId}, ${folder.name}, ${userId})`);
  return { token };
}

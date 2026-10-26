// ── Pictures in the Mailer — upload, shrink, host ────────────────────────────
//
// Daniel, 2026-10-26: "We need to be able to do the file upload and then also
// need to figure out a way so that it doesn't become big and slow to load.
// Maybe something in our email builder that's going to be able to just
// compress it or format it in the right way (or whatever is industry
// standard)."
//
// The standard, built: a picture is HOSTED, never embedded. On the way in it is
// rotated upright (EXIF orientation), stripped of camera/GPS data (sharp drops
// metadata unless asked to keep it), shrunk to fit 1200×1800 (the 600px body at
// retina), and re-encoded — progressive JPEG for a photo with the quality
// stepped down until it weighs ≤250KB, a palette PNG for anything with
// transparency, GIF kept as GIF. The bytes are stored in Postgres behind ONE
// adapter (storeMailerImage / readMailerImage) and served from
// https://app.usg.co.nz/mailer/img/<key>.<ext> with a year-long immutable
// cache. The key is the output's own SHA-256, so the same picture twice is one
// row and the address cannot be guessed.
//
// 🔴 Not the Supabase bucket Club Drive uses — that project is egress-restricted
// and has answered 402 twice. When R2 keys exist, swap the two adapter
// functions; nothing else changes. The rules themselves are pure and proven in
// shared/mailer-images.ts + script/_test-mailer-images.ts.

import type { Express, Request, Response } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { requireTab } from "./auth";
import { shrinkForEmail, type ShrunkImage } from "./mailer-image-shrink";
import {
  MAILER_IMAGE_MAX_UPLOAD_BYTES,
  MAILER_IMAGE_MIME,
  describeShrink,
  mailerImageKey,
  mailerImageUrl,
  parseMailerImageFile,
  type MailerImageFormat,
} from "@shared/mailer-images";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAILER_IMAGE_MAX_UPLOAD_BYTES, files: 1 } });
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

/** The organisation behind the workspace header (requireTab has already
 *  proved the caller may use the Mailer there). */
async function orgIdFor(req: Request): Promise<number | null> {
  const slug = String(req.headers["x-workspace-slug"] || "");
  if (!slug) return null;
  const r = rowsOf(await db.execute(sql`SELECT id FROM organizations WHERE slug = ${slug} LIMIT 1`));
  return r[0] ? Number(r[0].id) : null;
}

// ── Store / read — the adapter R2 would replace ───────────────────────────────

export interface StoredMailerImage {
  key: string;
  url: string;
  format: MailerImageFormat;
  width: number;
  height: number;
  bytes: number;
  existed: boolean;
}

export async function storeMailerImage(args: {
  orgId: number;
  userId: number | null;
  originalName: string | null;
  originalBytes: number | null;
  image: ShrunkImage;
}): Promise<StoredMailerImage> {
  const { image } = args;
  const key = mailerImageKey(createHash("sha256").update(image.data).digest("hex"));
  const mime = MAILER_IMAGE_MIME[image.format];
  const inserted = rowsOf(await db.execute(sql`
    INSERT INTO mailer_images (organization_id, uploaded_by, key, mime, width, height, bytes, data, original_name, original_bytes)
    VALUES (${args.orgId}, ${args.userId}, ${key}, ${mime}, ${image.width}, ${image.height}, ${image.data.length}, ${image.data}, ${args.originalName}, ${args.originalBytes})
    ON CONFLICT (key) DO NOTHING
    RETURNING id`));
  return { key, url: mailerImageUrl(key, image.format), format: image.format, width: image.width, height: image.height, bytes: image.data.length, existed: inserted.length === 0 };
}

export async function readMailerImage(key: string): Promise<{ mime: string; data: Buffer; bytes: number } | null> {
  const r = rowsOf(await db.execute(sql`SELECT mime, bytes, data FROM mailer_images WHERE key = ${key} LIMIT 1`));
  if (!r[0]) return null;
  const data: Buffer = Buffer.isBuffer(r[0].data) ? r[0].data : Buffer.from(r[0].data);
  return { mime: String(r[0].mime), data, bytes: Number(r[0].bytes) };
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function registerMailerImageRoutes(app: Express) {
  const gate = requireTab("mailer");

  /** The workspace's recent uploads — the start of a media library, and the
   *  deploy canary for this feature. */
  app.get("/api/admin/mailer/images", gate, async (req: Request, res: Response) => {
    try {
      const org = await orgIdFor(req);
      if (!org) return res.status(400).json({ message: "Unknown workspace" });
      const rows = rowsOf(await db.execute(sql`
        SELECT key, mime, width, height, bytes, original_name, created_at
        FROM mailer_images WHERE organization_id = ${org}
        ORDER BY created_at DESC LIMIT 50`));
      res.json({
        images: rows.map((r) => {
          const format: MailerImageFormat = r.mime === "image/png" ? "png" : r.mime === "image/gif" ? "gif" : "jpeg";
          return { key: r.key, url: mailerImageUrl(r.key, format), width: r.width, height: r.height, bytes: r.bytes, name: r.original_name, createdAt: r.created_at };
        }),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post(
    "/api/admin/mailer/images",
    gate,
    (req: Request, res: Response, next) =>
      upload.single("file")(req, res, (err: any) => {
        if (!err) return next();
        const tooBig = err?.code === "LIMIT_FILE_SIZE";
        res.status(400).json({ ok: false, message: tooBig ? `That file is over ${Math.round(MAILER_IMAGE_MAX_UPLOAD_BYTES / 1024 / 1024)}MB. Export a smaller copy and try again.` : (err?.message || "Upload failed") });
      }),
    async (req: Request, res: Response) => {
      try {
        const org = await orgIdFor(req);
        if (!org) return res.status(400).json({ ok: false, message: "Unknown workspace" });
        const file = (req as any).file as { buffer: Buffer; mimetype: string; originalname: string; size: number } | undefined;
        if (!file || !file.buffer?.length) return res.status(400).json({ ok: false, message: "No file arrived. Pick a picture and try again." });
        const started = Date.now();
        const shrunk = await shrinkForEmail(file.buffer);
        if (!shrunk.ok) return res.status(400).json({ ok: false, message: shrunk.message });
        const stored = await storeMailerImage({
          orgId: org,
          userId: req.session.userId ?? null,
          originalName: (file.originalname || "").slice(0, 200) || null,
          originalBytes: file.size ?? file.buffer.length,
          image: shrunk.image,
        });
        res.json({
          ok: true,
          url: stored.url,
          key: stored.key,
          format: stored.format,
          width: stored.width,
          height: stored.height,
          bytes: stored.bytes,
          originalBytes: file.buffer.length,
          reason: shrunk.image.reason,
          quality: shrunk.image.quality,
          note: describeShrink(file.buffer.length, stored.bytes),
          ms: Date.now() - started,
        });
      } catch (e: any) {
        res.status(500).json({ ok: false, message: e.message });
      }
    },
  );

  /** Public, cookie-less: mail clients and their image proxies fetch this. The
   *  address is content-addressed and unguessable; the answer never changes,
   *  so it is cached for a year. */
  app.get("/mailer/img/:file", async (req: Request, res: Response) => {
    const parsed = parseMailerImageFile(String(req.params.file || ""));
    if (!parsed) return res.status(404).end();
    try {
      const img = await readMailerImage(parsed.key);
      if (!img) return res.status(404).end();
      const etag = `"${parsed.key}"`;
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("ETag", etag);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.headers["if-none-match"] === etag) return res.status(304).end();
      res.setHeader("Content-Type", img.mime);
      res.setHeader("Content-Length", String(img.data.length));
      res.status(200).end(img.data);
    } catch (e: any) {
      res.status(500).end();
    }
  });
}

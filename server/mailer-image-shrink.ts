// ── One picture in, one email-ready picture out (the sharp pipeline) ─────────
//
// Kept apart from the routes and the database so a script can prove it on a
// real JPEG without a connection: script/_test-mailer-images.ts feeds it a
// 4000×3000 photo, a sideways phone photo, a transparent logo and an SVG.
// The DECISIONS (what becomes what, how wide) are pure in shared/mailer-images.ts;
// this file only carries them out.

import sharp from "sharp";
import {
  MAILER_IMAGE_JPEG_MIN_QUALITY,
  MAILER_IMAGE_JPEG_QUALITY,
  MAILER_IMAGE_STORED_MAX_BYTES,
  MAILER_IMAGE_TARGET_BYTES,
  planMailerImage,
  type MailerImageFormat,
} from "@shared/mailer-images";

export interface ShrunkImage {
  format: MailerImageFormat;
  width: number;
  height: number;
  data: Buffer;
  /** Why this format, for the note under the picker. */
  reason: string;
  /** JPEG quality that reached the target (null for PNG/GIF). */
  quality: number | null;
}

const PIXEL_LIMIT = 100_000_000; // a decompression bomb stops here

export async function shrinkForEmail(input: Buffer): Promise<{ ok: true; image: ShrunkImage } | { ok: false; message: string }> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { animated: true, limitInputPixels: PIXEL_LIMIT }).metadata();
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (/heif|heic/i.test(msg)) return { ok: false, message: "HEIC photos from an iPhone need converting first — share it as a JPEG (Photos → Export, or AirDrop with 'Most compatible')." };
    return { ok: false, message: "That file couldn't be read as a picture. Upload a JPEG, PNG or GIF." };
  }
  const pages = meta.pages ?? 1;
  // An EXIF orientation of 5–8 means the stored pixels lie on their side: once
  // .rotate() stands the picture up, width and height swap.
  const sideways = (meta.orientation ?? 1) >= 5;
  const rawW = meta.width ?? 0;
  const rawH = pages > 1 ? (meta.pageHeight ?? meta.height ?? 0) : (meta.height ?? 0);
  const planned = planMailerImage({
    format: String(meta.format || ""),
    width: sideways ? rawH : rawW,
    height: sideways ? rawW : rawH,
    hasAlpha: !!meta.hasAlpha,
    pages,
    bytes: input.length,
  });
  if (!planned.ok) return planned;
  const { plan } = planned;

  // sharp drops EXIF/ICC/XMP unless withMetadata() is called — which is the
  // point: no camera serial, no GPS, in a picture that goes to 4,000 inboxes.
  const base = () =>
    sharp(input, { animated: plan.format === "gif", limitInputPixels: PIXEL_LIMIT })
      .rotate()
      .resize({ width: plan.width, height: plan.height, fit: "inside", withoutEnlargement: true });

  try {
    if (plan.format === "jpeg") {
      let quality = MAILER_IMAGE_JPEG_QUALITY;
      const encode = () => base().flatten({ background: "#ffffff" }).jpeg({ quality, progressive: true, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      let out = await encode();
      while (out.data.length > MAILER_IMAGE_TARGET_BYTES && quality - 6 >= MAILER_IMAGE_JPEG_MIN_QUALITY) {
        quality -= 6;
        out = await encode();
      }
      return { ok: true, image: { format: "jpeg", width: out.info.width, height: out.info.height, data: out.data, reason: plan.reason, quality } };
    }
    if (plan.format === "png") {
      const out = await base().png({ palette: true, quality: 85, compressionLevel: 9, effort: 7 }).toBuffer({ resolveWithObject: true });
      return { ok: true, image: { format: "png", width: out.info.width, height: out.info.height, data: out.data, reason: plan.reason, quality: null } };
    }
    const out = await base().gif({ effort: 7 }).toBuffer({ resolveWithObject: true });
    if (out.data.length > MAILER_IMAGE_STORED_MAX_BYTES) {
      return { ok: false, message: `That animated GIF is still ${Math.round((out.data.length / 1024 / 1024) * 10) / 10}MB after shrinking — too heavy for an email. Shorten it or use a still picture.` };
    }
    // sharp reports an animated GIF's height as every frame stacked; pageHeight is one frame.
    const h = (out.info as any).pageHeight ?? out.info.height;
    return { ok: true, image: { format: "gif", width: out.info.width, height: h, data: out.data, reason: plan.reason, quality: null } };
  } catch (e: any) {
    return { ok: false, message: `That picture couldn't be converted (${String(e?.message || "unknown error").slice(0, 120)}). Try exporting it as a JPEG or PNG.` };
  }
}

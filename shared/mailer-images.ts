// ── Pictures in an email — the rules the server shrinks by and the browser links to ─
//
// Daniel, 2026-10-26: "We need to be able to do the file upload and then also
// need to figure out a way so that it doesn't become big and slow to load …
// compress it or format it in the right way (or whatever is industry standard)."
//
// The industry standard, in one paragraph: a picture is never EMBEDDED in an
// email (Gmail clips the HTML at 102KB and most clients block data: URIs); it
// is HOSTED at a fixed https address and the email carries the link. Before it
// is stored it is rotated the right way up, stripped of camera/GPS data,
// shrunk to the width an email can actually show (the body is 600px; ×2 for a
// retina screen = 1200px) and re-encoded — progressive JPEG for a photograph,
// a palette PNG for a logo with transparency, GIF kept as GIF. Formats the
// mail clients cannot show (SVG in Gmail, WebP/HEIC/AVIF in Outlook) are
// converted on the way in or refused with a plain reason.
//
// Everything here is pure — no sharp, no database — so a script proves it.

export const MAILER_IMAGE_HOST = "https://app.usg.co.nz";
/** A phone photo is 3–12MB; 25MB leaves room for a DSLR frame. */
export const MAILER_IMAGE_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** 600px body × 2 for retina. Nothing in an email needs more. */
export const MAILER_IMAGE_MAX_WIDTH = 1200;
export const MAILER_IMAGE_MAX_HEIGHT = 1800;
/** What a photograph should weigh after shrinking. Quality steps down to reach it. */
export const MAILER_IMAGE_TARGET_BYTES = 250 * 1024;
export const MAILER_IMAGE_JPEG_QUALITY = 82;
export const MAILER_IMAGE_JPEG_MIN_QUALITY = 62;
/** A hard ceiling on what is stored (an animated GIF can legitimately be big). */
export const MAILER_IMAGE_STORED_MAX_BYTES = 2 * 1024 * 1024;

export type MailerImageFormat = "jpeg" | "png" | "gif";

export const MAILER_IMAGE_MIME: Record<MailerImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
};
export const MAILER_IMAGE_EXT: Record<MailerImageFormat, string> = { jpeg: "jpg", png: "png", gif: "gif" };

/** Input formats sharp reads on the server. HEIC needs libheif and is not
 *  built into the Fly image — it is refused with a reason, not silently dropped. */
export const MAILER_IMAGE_INPUT_FORMATS = ["jpeg", "png", "gif", "webp", "tiff", "avif", "bmp"] as const;

export const MAILER_IMAGE_REFUSALS: Record<string, string> = {
  svg: "SVG can't be shown by Gmail or Outlook. Export it as a PNG (or a JPEG for a photo) and upload that.",
  heif: "HEIC photos from an iPhone need converting first — share it as a JPEG (Photos → Export, or AirDrop with 'Most compatible').",
  heic: "HEIC photos from an iPhone need converting first — share it as a JPEG (Photos → Export, or AirDrop with 'Most compatible').",
  pdf: "That's a PDF, not a picture. Attach it with 'Attach a file' under the editor, or export a page as a JPEG.",
};

export interface MailerImageMeta {
  format: string;
  width: number;
  height: number;
  hasAlpha?: boolean;
  /** Frames in an animated GIF (sharp's `pages`). 1 or undefined = still. */
  pages?: number;
  bytes: number;
}

export interface MailerImagePlan {
  format: MailerImageFormat;
  /** Target box; the server resizes to fit INSIDE it, never enlarging. */
  width: number;
  height: number;
  /** Why this format — shown in the upload note. */
  reason: string;
}

/** Decide what a picture becomes. Pure, so the rules can be proven:
 *  - a photograph (no transparency) → progressive JPEG
 *  - a logo / graphic with transparency → palette PNG
 *  - an animated GIF → GIF, shrunk if wide
 *  - anything wider than 1200px is shrunk to 1200px; narrower is left alone */
export function planMailerImage(meta: MailerImageMeta): { ok: true; plan: MailerImagePlan } | { ok: false; message: string } {
  const fmt = String(meta.format || "").toLowerCase();
  if (MAILER_IMAGE_REFUSALS[fmt]) return { ok: false, message: MAILER_IMAGE_REFUSALS[fmt] };
  if (!(MAILER_IMAGE_INPUT_FORMATS as readonly string[]).includes(fmt)) {
    return { ok: false, message: `That file isn't a picture the builder can use (${fmt || "unknown type"}). Upload a JPEG, PNG or GIF.` };
  }
  if (!(meta.width > 0) || !(meta.height > 0)) return { ok: false, message: "That picture has no size — it may be corrupted. Try exporting it again." };

  const scale = Math.min(1, MAILER_IMAGE_MAX_WIDTH / meta.width, MAILER_IMAGE_MAX_HEIGHT / meta.height);
  const width = Math.max(1, Math.round(meta.width * scale));
  const height = Math.max(1, Math.round(meta.height * scale));
  const animated = fmt === "gif" && (meta.pages ?? 1) > 1;

  if (animated) return { ok: true, plan: { format: "gif", width, height, reason: "animated GIF kept as GIF" } };
  if (meta.hasAlpha) return { ok: true, plan: { format: "png", width, height, reason: "transparent, so PNG" } };
  return { ok: true, plan: { format: "jpeg", width, height, reason: "a photo, so progressive JPEG" } };
}

/** The stored key is the first 24 hex characters of the OUTPUT's SHA-256: the
 *  same picture uploaded twice is one row, and 96 bits cannot be guessed. */
export function mailerImageKey(sha256Hex: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256Hex)) throw new Error("expected a sha256 hex digest");
  return sha256Hex.slice(0, 24);
}

export function mailerImagePath(key: string, format: MailerImageFormat): string {
  return `/mailer/img/${key}.${MAILER_IMAGE_EXT[format]}`;
}

export function mailerImageUrl(key: string, format: MailerImageFormat): string {
  return `${MAILER_IMAGE_HOST}${mailerImagePath(key, format)}`;
}

/** Parse "/mailer/img/<key>.<ext>" (or the bare filename) back into its parts. */
export function parseMailerImageFile(file: string): { key: string; format: MailerImageFormat } | null {
  const m = /^(?:.*\/)?([a-f0-9]{24})\.(jpg|png|gif)$/.exec(String(file || ""));
  if (!m) return null;
  const format: MailerImageFormat = m[2] === "jpg" ? "jpeg" : (m[2] as MailerImageFormat);
  return { key: m[1], format };
}

export function isMailerImageUrl(src: string): boolean {
  return src.startsWith(`${MAILER_IMAGE_HOST}/mailer/img/`) && !!parseMailerImageFile(src);
}

/** "1.8 MB → 142 KB (−92%)" for the note under the picker. */
export function describeShrink(originalBytes: number, bytes: number): string {
  const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  if (originalBytes <= 0) return kb(bytes);
  const saved = Math.round((1 - bytes / originalBytes) * 100);
  return saved > 0 ? `${kb(originalBytes)} → ${kb(bytes)} (−${saved}%)` : kb(bytes);
}

/** The email's own weight — the HTML Gmail measures against its 102KB clip. */
export const MAILER_HTML_CLIP_BYTES = 102 * 1024;
export const MAILER_HTML_WARN_BYTES = 80 * 1024;
export type MailerHtmlSizeState = "ok" | "warn" | "over";
export function mailerHtmlSizeState(bytes: number): MailerHtmlSizeState {
  if (bytes >= MAILER_HTML_CLIP_BYTES) return "over";
  if (bytes >= MAILER_HTML_WARN_BYTES) return "warn";
  return "ok";
}

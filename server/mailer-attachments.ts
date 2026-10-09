// Files attached to a Mailer email (Daniel, 2026-10-09: "make it so easy to add
// attachment like pdf etc.").
//
// 🔴 The SAME files go to every recipient, so the cap is about the list, not the
// file: a 7 MB PDF to 3,800 families is 26 GB through Resend and into inboxes
// that reject big mail. 7 MB total keeps every message under Gmail/Outlook's
// limits after base64 (+33%) and leaves Resend's 40 MB ceiling far away.
// 🔴 Never trusted from the browser — every field is re-read here, the type must
// be on the list, and the size is measured from the DECODED bytes.
import type { EmailAttachment } from "./email";

export const MAILER_ATTACHMENT_MAX_FILES = 5;
export const MAILER_ATTACHMENT_MAX_BYTES = 7 * 1024 * 1024;

const ALLOWED = new Set([
  "application/pdf",
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv", "text/plain", "text/calendar",
]);

/** Validated attachments, or a plain-English reason they were refused. */
export function readMailerAttachments(raw: unknown): { ok: true; files: EmailAttachment[] } | { ok: false; message: string } {
  if (raw == null) return { ok: true, files: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "Attachments were not readable." };
  if (raw.length > MAILER_ATTACHMENT_MAX_FILES) return { ok: false, message: `Up to ${MAILER_ATTACHMENT_MAX_FILES} attachments per email.` };
  const files: EmailAttachment[] = [];
  let total = 0;
  for (const a of raw) {
    const filename = String((a as any)?.filename ?? "").replace(/[\\/\r\n]/g, "_").trim().slice(0, 150);
    const contentType = String((a as any)?.contentType ?? "").toLowerCase().trim();
    const content = String((a as any)?.content ?? "");
    if (!filename || !content) return { ok: false, message: "An attachment was empty." };
    if (!ALLOWED.has(contentType)) return { ok: false, message: `"${filename}" can't be attached — PDFs, images, Word, Excel, PowerPoint, CSV and text files only.` };
    if (!/^[A-Za-z0-9+/=\s]+$/.test(content)) return { ok: false, message: `"${filename}" was not readable.` };
    const bytes = Buffer.from(content, "base64").length;
    total += bytes;
    files.push({ filename, content: content.replace(/\s+/g, ""), contentType } as EmailAttachment);
  }
  if (total > MAILER_ATTACHMENT_MAX_BYTES) {
    return { ok: false, message: `Attachments come to ${(total / 1048576).toFixed(1)} MB — the limit is 7 MB, because every recipient gets a copy. Link to a bigger file instead.` };
  }
  return { ok: true, files };
}

// "How did you hear about us?" — asked BEFORE the money, on every sale path.
//
// Daniel, 2026-10-20: "make how did you hear about us mandatory for all new
// sales across everything we do … shouldn't be asking returning customers
// necessarily but should also be built into register at office flow."
//
// ONE list. Every checkout form renders it and every route validates against
// it, so a form can never offer an answer the server refuses, and the report
// can never meet a key nobody can label.
//
// Stored in `registrations.referral_source` (the column the old post-payment
// camp survey and the success-screen card already write). Free text for
// "Other" lives in `registrations.referral_detail` — written through
// server/hdyhau.ts, never through the Drizzle table object, so a deploy that
// lands before the migration cannot break a checkout.
//
// Who must answer is decided on the SERVER (server/hdyhau.ts →
// isReturningBuyer): a buyer new to that ORGANISATION must; a returning one
// may. This file only knows what a valid answer looks like.

export const HDYHAU_OPTIONS = [
  { value: "friend_teammate", label: "A friend or teammate" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "google", label: "Google search" },
  { value: "school_elc", label: "School or early learning centre" },
  { value: "flyer_poster", label: "Flyer or poster" },
  { value: "venue", label: "Saw the venue / drove past" },
  { value: "email", label: "Email or newsletter" },
  { value: "website", label: "Club website" },
  { value: "returning", label: "I've been with you before" },
  { value: "other", label: "Other" },
] as const;

export type HdyhauValue = (typeof HDYHAU_OPTIONS)[number]["value"];

/** "Other" needs a few words, or the answer tells us nothing. */
export const HDYHAU_DETAIL_MAX = 200;

export function isHdyhauValue(v: unknown): v is HdyhauValue {
  return typeof v === "string" && HDYHAU_OPTIONS.some((o) => o.value === v);
}

/**
 * Labels for EVERY key that has ever been stored in `referral_source`, not just
 * the current list — 2,300+ rows were written by the post-payment camp survey
 * (attribution-survey.tsx) and the success-screen card (shared/attribution.ts)
 * with their own keys, and those rows must still read as words in a report.
 */
export const HDYHAU_LABELS: Record<string, string> = {
  ...Object.fromEntries(HDYHAU_OPTIONS.map((o) => [o.value, o.label])),
  // Camp survey keys (attribution-survey.tsx), kept readable.
  youtube: "YouTube",
  facebook_ad: "Facebook / Instagram ad",
  word_of_mouth: "Word of mouth",
  friend_family: "A friend or family member",
  school_club: "School or club",
  billboard_sign: "Billboard or sign",
  email_newsletter: "Email or newsletter",
  // Success-screen card keys (shared/attribution.ts HDYHAU_OPTIONS).
  whatsapp: "WhatsApp",
  poster_qr: "Poster or QR code",
};

/** A human label for any stored value, including the legacy "Other: …" form. */
export function hdyhauLabel(source: string | null | undefined, detail?: string | null): string | null {
  if (!source) return null;
  const s = String(source).trim();
  if (!s) return null;
  if (/^other:/i.test(s)) return s.replace(/^other:\s*/i, "Other: ");
  const base = HDYHAU_LABELS[s] ?? s;
  if (s === "other" && detail && detail.trim()) return `Other: ${detail.trim()}`;
  return base;
}

export type HdyhauParse =
  | { ok: true; source: HdyhauValue; detail: string | null }
  | { ok: true; source: null; detail: null } // nothing sent
  | { ok: false; message: string };

export const HDYHAU_REQUIRED_MESSAGE = "Please tell us how you heard about us.";
export const HDYHAU_INVALID_MESSAGE = "That answer to \"How did you hear about us?\" isn't one of the options.";
export const HDYHAU_DETAIL_MESSAGE = "You picked \"Other\" — please tell us where you heard about us.";

/**
 * Read an answer off a request body. Never decides whether one is REQUIRED —
 * only whether what was sent is valid. A value that was sent and is wrong is
 * always refused, returning buyer or not: we never store a key we can't label.
 */
export function parseHdyhau(rawSource: unknown, rawDetail: unknown): HdyhauParse {
  const source = typeof rawSource === "string" ? rawSource.trim() : "";
  if (!source) return { ok: true, source: null, detail: null };
  if (!isHdyhauValue(source)) return { ok: false, message: HDYHAU_INVALID_MESSAGE };
  const detail = typeof rawDetail === "string" ? rawDetail.trim().slice(0, HDYHAU_DETAIL_MAX) : "";
  if (source === "other" && !detail) return { ok: false, message: HDYHAU_DETAIL_MESSAGE };
  return { ok: true, source, detail: source === "other" ? detail : null };
}

// Google Ads conversion export — PURE logic (no DB, no env, no clock).
//
// The server side (server/google-ads-attribution.ts) reads the rows; everything
// that decides WHICH click a conversion belongs to and HOW a row is written for
// Google lives here so script/_test-google-ads-attribution.ts can prove it.
//
// File format — Google Ads "Import conversions from ad clicks into Google Ads using
// files (legacy)": https://support.google.com/google-ads/answer/7014069 (read
// 2026-10-14). What that page states and we rely on:
//   - a parameter row `Parameters:TimeZone=<tz id>` (an IANA id such as
//     America/Chicago is the documented, DST-safe form; no quotes),
//   - columns "Google Click ID", "Conversion Name", "Conversion Time",
//     "Conversion Value", "Conversion Currency", optional "Order ID",
//   - Conversion Time as `yyyy-MM-dd HH:mm:ss` (local to the TimeZone parameter),
//   - Conversion Name must match the conversion action's name EXACTLY,
//   - scheduled imports may be fetched from an HTTPS URL.
// What it does NOT state, and so we do not do by default:
//   - GBRAID / WBRAID are not documented as file-upload columns (the page mentions
//     GBRAID only for external attribution; WBRAID not at all). They are resolved
//     and shown in ClubOS, but only gclid rows go into the CSV.
//   - the hashed-email column name for enhanced conversions is not given on that
//     page; it is behind an explicit opt-in (`includeEmailHash`) and UNVERIFIED.
// Google labels file import "legacy" and points at Data Manager; the format above
// still works for scheduled HTTPS imports as of this writing.

import { validExternalId } from "./attribution";

export const GOOGLE_ADS_CONVERSION_NAME = "ClubOS Purchase";
export const GOOGLE_ADS_TIMEZONE = "Pacific/Auckland";
export const GOOGLE_CLICK_WINDOW_DAYS = 90;

export const GOOGLE_ADS_CSV_HEADER = [
  "Google Click ID",
  "Conversion Name",
  "Conversion Time",
  "Conversion Value",
  "Conversion Currency",
  "Order ID",
] as const;

export type GoogleClickType = "gclid" | "gbraid" | "wbraid";
/** Where the click was found: on the conversion row, on the converting visitor,
 *  or on another visitor bound to the same payer. */
export type GoogleClickSource = "conversion" | "visitor" | "person";

export interface GoogleClick {
  type: GoogleClickType;
  id: string;
  /** When the click landed (ms). Null when the id came off the conversion row itself. */
  clickAtMs: number | null;
  source: GoogleClickSource;
}

/** A Google-click-bearing analytics touch, as the server reads it. */
export interface GoogleClickTouch {
  visitorId: string;
  /** True when this touch's visitor IS the conversion's visitor. */
  sameVisitor: boolean;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  isBot?: boolean | null;
  timestampMs: number;
}

/** The single Google click id a touch carries, gclid first. */
export function googleClickOf(t: { gclid?: string | null; gbraid?: string | null; wbraid?: string | null }):
  { type: GoogleClickType; id: string } | null {
  const g = validExternalId(t.gclid);
  if (g) return { type: "gclid", id: g };
  const b = validExternalId(t.gbraid);
  if (b) return { type: "gbraid", id: b };
  const w = validExternalId(t.wbraid);
  if (w) return { type: "wbraid", id: w };
  return null;
}

/**
 * Resolve the Google click behind one conversion. Order:
 *   1. the conversion row's own gclid;
 *   2. the LATEST Google click on the converting visitor within the 90 days before
 *      the conversion;
 *   3. the same over every other visitor bound to the payer.
 * Bot touches and touches after the conversion never count.
 */
export function pickGoogleClick(input: {
  ownGclid?: string | null;
  convertedAtMs: number;
  touches: readonly GoogleClickTouch[];
  windowDays?: number;
}): GoogleClick | null {
  const own = validExternalId(input.ownGclid);
  if (own) return { type: "gclid", id: own, clickAtMs: null, source: "conversion" };
  const from = input.convertedAtMs - (input.windowDays ?? GOOGLE_CLICK_WINDOW_DAYS) * 86_400_000;
  type Hit = { t: GoogleClickTouch; c: { type: GoogleClickType; id: string } };
  let best: Hit | null = null;
  let bestPerson: Hit | null = null;
  for (const t of input.touches) {
    if (!t || t.isBot) continue;
    if (!Number.isFinite(t.timestampMs) || t.timestampMs > input.convertedAtMs || t.timestampMs < from) continue;
    const c = googleClickOf(t);
    if (!c) continue;
    if (t.sameVisitor) {
      if (!best || t.timestampMs > best.t.timestampMs) best = { t, c };
    } else if (!bestPerson || t.timestampMs > bestPerson.t.timestampMs) {
      bestPerson = { t, c };
    }
  }
  if (best) return { ...best.c, clickAtMs: best.t.timestampMs, source: "visitor" };
  if (bestPerson) return { ...bestPerson.c, clickAtMs: bestPerson.t.timestampMs, source: "person" };
  return null;
}

/** Net paid value in cents: what was charged minus what went back. Never negative. */
export function netPaidCents(totalCents: number | null | undefined, refundedCents: number | null | undefined): number {
  const t = Number.isFinite(Number(totalCents)) ? Math.trunc(Number(totalCents)) : 0;
  const r = Number.isFinite(Number(refundedCents)) ? Math.trunc(Number(refundedCents)) : 0;
  return Math.max(0, t - Math.max(0, r));
}

/** Cents → "123.45" (dot decimal, no thousands separator, no currency sign). */
export function centsToDecimal(cents: number): string {
  const c = Math.max(0, Math.trunc(cents));
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

/** An instant → "yyyy-MM-dd HH:mm:ss" on the Pacific/Auckland wall clock. */
export function formatNzDateTime(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: GOOGLE_ADS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const p: Record<string, string> = {};
  for (const x of parts) p[x.type] = x.value;
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second}`;
}

/** An instant → ISO 8601 on the Pacific/Auckland wall clock WITH its offset,
 *  e.g. "2026-10-14T17:05:09+13:00". Google Data Manager's HTTPS import reads the
 *  first line as the header and wants the zone inside every timestamp — the legacy
 *  `Parameters:TimeZone=` line became its only "column" (found 2026-10-14). */
export function formatNzIsoWithOffset(ms: number): string {
  const local = formatNzDateTime(ms); // yyyy-MM-dd HH:mm:ss, NZ wall clock
  const [d, t] = local.split(" ");
  const [Y, M, D] = d.split("-").map(Number);
  const [h, m, sec] = t.split(":").map(Number);
  const wallAsUtc = Date.UTC(Y, M - 1, D, h, m, sec);
  const offMin = Math.round((wallAsUtc - Math.floor(ms / 1000) * 1000) / 60000);
  const sign = offMin >= 0 ? "+" : "-";
  const a = Math.abs(offMin);
  const hh = String(Math.floor(a / 60)).padStart(2, "0");
  const mm = String(a % 60).padStart(2, "0");
  return `${d}T${t}${sign}${hh}:${mm}`;
}

/** RFC 4180 field quoting. */
export function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Normalise an email the way Google's enhanced conversions expect before hashing:
 * trim, lowercase, and for gmail.com / googlemail.com drop dots in the local part.
 * Returns null for anything that is not an address.
 */
export function normalizeEmailForGoogle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at <= 0 || at === s.length - 1 || /\s/.test(s)) return null;
  let local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** One conversion ready to write. `emailSha256` is the PAYER's, only when opted in. */
export interface GoogleConversionRow {
  orderId: string;
  gclid: string;
  convertedAtMs: number;
  valueCents: number;
  currency: string;
  emailSha256?: string | null;
}

/** The full CSV body Google fetches. Rows with no value are dropped. */
export function buildGoogleAdsCsv(
  rows: readonly GoogleConversionRow[],
  opts: { conversionName?: string; includeEmailHash?: boolean; legacy?: boolean } = {},
): string {
  const name = opts.conversionName ?? GOOGLE_ADS_CONVERSION_NAME;
  const header: string[] = [...GOOGLE_ADS_CSV_HEADER];
  // UNVERIFIED column name — see the header comment. Off unless asked for.
  if (opts.includeEmailHash) header.push("Email");
  // Default = Data Manager shape (header first, zone inside each timestamp).
  // `legacy` = the old file-upload shape with a Parameters:TimeZone line.
  const lines = opts.legacy
    ? [`Parameters:TimeZone=${GOOGLE_ADS_TIMEZONE}`, header.map(csvField).join(",")]
    : [header.map(csvField).join(",")];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || r.valueCents <= 0 || seen.has(r.orderId)) continue;
    const gclid = validExternalId(r.gclid);
    if (!gclid) continue;
    seen.add(r.orderId);
    const cells = [
      gclid,
      name,
      opts.legacy ? formatNzDateTime(r.convertedAtMs) : formatNzIsoWithOffset(r.convertedAtMs),
      centsToDecimal(r.valueCents),
      (r.currency || "NZD").toUpperCase(),
      r.orderId,
    ];
    if (opts.includeEmailHash) cells.push(r.emailSha256 ?? "");
    lines.push(cells.map(csvField).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

// ─────────────────────────────────────────────────────────────────────────────
// SALES — United Print prospect database + pipeline. Shared enums and derived
// statuses. Pure functions, no DB imports — same shape as shared/vehicles.ts.
//
// Stage values are validated HERE, application-side, never as a DB CHECK —
// a stale CHECK is how the MFL checkout 500'd when code shipped a value the
// database had never heard of.
// ─────────────────────────────────────────────────────────────────────────────

export const SALES_STAGES = [
  { key: "new", label: "New", color: "#64748b" },
  { key: "contacted", label: "Contacted", color: "#0ea5e9" },
  { key: "call_booked", label: "Call booked", color: "#8b5cf6" },
  { key: "sales_call", label: "Sales call", color: "#f59e0b" },
  { key: "quote_sent", label: "Quote sent", color: "#f97316" },
  { key: "won", label: "Won — invoiced", color: "#22c55e" },
  { key: "paid", label: "Invoice paid", color: "#10b981" },
  { key: "declined", label: "Declined", color: "#ef4444" },
] as const;

export type SalesStage = (typeof SALES_STAGES)[number]["key"];

export function isSalesStage(x: unknown): x is SalesStage {
  return typeof x === "string" && SALES_STAGES.some((s) => s.key === x);
}

export function stageLabel(key: string): string {
  return SALES_STAGES.find((s) => s.key === key)?.label ?? key;
}

/** Stages whose deal value counts as "in the pipeline" (not yet won, not dead). */
export const OPEN_PIPELINE_STAGES: readonly SalesStage[] = ["contacted", "call_booked", "sales_call", "quote_sent"];

export const SALES_ACTIVITY_TYPES = ["call", "email", "meeting", "note", "stage_change"] as const;
export type SalesActivityType = (typeof SALES_ACTIVITY_TYPES)[number];
export function isSalesActivityType(x: unknown): x is SalesActivityType {
  return typeof x === "string" && (SALES_ACTIVITY_TYPES as readonly string[]).includes(x);
}

/** Call/contact outcomes — the quick-log buttons in the UI. */
export const SALES_OUTCOMES = [
  "no_answer",
  "left_message",
  "gatekeeper",
  "callback",
  "interested",
  "not_interested",
  "call_booked",
  "other",
] as const;
export type SalesOutcome = (typeof SALES_OUTCOMES)[number];
export function isSalesOutcome(x: unknown): x is SalesOutcome {
  return typeof x === "string" && (SALES_OUTCOMES as readonly string[]).includes(x);
}

export const SALES_TIERS = ["A", "B", "C"] as const;
export type SalesTier = (typeof SALES_TIERS)[number];
export function isSalesTier(x: unknown): x is SalesTier {
  return typeof x === "string" && (SALES_TIERS as readonly string[]).includes(x);
}

export const SALES_REGIONS = ["christchurch", "canterbury", "south-island", "north-island", "nz-wide"] as const;
export type SalesRegion = (typeof SALES_REGIONS)[number];
export function isSalesRegion(x: unknown): x is SalesRegion {
  return typeof x === "string" && (SALES_REGIONS as readonly string[]).includes(x);
}

export const SALES_SOURCES = ["research-fleet", "manual"] as const;
export type SalesSource = (typeof SALES_SOURCES)[number];
export function isSalesSource(x: unknown): x is SalesSource {
  return typeof x === "string" && (SALES_SOURCES as readonly string[]).includes(x);
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Calendar-day addition on the date PARTS — no timezone in play, so an NZ
 *  evening never reads as yesterday the way `new Date().toISOString()` does. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export type FollowUpStatus = "none" | "overdue" | "due_today" | "upcoming" | "scheduled";

/** DERIVED, never stored — same rule as housing arrears and vehicle compliance.
 *  ISO strings compare chronologically, so plain string comparison is exact. */
export function followUpStatus(nextFollowUpOn: string | null | undefined, todayIso: string): FollowUpStatus {
  if (!nextFollowUpOn || !isIsoDate(nextFollowUpOn)) return "none";
  if (nextFollowUpOn < todayIso) return "overdue";
  if (nextFollowUpOn === todayIso) return "due_today";
  if (nextFollowUpOn <= addDaysIso(todayIso, 7)) return "upcoming";
  return "scheduled";
}

// ── Outreach email ───────────────────────────────────────────────────────────
// The first email to a prospect, pre-filled from what the research fleet found
// and then rewritten by a human before it goes. ONE draft function, used by the
// dialog; the server sends whatever the person finally typed and never
// rewrites it (the footer below is the only thing it adds).

const NAME_TITLES = /^(dr|mr|mrs|ms|miss|mx|prof|sir|dame)\.?$/i;

/** "Dr Rachel Dovey" → "Rachel"; "Rachel & Tom Smith" → "Rachel". Null when
 *  there is no usable name — the greeting then says "Hi there", never a guess. */
export function firstNameOf(contactName: string | null | undefined): string | null {
  const first = (contactName ?? "").split(/[&/,;]| and /i)[0].trim();
  const parts = first.split(/\s+/).filter((w) => w && !NAME_TITLES.test(w));
  const name = parts[0] ?? "";
  if (name.length < 2 || !/^[\p{L}'-]+$/u.test(name)) return null;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** info@, office@, enquiries@… — a shared inbox, so the named contact may
 *  never see it unless someone forwards it. Shown as a hint, never blocked. */
export function isSharedInbox(email: string | null | undefined): boolean {
  const local = (email ?? "").split("@")[0].toLowerCase();
  return /^(info|office|enquir(y|ies)|admin|hello|contact|reception|mail|general|school\.information|sales|team|events?)$/.test(local);
}

const SERVICE_WORDS: Record<string, string> = {
  "banners-signage": "banners and signage",
  "merch": "printed apparel",
  "trophies-medals": "trophies and medals",
  "design": "design",
};

/** One line per category the research fleet used — what that kind of buyer
 *  actually orders. No claim about the prospect itself. */
const CATEGORY_LINES: Record<string, string> = {
  "real-estate": "Real estate runs on signage — boards, sold stickers, open-home signs — and it's the kind of work we turn around quickly.",
  "secondary-schools": "Schools come to us for prizegiving trophies and medals, sports-day banners and team gear.",
  "primary-schools": "Schools come to us for prizegiving trophies and medals, sports-day banners and team gear.",
  "football-rugby-clubs": "We're a club ourselves, so we know what a season needs: team gear, sponsor banners and end-of-season trophies.",
  "other-sports-clubs": "We're a club ourselves, so we know what a season needs: team gear, sponsor banners and end-of-season trophies.",
  "event-organisers": "Events are a lot of what we do — finisher medals, course and sponsor banners, and event tees.",
  "hospitality": "For hospitality we do signage, banners and printed staff tees.",
  "charities-community": "For community groups we do event banners, fundraising tees and volunteer gear.",
  "councils-education": "We do banners, signage and merch for campus and community events.",
  "dance-gym-martialarts": "Studios come to us for branded tees and hoodies, signage, and trophies and medals for competitions.",
  "gyms-fitness": "Gyms come to us for branded tees and hoodies, signage, and trophies and medals for challenges.",
  "retail-franchise": "For retail we do window and promo signage, banners and staff uniforms.",
  "construction-trades": "For trades we do site signage, banners and branded workwear.",
  "tourism-adventure": "For tourism operators we do signage, banners and branded merch guests take home.",
  "car-dealers-marine": "For dealerships we do forecourt banners, signage and staff uniforms.",
  "corporate-awards": "We make trophies and awards, plus branded merch for staff and events.",
};

function listJoin(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return xs.length === 2 ? `${xs[0]}${xs.some((x) => x.includes(" and ")) ? ", and" : " and"} ${xs[1]}` : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`;
}

export interface OutreachDraftInput {
  name: string;
  contactName: string | null;
  category: string | null;
  servicesMatch: string[] | null;
}

export function outreachEmailDraft(p: OutreachDraftInput, sender: { firstName: string; lastName: string }): { subject: string; body: string } {
  const first = firstNameOf(p.contactName);
  const services = (p.servicesMatch ?? []).map((s) => SERVICE_WORDS[s]).filter(Boolean);
  const offer = services.length ? listJoin(services) : "banners, signage, printed apparel, trophies and medals";
  const categoryLine = (p.category && CATEGORY_LINES[p.category]) || null;

  const paragraphs = [
    `Hi ${first ?? "there"},`,
    `I'm ${sender.firstName} from United Prints, a Christchurch print shop and part of Christchurch United Football Club.`,
    categoryLine,
    `We do ${offer} in-house, so it's one place to go and one person to deal with, all made here in Christchurch.`,
    `Would a quick 10-minute call be worth it to see if we can help with your next job? Or if something's coming up, send me the details and I'll get a quote back to you quickly.`,
    `Cheers,\n${[sender.firstName, sender.lastName].filter(Boolean).join(" ")}\nUnited Prints\n0800 800 199 · unitedprints.co.nz`,
  ].filter(Boolean) as string[];

  return { subject: `Printing for ${p.name}`, body: paragraphs.join("\n\n") };
}

/** Added by the SERVER to every outreach email and never editable: who we are
 *  and how to opt out. NZ's Unsolicited Electronic Messages Act 2007 requires
 *  both on a commercial message (s10 sender info, s11 unsubscribe). */
export const OUTREACH_FOOTER =
  "United Prints · Christchurch United Football Club Inc. · Christchurch, New Zealand\n" +
  "Not the right time? Just let us know and we won't email you again.";
/** The words in OUTREACH_FOOTER that become the opt-out link. Dima, 2026-10-01:
 *  this is COLD outreach — nobody subscribed, so "Unsubscribe" reads like we put
 *  them on a list. UEMA s11 needs a working way to say "stop", not that word.
 *  The server swaps these words for the real link. */
export const OUTREACH_UNSUB_WORD = "let us know";

// ── Turning the typed message into the email ─────────────────────────────────
// ONE renderer for the dialog's preview and for the email that is sent, so
// what Daniel previews is what arrives. Plain text in; out comes HTML where
//   [words](https://…)            → a link reading "words"
//   https://… · www.… · x.co.nz   → a link reading the address
//   name@company.nz               → a mailto: link
//   0800 800 199 · +64 21 …       → a tel: link
// Web links are collected in order so the server can send each one through
// the tracked redirect; mailto: and tel: open the reader's own app directly.

export interface OutreachLink { url: string; label: string }

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "unitedprints.co.nz/quote" → "https://unitedprints.co.nz/quote". Only
 *  http(s) survives — a javascript: or data: "link" is left as plain text. */
export function normaliseUrl(raw: string): string | null {
  const s = raw.trim();
  const withScheme = /^https?:\/\//i.test(s) ? s : /^[a-z]+:/i.test(s) ? null : `https://${s}`;
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch { return null; }
}

const TLD = "(?:co\\.nz|org\\.nz|net\\.nz|govt\\.nz|school\\.nz|ac\\.nz|nz|com|org|net|io|co)";
const BARE_URL = `(?:https?:\\/\\/[^\\s<>()]+|www\\.[^\\s<>()]+|\\b[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.${TLD}\\b(?:\\/[^\\s<>()]*)?)`;
const EMAIL = "\\b[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}\\b";
const PHONE = "(?:\\+64[\\s-]?\\d{1,2}|0800|0508|0\\d{1,2})[\\s-]?\\d{3}[\\s-]?\\d{3,4}\\b";
const TOKENS = new RegExp(`\\[([^\\]\\n]{1,120})\\]\\(([^)\\s]{3,500})\\)|(${EMAIL})|(${BARE_URL})|(${PHONE})`, "gi");

/** Render one paragraph's text; `href(url, i)` decides where web link i points. */
function renderInline(text: string, links: OutreachLink[], href: (url: string, i: number) => string): string {
  let out = "";
  let last = 0;
  TOKENS.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = TOKENS.exec(text)); ) {
    let whole = m[0];
    let trail = "";
    // A sentence's full stop or comma is not part of the address.
    if (!m[1]) {
      const t = /[.,;:!?'"]+$/.exec(whole);
      if (t) { trail = t[0]; whole = whole.slice(0, -trail.length); }
    }
    out += escHtml(text.slice(last, m.index));
    const a = (h: string, label: string) => `<a href="${escHtml(h)}" style="color:#1d4ed8;text-decoration:underline">${escHtml(label)}</a>`;
    if (m[1]) {
      const url = normaliseUrl(m[2]);
      if (url) { links.push({ url, label: m[1] }); out += a(href(url, links.length - 1), m[1]); }
      else out += escHtml(m[0]);
    } else if (m[3]) {
      out += a(`mailto:${whole}`, whole);
    } else if (m[4]) {
      const url = normaliseUrl(whole);
      if (url) { links.push({ url, label: whole }); out += a(href(url, links.length - 1), whole); }
      else out += escHtml(whole);
    } else {
      out += a(`tel:${whole.replace(/[\s-]/g, "")}`, whole);
    }
    out += escHtml(trail);
    last = m.index + m[0].length;
  }
  return out + escHtml(text.slice(last));
}

/** The message as email HTML (paragraphs only — the caller adds the shell) and
 *  the web links in it, in order. */
export function renderOutreachBody(body: string, href: (url: string, i: number) => string = (u) => u): { html: string; links: OutreachLink[] } {
  const links: OutreachLink[] = [];
  const html = body
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.split("\n").map((l) => renderInline(l, links, href)).join("<br/>")}</p>`)
    .join("");
  return { html, links };
}

/** The same message as plain text — a link reads "words (https://…)". */
export function outreachPlainText(body: string): string {
  return body.replace(/\[([^\]\n]{1,120})\]\(([^)\s]{3,500})\)/g, (_m, label, url) => `${label} (${normaliseUrl(url) ?? url})`);
}

// Attachments: what a sales email may carry. Office files, PDFs and pictures;
// nothing executable, and small enough that Gmail and Outlook accept it.
export const OUTREACH_ATTACHMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
};
export const OUTREACH_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const OUTREACH_ATTACHMENT_MAX_FILES = 5;

// The customer journey after an email, in order. Quote/order/paid are read
// from the print tables, never stored against the email.
export const OUTREACH_STEPS = [
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered" },
  { key: "opened", label: "Opened" },
  { key: "clicked", label: "Clicked" },
  { key: "quoted", label: "Quote submitted" },
  { key: "ordered", label: "Order confirmed" },
  { key: "paid", label: "Paid" },
] as const;
/** Events that END the journey rather than advance it. */
export const OUTREACH_STOP_LABELS: Record<string, string> = {
  bounced: "Bounced", complained: "Marked as spam", delivery_delayed: "Delivery delayed", unsubscribed: "Unsubscribed",
};
export type OutreachStep = (typeof OUTREACH_STEPS)[number]["key"];

/** Free mailbox domains — a quote from one proves nothing about a company, so
 *  quotes and orders are matched to an email by the exact address there, and
 *  by the company's domain everywhere else. */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.co.nz", "outlook.com", "outlook.co.nz", "live.com", "live.co.nz",
  "msn.com", "yahoo.com", "yahoo.co.nz", "icloud.com", "me.com", "mac.com", "xtra.co.nz", "slingshot.co.nz",
  "orcon.net.nz", "vodafone.co.nz", "paradise.net.nz", "clear.net.nz", "actrix.co.nz", "windowslive.com", "proton.me", "protonmail.com",
]);
export function emailDomain(email: string | null | undefined): string | null {
  const d = (email ?? "").trim().toLowerCase().split("@")[1];
  return d && d.includes(".") ? d : null;
}

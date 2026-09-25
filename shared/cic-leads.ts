// ─────────────────────────────────────────────────────────────────────────────
// CIC Youth — the registration-of-interest LEAD PIPELINE (2026-09-25).
//
// ONE decider for everything about a lead that is not a stored fact: which
// stages exist, what counts as open, when a follow-up is due, where a lead is
// from, and which warning flags it carries. The page, the server and the
// verifier all read this file. Pure — no DB, no React.
//
// 🔴 Stage values are validated HERE, never by a DB CHECK (a stale CHECK is how
//    the MFL checkout 500'd).
// 🔴 Flags are SUGGESTIONS. Nothing here ever disqualifies a lead on its own:
//    a real club turned away costs a team, a spam row left in costs a click.
//    "Likely spam" needs TWO independent signals (the form-guard doctrine).
// ─────────────────────────────────────────────────────────────────────────────

import { NZF_COUNTRIES } from "./nzf-vocabulary";
import { looksRandomName } from "./form-guard";

export const LEAD_STAGES = [
  { key: "new",          label: "New",             color: "#64748b", hint: "Not touched yet" },
  { key: "contacted",    label: "Contacted",       color: "#0ea5e9", hint: "We've reached out, no reply yet" },
  { key: "talking",      label: "In conversation", color: "#8b5cf6", hint: "They've replied" },
  { key: "info_sent",    label: "Info sent",       color: "#f59e0b", hint: "Fees, dates and travel pack sent" },
  { key: "committed",    label: "Committed",       color: "#f97316", hint: "Said yes — waiting on entry" },
  { key: "entered",      label: "Entered",         color: "#22c55e", hint: "In the tournament" },
  { key: "not_coming",   label: "Not coming",      color: "#94a3b8", hint: "A real club that won't be coming" },
  { key: "disqualified", label: "Disqualified",    color: "#ef4444", hint: "Spam, duplicate or not a team" },
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number]["key"];
export const CLOSED_STAGES: readonly LeadStage[] = ["not_coming", "disqualified"];
export const OPEN_STAGES: readonly LeadStage[] = ["new", "contacted", "talking", "info_sent", "committed"];

export function isLeadStage(x: unknown): x is LeadStage {
  return typeof x === "string" && LEAD_STAGES.some((s) => s.key === x);
}
export function stageLabel(key: string): string {
  return LEAD_STAGES.find((s) => s.key === key)?.label ?? key;
}
/** A row from before the pipeline existed may still carry a legacy status. */
export function normaliseStage(raw: string | null | undefined): LeadStage {
  if (isLeadStage(raw)) return raw;
  if (raw === "confirmed") return "entered";
  if (raw === "declined") return "not_coming";
  if (raw === "archived") return "disqualified";
  return "new";
}

/** A closing stage needs a reason — and only a closing stage may carry one. */
export const DISQUALIFY_REASONS = [
  { key: "spam", label: "Spam / junk" },
  { key: "duplicate", label: "Duplicate" },
  { key: "fake", label: "Fake or test details" },
  { key: "not_a_team", label: "Not a team (player or parent)" },
  { key: "wrong_age", label: "Wrong age group / event" },
  { key: "other", label: "Other" },
] as const;
export const NOT_COMING_REASONS = [
  { key: "cost", label: "Cost" },
  { key: "travel", label: "Travel or visas" },
  { key: "dates", label: "Dates don't suit" },
  { key: "no_response", label: "Stopped replying" },
  { key: "other_event", label: "Chose another tournament" },
  { key: "other", label: "Other" },
] as const;
export function reasonsFor(stage: string) {
  if (stage === "disqualified") return DISQUALIFY_REASONS;
  if (stage === "not_coming") return NOT_COMING_REASONS;
  return [] as const;
}
export function isReasonFor(stage: string, reason: unknown): boolean {
  return typeof reason === "string" && (reasonsFor(stage) as readonly { key: string }[]).some((r) => r.key === reason);
}
export function reasonLabel(stage: string, reason: string | null | undefined): string | null {
  if (!reason) return null;
  return (reasonsFor(stage) as readonly { key: string; label: string }[]).find((r) => r.key === reason)?.label ?? reason;
}

export const PRIORITIES = [
  { key: "hot", label: "Hot" },
  { key: "warm", label: "Warm" },
  { key: "cold", label: "Cold" },
] as const;
export function isPriority(x: unknown): x is "hot" | "warm" | "cold" {
  return x === "hot" || x === "warm" || x === "cold";
}

export const ACTIVITY_TYPES = ["call", "email", "whatsapp", "note", "stage_change"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export function isActivityType(x: unknown): x is ActivityType {
  return typeof x === "string" && (ACTIVITY_TYPES as readonly string[]).includes(x);
}

/** The quick-log buttons. Logging first contact on a New lead moves it to
 *  Contacted; a reply moves it to In conversation. Never backwards. */
export const QUICK_LOGS = [
  { key: "emailed",   type: "email",    outcome: "sent",       label: "Emailed",          followUpDays: 3, advanceTo: "contacted" },
  { key: "whatsapp",  type: "whatsapp", outcome: "sent",       label: "WhatsApp'd",       followUpDays: 3, advanceTo: "contacted" },
  { key: "no_answer", type: "call",     outcome: "no_answer",  label: "Called — no answer", followUpDays: 2, advanceTo: "contacted" },
  { key: "talked",    type: "call",     outcome: "talked",     label: "Called — talked",  followUpDays: 5, advanceTo: "talking" },
  { key: "replied",   type: "email",    outcome: "replied",    label: "They replied",     followUpDays: 2, advanceTo: "talking" },
] as const;
export type QuickLogKey = (typeof QUICK_LOGS)[number]["key"];

const STAGE_ORDER: Record<string, number> = Object.fromEntries(LEAD_STAGES.map((s, i) => [s.key, i]));
/** Advance only: a quick log never drags a Committed lead back to Contacted,
 *  and never re-opens a closed one. */
export function advancedStage(current: LeadStage, target: LeadStage): LeadStage {
  if (CLOSED_STAGES.includes(current)) return current;
  return STAGE_ORDER[target] > STAGE_ORDER[current] ? target : current;
}

// ── Dates ────────────────────────────────────────────────────────────────────
export function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
/** Calendar-day addition on the date PARTS — no timezone in play. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
export type FollowUp = "overdue" | "today" | "upcoming" | "none";
/** DERIVED, never stored. A closed lead has nothing due. */
export function followUpStatus(on: string | null | undefined, today: string, stage: string): FollowUp {
  if (!on || CLOSED_STAGES.includes(stage as LeadStage)) return "none";
  if (on < today) return "overdue";
  if (on === today) return "today";
  return "upcoming";
}

// ── Where a lead is from ─────────────────────────────────────────────────────
// The form saves "City, Country"; older rows sometimes hold a bare city, so the
// country is DERIVED, never guessed: the location's last segment if it is a real
// country name, else the phone's dial code, else unknown.
const COUNTRY_BY_LOWER = new Map(NZF_COUNTRIES.map((c) => [c.name.toLowerCase(), c.name]));
export const DIAL_TO_COUNTRY: Record<string, string> = {
  "+64": "New Zealand", "+61": "Australia", "+66": "Thailand", "+81": "Japan", "+82": "South Korea", "+852": "Hong Kong",
  "+65": "Singapore", "+1": "USA / Canada", "+27": "South Africa", "+55": "Brazil", "+54": "Argentina", "+56": "Chile",
  "+598": "Uruguay", "+44": "United Kingdom", "+353": "Ireland", "+49": "Germany", "+31": "Netherlands", "+34": "Spain",
  "+351": "Portugal", "+977": "Nepal", "+679": "Fiji", "+685": "Samoa", "+676": "Tonga", "+91": "India", "+86": "China",
  "+60": "Malaysia", "+62": "Indonesia", "+63": "Philippines", "+33": "France", "+39": "Italy",
};
function dialCountry(phone: string | null | undefined): string | null {
  const digits = (phone || "").replace(/[^\d+]/g, "");
  if (!digits.startsWith("+")) return null;
  for (const len of [4, 3, 2]) { const k = digits.slice(0, len); if (DIAL_TO_COUNTRY[k]) return DIAL_TO_COUNTRY[k]; }
  return null;
}
function locationCountry(location: string | null | undefined): string | null {
  const loc = (location || "").trim();
  if (!loc.includes(",")) return null;
  return COUNTRY_BY_LOWER.get(loc.split(",").pop()!.trim().toLowerCase()) ?? null;
}
export function countryOf(r: { location: string | null; phone: string | null }): string | null {
  return locationCountry(r.location) ?? dialCountry(r.phone);
}

const MARKET_LABEL: Record<string, string> = {
  "north-island": "North Island", australia: "Australia", asia: "Asia", usa: "USA", "rest-of-world": "Rest of World", "south-island": "South Island",
};
/** Which ad market (or page) brought them — off the utm tags in sourceUrl. */
export function marketOf(sourceUrl: string | null): { label: string; paid: boolean } {
  const s = sourceUrl || "";
  const m = s.match(/utm_campaign=cic-2027-([a-z-]+)/i);
  if (m) return { label: `Meta ad · ${MARKET_LABEL[m[1].toLowerCase()] || m[1]}`, paid: true };
  if (/utm_source=|fbclid=/i.test(s)) return { label: "Ad click", paid: true };
  if (/\/cic-2027/i.test(s)) return { label: "CIC 2027 page", paid: false };
  return { label: "Website", paid: false };
}

// ── Warning flags ────────────────────────────────────────────────────────────
export interface FlagInput {
  id: number; firstName: string; lastName: string | null; email: string; phone: string | null;
  club: string | null; location: string | null; createdAt: string | Date;
}
/** `quiet` flags are weak on their own (a real federation can leave "club"
 *  blank) — they only surface as part of a two-signal "likely spam". */
export interface LeadFlag { key: string; label: string; spamSignal: boolean; quiet?: boolean; duplicateOf?: number }

const normEmail = (e: string) => e.trim().toLowerCase();
/** The last 8 digits: survives "+27 0762…" vs "+27 762…" and a wrong dial code. */
const phoneKey = (p: string | null) => { const d = (p || "").replace(/\D/g, ""); return d.length >= 8 ? d.slice(-8) : null; };

/**
 * Flags for every lead at once (duplicates need the whole list). A duplicate
 * points at the EARLIEST row with the same email or phone — the original is
 * never flagged, only the copies.
 */
export function leadFlags(rows: FlagInput[]): Map<number, LeadFlag[]> {
  const sorted = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id);
  const firstByEmail = new Map<string, number>();
  const firstByPhone = new Map<string, number>();
  const out = new Map<number, LeadFlag[]>();
  for (const r of sorted) {
    const flags: LeadFlag[] = [];
    const ek = normEmail(r.email);
    const pk = phoneKey(r.phone);
    const dup = firstByEmail.get(ek) ?? (pk ? firstByPhone.get(pk) : undefined);
    if (dup !== undefined) flags.push({ key: "duplicate", label: `Possible duplicate of #${dup}`, spamSignal: false, duplicateOf: dup });
    if (!firstByEmail.has(ek)) firstByEmail.set(ek, r.id);
    if (pk && !firstByPhone.has(pk)) firstByPhone.set(pk, r.id);

    const loc = locationCountry(r.location);
    const dial = dialCountry(r.phone);
    if (loc && dial && loc !== dial && !(dial === "USA / Canada" && /United States|Canada/i.test(loc))) {
      flags.push({ key: "phone_country", label: `Phone code is ${dial}, but they're in ${loc} — check the number`, spamSignal: false });
    }
    if ([r.firstName, r.lastName, r.club].some((n) => looksRandomName(n))) {
      flags.push({ key: "random_name", label: "A name reads as random characters", spamSignal: true });
    }
    if (/^(test|asdf|qwe|xxx|aaa)/i.test(r.firstName.trim()) || /@(test|example|mailinator|yopmail)\./i.test(r.email)) {
      flags.push({ key: "test_details", label: "Looks like test or throwaway details", spamSignal: true });
    }
    if (!(r.club || "").trim()) flags.push({ key: "no_club", label: "No club name given", spamSignal: true, quiet: true });
    if (!r.phone || (r.phone.replace(/\D/g, "").length < 7)) flags.push({ key: "no_phone", label: "No usable phone number", spamSignal: true, quiet: true });
    out.set(r.id, flags);
  }
  return out;
}
/** Two independent signals, never one. */
export function looksLikeSpam(flags: LeadFlag[]): boolean {
  return flags.filter((f) => f.spamSignal).length >= 2;
}
/** What a human should see: quiet flags only once they add up to spam. */
export function visibleFlags(flags: LeadFlag[]): LeadFlag[] {
  return looksLikeSpam(flags) ? flags : flags.filter((f) => !f.quiet);
}

/** A WhatsApp link from a typed phone, or null. Strips a trunk 0 after the dial
 *  code ("+27 0762…" → 27762…), which is how most of these are typed. */
export function whatsappHref(phone: string | null | undefined): string | null {
  const raw = (phone || "").trim();
  if (!raw.startsWith("+")) return null;
  // "+64 021…" says where the code ends; "+64210…" does not, so fall back to
  // the known dial codes, longest first.
  const spaced = raw.match(/^\+\s*(\d{1,4})[\s\-()]+(.*)$/);
  let code: string, restRaw: string;
  if (spaced) { code = spaced[1]; restRaw = spaced[2]; }
  else {
    const digits = raw.replace(/\D/g, "");
    const known = [4, 3, 2, 1].map((n) => digits.slice(0, n)).find((c) => DIAL_TO_COUNTRY["+" + c]);
    if (!known) return null;
    code = known; restRaw = digits.slice(known.length);
  }
  let rest = restRaw.replace(/\D/g, "");
  if (rest.startsWith(code) && rest.length > 9) rest = rest.slice(code.length);  // "+27 +2774…"
  rest = rest.replace(/^0+/, "");
  if (rest.length < 6) return null;
  return `https://wa.me/${code}${rest}`;
}

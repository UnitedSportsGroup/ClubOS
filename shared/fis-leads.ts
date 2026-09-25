// ─────────────────────────────────────────────────────────────────────────────
// Football in Schools — the outreach PIPELINE (2026-09-25).
//
// ONE decider for everything about a school/centre lead that is not a stored
// fact: which stages exist, which are open, when a follow-up is due, what a
// quick log does, and where that school's proposal page lives. The page, the
// server and the verifier all read this file. Pure — no DB, no React.
//
// Same shape as shared/cic-leads.ts (Isaac's CIC pipeline) on purpose, so the
// two boards behave the same way for staff. Different stages because a school
// buys a TERM after a meeting and a free session, not a tournament entry.
//
// 🔴 Stage values are validated HERE, never by a DB CHECK.
// ─────────────────────────────────────────────────────────────────────────────

export { addDaysIso, isIsoDate } from "./cic-leads";

export const FIS_KINDS = [
  { key: "school", label: "School", plural: "Schools" },
  { key: "elc", label: "Early learning centre", plural: "Early learning" },
] as const;
export type FisKind = (typeof FIS_KINDS)[number]["key"];
export function isFisKind(x: unknown): x is FisKind {
  return x === "school" || x === "elc";
}

/** The proposal page built for this school/centre — the thing Connor sends. */
export function fisPageUrl(kind: string, slug: string): string {
  return kind === "elc"
    ? `https://cufc.co.nz/football-in-early-learning/${slug}`
    : `https://cufc.co.nz/football-in-schools/${slug}`;
}

export const FIS_STAGES = [
  { key: "new",       label: "New",             color: "#64748b", hint: "Not contacted this year" },
  { key: "contacted", label: "Contacted",       color: "#0ea5e9", hint: "We've reached out, no reply yet" },
  { key: "talking",   label: "In conversation", color: "#8b5cf6", hint: "They've replied" },
  { key: "meeting",   label: "Meeting booked",  color: "#6366f1", hint: "A time is in the diary" },
  { key: "trial",     label: "Free session",    color: "#f59e0b", hint: "Free session booked or run" },
  { key: "proposal",  label: "Proposal sent",   color: "#f97316", hint: "Term dates and price sent" },
  { key: "booked",    label: "Booked",          color: "#22c55e", hint: "A term is booked with us" },
  { key: "not_now",   label: "Not now",         color: "#94a3b8", hint: "A real school that isn't going ahead" },
  { key: "not_a_fit", label: "Not a fit",       color: "#ef4444", hint: "Closed, duplicate or not for us" },
] as const;

export type FisStage = (typeof FIS_STAGES)[number]["key"];
export const FIS_CLOSED: readonly FisStage[] = ["not_now", "not_a_fit"];
export const FIS_OPEN: readonly FisStage[] = ["new", "contacted", "talking", "meeting", "trial", "proposal"];

export function isFisStage(x: unknown): x is FisStage {
  return typeof x === "string" && FIS_STAGES.some((s) => s.key === x);
}
export function fisStageLabel(key: string): string {
  return FIS_STAGES.find((s) => s.key === key)?.label ?? key;
}

export const NOT_NOW_REASONS = [
  { key: "has_provider", label: "Happy with their current provider" },
  { key: "budget", label: "No budget" },
  { key: "timing", label: "Wrong time — try next term" },
  { key: "no_response", label: "Stopped replying" },
  { key: "not_interested", label: "Not interested" },
  { key: "other", label: "Other" },
] as const;
export const NOT_A_FIT_REASONS = [
  { key: "duplicate", label: "Duplicate" },
  { key: "closed", label: "Closed or merged" },
  { key: "too_far", label: "Too far away" },
  { key: "wrong_type", label: "Not the right kind of place" },
  { key: "other", label: "Other" },
] as const;
export function fisReasonsFor(stage: string) {
  if (stage === "not_now") return NOT_NOW_REASONS;
  if (stage === "not_a_fit") return NOT_A_FIT_REASONS;
  return [] as const;
}
export function isFisReasonFor(stage: string, reason: unknown): boolean {
  return typeof reason === "string" && (fisReasonsFor(stage) as readonly { key: string }[]).some((r) => r.key === reason);
}
export function fisReasonLabel(stage: string, reason: string | null | undefined): string | null {
  if (!reason) return null;
  return (fisReasonsFor(stage) as readonly { key: string; label: string }[]).find((r) => r.key === reason)?.label ?? reason;
}

export const FIS_PRIORITIES = [
  { key: "hot", label: "Hot" },
  { key: "warm", label: "Warm" },
  { key: "cold", label: "Cold" },
] as const;
export function isFisPriority(x: unknown): x is "hot" | "warm" | "cold" {
  return x === "hot" || x === "warm" || x === "cold";
}

export const FIS_ACTIVITY_TYPES = ["call", "email", "visit", "note", "stage_change"] as const;
export type FisActivityType = (typeof FIS_ACTIVITY_TYPES)[number];
export function isFisActivityType(x: unknown): x is FisActivityType {
  return typeof x === "string" && (FIS_ACTIVITY_TYPES as readonly string[]).includes(x);
}

/** The quick-log buttons. Each sets the next follow-up and moves a lead
 *  FORWARD only — never backwards, never out of a closed stage. */
export const FIS_QUICK_LOGS = [
  { key: "emailed",   type: "email", outcome: "sent",      label: "Emailed the page",   followUpDays: 4, advanceTo: "contacted" },
  { key: "no_answer", type: "call",  outcome: "no_answer", label: "Called — no answer", followUpDays: 2, advanceTo: "contacted" },
  { key: "voicemail", type: "call",  outcome: "voicemail", label: "Left a message",     followUpDays: 3, advanceTo: "contacted" },
  { key: "talked",    type: "call",  outcome: "talked",    label: "Called — talked",    followUpDays: 5, advanceTo: "talking" },
  { key: "replied",   type: "email", outcome: "replied",   label: "They replied",       followUpDays: 2, advanceTo: "talking" },
  { key: "visited",   type: "visit", outcome: "visited",   label: "Dropped in",         followUpDays: 5, advanceTo: "talking" },
] as const;
export type FisQuickLogKey = (typeof FIS_QUICK_LOGS)[number]["key"];

const ORDER: Record<string, number> = Object.fromEntries(FIS_STAGES.map((s, i) => [s.key, i]));
export function fisAdvancedStage(current: FisStage, target: FisStage): FisStage {
  if (FIS_CLOSED.includes(current)) return current;
  return ORDER[target] > ORDER[current] ? target : current;
}

export type FisFollowUp = "overdue" | "today" | "upcoming" | "none";
/** DERIVED, never stored. A closed or booked lead has nothing due. */
export function fisFollowUpStatus(on: string | null | undefined, today: string, stage: string): FisFollowUp {
  if (!on || FIS_CLOSED.includes(stage as FisStage)) return "none";
  if (on < today) return "overdue";
  if (on === today) return "today";
  return "upcoming";
}

/** A tel: href from a typed NZ number, or null. */
export function telHref(phone: string | null | undefined): string | null {
  const d = (phone || "").replace(/[^\d+]/g, "");
  return d.replace(/\D/g, "").length >= 7 ? `tel:${d}` : null;
}

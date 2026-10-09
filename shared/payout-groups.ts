/**
 * Which part of the club a payout line belongs to — and its badge.
 *
 * Daniel, 2026-10-09, of a payout's breakdown: "make sure it has same badges
 * and separation for like academy, additional, holiday camps, leagues, dinner".
 *
 * 🔴 Academy · Additional · Holiday camp come from `programmeKind()` — the SAME
 * decider the Registrations list colours with, so a camp is amber on both
 * screens and a new programme cannot be one colour here and another there.
 * Everything else is decided by WHAT was paid for, which the server already
 * knows when it matches the payment.
 */
import { programmeKind, PROGRAMME_KIND_META } from "./programme-kinds";

export type PayoutGroup =
  | "academy" | "additional" | "camp"
  | "league" | "tournament" | "event"
  | "shop" | "membership" | "venue" | "print" | "invoice" | "gymnastics"
  | "stripe" | "other";

/** Mini Football Leagues' workspace — every programme it sells is a league
 *  product, Ballers included (an individual sign-up on the academy engine). */
const MFL_ORG_ID = 3;

export function registrationGroup(p: { type?: string | null; academySection?: string | null; organizationId?: number | null } | null | undefined): PayoutGroup {
  if (!p) return "other";
  const type = String(p.type ?? "").toLowerCase();
  if (type === "league_team" || p.organizationId === MFL_ORG_ID) return "league";
  const k = programmeKind(p);
  return k === "other" ? "other" : k;
}

export const PAYOUT_GROUP_META: Record<PayoutGroup, { label: string; chip: string; dot: string }> = {
  academy: { label: "Academy", chip: PROGRAMME_KIND_META.academy.chip, dot: PROGRAMME_KIND_META.academy.dot },
  additional: { label: "Additional", chip: PROGRAMME_KIND_META.additional.chip, dot: PROGRAMME_KIND_META.additional.dot },
  camp: { label: "Holiday camp", chip: PROGRAMME_KIND_META.camp.chip, dot: PROGRAMME_KIND_META.camp.dot },
  league: { label: "Leagues", chip: "border-yellow-600/30 text-yellow-700 bg-yellow-500/[0.10]", dot: "bg-yellow-500/70 border-yellow-600/70" },
  tournament: { label: "Tournaments", chip: "border-lime-600/30 text-lime-700 bg-lime-500/[0.10]", dot: "bg-lime-500/70 border-lime-600/70" },
  event: { label: "Events", chip: "border-rose-500/25 text-rose-500 bg-rose-500/[0.08]", dot: "bg-rose-500/60 border-rose-500/70" },
  shop: { label: "Store", chip: "border-emerald-500/25 text-emerald-600 bg-emerald-500/[0.08]", dot: "bg-emerald-500/60 border-emerald-500/70" },
  membership: { label: "Membership", chip: "border-teal-500/25 text-teal-600 bg-teal-500/[0.08]", dot: "bg-teal-500/60 border-teal-500/70" },
  venue: { label: "Venue hire", chip: "border-cyan-500/25 text-cyan-600 bg-cyan-500/[0.08]", dot: "bg-cyan-500/60 border-cyan-500/70" },
  print: { label: "United Prints", chip: "border-orange-500/25 text-orange-600 bg-orange-500/[0.08]", dot: "bg-orange-500/60 border-orange-500/70" },
  invoice: { label: "Invoices", chip: "border-indigo-500/25 text-indigo-500 bg-indigo-500/[0.08]", dot: "bg-indigo-500/60 border-indigo-500/70" },
  gymnastics: { label: "Gymnastics", chip: "border-sky-500/25 text-sky-600 bg-sky-500/[0.08]", dot: "bg-sky-500/60 border-sky-500/70" },
  stripe: { label: "Stripe", chip: "border-white/12 text-white/45 bg-white/[0.03]", dot: "bg-white/30 border-white/40" },
  other: { label: "Not matched", chip: "border-white/12 text-white/45 bg-white/[0.03]", dot: "bg-white/30 border-white/40" },
};

/** The order groups read in, on the breakdown and in its subtotals. */
export const PAYOUT_GROUP_ORDER: PayoutGroup[] = [
  "academy", "additional", "camp", "league", "tournament", "event",
  "shop", "membership", "venue", "print", "invoice", "gymnastics", "stripe", "other",
];

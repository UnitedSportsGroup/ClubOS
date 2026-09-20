// ─────────────────────────────────────────────────────────────────────────────
// CUGC term pricing — SERVER-AUTHORITATIVE.
// A faithful mirror of apps/cugc-website/src/lib/pricing.ts (the proration
// engine) plus the Term 3 program/option/price data from
// apps/cugc-website/src/site.ts. The enrol endpoint computes the price from
// THIS module — the client-sent price is always ignored.
// ─────────────────────────────────────────────────────────────────────────────

// 🔴 The term list moved to shared/cugc-terms.ts on 2026-09-20 when Term 4
// opened. There is no longer a single `CUGC_TERM` constant, because one
// constant cannot mean both "the term we are selling" and "the term this
// enrolment is for" — see the header of that file for what that cost.
export {
  CUGC_TERMS, termStatus, isSellable, sellableTerms, defaultTerm,
  termById, termByName, resolveTermForSale, termWindowLabel, nzTodayIso,
  type CugcTerm, type CugcTermStatus, type TermResolution,
} from "@shared/cugc-terms";
import { type CugcTerm, termById, defaultTerm, nzTodayIso } from "@shared/cugc-terms";

export type CugcOption = { label: string; price: number; times: string[] }; // full-term price in NZD
export type CugcProgram = {
  slug: string; title: string; ages: string; image: string; // image = path on cugc.co.nz
  annual?: boolean; inviteOnly?: boolean;
  options: CugcOption[];
};

// Mirrors apps/cugc-website/src/site.ts `programs` (slug, title, ages, options[].label/price/times).
export const CUGC_PROGRAMS: CugcProgram[] = [
  {
    slug: "gymplay",
    title: "GymPlay",
    ages: "3–6 years",
    image: "/img/program-1.jpg",
    options: [
      {
        label: "1–2 sessions per week",
        price: 165,
        times: ["Wednesday 4:00–4:45pm", "Saturday 9:30–10:15am", "Saturday 10:30–11:15am"],
      },
    ],
  },
  {
    slug: "gymbasics",
    title: "GymBasics",
    ages: "5–7 & 8+ years",
    image: "/img/program-2.jpg",
    options: [
      { label: "Ages 5–7 · once a week", price: 250, times: ["Tuesday 4:00–5:30pm", "Saturday 9:00–10:30am"] },
      { label: "Ages 5–7 · twice a week", price: 350, times: ["Tuesday + Saturday"] },
      { label: "Ages 8+ · once a week", price: 195, times: ["Friday 4:00–5:00pm"] },
    ],
  },
  {
    slug: "competitive",
    title: "Competitive Stream — Level 1",
    ages: "By invitation",
    image: "/img/program-3.jpg",
    annual: true,
    inviteOnly: true,
    options: [
      { label: "1× per week (2 hours)", price: 295, times: ["Thursday"] },
      { label: "2× per week (4.5 hours)", price: 565, times: ["Tuesday or Thursday, + Saturday"] },
    ],
  },
];

// ── Discount / test codes for the enrol flow ─────────────────────────────────
// Server-side only (never in the client bundle). Codes are normalised to
// uppercase before lookup. priceCentsOverride REPLACES the computed term price
// for the whole enrolment. Remove test codes once they've served their purpose.
export const CUGC_DISCOUNT_CODES: Record<string, { label: string; priceCentsOverride: number }> = {
  "CUGC-TEST-2741": { label: "Internal $1 end-to-end payment test", priceCentsOverride: 100 },
};

/** Whole days from `a` to `b`, both `YYYY-MM-DD`. Anchored at UTC midnight so
 *  the arithmetic is timezone-free — these are calendar dates, not instants. */
function daysBetween(aIso: string, bIso: string): number {
  return Math.round((Date.parse(`${bIso}T00:00:00Z`) - Date.parse(`${aIso}T00:00:00Z`)) / 86_400_000);
}

export type CugcPricing = {
  status: "upcoming" | "active" | "ended";
  fullPrice: number;
  price: number;
  weeksTotal: number;
  weeksLeft: number;
  discountPct: number;
  prorated: boolean;
};

/**
 * Compute today's price for a term-priced program. Identical logic to the
 * website's proratedTermPrice so the price the family saw matches the charge —
 * the two are kept honest by `npm run check:cugc-terms`, not by good intentions.
 *
 * 🔴 Every boundary is decided on the NZ CALENDAR DATE, compared as a string.
 * It used to compare a UTC instant against a locally-parsed midnight, which on
 * a Fly machine running UTC flips a term up to a day early or late — and a term
 * boundary being a day out is the difference between charging full price and
 * charging a tenth of it. `end` is INCLUSIVE: a class runs on the last day.
 */
export function proratedTermPrice(
  fullPrice: number,
  startIso: string,
  endIso: string,
  weeksTotal: number,
  now: Date = new Date(),
): CugcPricing {
  const today = nzTodayIso(now);
  const base = { fullPrice, weeksTotal, price: fullPrice, weeksLeft: weeksTotal, discountPct: 0, prorated: false };

  if (today < startIso) return { ...base, status: "upcoming" };
  // An ended term still reports its full price, but nothing can BUY it —
  // `isSellable()` refuses first. That ordering is the whole fix for the
  // 26 September hole; this number is for display only.
  if (today > endIso) return { ...base, status: "ended", price: fullPrice, weeksLeft: 0 };

  const weeksElapsed = Math.floor(daysBetween(startIso, today) / 7);
  const weeksLeft = Math.max(1, weeksTotal - weeksElapsed); // always at least 1 week's value
  const price = Math.round((fullPrice * weeksLeft) / weeksTotal);
  const discountPct = Math.round(((fullPrice - price) / fullPrice) * 100);

  return { status: "active", fullPrice, price, weeksTotal, weeksLeft, discountPct, prorated: price < fullPrice };
}

/**
 * Resolve a program + option from the enrol form and price it server-side.
 * Returns null if the program slug or option index is invalid.
 */
export function computeCugcEnrolPrice(
  programSlug: string,
  optionIndex: number,
  term: CugcTerm | string | null = null,
  now: Date = new Date(),
): { program: CugcProgram; option: CugcOption; pricing: CugcPricing; term: CugcTerm } | null {
  const program = CUGC_PROGRAMS.find((p) => p.slug === programSlug);
  if (!program) return null;
  if (!Number.isInteger(optionIndex)) return null;
  const option = program.options[optionIndex];
  if (!option) return null;

  // 🔴 Priced against the term's OWN dates, so Term 4's price is its full price
  // while Term 3 is running out its last fortnight. One shared constant could
  // only ever have priced one of them.
  const resolved = typeof term === "string" ? termById(term) : term;
  const forTerm = resolved ?? defaultTerm(nzTodayIso(now));
  if (!forTerm) return null;

  const pricing = proratedTermPrice(option.price, forTerm.start, forTerm.end, forTerm.weeks, now);
  return { program, option, pricing, term: forTerm };
}

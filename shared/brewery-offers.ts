/**
 * Brewery partner offers — types and the ONE value calculator (2026-09-25).
 *
 * The offers themselves live server-side (server/brewery-offers.ts) because
 * they carry a brewer's confidential volumes and every price a rival would like
 * to see; the client bundle is public. This file holds only shapes and maths.
 *
 * 🔴 Every view (cards, comparison table, calculator, chart) prices an offer
 *    through breweryValue(). A second copy of the arithmetic in a component is
 *    how two tabs end up quoting two different numbers for the same deal.
 */

export type RebateTier = { fromHl: number; toHl: number | null; perHlCents: number };

export interface BreweryOffer {
  key: string;
  brewery: string;
  parent: string | null;
  colour: string;
  contact: { name: string; role: string; email: string | null; phone: string | null };
  channel: string;
  receivedOn: string | null;          // ISO date the offer landed; null = no written offer seen
  hasWrittenOffer: boolean;
  status: string;
  nextAction: string;
  sponsorship: { lowCents: number | null; highCents: number | null; basis: string };
  rebate: { tiers: RebateTier[]; note: string };
  stadiumRebatePerHlCents: number | null;
  pctOfPurchases: number | null;      // % of everything bought, e.g. 4
  promoFundPerHlCents: number | null; // accrues into a promotions fund — NOT cash to the club
  oneOffs: { label: string; cents: number; kind: "cash" | "fitout" | "promo" }[];
  productInKind: string[];
  stockPricing: string[];
  loan: { answer: "no" | "discuss" | "unknown"; detail: string };
  termYears: number | null;           // null = rolling / unknown
  termLabel: string;
  exclusivity: string;
  range: string;
  delivery: string;
  paymentTerms: string;
  service: string;
  strengths: string[];
  watchOuts: string[];
  openQuestions: string[];
}

export interface VolumeEstimate {
  key: string;
  label: string;
  hlPerYear: number;
  source: string;
  note: string;
  confidential?: boolean;
}

export interface BreweryTimelineEvent { date: string; brewery: string; who: string; what: string }

export interface BreweryBoard {
  updatedOn: string;
  summary: string;
  assumedPurchaseCentsPerHl: number;
  offers: BreweryOffer[];
  volumes: VolumeEstimate[];
  issues: { title: string; detail: string }[];
  looseEnds: { brewery: string; detail: string }[];
  timeline: BreweryTimelineEvent[];
  submissions: Record<string, { receivedAt: string; subject: string; text: string }>;
  dbOfferPage: { label: string; value: string }[];
  dbObligations: { label: string; value: string }[];
}

/** The rebate rate for a year's volume. A tier table pays the band the TOTAL reaches, on all of it. */
export function rebateRateCents(offer: BreweryOffer, hl: number): number {
  const t = offer.rebate.tiers.find(t => hl >= t.fromHl && (t.toHl == null || hl < t.toHl))
    ?? offer.rebate.tiers[offer.rebate.tiers.length - 1];
  return t ? t.perHlCents : 0;
}

export interface BreweryValue {
  sponsorshipLowCents: number;
  sponsorshipHighCents: number;
  rebateCents: number;
  purchasesPctCents: number;
  cashPerYearLowCents: number;
  cashPerYearHighCents: number;
  promoPerYearCents: number;
  oneOffCashCents: number;
  oneOffInKindCents: number;
  years: number;
  overYearsLowCents: number;
  overYearsHighCents: number;
  knowable: boolean;                  // false when there is no written offer to price
}

/**
 * What an offer is worth at `hl` hectolitres a year, over `years` years.
 * Cash = sponsorship + rebate + % of purchases. Promo accrual and fit-out
 * one-offs are reported separately and added to the over-years figure only
 * when `includeInKind` is set — a tap install is worth money only if we'd
 * otherwise have bought the taps.
 */
export function breweryValue(
  offer: BreweryOffer, hl: number, years: number, purchaseCentsPerHl: number, includeInKind: boolean,
): BreweryValue {
  const knowable = offer.hasWrittenOffer;
  const sLow = offer.sponsorship.lowCents ?? 0;
  const sHigh = offer.sponsorship.highCents ?? sLow;
  const rebate = Math.round(rebateRateCents(offer, hl) * hl);
  const pct = offer.pctOfPurchases ? Math.round(hl * purchaseCentsPerHl * offer.pctOfPurchases / 100) : 0;
  const promo = offer.promoFundPerHlCents ? Math.round(offer.promoFundPerHlCents * hl) : 0;
  const oneOffCash = offer.oneOffs.filter(o => o.kind === "cash").reduce((a, o) => a + o.cents, 0);
  const oneOffKind = offer.oneOffs.filter(o => o.kind !== "cash").reduce((a, o) => a + o.cents, 0);
  const lowYear = sLow + rebate + pct;
  const highYear = sHigh + rebate + pct;
  const extra = oneOffCash + (includeInKind ? oneOffKind + promo * years : 0);
  return {
    sponsorshipLowCents: sLow, sponsorshipHighCents: sHigh, rebateCents: rebate, purchasesPctCents: pct,
    cashPerYearLowCents: lowYear, cashPerYearHighCents: highYear, promoPerYearCents: promo,
    oneOffCashCents: oneOffCash, oneOffInKindCents: oneOffKind, years,
    overYearsLowCents: lowYear * years + extra, overYearsHighCents: highYear * years + extra,
    knowable,
  };
}

/**
 * The partner form emails every answer as ONE run-on paragraph ("Company X Contact Y
 * Email … Notes: …"). This cuts it at the form's own field labels so it reads as the
 * form they filled in. It never edits a word: each answer is the exact slice of the
 * email between two labels, and the pieces rejoin to the original (checked by
 * script/_test-brewery-submission-split.ts). Anything it cannot place — a submission
 * that is not a form email (DB's covering letter), or a shape it does not recognise —
 * returns null and the caller shows the raw text instead.
 */
export const SUBMISSION_FIELDS: { label: string; title: string }[] = [
  { label: "Company ", title: "Company" },
  { label: "Contact ", title: "Contact" },
  { label: "Email ", title: "Email" },
  { label: "Phone ", title: "Phone" },
  { label: "Sponsorship ", title: "Sponsorship" },
  { label: "Volume rebate ", title: "Volume rebate" },
  { label: "Notes: ", title: "Notes" },
  { label: "Supply terms ", title: "Supply terms" },
  { label: "Discounted stocking price: ", title: "Discounted stocking price" },
  { label: "Timing & delivery: ", title: "Timing & delivery" },
  { label: "Service: ", title: "Service" },
  { label: "Build loan ", title: "Build loan" },
  { label: "Proposed terms: ", title: "Proposed terms" },
  { label: "Term ", title: "Term" },
  { label: "In their words ", title: "In their words" },
];

export interface SubmissionSection { title: string; text: string }

export function splitSubmission(raw: string): { preamble: string; sections: SubmissionSection[] } | null {
  const text = raw.replace(/\r\n/g, "\n");
  if (!/^New partner submission\b/.test(text)) return null;
  const hits: { at: number; end: number; title: string }[] = [];
  let cursor = 0;
  for (const f of SUBMISSION_FIELDS) {
    const at = text.indexOf(f.label, cursor);
    if (at < 0) continue;                       // an optional field this form did not have
    hits.push({ at, end: at + f.label.length, title: f.title });
    cursor = at + f.label.length;
  }
  // The first five are always on the form; without them this is not the email we know.
  const must = ["Company", "Contact", "Email", "Sponsorship", "Term"];
  if (!must.every(t => hits.some(h => h.title === t))) return null;
  const sections = hits.map((h, i) => ({
    title: h.title,
    text: text.slice(h.end, i + 1 < hits.length ? hits[i + 1].at : text.length).trim(),
  }));
  return { preamble: text.slice(0, hits[0].at).trim(), sections };
}

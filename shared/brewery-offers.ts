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

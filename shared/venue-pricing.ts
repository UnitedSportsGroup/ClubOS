/**
 * ONE decider for what an hour of a facility costs.
 *
 * WHY THIS FILE EXISTS. Until 2026-09-11 the rate was worked out in two places
 * that had to agree and nothing made them: `calcItemPriceCents` on the server
 * (what the customer is actually charged) and `pricePerHourForSlot` in
 * `venue-book.tsx` (the price printed on the slot before they click it). Two
 * implementations of one money rule is the drift that ends with a booking page
 * advertising one number and a card being charged another. Both now call in
 * here.
 *
 * WHAT CHANGED, AND WHY. `facility_pricing_rules` carries a day_of_week and a
 * time window and NOTHING ABOUT DATES, so the venue could not express the one
 * thing that is obviously true of a sports centre: a Tuesday morning in the
 * school holidays is not a Tuesday morning in term time. In term time a weekday
 * morning is the quiet part of the day and is priced off-peak; in the holidays
 * it is the busiest part of the day.
 *
 * That gap had already cost real money once. The Barça Academy camp quote
 * (CUFC-2026-013, 25-29 Jan 2027) charges the peak rate for the whole camp
 * because the week is summer holiday — and the public booking site would have
 * quoted the off-peak morning rate for the same hours, so the quote and the
 * page a customer can check disagreed. Travis spotted it before it was sent.
 *
 * THE RULE, in one sentence: in the school holidays a WEEKDAY is priced
 * 09:00-21:00 at peak, with the tails either side off-peak. Weekends are
 * untouched — a Saturday is a Saturday whether or not school is in.
 */

/**
 * When a rule applies. `always` is every rule that existed before this file and
 * is the default, so a database with no seasonal rules behaves exactly as it did
 * yesterday. That is deliberate: this must be an addition, never a repricing.
 */
export type PricingSeason = "always" | "school_holidays" | "term_time";

export const PRICING_SEASONS: PricingSeason[] = ["always", "school_holidays", "term_time"];

export interface HolidayPeriod {
  /** Inclusive ISO date, NZ calendar day. */
  startsOn: string;
  /** Inclusive ISO date, NZ calendar day. */
  endsOn: string;
  name?: string;
}

export interface PricingRuleLike {
  dayOfWeek: number | null;
  startTime: string | null;
  endTime: string | null;
  pricePerHour: string;
  halfFieldPricePerHour?: string | null;
  quarterFieldPricePerHour?: string | null;
  isDefault: boolean | null;
  /**
   * Missing/null reads as "always" — every pre-existing row.
   *
   * Typed as a plain string because that is what the column is: `text`, with no
   * CHECK and no pg enum, deliberately. Narrowed by `ruleSeason` below, so an
   * unrecognised value degrades to a rule that simply never matches rather than
   * throwing inside a checkout.
   */
  appliesTo?: string | null;
}

/**
 * Day of week for an ISO date, 0 = Sunday, matching `Date.prototype.getDay`.
 *
 * 🔴 Built from the STRING's own parts through Date.UTC, never `new Date(iso)`.
 * A bare `new Date("2027-01-25")` is parsed as UTC midnight and then read back
 * in the reader's zone, which is the previous day in New Zealand — the bug that
 * has already printed an invoice due "18 July" on an invoice due the 17th.
 */
export function dayOfWeekForIso(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Inclusive both ends. Plain string comparison — ISO dates sort correctly. */
export function isSchoolHoliday(dateIso: string, periods: HolidayPeriod[]): boolean {
  return periods.some(p => dateIso >= p.startsOn && dateIso <= p.endsOn);
}

/** The named period a date falls in, for showing a customer WHY they are paying peak. */
export function holidayPeriodFor(dateIso: string, periods: HolidayPeriod[]): HolidayPeriod | null {
  return periods.find(p => dateIso >= p.startsOn && dateIso <= p.endsOn) ?? null;
}

/**
 * The season a given date is being priced in. A date inside a declared holiday
 * period is `school_holidays`; every other date is `term_time`.
 *
 * 🔴 With NO periods declared, every date is `term_time` and no `school_holidays`
 * rule can ever match. A venue that has not told us its holiday dates must not
 * start charging holiday rates on a guess.
 */
export function seasonFor(dateIso: string, periods: HolidayPeriod[]): Exclude<PricingSeason, "always"> {
  return isSchoolHoliday(dateIso, periods) ? "school_holidays" : "term_time";
}

function ruleSeason(r: PricingRuleLike): PricingSeason {
  const v = r.appliesTo;
  if (v === "school_holidays" || v === "term_time" || v === "always") return v;
  // Null, undefined, or something nobody recognises. "always" is the pre-2026-09-11
  // behaviour and the only safe reading of a value we cannot interpret.
  return "always";
}

/**
 * Does this rule cover this slot? A rule with a null dayOfWeek covers EVERY day
 * — that is how a seasonal window is written once instead of five times.
 */
function covers(r: PricingRuleLike, dayOfWeek: number, startTime: string, endTime: string): boolean {
  if (r.dayOfWeek != null && r.dayOfWeek !== dayOfWeek) return false;
  if (!r.startTime || !r.endTime) return false;
  return startTime >= r.startTime && endTime <= r.endTime;
}

export interface ResolvedRate {
  fullPerHourCents: number;
  halfPerHourCents: number | null;
  quarterPerHourCents: number | null;
  /** Which rule won, for explaining a price back to a customer or a verifier. */
  ruleName: PricingSeason | "default" | "facility";
  season: Exclude<PricingSeason, "always">;
  isHoliday: boolean;
}

export interface FacilityRateFallback {
  pricePerHourCents: number | null;
  halfFieldPricePerHourCents: number | null;
  quarterFieldPricePerHourCents?: number | null;
}

function dollarsToCents(v: string | null | undefined): number | null {
  if (v == null) return null;
  return Math.round(parseFloat(v) * 100);
}

/**
 * THE decider. Resolution order, most specific first:
 *
 *   1. a rule for THIS season (school_holidays or term_time) covering the slot
 *   2. an `always` rule covering the slot          ← every rule that existed before
 *   3. the `isDefault` rule
 *   4. the facility's own base price
 *
 * Step 1 is the only new step. Remove every seasonal rule from the database and
 * this function returns exactly what the old code returned, which is what makes
 * it safe to ship to a page that is already taking money.
 */
export function resolveRate(
  slot: { date: string; startTime: string; endTime: string },
  facility: FacilityRateFallback,
  rules: PricingRuleLike[],
  holidayPeriods: HolidayPeriod[],
): ResolvedRate {
  const dayOfWeek = dayOfWeekForIso(slot.date);
  const isHoliday = isSchoolHoliday(slot.date, holidayPeriods);
  const season = isHoliday ? "school_holidays" : "term_time";

  const seasonal = rules.find(r => ruleSeason(r) === season && covers(r, dayOfWeek, slot.startTime, slot.endTime));
  const always = seasonal ?? rules.find(r => ruleSeason(r) === "always" && covers(r, dayOfWeek, slot.startTime, slot.endTime));

  if (always) {
    return {
      fullPerHourCents: dollarsToCents(always.pricePerHour) ?? 0,
      halfPerHourCents: dollarsToCents(always.halfFieldPricePerHour),
      quarterPerHourCents: dollarsToCents(always.quarterFieldPricePerHour),
      ruleName: seasonal ? season : "always",
      season,
      isHoliday,
    };
  }

  const def = rules.find(r => r.isDefault);
  if (def) {
    return {
      fullPerHourCents: dollarsToCents(def.pricePerHour) ?? 0,
      halfPerHourCents: dollarsToCents(def.halfFieldPricePerHour),
      quarterPerHourCents: dollarsToCents(def.quarterFieldPricePerHour),
      ruleName: "default",
      season,
      isHoliday,
    };
  }

  return {
    fullPerHourCents: facility.pricePerHourCents ?? 0,
    halfPerHourCents: null,
    quarterPerHourCents: null,
    ruleName: "facility",
    season,
    isHoliday,
  };
}

/**
 * Per-hour price for the size of pitch actually being booked.
 *
 * Resolution for half: rule half → facility half → half of full.
 * For quarter: rule quarter → facility quarter → half of the half → quarter of full.
 * Unchanged from the behaviour this replaced; moved here so both callers share it.
 */
export function perHourCentsForSize(
  resolved: ResolvedRate,
  facility: FacilityRateFallback,
  halfFull: string | null | undefined,
): number {
  if (halfFull === "half") {
    if (resolved.halfPerHourCents != null) return resolved.halfPerHourCents;
    if (facility.halfFieldPricePerHourCents != null) return facility.halfFieldPricePerHourCents;
    return Math.round(resolved.fullPerHourCents / 2);
  }
  if (halfFull === "quarter") {
    if (resolved.quarterPerHourCents != null) return resolved.quarterPerHourCents;
    if (facility.quarterFieldPricePerHourCents != null) return facility.quarterFieldPricePerHourCents;
    if (resolved.halfPerHourCents != null) return Math.round(resolved.halfPerHourCents / 2);
    if (facility.halfFieldPricePerHourCents != null) return Math.round(facility.halfFieldPricePerHourCents / 2);
    return Math.round(resolved.fullPerHourCents / 4);
  }
  return resolved.fullPerHourCents;
}

/** Minutes between two "HH:MM" times on the same day. */
export function slotMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

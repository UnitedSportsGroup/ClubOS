// Promo codes on the light term checkout (/{slug}/class-book — Ballers).
//
// ONE decider for what a code does to a class booking. The preview endpoint
// and the intent both call it, so the number a parent sees before typing a
// card is the number Stripe charges.
//
// Two shapes:
//   upfront        — the code comes off what is paid today (after pro-rata).
//   deposit_weekly — the deposit that holds the place stays the same; the code
//                    comes off the WEEKLY payments. "$20 now, then $10 × 8"
//                    with 20% off is "$20 now, then $7.50 × 8" ($80).
// A weekly amount that does not divide evenly is rounded DOWN, so the family
// gets the odd cent rather than paying it, and deposit + weeks × weekly always
// equals the term total exactly.
import { promoDiscountCents, STRIPE_MIN_CHARGE_CENTS } from "./academy";

export interface ClassPromoInput {
  valueType: string;
  value: number | string;
  /** What would be charged today with no code: the full or pro-rated term. */
  payNowCents: number;
  depositWeekly?: { depositCents: number; weeks: number; weeklyCents: number } | null;
}

export type ClassPromoResult =
  | { ok: true; promoCents: number; termTotalCents: number; payTodayCents: number; weeklyCents: number | null }
  | { ok: false; reason: string };

export function applyClassPromo(i: ClassPromoInput): ClassPromoResult {
  const plan = i.depositWeekly;
  if (plan) {
    const { depositCents, weeks, weeklyCents } = plan;
    const full = depositCents + weeks * weeklyCents;
    const promo = promoDiscountCents(full, i.valueType, i.value);
    if (promo <= 0) return { ok: false, reason: "That code doesn't take anything off." };
    const remaining = full - depositCents - promo;
    const newWeekly = Math.floor(remaining / weeks);
    if (newWeekly < STRIPE_MIN_CHARGE_CENTS) {
      return { ok: false, reason: "That code can't be used with the weekly plan — please pay in full." };
    }
    const termTotal = depositCents + weeks * newWeekly;
    return { ok: true, promoCents: full - termTotal, termTotalCents: termTotal, payTodayCents: depositCents, weeklyCents: newWeekly };
  }
  const promo = promoDiscountCents(i.payNowCents, i.valueType, i.value);
  if (promo <= 0) return { ok: false, reason: "That code doesn't take anything off." };
  const total = i.payNowCents - promo;
  if (total < STRIPE_MIN_CHARGE_CENTS) return { ok: false, reason: "That code covers the full fee — we can't take a $0 payment here." };
  return { ok: true, promoCents: promo, termTotalCents: total, payTodayCents: total, weeklyCents: null };
}

/** A class-book code must NAME the programme. Org-wide ("all") codes were
 *  written for MFL league teams (EARLYBIRD, MULTITEAM) and must not start
 *  discounting youth sign-ups the day this checkout learns to take a code. */
export function classPromoCoversProgram(promo: { appliesTo: string; campIds: number[] | null }, programId: number): boolean {
  return promo.appliesTo === "specific_camps" && (promo.campIds ?? []).includes(programId);
}

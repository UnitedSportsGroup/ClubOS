// ── Academy AutoPay: the ONE decider for what a family is charged, and when ──
//
// Daniel, 4 Nov 2026: "an industry gold standard system like gyms use … as
// easy, fast and automated for our side". Plan: plans/2026-11-04-academy-autopay.md
// Research: outputs/deep-research/2026-11-04-club-fee-collection/synthesis.md
//
// Every surface that shows or charges an AutoPay schedule (checkout, the parent
// account, the renewal notice, the staff Payments screen, the Stripe charger)
// reads THIS function. The browser never decides an amount; the server re-runs
// this and charges what it returns.
//
// Rules, each one a decision with a reason:
//
// 1. The term fee comes in already priced (academyQuoteFor / pro-rata). This
//    file never prices a programme; it only splits a price over time.
// 2. Instalments add up to the term fee EXACTLY, rounded once: every charge is
//    the floor share and the remainder rides on the FIRST charge (so a family
//    who stops paying has paid the larger share, never the smaller).
// 3. PAID IN ADVANCE. Charge 1 is taken at sign-up (or on the renewal date);
//    every later charge falls on the START of a teaching week, and the last
//    charge is no later than the start of the final week. So the club is never
//    owed money for sessions already delivered, which keeps a weekly plan a
//    way of paying, not credit (CCCFA). Same price as paying in full: no fee,
//    no discount for paying weekly.
// 4. Weekly only when it means at least 2 charges. A join in the final week is
//    one charge, i.e. pay in full.
// 5. Monthly is NOT offered yet: months do not line up with 10-week terms, and
//    the research recommends launching with full + weekly (synthesis §Rec).
// 6. Dates are bare ISO yyyy-mm-dd strings, worked on their parts. Never a JS
//    Date in local time (the NZ/UTC day-boundary bug this repo has hit 5 times).

export type AutoPayPlan = "full" | "weekly";
export const AUTOPAY_PLANS: readonly AutoPayPlan[] = ["full", "weekly"] as const;

export type PaymentMethodKind = "card" | "nz_bank_account";

export interface PlanInput {
  plan: AutoPayPlan;
  /** The price of what is being bought, already pro-rated if it applies. */
  termFeeCents: number;
  termStartIso: string;
  termEndIso: string;
  /** When the first charge is taken: sign-up day, or the renewal date. */
  firstChargeIso: string;
}

export interface PlannedCharge {
  /** 1-based. */
  n: number;
  dueIso: string;
  amountCents: number;
  /** "Payment 1 of 10" — what the family reads. */
  label: string;
}

export interface PlanSchedule {
  plan: AutoPayPlan;
  totalCents: number;
  charges: PlannedCharge[];
  /** The plan asked for vs the plan given (weekly collapses to full near the end). */
  requestedPlan: AutoPayPlan;
  /** Plain-English summary for the agreement text. */
  summary: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function toDayNumber(iso: string): number {
  if (!ISO.test(iso)) throw new Error(`academy-payment-plan: not an ISO date: ${iso}`);
  const [y, m, d] = iso.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    throw new Error(`academy-payment-plan: impossible date: ${iso}`);
  }
  return Math.round(ms / 86_400_000);
}

function fromDayNumber(n: number): string {
  const d = new Date(n * 86_400_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1]} ${y}`;
}

/** Split `total` into `count` parts that sum exactly; remainder on part 1. */
export function splitEvenly(totalCents: number, count: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error("academy-payment-plan: total must be whole cents ≥ 0");
  if (!Number.isInteger(count) || count < 1) throw new Error("academy-payment-plan: count must be ≥ 1");
  const base = Math.floor(totalCents / count);
  const parts = Array.from({ length: count }, () => base);
  parts[0] += totalCents - base * count;
  return parts;
}

/**
 * The start days of the teaching weeks still ahead of (or containing) `fromIso`.
 * Week k starts on termStart + 7·(k−1). A week counts if it has not yet ended
 * by `fromIso`, i.e. its start is ≥ the start of the week `fromIso` falls in.
 */
export function remainingWeekStarts(termStartIso: string, termEndIso: string, fromIso: string): string[] {
  const start = toDayNumber(termStartIso);
  const end = toDayNumber(termEndIso);
  const from = toDayNumber(fromIso);
  if (end < start) throw new Error("academy-payment-plan: term ends before it starts");
  const weeks: string[] = [];
  for (let s = start; s <= end; s += 7) {
    const weekEnd = s + 6;
    if (weekEnd >= from) weeks.push(fromDayNumber(s));
  }
  return weeks;
}

export function planSchedule(input: PlanInput): PlanSchedule {
  const { termFeeCents, termStartIso, termEndIso, firstChargeIso } = input;
  if (!AUTOPAY_PLANS.includes(input.plan)) throw new Error(`academy-payment-plan: unknown plan ${input.plan}`);
  if (toDayNumber(firstChargeIso) > toDayNumber(termEndIso)) {
    throw new Error("academy-payment-plan: the term has finished; nothing can be scheduled");
  }

  const fullSchedule = (requested: AutoPayPlan): PlanSchedule => ({
    plan: "full",
    requestedPlan: requested,
    totalCents: termFeeCents,
    charges: [{ n: 1, dueIso: firstChargeIso, amountCents: termFeeCents, label: "Paid in full" }],
    summary: `${money(termFeeCents)} paid in full on ${longDate(firstChargeIso)}.`,
  });

  if (input.plan === "full") return fullSchedule("full");

  // Weekly: one charge per teaching week still to come. Charge 1 is today
  // (covering the current or first week); charges 2..n fall on each later
  // week's first day.
  const weeks = remainingWeekStarts(termStartIso, termEndIso, firstChargeIso);
  const first = toDayNumber(firstChargeIso);
  // The first charge covers the earliest remaining week; later charges are the
  // remaining week starts strictly after the first charge day.
  const later = weeks.slice(1).filter((w) => toDayNumber(w) > first);
  const dates = [firstChargeIso, ...later];
  if (dates.length < 2) return fullSchedule("weekly");

  const parts = splitEvenly(termFeeCents, dates.length);
  const charges = dates.map((dueIso, i) => ({
    n: i + 1,
    dueIso,
    amountCents: parts[i],
    label: `Payment ${i + 1} of ${dates.length}`,
  }));
  const each = parts[parts.length - 1];
  const firstAmt = parts[0];
  const summary =
    firstAmt === each
      ? `${dates.length} weekly payments of ${money(each)} (${money(termFeeCents)} in total), the first on ${longDate(dates[0])} and the last on ${longDate(dates[dates.length - 1])}.`
      : `${dates.length} weekly payments: ${money(firstAmt)} on ${longDate(dates[0])}, then ${money(each)} each week to ${longDate(dates[dates.length - 1])} (${money(termFeeCents)} in total).`;
  return { plan: "weekly", requestedPlan: "weekly", totalCents: termFeeCents, charges, summary };
}

// ── What collecting a schedule costs the club (Stripe NZ, verified 4 Nov 2026) ──
// Card: 2.65% + $0.30 domestic. NZ BECS direct debit: 1% + $0.40, capped at $4.
// Sources: stripe.com/nz/pricing; synthesis.md §Costs. Used for the staff view
// and the analysis, NEVER to surcharge a family (the club absorbs the fee).
export const STRIPE_NZ = {
  card: { pct: 0.0265, fixedCents: 30, capCents: null as number | null },
  nz_bank_account: { pct: 0.01, fixedCents: 40, capCents: 400 },
} as const;

export function stripeFeeCents(amountCents: number, method: PaymentMethodKind): number {
  const r = STRIPE_NZ[method];
  const fee = Math.round(amountCents * r.pct) + r.fixedCents;
  return r.capCents == null ? fee : Math.min(fee, r.capCents);
}

export function scheduleFeeCents(schedule: PlanSchedule, method: PaymentMethodKind): number {
  return schedule.charges.reduce((sum, c) => sum + stripeFeeCents(c.amountCents, method), 0);
}

// ── Missed charges, DERIVED (never stored) ──────────────────────────────────
// A charge is missed when its due day has passed by more than the grace days
// and it has not been paid. Two missed → payment hold. Paying clears it on the
// next read, because nothing is stored to clear.
export const HOLD_AFTER_MISSES = 2;
/** Direct debit settles T+2 and may retry; allow 4 days before calling it missed. */
export const MISSED_GRACE_DAYS = 4;

export interface ChargeState {
  dueIso: string;
  amountCents: number;
  paid: boolean;
}

export interface MissedState {
  missedCount: number;
  missedCents: number;
  onHold: boolean;
}

export function missedState(charges: ChargeState[], todayIso: string): MissedState {
  const today = toDayNumber(todayIso);
  let missedCount = 0;
  let missedCents = 0;
  for (const c of charges) {
    if (c.paid) continue;
    if (today - toDayNumber(c.dueIso) > MISSED_GRACE_DAYS) {
      missedCount += 1;
      missedCents += c.amountCents;
    }
  }
  return { missedCount, missedCents, onHold: missedCount >= HOLD_AFTER_MISSES };
}

// ── Where NZ bank direct debit is offered (Daniel, 4 Nov 2026) ───────────────
// "turn it on, but only for under-9 and under-12 payments, and just for Term 4 …
// just with the full payments, not the weekly payments, for now." Plus U13–U20
// families paying from their parent account (that path is checked separately by
// `bankDebitForParentPayment`). Everywhere else stays card-only, because the
// account's default payment-method configuration has bank debit switched OFF.
//
// 🔴 This is the ONE place that decides it. A checkout that wants bank debit asks
// here and, when the answer is yes, sends an explicit method list — the default
// configuration never offers it.
export const BANK_DEBIT_PROGRAMME_SLUGS: readonly string[] = ["pre-academy-u9-u12"] as const;

/** What the Payment Element offers when bank debit is allowed: today's default
 *  set (card incl. Apple Pay / Google Pay, Link, Klarna) plus bank account.
 *  Verified against Stripe live on 4 Nov 2026 with a cancelled probe. */
export const BANK_DEBIT_METHOD_TYPES: readonly string[] = ["card", "link", "klarna", "nz_bank_account"] as const;

export function bankDebitAllowed(input: { programSlug: string | null | undefined; academyPlan: string | null | undefined; currency?: string }): boolean {
  if ((input.currency ?? "NZD").toUpperCase() !== "NZD") return false;
  if (!input.programSlug || !BANK_DEBIT_PROGRAMME_SLUGS.includes(input.programSlug)) return false;
  // Pay the term in full only, for now. 'year' is a bigger single debit and the
  // weekly plan is not built for bank debit yet.
  return input.academyPlan === "term";
}

/** A bank debit has been submitted and has not settled or failed yet. */
export type BankDebitState = "clearing" | "failed" | null;

export function bankDebitState(r: {
  status?: string | null;
  paymentProcessingAt?: Date | string | null;
  paymentFailedAt?: Date | string | null;
}): BankDebitState {
  if (r.status && r.status !== "pending") return null; // money landed (or it was removed)
  if (r.paymentFailedAt) return "failed";
  if (r.paymentProcessingAt) return "clearing";
  return null;
}

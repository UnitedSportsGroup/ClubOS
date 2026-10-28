// Removing a registration that was entered by mistake (Daniel, 2026-10-28).
//
// Travis entered one EFTPOS payment twice at the counter. Staff can now remove
// the extra one themselves — and every removal carries a name, a time and a
// reason, because "who deleted that?" must always have an answer.
//
// ONE decider for what may be removed. The server enforces it on every call
// and the page reads it to decide whether to offer the button, so the two can
// never disagree.
//
// 🔴 REMOVING IS NOT REFUNDING. It corrects the RECORD. It never moves money,
// so it is refused wherever real money sits in a system we cannot see from
// here: a card payment held by Stripe, or a sale rung up on the till. Those
// are refunded through their own paths, which have their own permission.

export const REMOVED_STATUS = "removed" as const;

/** Quick choices offered on the page; any other wording is fine too. */
export const REMOVAL_REASONS = [
  "Entered twice by mistake",
  "Wrong child or wrong programme",
  "Test entry",
] as const;

export const MIN_REASON_LENGTH = 3;

export type RemovableShape = {
  status: string | null | undefined;
  stripePaymentIntentId?: string | null;
  posSaleId?: number | null;
  totalCents?: number | null;
  refundedAmountCents?: number | null;
};

/** null = may be removed; otherwise the sentence to show the person. */
export function removalBlocker(reg: RemovableShape): string | null {
  if (reg.status === REMOVED_STATUS) return "This registration has already been removed.";
  const moneyHeld = reg.status === "confirmed" || reg.status === "partially_refunded";
  if (moneyHeld && reg.stripePaymentIntentId) {
    return "This was paid by card online, so the money is in Stripe. Refund it instead — removing it would hide a real payment.";
  }
  if (moneyHeld && reg.posSaleId) {
    return "This was paid at the till. Refund the till sale instead — removing it would hide a real payment.";
  }
  return null;
}

/** null = acceptable; otherwise what is wrong with the reason. */
export function reasonProblem(reason: unknown): string | null {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < MIN_REASON_LENGTH) return "Say why it is being removed (for example: entered twice by mistake).";
  if (r.length > 500) return "Keep the reason under 500 characters.";
  return null;
}

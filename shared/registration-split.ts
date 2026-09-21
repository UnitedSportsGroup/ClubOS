/**
 * Splitting one booking's money between the children it covers.
 *
 * Daniel, 2026-09-22, after the first Move shipped: "this parent had actually
 * booked in this one payment for registration for two kids… when you click
 * Move on that specific player page, the player just comes up." One
 * registration row (#619, $600, one Stripe payment) carries Jack's ten days
 * AND Eden's ten days. Moving "the registration" moved Eden too. So a move is
 * per CHILD, and when a booking covers more than the child who is moving it
 * is split in two: the moving child's days and their share of the money go
 * to a new registration on the new programme; the rest stays exactly where it
 * was.
 *
 * 🔴 NOTHING IS CHARGED OR REFUNDED. Every figure below re-files dollars that
 * already landed; the two halves always add back to the original, and the
 * server refuses the split if they do not.
 *
 * 🔴 ONE DECIDER. The refund route, the transfer route and the preview all
 * price a day the same way: the price stamped on the line, else the ORIGINAL
 * programme's price for that product — what the family actually paid, never
 * the new programme's price. A day a family paid $30 for is a $30 day after
 * it moves, even if the camp it moves to charges $50.
 *
 * Rounding: the moving side is computed pro rata and rounded ONCE; the staying
 * side is the remainder, so cents can never be created or lost between them.
 * Refunds are the exception: a refund tied to a specific day (the "By session"
 * refund) travels with that day EXACTLY; a refund that was never tied to a day
 * (a "Full"/"Part amount" refund) stays on the original booking, because
 * apportioning it would be a guess about which child the office was refunding.
 */

export type SplitLine = {
  id: number;
  /** Price paid for this line, in cents — never null once resolved by `lineCents`. */
  priceCents: number;
  refundedCents: number;
  moving: boolean;
};

export type SplitSide = {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  amountPaidCents: number;
  refundedCents: number;
  status: "confirmed" | "partially_refunded" | "refunded";
  lineIds: number[];
};

export type SplitResult = { moving: SplitSide; staying: SplitSide };

/** What a line cost the family: its own stamped price, else the programme's list price for that product. */
export function lineCents(line: { priceCents?: number | null; productType: string }, priceByProduct: Map<string, number>): number {
  if (typeof line.priceCents === "number" && Number.isFinite(line.priceCents)) return line.priceCents;
  return priceByProduct.get(line.productType) ?? 0;
}

/** The status a registration's own figures imply — the same rule the refund route leaves rows in. */
export function statusFor(totalCents: number, refundedCents: number): SplitSide["status"] {
  if (totalCents > 0 && refundedCents >= totalCents) return "refunded";
  if (refundedCents > 0) return "partially_refunded";
  return "confirmed";
}

function proRata(part: number, whole: number, amount: number): number {
  if (whole <= 0) return 0;
  return Math.round((amount * part) / whole);
}

export function splitRegistrationMoney(
  reg: { subtotalCents: number; discountCents: number; totalCents: number; amountPaidCents: number; refundedCents: number },
  lines: SplitLine[],
): SplitResult {
  const moving = lines.filter((l) => l.moving);
  const staying = lines.filter((l) => !l.moving);
  if (moving.length === 0) throw new Error("Nothing is moving");
  if (staying.length === 0) throw new Error("Everything is moving — that is a move, not a split");

  const lineSum = lines.reduce((s, l) => s + l.priceCents, 0);
  const movingLineSum = moving.reduce((s, l) => s + l.priceCents, 0);

  // Subtotal follows the lines; if the stored subtotal disagrees with the sum
  // of its lines (a discount recorded oddly, a hand-edited row) the lines'
  // share still decides the proportion and the remainder rule keeps the sums.
  const subtotalMoving = proRata(movingLineSum, lineSum, reg.subtotalCents);
  const discountMoving = proRata(movingLineSum, lineSum, reg.discountCents);
  const totalMoving = proRata(movingLineSum, lineSum, reg.totalCents);
  const paidMoving = proRata(movingLineSum, lineSum, reg.amountPaidCents);

  // Refunds: tied-to-a-day travels with the day; untied stays put.
  const tiedRefundMoving = moving.reduce((s, l) => s + (l.refundedCents || 0), 0);
  const tiedRefundStaying = staying.reduce((s, l) => s + (l.refundedCents || 0), 0);
  const tiedTotal = tiedRefundMoving + tiedRefundStaying;
  if (tiedTotal > reg.refundedCents) {
    throw new Error(`Lines carry $${(tiedTotal / 100).toFixed(2)} of refunds but the registration records $${(reg.refundedCents / 100).toFixed(2)}`);
  }
  const refundMoving = Math.min(tiedRefundMoving, totalMoving);
  const refundStaying = reg.refundedCents - refundMoving;

  const side = (sub: number, disc: number, tot: number, paid: number, ref: number, ids: number[]): SplitSide => ({
    subtotalCents: sub, discountCents: disc, totalCents: tot, amountPaidCents: paid, refundedCents: ref,
    status: statusFor(tot, ref), lineIds: ids,
  });

  const result: SplitResult = {
    moving: side(subtotalMoving, discountMoving, totalMoving, paidMoving, refundMoving, moving.map((l) => l.id)),
    staying: side(
      reg.subtotalCents - subtotalMoving,
      reg.discountCents - discountMoving,
      reg.totalCents - totalMoving,
      reg.amountPaidCents - paidMoving,
      refundStaying,
      staying.map((l) => l.id),
    ),
  };

  // 🔴 The invariant, checked here and again by the server before it writes.
  for (const k of ["subtotalCents", "discountCents", "totalCents", "amountPaidCents", "refundedCents"] as const) {
    if (result.moving[k] + result.staying[k] !== reg[k]) throw new Error(`Split does not add up on ${k}`);
    if (result.moving[k] < 0 || result.staying[k] < 0) throw new Error(`Split went negative on ${k}`);
  }
  return result;
}

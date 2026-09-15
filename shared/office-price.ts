/**
 * The agreed price a staff member records at the counter.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * Olga, 2026-09-15, of a Technification registration she had just taken:
 *   "I entered price $135. But it's shown as $30."
 *
 * She was right, and nothing told her. The office form let her type an agreed
 * price and then SILENTLY discarded it whenever it was above the pro-rated
 * total, falling back to the quote. Two real registrations were written that
 * afternoon at a price nobody chose — Subin Lee at $30 against an agreed $135,
 * and the same shape on a FUNiño walk-up at $32.
 *
 * ── The rule, and why it is the SUBTOTAL ────────────────────────────────────
 * The old rule was "an agreed price can only go DOWN", measured against the
 * quote's TOTAL. That conflated two different numbers:
 *
 *   • `subtotalCents` — the programme's published term fee ($150 Technification,
 *     $160 FUNiño). This is the price the club advertises.
 *   • `totalCents`    — that fee AFTER the mid-term pro-rata discount. On
 *     15 September, two sessions from the end of Term 3, it was $30.
 *
 * The pro-rata is a DISCOUNT OFF the published fee for somebody joining late.
 * A family who has been training all term and is settling up at the counter in
 * September has not joined late — they owe for the sessions they have had.
 * Measuring the ceiling against the pro-rated total made that family
 * un-recordable, which is exactly what Olga hit.
 *
 * 🔴 So the ceiling is `subtotalCents`: the counter may agree any price from
 * zero up to the programme's own published fee, and never a cent more. That
 * keeps the consumer-law line the old rule was actually protecting — we never
 * charge above the advertised price — while letting staff record what a family
 * genuinely owes. It also keeps the columns honest: `discount_cents` is
 * `subtotal − agreed` and can never go negative.
 *
 * 🔴 And it is ONE decider, used by the browser AND by the server. The browser
 * needs it to disable Apply and say why; the server needs it because a price is
 * money and the browser is never trusted with money. Two copies of this rule
 * would drift, and the drift would look exactly like this bug again: one end
 * accepting a number the other end throws away.
 */

export interface AgreedPriceInput {
  /** What the staff member typed, in cents. null = they typed nothing. */
  agreedCents: number | null;
  /** The programme's own published fee — the ceiling. */
  listSubtotalCents: number;
  /** Why the price differs. Required whenever a price is given. */
  reason: string;
}

/** Dollars, for a message a person reads. */
function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * `null` = this agreed price is fine to use (or none was given).
 * A string = the reason it cannot be used, written for the person at the
 * counter. Never throw it away silently; show it.
 */
export function agreedPriceError(input: AgreedPriceInput): string | null {
  const { agreedCents, listSubtotalCents, reason } = input;

  // Nothing typed. A blank box means "charge the programme's price", which is
  // a different thing from "charge nothing" — so it is not an error.
  if (agreedCents == null) return null;

  if (!Number.isFinite(agreedCents) || !Number.isInteger(agreedCents) || agreedCents < 0) {
    return "That agreed price isn't a valid amount.";
  }

  // 🔴 The ceiling is the published fee, never the pro-rated total.
  if (agreedCents > listSubtotalCents) {
    return `The agreed price can't be more than the programme's fee of ${money(listSubtotalCents)}. ` +
      `Reduce it, or pick a different programme or term.`;
  }

  if (!reason.trim()) {
    return "Say why the price was changed — it goes on the registration.";
  }

  return null;
}

/**
 * Split an agreed price back into the three columns the registration stores.
 * The subtotal always keeps the LIST price: overwriting it would lose what the
 * programme actually charges, and every report that reads it would be wrong.
 */
export function agreedPriceColumns(agreedCents: number, listSubtotalCents: number) {
  return {
    subtotalCents: listSubtotalCents,
    discountCents: listSubtotalCents - agreedCents,
    totalCents: agreedCents,
  };
}

/** The sentence written into the registration's notes, so the figure can be
 *  explained months later without anyone having to remember the conversation. */
export function agreedPriceNote(quotedCents: number, agreedCents: number, reason: string): string {
  return `Price adjusted from ${money(quotedCents)} to ${money(agreedCents)} — ${reason.trim()}`;
}

// ONE decider for what a venue booking means in MONEY terms — shared by the
// server (which attaches the Player Pay summary to every booking it serves)
// and every admin surface that draws a status badge: the Bookings tab, the
// Payments tab and the calendar's detail modal.
//
// Why it exists (Daniel, 2026-10-22): "why this say cancelled, does it mean
// they didn't pay?" — the Bookings tab read CANCELLED over a booking whose five
// players had each paid their Player Pay share ($186.90 on the club's Stripe),
// because the row's own status was the only thing it looked at. A booking's
// status is a fact about the SLOT; whether money landed is a fact about the
// PAYMENT — and for Player Pay the payment lives on split_members, not the row.
// Two more website bookings (adib ahlami 25 Jul, James Burns 22 Aug) were
// charged after a declined first attempt and read CANCELLED for months.
//
// facility_bookings.cancel_reason says WHY a slot was released:
//   abandoned            — the 30-minute abandoned-cart sweep (card never completed)
//   card_declined        — Stripe reported the card failed, nothing charged
//   player_pay_expired   — a Player Pay squad did not fill before its deadline
//   player_pay_cancelled — the organiser or staff cancelled the Player Pay split
//   paid_slot_conflict   — money landed AFTER the slot was released and someone
//                          else now holds it: a human refunds or moves it
// NULL on live rows, and on rows released before 2026-10-22 that the backfill
// could not explain — never a default, because a default is a claim.

export type VenueSplitSummary = {
  id: number;
  status: string; // open · settling · settled · cancelled · failed
  shareCode: string;
  targetCount: number | null;
  joinedCount: number;
  paidCount: number;
  collectedCents: number;
  shareCents: number;
  totalCents: number;
  deadlineAt: string | null;
  settledAt: string | null;
  createdAt: string;
};

export type VenueBookingPaymentInput = {
  status: string;
  source?: string | null;
  totalCents?: number | null;
  paidAt?: string | Date | null;
  stripePaymentIntentId?: string | null;
  cancelReason?: string | null;
  split?: VenueSplitSummary | null;
};

export type VenuePaymentState = "paid" | "in_progress" | "checkout_open" | "not_paid" | "no_charge" | "attention";
export type VenuePaymentTone = "green" | "blue" | "amber" | "slate" | "red" | "violet";
export type VenuePaymentMethod = "card" | "player_pay" | "office" | "none";

export type VenuePaymentTruth = {
  state: VenuePaymentState;
  method: VenuePaymentMethod;
  headline: string;   // the badge: Paid · Player Pay · Checkout open · Not paid · Confirmed · Needs attention
  detail: string;     // the line under it, in plain English
  tone: VenuePaymentTone;
  collectedCents: number; // money the club actually holds for this booking
};

// The USC booking site. Player Pay squads pay on /book/split/<code> there.
export const VENUE_BOOKING_SITE = "https://book.unitedsportscentre.com";
export function venueSplitShareUrl(shareCode: string): string {
  return `${VENUE_BOOKING_SITE}/book/split/${shareCode}`;
}

export const VENUE_CANCEL_REASONS = ["abandoned", "card_declined", "player_pay_expired", "player_pay_cancelled", "paid_slot_conflict"] as const;
export type VenueCancelReason = (typeof VENUE_CANCEL_REASONS)[number];

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function fmtWhen(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function describeVenuePayment(b: VenueBookingPaymentInput): VenuePaymentTruth {
  const total = b.totalCents ?? 0;
  const split = b.split ?? null;

  if (split) {
    const target = split.targetCount && split.targetCount > 0 ? split.targetCount : null;
    const progress = target ? `${split.paidCount} of ${target} paid` : `${split.paidCount} paid`;
    const collected = `${money(split.collectedCents)} of ${money(split.totalCents)} collected`;

    if (b.status === "paid") {
      return { state: "paid", method: "player_pay", headline: "Paid", tone: "green", collectedCents: split.collectedCents,
        detail: `Player Pay · ${progress} · ${money(split.collectedCents)}${b.paidAt ? ` · ${fmtWhen(b.paidAt)}` : ""}` };
    }
    if (b.cancelReason === "paid_slot_conflict") {
      return { state: "attention", method: "player_pay", headline: "Needs attention", tone: "red", collectedCents: split.collectedCents,
        detail: `Squad paid ${money(split.collectedCents)} but the slot was taken before it was confirmed — refund or move it` };
    }
    if (split.status === "settled") {
      return { state: "attention", method: "player_pay", headline: "Needs attention", tone: "red", collectedCents: split.collectedCents,
        detail: `Player Pay ${progress} · ${money(split.collectedCents)} collected, booking never confirmed` };
    }
    if (split.status === "open" || split.status === "settling") {
      if (b.status === "cancelled") {
        return { state: "attention", method: "player_pay", headline: "Needs attention", tone: "red", collectedCents: split.collectedCents,
          detail: `Player Pay ${progress} · ${collected} · slot was released while the squad was still paying` };
      }
      const closes = split.deadlineAt ? ` · closes ${fmtWhen(split.deadlineAt)}` : "";
      return { state: "in_progress", method: "player_pay", headline: "Player Pay", tone: "amber", collectedCents: split.collectedCents,
        detail: `${progress} · ${collected}${closes}` };
    }
    // cancelled / failed split: the slot is free and the squad was refunded
    const why = b.cancelReason === "player_pay_expired" ? "Player Pay closed before the squad filled" : "Player Pay cancelled";
    const tail = split.collectedCents > 0 ? "shares refunded" : "nothing charged";
    return { state: "not_paid", method: "player_pay", headline: "Not paid", tone: "slate", collectedCents: 0,
      detail: `${why} · ${progress} · ${tail}` };
  }

  if (b.status === "paid") {
    const when = b.paidAt ? ` · ${fmtWhen(b.paidAt)}` : "";
    if (b.stripePaymentIntentId) {
      return { state: "paid", method: "card", headline: "Paid", tone: "green", collectedCents: total, detail: `Card · ${money(total)}${when}` };
    }
    return { state: "paid", method: "office", headline: "Paid", tone: "green", collectedCents: total, detail: `Marked paid${when}` };
  }
  if (b.status === "confirmed") {
    return { state: "no_charge", method: "none", headline: "Confirmed", tone: "blue", collectedCents: 0,
      detail: total > 0 ? `${money(total)} · no payment recorded` : "No charge" };
  }
  if (b.status === "pending") {
    return { state: "checkout_open", method: b.stripePaymentIntentId ? "card" : "none", headline: "Checkout open", tone: "amber", collectedCents: 0,
      detail: "Card step not finished · slot is released after 30 minutes" };
  }
  // cancelled, no split
  if (b.cancelReason === "paid_slot_conflict") {
    return { state: "attention", method: "card", headline: "Needs attention", tone: "red", collectedCents: total,
      detail: `Paid ${money(total)} but the slot was taken before it was confirmed — refund or move it` };
  }
  const reason: Record<string, string> = {
    abandoned: "Checkout abandoned",
    card_declined: "Card declined",
  };
  const why = (b.cancelReason && reason[b.cancelReason]) || "Checkout not completed";
  return { state: "not_paid", method: b.stripePaymentIntentId ? "card" : "none", headline: "Not paid", tone: "slate", collectedCents: 0,
    detail: `${why} · nothing charged` };
}

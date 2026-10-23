// The one decider for what a venue booking means in money terms, proven on the
// real shapes found on 2026-10-22 (ids are the production rows that day).
//   npx tsx script/_test-venue-booking-truth.ts
import { describeVenuePayment, type VenueSplitSummary } from "../shared/venue-booking-truth";

let failures = 0;
const check = (ok: boolean, label: string) => { console.log(`  ${ok ? "ok  " : "✗   "}${label}`); if (!ok) failures++; };
const split = (over: Partial<VenueSplitSummary>): VenueSplitSummary => ({
  id: 50, status: "settled", shareCode: "mE2J8gXM", targetCount: 5, joinedCount: 5, paidCount: 5,
  collectedCents: 18690, shareCents: 3738, totalCents: 18688, deadlineAt: "2026-10-21T05:32:43.715Z",
  settledAt: "2026-10-20T01:22:02.506Z", createdAt: "2026-10-19T05:32:43.716Z", ...over,
});

console.log("\nPlayer Pay");
{ // #5789 James Na after the repair: paid via Player Pay
  const t = describeVenuePayment({ status: "paid", source: "public", totalCents: 18688, paidAt: "2026-10-20T01:22:02.506Z", split: split({}) });
  check(t.state === "paid" && t.headline === "Paid" && t.method === "player_pay", "settled split on a paid row → Paid (player_pay)");
  check(/5 of 5 paid/.test(t.detail) && /\$186\.90/.test(t.detail), `detail names the shares and the money: ${t.detail}`);
  check(t.collectedCents === 18690, "collected = the shares, not the row total");
}
{ // #5789 as it WAS: settled split, row still cancelled → needs attention, never "Not paid"
  const t = describeVenuePayment({ status: "cancelled", source: "public", totalCents: 18688, split: split({}) });
  check(t.state === "attention" && t.tone === "red", "settled split on a cancelled row → Needs attention");
  check(/collected/.test(t.detail) && t.headline !== "Not paid", "never tells staff a paid squad did not pay");
}
{ // #5791 Cory Wu while open: in progress, closes at the deadline
  const t = describeVenuePayment({ status: "pending", source: "public", totalCents: 10000, split: split({ id: 51, status: "open", targetCount: 10, joinedCount: 1, paidCount: 0, collectedCents: 0, shareCents: 1000, totalCents: 10000, deadlineAt: "2026-10-22T08:36:11.805Z", settledAt: null }) });
  check(t.state === "in_progress" && t.headline === "Player Pay" && t.tone === "amber", "open split on a pending row → Player Pay (in progress)");
  check(/0 of 10 paid/.test(t.detail) && /\$0\.00 of \$100\.00/.test(t.detail) && /closes/.test(t.detail), `progress, money and deadline: ${t.detail}`);
}
{ // open split but the row was swept (the bug) → attention, not "Not paid"
  const t = describeVenuePayment({ status: "cancelled", source: "public", totalCents: 10000, split: split({ status: "open", paidCount: 2, collectedCents: 2000, targetCount: 10 }) });
  check(t.state === "attention" && /released while the squad was still paying/.test(t.detail), "open split on a cancelled row → Needs attention");
}
{ // expired split, nobody paid
  const t = describeVenuePayment({ status: "cancelled", source: "public", totalCents: 10000, cancelReason: "player_pay_expired", split: split({ status: "cancelled", paidCount: 0, collectedCents: 0, targetCount: 10 }) });
  check(t.state === "not_paid" && t.headline === "Not paid" && t.tone === "slate", "expired empty split → Not paid (slate, not red)");
  check(/closed before the squad filled/.test(t.detail) && /nothing charged/.test(t.detail), `says why: ${t.detail}`);
}
{ // cancelled split after two had paid → refunded
  const t = describeVenuePayment({ status: "cancelled", source: "public", totalCents: 10000, cancelReason: "player_pay_cancelled", split: split({ status: "cancelled", paidCount: 2, collectedCents: 2000, targetCount: 10 }) });
  check(t.state === "not_paid" && /shares refunded/.test(t.detail) && t.collectedCents === 0, "cancelled split with payers → Not paid · shares refunded");
}
{ // money landed, slot taken
  const t = describeVenuePayment({ status: "cancelled", source: "public", totalCents: 18688, cancelReason: "paid_slot_conflict", split: split({}) });
  check(t.state === "attention" && /slot was taken/.test(t.detail), "paid_slot_conflict → Needs attention, names the clash");
}

console.log("\nCard");
{ // #5792 wan adib — paid, card
  const t = describeVenuePayment({ status: "paid", source: "public", totalCents: 13283, paidAt: "2026-10-22T21:26:46.55Z", stripePaymentIntentId: "pi_3UTTVBB0V2tnya3109k10I0t" });
  check(t.state === "paid" && t.method === "card" && /Card · \$132\.83/.test(t.detail), `paid card: ${t.detail}`);
}
{ // #5507 James Burns as it WAS: cancelled, PI succeeded — the decider cannot see Stripe, so this reads Not paid;
  // the REPAIR + revive path is what fixes it. Assert the honest reading, not a guess.
  const t = describeVenuePayment({ status: "cancelled", source: "public", totalCents: 2500, stripePaymentIntentId: "pi_3U4VbjB0V2tnya311quXrpvg", cancelReason: null });
  check(t.state === "not_paid" && /Checkout not completed/.test(t.detail), "cancelled, reason unknown → Not paid · checkout not completed");
}
{ // abandoned / declined reasons
  const a = describeVenuePayment({ status: "cancelled", source: "public", totalCents: 8855, stripePaymentIntentId: "pi_x", cancelReason: "abandoned" });
  const d = describeVenuePayment({ status: "cancelled", source: "public", totalCents: 8855, stripePaymentIntentId: "pi_y", cancelReason: "card_declined" });
  check(/Checkout abandoned · nothing charged/.test(a.detail), `abandoned: ${a.detail}`);
  check(/Card declined · nothing charged/.test(d.detail), `declined: ${d.detail}`);
}
{ // pending card checkout, under 30 minutes old
  const t = describeVenuePayment({ status: "pending", source: "public", totalCents: 8855, stripePaymentIntentId: "pi_z" });
  check(t.state === "checkout_open" && t.headline === "Checkout open", "pending card row → Checkout open");
}
{ // staff block, no charge
  const t = describeVenuePayment({ status: "confirmed", source: "manual", totalCents: 0 });
  check(t.state === "no_charge" && t.headline === "Confirmed" && t.detail === "No charge", "manual $0 confirmed → Confirmed · No charge");
}
{ // staff-recorded paid, no Stripe
  const t = describeVenuePayment({ status: "paid", source: "manual", totalCents: 5000, paidAt: "2026-10-01T00:00:00Z" });
  check(t.state === "paid" && t.method === "office" && /Marked paid/.test(t.detail), "paid with no PI → Marked paid");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

// Pure checks for shared/academy-payment-plan.ts — the AutoPay money decider.
// Run: npx tsx script/_test-academy-payment-plan.ts
import { planSchedule, splitEvenly, remainingWeekStarts, stripeFeeCents, scheduleFeeCents, missedState } from "../shared/academy-payment-plan";

let pass = 0, fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; } else { fail++; console.log("FAIL", name, detail ?? ""); }
}
function throws(fn: () => unknown, name: string) {
  try { fn(); fail++; console.log("FAIL (no throw)", name); } catch { pass++; }
}
const sum = (s: { charges: { amountCents: number }[] }) => s.charges.reduce((a, c) => a + c.amountCents, 0);

// Term 1 2027 = 1 Feb – 9 Apr (ClubOS terms id 20): 10 teaching weeks.
const T = { termStartIso: "2027-02-01", termEndIso: "2027-04-09" };

ok(remainingWeekStarts(T.termStartIso, T.termEndIso, "2027-01-20").length === 10, "10 weeks before the term");
ok(remainingWeekStarts(T.termStartIso, T.termEndIso, "2027-02-17").length === 8, "mid week 3 → weeks 3..10 left");
ok(remainingWeekStarts(T.termStartIso, T.termEndIso, "2027-04-09")[0] === "2027-04-05", "last day → final week only");

// Full
const full = planSchedule({ plan: "full", termFeeCents: 40500, ...T, firstChargeIso: "2027-01-20" });
ok(full.charges.length === 1 && full.charges[0].amountCents === 40500 && full.charges[0].dueIso === "2027-01-20", "full = one charge at sign-up", full);

// Weekly before term: 10 × $40.50
const wk = planSchedule({ plan: "weekly", termFeeCents: 40500, ...T, firstChargeIso: "2027-01-20" });
ok(wk.charges.length === 10, "weekly before term = 10 charges", wk.charges.length);
ok(sum(wk) === 40500, "weekly sums to fee");
ok(wk.charges.every((c) => c.amountCents === 4050), "even split $40.50");
ok(wk.charges[0].dueIso === "2027-01-20" && wk.charges[1].dueIso === "2027-02-08" && wk.charges[9].dueIso === "2027-04-05", "dates: sign-up, then week 2..10 starts", wk.charges.map(c => c.dueIso));
ok(wk.charges.every((c) => c.dueIso <= "2027-04-05"), "paid in advance: no charge after the last week starts");

// Uneven: $805 over 10 → $80.50 each; $540 over 10 = $54; $882 / 7
for (const [fee, from, n] of [[80500, "2027-01-20", 10], [88200, "2027-02-24", 7], [54001, "2027-01-20", 10], [16000, "2027-03-31", 2]] as const) {
  const s = planSchedule({ plan: "weekly", termFeeCents: fee, ...T, firstChargeIso: from });
  ok(sum(s) === fee, `sums exactly: ${fee} from ${from}`, s.charges);
  ok(s.charges.length === n, `count ${n} for ${from}`, s.charges.length);
  ok(s.charges[0].amountCents >= s.charges[s.charges.length - 1].amountCents, "remainder rides on charge 1");
  ok(s.charges.every((c, i, a) => i === 0 || c.dueIso > a[i - 1].dueIso), "dates strictly increase");
}

// Weekly in the final week collapses to full
const late = planSchedule({ plan: "weekly", termFeeCents: 4050, ...T, firstChargeIso: "2027-04-06" });
ok(late.plan === "full" && late.requestedPlan === "weekly" && late.charges.length === 1, "final week → pay in full", late);

// Mid-week sign-up: first charge today, next on the following Monday
const mid = planSchedule({ plan: "weekly", termFeeCents: 32400, ...T, firstChargeIso: "2027-02-17" });
ok(mid.charges.length === 8 && mid.charges[1].dueIso === "2027-02-22", "mid-week: next charge next Monday", mid.charges.map(c => c.dueIso));

// Renewal charged on the first day of term
const ren = planSchedule({ plan: "weekly", termFeeCents: 40500, ...T, firstChargeIso: "2027-02-01" });
ok(ren.charges.length === 10 && ren.charges[1].dueIso === "2027-02-08", "renewal on day 1 → 10 charges, no double on day 1", ren.charges.map(c => c.dueIso));

// Guards
throws(() => planSchedule({ plan: "weekly", termFeeCents: 40500, ...T, firstChargeIso: "2027-04-10" }), "after term → throws");
throws(() => planSchedule({ plan: "monthly" as any, termFeeCents: 40500, ...T, firstChargeIso: "2027-01-20" }), "monthly not offered");
throws(() => planSchedule({ plan: "full", termFeeCents: 40500, ...T, firstChargeIso: "2027-02-30" }), "impossible date");
throws(() => splitEvenly(100.5, 2), "fractional cents");
ok(JSON.stringify(splitEvenly(1001, 3)) === "[335,333,333]", "split remainder on first");

// Fees
ok(stripeFeeCents(40500, "card") === 1103, "card fee on $405 = $11.03", stripeFeeCents(40500, "card"));
ok(stripeFeeCents(40500, "nz_bank_account") === 400, "DD fee capped at $4");
ok(stripeFeeCents(4050, "nz_bank_account") === 81, "DD fee on $40.50 = $0.81");
ok(scheduleFeeCents(wk, "nz_bank_account") === 810, "weekly DD over a term = $8.10", scheduleFeeCents(wk, "nz_bank_account"));
ok(scheduleFeeCents(wk, "card") === 1370, "weekly card over a term = $13.70", scheduleFeeCents(wk, "card"));

// Missed / hold, derived
const ch = wk.charges.map((c) => ({ dueIso: c.dueIso, amountCents: c.amountCents, paid: c.n <= 2 }));
ok(missedState(ch, "2027-02-17").missedCount === 0, "charge 3 due 15 Feb, 2 days late = within grace");
ok(missedState(ch, "2027-02-20").missedCount === 1 && !missedState(ch, "2027-02-20").onHold, "1 miss, no hold");
const two = missedState(ch, "2027-02-27");
ok(two.missedCount === 2 && two.onHold && two.missedCents === 8100, "2 misses → hold, $81 behind", two);
ch[2].paid = true;
ok(!missedState(ch, "2027-02-27").onHold, "paying clears the hold on the next read");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

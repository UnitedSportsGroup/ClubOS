/**
 * Mailer Automations — the timing rules, proven.
 *   npx tsx script/_test-mailer-automations.ts
 * Every email is timed from the trigger, in NZ time, across daylight saving.
 */
import { dueAt, nzParts, nzMidnight, outOfQuietHours, timingSentence, offsetMinutes, STARTER_FLOWS, TRIGGERS } from "../shared/mailer-automations";

let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
};
const nz = (d: Date) => { const p = nzParts(d); return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")} ${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`; };

// A payment at 2:15pm NZ on Tue 3 Nov 2026 (NZDT, UTC+13).
const paid = new Date("2026-11-03T01:15:00Z");
eq("payment reads 2:15pm NZ", nz(paid), "2026-11-03 14:15");
const t = (u: any, a: number, extra: any = {}) => ({ timingUnit: u, timingAmount: a, timingDirection: "after", sendTime: null, ...extra });
eq("straight away", nz(dueAt(paid, t("immediately", 0), "registration_paid", true)), "2026-11-03 14:15");
eq("2 hours after", nz(dueAt(paid, t("hours", 2), "registration_paid", true)), "2026-11-03 16:15");
eq("1 day after, at 9am", nz(dueAt(paid, t("days", 1, { sendTime: "09:00" }), "registration_paid", true)), "2026-11-04 09:00");
eq("1 week after, same time", nz(dueAt(paid, t("weeks", 1), "registration_paid", true)), "2026-11-10 14:15");
eq("30 days after at 10am", nz(dueAt(paid, t("days", 30, { sendTime: "10:00" }), "registration_paid", true)), "2026-12-03 10:00");

// Quiet hours: a checkout abandoned at 7:30pm + 2h = 9:30pm → held to 8am.
const late = new Date("2026-11-03T06:30:00Z"); // 7:30pm NZDT
eq("abandoned at 7:30pm", nz(late), "2026-11-03 19:30");
eq("2h later falls in quiet hours → next 8am", nz(dueAt(late, t("hours", 2), "registration_started", true)), "2026-11-04 08:00");
eq("quiet hours off → 9:30pm", nz(dueAt(late, t("hours", 2), "registration_started", false)), "2026-11-03 21:30");
eq("3am → 8am same day", nz(outOfQuietHours(new Date("2026-11-03T14:00:00Z"))), "2026-11-04 08:00");

// Date triggers: programme starts Mon 12 Oct 2026; NZ moved to NZDT on 27 Sep.
const start = nzMidnight("2026-10-12");
eq("start date midnight NZ", nz(start), "2026-10-12 00:00");
eq("3 days before at 9am", nz(dueAt(start, t("days", 3, { timingDirection: "before", sendTime: "09:00" }), "programme_start", true)), "2026-10-09 09:00");
eq("1 day before at 4pm", nz(dueAt(start, t("days", 1, { timingDirection: "before", sendTime: "16:00" }), "programme_start", true)), "2026-10-11 16:00");
eq("on the day defaults to 9am", nz(dueAt(start, t("immediately", 0), "programme_start", true)), "2026-10-12 09:00");
// Across the April change (NZDT → NZST on 5 Apr 2026).
const apr = nzMidnight("2026-04-06");
eq("1 day before, across daylight saving, still 9am", nz(dueAt(apr, t("days", 1, { timingDirection: "before", sendTime: "09:00" }), "programme_start", true)), "2026-04-05 09:00");
eq("birthday on the day at 9am", nz(dueAt(nzMidnight("2026-07-14"), t("immediately", 0, { sendTime: "09:00" }), "birthday", true)), "2026-07-14 09:00");

// Sentences staff read
eq("sentence: 3 days after they pay", timingSentence(t("days", 3, { sendTime: "09:00" }), "registration_paid"), "Sends 3 days after they pay, at 9am");
eq("sentence: 1 day before it starts", timingSentence(t("days", 1, { timingDirection: "before", sendTime: "16:00" }), "programme_start"), "Sends 1 day before it starts, at 4pm");
eq("sentence: 2 hours, no clock", timingSentence(t("hours", 2, { sendTime: "09:00" }), "registration_started"), "Sends 2 hours after they stopped at checkout");
eq("sentence: birthday", timingSentence(t("immediately", 0, { sendTime: "09:00" }), "birthday"), "On their birthday, at 9am");
eq("before is negative", offsetMinutes(t("days", 2, { timingDirection: "before" }) as any), -2880);

// Starter flows are well-formed
for (const f of STARTER_FLOWS) {
  eq(`starter ${f.key}: trigger exists`, !!TRIGGERS[f.trigger], true);
  eq(`starter ${f.key}: every email has a subject and words`, f.steps.every((s) => s.subject.trim() && s.bodyHtml.length > 40), true);
  eq(`starter ${f.key}: no discount codes`, f.steps.some((s) => /discount|% off|promo code/i.test(s.bodyHtml + s.subject)), false);
}
eq("unfinished registration stops on payment", STARTER_FLOWS.find((f) => f.key === "unfinished_registration")!.stopOnPayment, true);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

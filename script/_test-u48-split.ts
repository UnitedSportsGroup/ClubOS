// The U4–U8 split rules, pure: npx tsx script/_test-u48-split.ts
import { bandsOf, inSessionBand, sessionBand } from "../shared/session-bands";
import { planTermSessions } from "../server/term-sessions";
let pass = 0, fail = 0;
const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? " — " + d : ""}`); g ? pass++ : fail++; };
const b46 = sessionBand("U4–U6")!, b78 = sessionBand("U7-U8")!;
const all = bandsOf(["U4–U6", "U7–U8", null, "", "Squad"]);
ok("band names parse (en-dash and hyphen)", b46.lo === 4 && b46.hi === 6 && b78.lo === 7 && b78.hi === 8);
ok("a session with no band name is not a band", sessionBand(null) === null && sessionBand("") === null && sessionBand("Squad") === null);
ok("bandsOf finds exactly two", all.length === 2);
ok("U6 is on U4–U6, not U7–U8", inSessionBand(6, b46, all) && !inSessionBand(6, b78, all));
ok("U7 is on U7–U8, not U4–U6", inSessionBand(7, b78, all) && !inSessionBand(7, b46, all));
ok("a U9 lead-in goes to the oldest band, never off every roll", inSessionBand(9, b78, all) && !inSessionBand(9, b46, all));
ok("a U3 goes to the youngest band", inSessionBand(3, b46, all) && !inSessionBand(3, b78, all));
ok("no grade (no date of birth) is on every band", inSessionBand(null, b46, all) && inSessionBand(null, b78, all));
const slots = [
  { daysOfWeek: [1, 2, 3, 4, 5], startTime: "16:30", endTime: "17:15", name: null },
  { daysOfWeek: [1, 2, 4], startTime: "17:20", endTime: "18:05", name: "U7–U8", from: "2026-11-02" },
];
const plan = planTermSessions({ slots, terms: [{ id: 8, start: "2026-10-12", end: "2026-12-18" }], existing: [], today: "2026-10-28", horizonDays: 21 });
const late = plan.filter((s) => s.startTime === "17:20");
ok("the 5:20 slot starts on Mon 2 Nov, never before", late.length > 0 && late[0].date === "2026-11-02" && late.every((s) => s.date >= "2026-11-02"), late[0]?.date);
ok("…runs Mon/Tue/Thu only, 21 sessions to 17 Dec", late.length === 21 && late[late.length - 1].date === "2026-12-17", `${late.length}, last ${late[late.length - 1]?.date}`);
ok("…and the 4:30 slot still covers the whole term from 12 Oct", plan.filter((s) => s.startTime === "16:30")[0].date === "2026-10-12");
ok("a bad 'from' is refused", (() => { try { planTermSessions({ slots: [{ ...slots[1], from: "2 Nov" }], terms: [], existing: [], today: "2026-10-28", horizonDays: 21 }); return false; } catch { return true; } })());
console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(fail ? 1 : 0);

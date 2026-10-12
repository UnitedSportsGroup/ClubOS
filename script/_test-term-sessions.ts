import { planTermSessions } from "../server/term-sessions";
let f = 0; const ok = (c: boolean, m: string) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) f++; };
const T3 = { id: 7, start: "2026-07-20", end: "2026-09-25" }, T4 = { id: 8, start: "2026-10-12", end: "2026-12-18" }, T1 = { id: 9, start: "2027-02-01", end: "2027-04-16" };
const fun = [{ daysOfWeek: [1,2,3,4,5], startTime: "16:30", endTime: "17:15" }, { daysOfWeek: [6], startTime: "09:30", endTime: "10:15", name: "U4–U6" }, { daysOfWeek: [6], startTime: "10:30", endTime: "11:15", name: "U7–U8" }];
const p = planTermSessions({ slots: fun, terms: [T3, T4], existing: [], today: "2026-10-12", horizonDays: 21 });
ok(p.length === 68, `Term 4 FUNiño = 68 sessions (${p.length})`);
ok(p.every(s => s.termId === 8), "past Term 3 is left alone");
ok(p[0].date === "2026-10-12" && p[0].startTime === "16:30", "first is Mon 12 Oct 16:30");
ok(p.at(-1)!.date === "2026-12-18", "last is Fri 18 Dec");
ok(p.filter(s => s.date === "2026-10-17").length === 2, "Saturday has two age slots");
const again = planTermSessions({ slots: fun, terms: [T4], existing: p.map(s => ({ date: s.date, start: s.startTime })), today: "2026-10-12", horizonDays: 21 });
ok(again.length === 0, "idempotent");
ok(planTermSessions({ slots: fun, terms: [T1], existing: [], today: "2026-12-20", horizonDays: 21 }).length === 0, "Term 1 not made 6 weeks early");
const pre = planTermSessions({ slots: fun, terms: [T4, T1], existing: [], today: "2027-01-15", horizonDays: 21 });
ok(pre.length > 0 && pre.every(s => s.termId === 9), "Term 1 made 17 days before it starts");
ok(planTermSessions({ slots: [{ daysOfWeek: [2,4], startTime: "17:30", endTime: "19:00" }], terms: [T4], existing: [], today: "2026-10-12", horizonDays: 0 }).length === 20, "Pre-Academy Tue/Thu = 20");
let threw = false; try { planTermSessions({ slots: [{ daysOfWeek: [7], startTime: "5pm", endTime: "x" }], terms: [], existing: [], today: "2026-10-12", horizonDays: 0 }); } catch { threw = true; }
ok(threw, "a bad pattern is refused, not guessed");
console.log(f ? `${f} FAILED` : "all passed"); process.exit(f ? 1 : 0);

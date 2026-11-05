import { officeSellableTerms } from "../shared/office-term-window";
const T = [
  { id: 5, startDate: "2026-01-26", endDate: "2026-04-02" },
  { id: 6, startDate: "2026-04-20", endDate: "2026-07-03" },
  { id: 7, startDate: "2026-07-20", endDate: "2026-09-25" },
  { id: 8, startDate: "2026-10-12", endDate: "2026-12-18" },
  { id: 20, startDate: "2027-02-01", endDate: "2027-04-16" },
  { id: 21, startDate: "2027-04-27", endDate: "2027-07-02" },
  { id: 23, startDate: "2027-10-11", endDate: "2027-12-17" },
  { id: 22, startDate: "2027-07-19", endDate: "2027-09-24" },
];
let fail = 0;
const ok = (name: string, got: number[], want: number[]) => { const p = JSON.stringify(got) === JSON.stringify(want); if (!p) fail++; console.log(`${p ? "✓" : "✗"} ${name} → ${JSON.stringify(got)}`); };
const ids = (d: string) => officeSellableTerms(T, d).map((t) => t.id);
ok("5 Nov 2026 (in Term 4): Term 4 2026 + Term 1 2027", ids("2026-11-05"), [8, 20]);
ok("last day of Term 4 still counts", ids("2026-12-18"), [8, 20]);
ok("summer holidays: next two", ids("2026-12-25"), [20, 21]);
ok("in Term 3 2026", ids("2026-08-01"), [7, 8]);
ok("Term 4 2027 never offered in Nov 2026", ids("2026-11-05").includes(23) ? [1] : [], []);
ok("Date objects work", officeSellableTerms(T.map(t => ({ ...t, startDate: new Date(t.startDate + "T00:00:00"), endDate: new Date(t.endDate + "T00:00:00") })), "2026-11-05").map(t => t.id), [8, 20]);
if (fail) { console.log(`${fail} failed`); process.exit(1); } console.log("all passed");

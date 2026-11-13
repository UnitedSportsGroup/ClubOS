// Unit tests for shared/performance.ts and shared/perf-csv.ts.
//   npx tsx script/_test-performance.ts
import * as P from "../shared/performance";
import { parseCsv, planImport } from "../shared/perf-csv";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`, detail ?? ""); }
};

// dates
ok("addDays crosses a month end", P.addDays("2026-10-31", 1) === "2026-11-01");
ok("addDays crosses a year end backwards", P.addDays("2027-01-01", -1) === "2026-12-31");
ok("daysBetween counts whole days", P.daysBetween("2026-11-01", "2026-11-14") === 13);
ok("an impossible date is not a date", !P.isIsoDate("2026-02-30") && P.isIsoDate("2028-02-29"));
ok("NZ today is NZ, not UTC (10:30pm UTC on the 13th is the 14th in NZ)", P.nzToday(new Date("2026-11-13T22:30:00Z")) === "2026-11-14");

// load
ok("session load = RPE × minutes", P.sessionLoad({ date: "2026-11-01", rpe: 6, minutes: 80 }) === 480);
ok("no minutes = no load (never RPE × 0)", P.sessionLoad({ date: "2026-11-01", rpe: 6, minutes: null }) === null);
const series = P.dailyLoads([{ date: "2026-11-02", load: 400 }, { date: "2026-11-03", load: null }], "2026-11-01", "2026-11-04");
ok("a day with no session is a rest day (0)", series[0].load === 0 && series[3].load === 0);
ok("a session with no reading is NOT a rest day (null)", series[2].load === null);
ok("two sessions in a day add up", P.dailyLoads([{ date: "2026-11-02", load: 300 }, { date: "2026-11-02", load: 200 }], "2026-11-02", "2026-11-02")[0].load === 500);

const today = "2026-11-28";
const daily = P.dailyLoads(Array.from({ length: 28 }, (_, i) => ({ date: P.addDays(today, -27 + i), load: 300 })), P.addDays(today, -27), today);
const s28 = P.loadSummary(daily, P.addDays(today, -27), today);
ok("steady 4 weeks → ACWR 1.0, sweet spot", s28.acwr === 1 && s28.band === "sweet", s28);
const young = P.loadSummary(daily, P.addDays(today, -10), today);
ok("under 3 weeks of history → no ACWR, and it says why", young.acwr === null && /3 weeks/.test(young.acwrNote ?? ""), young);
ok("no sessions at all → says so", P.loadSummary([], null, today).acwrNote === "No sessions recorded yet");
const spike = P.dailyLoads([
  ...Array.from({ length: 21 }, (_, i) => ({ date: P.addDays(today, -27 + i), load: 200 })),
  ...Array.from({ length: 7 }, (_, i) => ({ date: P.addDays(today, -6 + i), load: 600 })),
], P.addDays(today, -27), today);
const sp = P.loadSummary(spike, P.addDays(today, -27), today);
ok("a tripled week reads as danger", sp.band === "danger" && (sp.acwr ?? 0) > 1.5, sp);
ok("identical days have no monotony (SD 0 → null, not infinity)", s28.monotony === null);
ok("bands: 0.79 low · 1.3 sweet · 1.31 high · 1.51 danger",
  P.acwrBand(0.79) === "low" && P.acwrBand(1.3) === "sweet" && P.acwrBand(1.31) === "high" && P.acwrBand(1.51) === "danger");

// wellness
const w = (date: string, v: number) => ({ date, sleep: v, fatigue: v, soreness: v, stress: v, mood: v });
ok("all 5s = 25", P.wellnessScore(w("2026-11-01", 5)).score === 25);
ok("an unanswered check-in has no score (not 0)", P.wellnessScore({ date: "x", sleep: null, fatigue: null, soreness: null, stress: null, mood: null }).score === null);
ok("half-answered is scaled, not penalised", P.wellnessScore({ date: "x", sleep: 4, fatigue: 4, soreness: null, stress: null, mood: null }).score === 20);
ok("any item at 1 is red", P.wellnessFlag({ ...w("2026-11-10", 4), soreness: 1 }, []).level === "red");
ok("an item at 2 is amber", P.wellnessFlag({ ...w("2026-11-10", 4), stress: 2 }, []).level === "amber");
ok("under 6 h sleep is amber", P.wellnessFlag({ ...w("2026-11-10", 4), sleepHours: 5 }, []).level === "amber");
const hist = Array.from({ length: 10 }, (_, i) => ({ ...w(P.addDays("2026-11-10", -10 + i), 5), mood: i % 2 ? 4 : 5 }));
ok("a drop against their own normal is flagged", P.wellnessFlag(w("2026-11-10", 3), hist).level != null);
ok("no baseline before 7 check-ins", P.wellnessBaseline("2026-11-10", hist.slice(0, 5)).mean === null);

// availability
const spells: P.AvailabilitySpell[] = [{ status: "injured", startedOn: "2026-11-01", endedOn: "2026-11-05" }, { status: "modified", startedOn: "2026-11-10", endedOn: null }];
ok("today inside an open spell", P.availabilityOn(spells, "2026-11-14").state === "modified");
ok("between spells = available", P.availabilityOn(spells, "2026-11-07").state === "available");
ok("days lost: 5 closed + 5 open to today", P.daysLost(spells, "2026-11-14") === 10);
ok("a future spell loses no days yet", P.daysLost([{ status: "injured", startedOn: "2026-12-01", endedOn: null }], "2026-11-14") === 0);

// readiness
const r1 = P.readiness({ availability: "available", wellness: null, load: null });
ok("readiness with nothing but availability says what is missing", r1.level === "green" && r1.missing.length === 2, r1);
ok("injured is red whatever else", P.readiness({ availability: "injured", wellness: { level: null, reasons: [] }, load: s28 }).level === "red");

// metrics
ok("'Total Distance (m)' is distance", P.metricForHeader("Total Distance (m)")?.key === "total_distance_m");
ok("'Top Speed (km/h)' is top speed", P.metricForHeader("Top Speed (km/h)")?.key === "top_speed_kmh");
ok("an unknown header is NOT guessed", P.metricForHeader("Bananas") === null);
ok("a blank formats as —", P.formatMetric(null) === "—");

// CSV
const rows = parseCsv('Player Name,Date,"Total Distance (m)",Top Speed (km/h),Notes\r\nHH,13/10/2026,"7,612",31.2,"said ""fine"""\r\nJR,13/10/2026,,29.8,\r\n');
ok("CSV: quoted commas and doubled quotes", rows[1][2] === "7,612" && rows[1][4] === 'said "fine"', rows);
const plan = planImport(rows, { source: "catapult_one", fallbackDate: null });
ok("plan finds the player and date columns", plan.playerColumn === 0 && plan.dateColumn === 1, plan);
ok("plan maps the metrics and ignores the rest", plan.mapped.map((m) => m.metric).join() === "total_distance_m,top_speed_kmh" && plan.ignored.includes("Notes"), plan);
ok("NZ day/month/year date is read as 13 October", plan.rows[0].date === "2026-10-13", plan.rows[0]);
ok("'7,612' is 7612", plan.rows[0].values.total_distance_m === 7612);
ok("a blank cell is no reading (not 0)", !("total_distance_m" in plan.rows[1].values) && plan.rows[1].values.top_speed_kmh === 29.8, plan.rows[1]);
const nodate = planImport(parseCsv("Player,Distance\nHH,5000\n"), { source: "catapult_one", fallbackDate: null });
ok("a file with no date asks for one", nodate.problems.some((p) => /date/i.test(p)), nodate.problems);
const bad = planImport(parseCsv("Invoice,Amount\nINV-1,400\n"), { source: "catapult_one", fallbackDate: "2026-11-01" });
ok("a file that isn't player data is refused, listing its headers", bad.problems.some((p) => /Invoice/.test(p)), bad.problems);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

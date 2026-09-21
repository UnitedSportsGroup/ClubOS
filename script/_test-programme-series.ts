// Unit checks for @shared/programme-series — the holiday-camp series decider.
//   npx tsx script/_test-programme-series.ts
import { seriesName, editionLabel, currentEditionId, groupCampSeries } from "../shared/programme-series";
let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
console.log("\nseriesName");
eq("Term suffix", seriesName("World Cup Holiday Camp Term 3 2026"), "World Cup Holiday Camp");
eq("no suffix", seriesName("World Cup Holiday Camp"), "World Cup Holiday Camp");
eq("FUNdamentals term", seriesName("FUNdamentals Holiday Camp Term 3 2026"), "FUNdamentals Holiday Camp");
eq("month + year", seriesName("World Cup Holiday Camp January 2027"), "World Cup Holiday Camp");
eq("month range", seriesName("World Cup Holiday Camp Sep–Oct 2026"), "World Cup Holiday Camp");
eq("slash months", seriesName("World Cup Holiday Camp September/October"), "World Cup Holiday Camp");
eq("dash separator", seriesName("World Cup Holiday Camp — April 2026"), "World Cup Holiday Camp");
eq("parenthetical", seriesName("World Cup Holiday Camp (April 2026)"), "World Cup Holiday Camp");
eq("pre-Christmas", seriesName("FUNdamentals Holiday Camp Pre-Christmas 2026"), "FUNdamentals Holiday Camp");
eq("bare year", seriesName("FUNdamentals Holiday Camp 2027"), "FUNdamentals Holiday Camp");
eq("Term without year", seriesName("World Cup Holiday Camp Term 1"), "World Cup Holiday Camp");
eq("'May' inside a word is not a month", seriesName("Mayfield Camp"), "Mayfield Camp");
eq("'Holiday Camp' keeps its Camp", seriesName("Summer Holiday Camp"), "Summer Holiday Camp");
eq("a name that is only a suffix keeps itself", seriesName("Term 3 2026"), "Term 3 2026");
eq("different camps stay different", seriesName("World Cup Camp Term 3 2026") === seriesName("World Cup Holiday Camp Term 3 2026"), false);
console.log("\neditionLabel");
eq("same month", editionLabel("2026-04-07", "2026-04-17"), "Apr 2026");
eq("two months", editionLabel("2026-09-28", "2026-10-09"), "Sep–Oct 2026");
eq("across a year", editionLabel("2026-12-15", "2027-01-20"), "Dec 2026 – Jan 2027");
eq("no dates", editionLabel(null, null), "Dates not set");
eq("timestamp-shaped date", editionLabel("2026-04-07T00:00:00.000Z", "2026-04-17T00:00:00.000Z"), "Apr 2026");
console.log("\ncurrentEditionId");
const apr = { id: 2, startDate: "2026-04-07", endDate: "2026-04-17", isActive: false };
const sep = { id: 39, startDate: "2026-09-28", endDate: "2026-10-09", isActive: true };
const jan = { id: 50, startDate: "2027-01-12", endDate: "2027-01-23", isActive: true };
eq("the live one running or next up", currentEditionId([apr, sep], "2026-09-21"), 39);
eq("the NEXT live one, not a later one", currentEditionId([apr, sep, jan], "2026-09-21"), 39);
eq("after it ends, the next live one", currentEditionId([apr, sep, jan], "2026-11-01"), 50);
eq("all past and live: the latest live", currentEditionId([apr, sep], "2027-03-01"), 39);
eq("nothing live: the latest", currentEditionId([apr, { ...sep, isActive: false }], "2026-09-21"), 39);
eq("empty", currentEditionId([], "2026-09-21"), null);
console.log("\ngroupCampSeries");
const g = groupCampSeries([
  { id: 1, name: "FUNdamentals Holiday Camp", startDate: "2026-04-07", endDate: "2026-04-17", isActive: false },
  { id: 30, name: "FUNdamentals Holiday Camp Term 3 2026", startDate: "2026-09-28", endDate: "2026-10-09", isActive: true },
  { id: 2, name: "World Cup Holiday Camp", startDate: "2026-04-07", endDate: "2026-04-17", isActive: false },
  { id: 39, name: "World Cup Holiday Camp Term 3 2026", startDate: "2026-09-28", endDate: "2026-10-09", isActive: true },
], "2026-09-21");
eq("two series from four rows", g.length, 2);
eq("names are the series names", g.map((s) => s.name), ["FUNdamentals Holiday Camp", "World Cup Holiday Camp"]);
eq("editions oldest first", g[1].editions.map((e) => e.id), [2, 39]);
eq("current is the one on sale", g.map((s) => s.current.id), [30, 39]);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

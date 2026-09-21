// The gaps in a history are DERIVED, and the off-by-one at a handover is the
// thing worth proving. Vehicles and the residency share this algorithm, so a
// bug here is a bug in both.
//
//   npx tsx script/_test-occupancy-timeline.ts
import { occupancyTimeline } from "@shared/occupancy-timeline";
import { vehicleTimeline } from "@shared/fleet-history";

let bad = 0;
const t = (got: unknown, want: unknown, label: string) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
  if (!ok) bad++;
};
const shape = (segs: any[]) => segs.map((s) => s.kind === "held"
  ? `${s.holderName} ${s.from}..${s.to ?? "open"}`
  : `EMPTY ${s.from}..${s.to ?? "open"}`);

const TODAY = "2026-09-21";
const P = (id: number, holderName: string, from: string, to: string | null) => ({ id, holderName, from, to });

// Daniel's own example, with the dates he used.
t(shape(occupancyTimeline([P(1, "Travis", "2026-07-20", "2026-09-12")], TODAY)),
  ["Travis 2026-07-20..2026-09-12", "EMPTY 2026-09-13..open"],
  "a closed stint leaves an open gap running to today");

t(shape(occupancyTimeline([
    P(1, "Travis", "2026-07-20", "2026-09-12"),
    P(2, "Someone", "2026-09-20", null),
  ], TODAY)),
  ["Travis 2026-07-20..2026-09-12", "EMPTY 2026-09-13..2026-09-19", "Someone 2026-09-20..open"],
  "a gap between two stints stops the day before the next one starts");

// 🔴 The off-by-one. Out Monday, in Tuesday is NOT a gap.
t(shape(occupancyTimeline([
    P(1, "A", "2026-01-01", "2026-01-10"),
    P(2, "B", "2026-01-11", "2026-01-20"),
  ], TODAY)),
  ["A 2026-01-01..2026-01-10", "B 2026-01-11..2026-01-20", "EMPTY 2026-01-21..open"],
  "a same-next-day handover produces NO gap");

t(shape(occupancyTimeline([
    P(1, "A", "2026-01-01", "2026-01-10"),
    P(2, "B", "2026-01-12", "2026-01-20"),
  ], TODAY)),
  ["A 2026-01-01..2026-01-10", "EMPTY 2026-01-11..2026-01-11", "B 2026-01-12..2026-01-20", "EMPTY 2026-01-21..open"],
  "one clear day IS a gap, of exactly one day");

t(occupancyTimeline([P(1, "A", "2026-01-01", "2026-01-10"), P(2, "B", "2026-01-12", "2026-01-20")], TODAY)
   .filter((s) => s.kind === "empty")[0].days, 1, "and it counts as 1 day, not 0 or 2");

// Nothing before the first period, ever.
t(occupancyTimeline([P(1, "A", "2026-01-01", null)], TODAY)[0].kind, "held",
  "no invented gap before the first stint");

// An open period ends the line.
t(shape(occupancyTimeline([
    P(1, "A", "2026-01-01", null),
    P(2, "B", "2026-05-01", "2026-06-01"),
  ], TODAY)),
  ["A 2026-01-01..open"],
  "an open stint ends the line — nothing can follow it");

// A stint that ended TODAY leaves no gap yet.
t(shape(occupancyTimeline([P(1, "A", "2026-01-01", TODAY)], TODAY)),
  ["A 2026-01-01..2026-09-21"],
  "a stint ending today leaves no gap");

// Unusable dates are dropped, never guessed into place.
t(shape(occupancyTimeline([P(1, "A", "not-a-date", null), P(2, "B", "2026-02-01", null)], TODAY)),
  ["B 2026-02-01..open"],
  "a row with an unusable start is dropped, not guessed");

// Rows arrive in any order.
t(shape(occupancyTimeline([
    P(2, "B", "2026-03-01", "2026-03-10"),
    P(1, "A", "2026-01-01", "2026-01-10"),
  ], TODAY))[0],
  "A 2026-01-01..2026-01-10",
  "unsorted input is sorted by date");

// Inclusive day counts.
t(occupancyTimeline([P(1, "A", "2026-01-01", "2026-01-01")], TODAY)[0].days, 1,
  "a one-day stint is 1 day, inclusive");

// ── The vehicle wrapper ────────────────────────────────────────────────────
const v = vehicleTimeline(
  [{ id: 1, holderName: "Travis", assignedOn: "2026-07-20", returnedOn: "2026-09-12" }],
  "United Sports Centre, 466 Yaldhurst Road", TODAY);
t((v[1] as any).parkedLocation, "United Sports Centre, 466 Yaldhurst Road",
  "a gap carries the vehicle's recorded parking place");

const v2 = vehicleTimeline(
  [{ id: 1, holderName: "Travis", assignedOn: "2026-07-20", returnedOn: "2026-09-12" }], null, TODAY);
t((v2[1] as any).parkedLocation, null,
  "🔴 and null when nobody has said — never a guessed address");

const v3 = vehicleTimeline(
  [{ id: 1, holderName: "Travis", assignedOn: "2026-07-20", returnedOn: "2026-09-12" }], "   ", TODAY);
t((v3[1] as any).parkedLocation, null, "whitespace is not a location");

console.log(bad ? `\n${bad} FAILED\n` : "\nAll passed\n");
process.exit(bad ? 1 : 0);

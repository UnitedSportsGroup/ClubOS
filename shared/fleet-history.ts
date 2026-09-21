/**
 * A vehicle's history as one continuous line: who held it, and the stretches
 * when nobody did.
 *
 * Daniel, 2026-09-21: "be able to see like for example travis had car from 20th
 * july 2026 to 12th september 2026 and then we assign new person from start to
 * end date and any dates not clicked are shown as blank, no one had car at this
 * time and it was parked at United Sports Centre or whatever address we say."
 *
 * 🔴 A GAP IS THE ABSENCE OF AN ASSIGNMENT, DERIVED HERE. Nothing stores a
 * "nobody had it" row. Storing one would be a second source of truth that goes
 * stale the moment a date either side is edited, and would need deleting and
 * recreating on every change — the same reason overdue, occupancy and
 * compliance are all computed on read in this codebase.
 *
 * 🔴 IT NEVER INVENTS A LOCATION. A gap reads the vehicle's `parkedLocation`
 * when a human has set one, and says "location not recorded" when they have
 * not. The club has vehicles that do not live at United Sports Centre, and a
 * guessed address on a historical gap is the sort of thing that later gets
 * quoted back by an insurer.
 *
 * 🔴 IT NEVER INVENTS A BEGINNING. There is no gap before the first assignment:
 * nothing in this database says when the club acquired the vehicle, so a period
 * stretching back to the dawn of time would be a claim we cannot support.
 *
 * 🔴 DATES ARE ISO STRINGS THROUGHOUT, compared as strings and stepped by the
 * calendar. Putting a bare `YYYY-MM-DD` through a JS `Date` reads a day early
 * in NZ for the whole evening — which on a history view means a handover lands
 * on the wrong day.
 */

export interface AssignmentLike {
  id: number;
  holderName: string;
  holderUserId?: number | null;
  assignedOn: string;              // ISO yyyy-mm-dd
  returnedOn?: string | null;      // null = they still have it
  purpose?: string | null;
  odometerStartKm?: number | null;
  odometerEndKm?: number | null;
}

export type TimelineSegment =
  | {
      kind: "held";
      assignmentId: number;
      holderName: string;
      holderUserId: number | null;
      from: string;
      /** null = open-ended, they still have it. */
      to: string | null;
      open: boolean;
      days: number | null;
      odometerStartKm: number | null;
      odometerEndKm: number | null;
      purpose: string | null;
    }
  | {
      kind: "gap";
      from: string;
      /** null = nobody has it now and nobody is booked to. */
      to: string | null;
      open: boolean;
      days: number | null;
      /** The vehicle's recorded parking place, or null when nobody has said. */
      parkedLocation: string | null;
    };

/** Calendar arithmetic on the y-m-d parts. Never `new Date(iso)`. */
function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Inclusive day count between two ISO dates. */
function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split("-").map(Number);
  const [by, bm, bd] = to.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000) + 1;
}

const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());

/**
 * Build the timeline. `todayIso` is NZ's today from the server — a browser
 * computing it with toISOString() is a day behind here all evening.
 */
export function vehicleTimeline(
  assignments: AssignmentLike[],
  parkedLocation: string | null | undefined,
  todayIso: string,
): TimelineSegment[] {
  // Only rows with a usable start date can be placed on a line. A malformed
  // date is dropped rather than guessed — it would otherwise anchor a gap.
  const rows = assignments
    .filter((a) => isIsoDate(a.assignedOn))
    .map((a) => ({
      ...a,
      returnedOn: isIsoDate(a.returnedOn) ? a.returnedOn!.trim() : null,
      assignedOn: a.assignedOn.trim(),
    }))
    .sort((a, b) => (a.assignedOn === b.assignedOn ? a.id - b.id : a.assignedOn < b.assignedOn ? -1 : 1));

  const park = typeof parkedLocation === "string" && parkedLocation.trim() ? parkedLocation.trim() : null;
  const out: TimelineSegment[] = [];

  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    out.push({
      kind: "held",
      assignmentId: a.id,
      holderName: a.holderName,
      holderUserId: a.holderUserId ?? null,
      from: a.assignedOn,
      to: a.returnedOn,
      open: a.returnedOn === null,
      days: a.returnedOn ? daysBetween(a.assignedOn, a.returnedOn) : null,
      odometerStartKm: a.odometerStartKm ?? null,
      odometerEndKm: a.odometerEndKm ?? null,
      purpose: a.purpose ?? null,
    });

    // An open assignment runs to the end of the line — nothing can follow it,
    // and the exclusion constraint in Postgres says so too.
    if (a.returnedOn === null) break;

    const next = rows[i + 1];
    const gapFrom = addDays(a.returnedOn, 1);

    if (next) {
      // A handover with no daylight between it (returned Monday, reassigned
      // Tuesday) is NOT a gap — there was no day on which nobody held it.
      if (gapFrom <= addDays(next.assignedOn, -1)) {
        out.push({
          kind: "gap",
          from: gapFrom,
          to: addDays(next.assignedOn, -1),
          open: false,
          days: daysBetween(gapFrom, addDays(next.assignedOn, -1)),
          parkedLocation: park,
        });
      }
    } else if (gapFrom <= todayIso) {
      // Nobody holds it now. The gap runs to today and stays open.
      out.push({
        kind: "gap",
        from: gapFrom,
        to: null,
        open: true,
        days: daysBetween(gapFrom, todayIso),
        parkedLocation: park,
      });
    }
  }

  return out;
}

/** Who holds it right now, or null when nobody does. */
export function currentHolder(segments: TimelineSegment[]): string | null {
  const last = segments[segments.length - 1];
  return last && last.kind === "held" && last.open ? last.holderName : null;
}

/**
 * One thing held by one person at a time, over time — and the stretches when
 * nobody held it.
 *
 * Daniel asked for the same view twice on 2026-09-21, an hour apart:
 *
 *   "travis had car from 20th july 2026 to 12th september 2026 and then we
 *    assign new person from start to end date and any dates not clicked are
 *    shown as blank, no one had car at this time and it was parked at United
 *    Sports Centre"
 *
 *   "seeing history of like Oli Fay was in Room 2 main house from January 10th
 *    – May 31st and it sat empty from 1st June to July 15th and then test
 *    player moved in on July 16th – present"
 *
 * 🔴 ONE ALGORITHM, TWO CALLERS. A vehicle assignment and a room tenancy are
 * the same shape — a holder, a start, an optional end — and the interesting
 * part is identical: the gaps between them. Writing it twice would mean fixing
 * the off-by-one at a handover twice, and only remembering once.
 *
 * 🔴 A GAP IS DERIVED, NEVER STORED. Nothing writes a "nobody had it" row. It
 * would be a second source of truth that goes stale the moment a date either
 * side is edited, and would need deleting and recreating on every change.
 *
 * 🔴 IT NEVER INVENTS A BEGINNING. There is no gap before the first period:
 * nothing in the database says when the club acquired the van or the house, so
 * a stretch reaching back to the dawn of time would be a claim we cannot
 * support.
 *
 * 🔴 DATES ARE ISO STRINGS, compared as strings and stepped by the calendar.
 * Putting a bare `YYYY-MM-DD` through a JS `Date` reads a day early in NZ for
 * the whole evening — on a history view that lands a handover on the wrong day.
 */

export interface HeldPeriod {
  id: number;
  /** Who held it. */
  holderName: string;
  from: string;                 // ISO yyyy-mm-dd
  to?: string | null;           // null = they still hold it
  /** Anything the caller wants back on the segment, untouched. */
  meta?: Record<string, unknown>;
}

export type OccupancySegment =
  | {
      kind: "held";
      id: number;
      holderName: string;
      from: string;
      to: string | null;
      open: boolean;
      days: number | null;
      meta: Record<string, unknown>;
    }
  | {
      kind: "empty";
      from: string;
      to: string | null;
      open: boolean;
      days: number | null;
    };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (v: unknown): v is string => typeof v === "string" && ISO.test(v.trim());

export function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + delta * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Inclusive day count between two ISO dates. */
export function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split("-").map(Number);
  const [by, bm, bd] = to.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000) + 1;
}

/**
 * @param todayIso NZ's today, from the SERVER. A browser computing it with
 *   toISOString() is a day behind here all evening.
 */
export function occupancyTimeline(periods: HeldPeriod[], todayIso: string): OccupancySegment[] {
  // A row without a usable start cannot be placed on a line, and would
  // otherwise anchor a gap somewhere arbitrary. Dropped, never guessed.
  const rows = periods
    .filter((p) => isIso(p.from))
    .map((p) => ({ ...p, from: p.from.trim(), to: isIso(p.to) ? p.to!.trim() : null }))
    .sort((a, b) => (a.from === b.from ? a.id - b.id : a.from < b.from ? -1 : 1));

  const out: OccupancySegment[] = [];

  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    out.push({
      kind: "held",
      id: p.id,
      holderName: p.holderName,
      from: p.from,
      to: p.to,
      open: p.to === null,
      days: p.to ? daysBetween(p.from, p.to) : null,
      meta: p.meta ?? {},
    });

    // An open period runs to the end of the line. Nothing can follow it, and
    // the exclusion constraints in Postgres say so for both callers.
    if (p.to === null) break;

    const next = rows[i + 1];
    const gapFrom = addDays(p.to, 1);

    if (next) {
      // 🔴 A handover with no daylight (out Monday, in Tuesday) is NOT a gap —
      // there was no day on which nobody held it. This is the off-by-one worth
      // only writing once.
      const gapTo = addDays(next.from, -1);
      if (gapFrom <= gapTo) {
        out.push({ kind: "empty", from: gapFrom, to: gapTo, open: false, days: daysBetween(gapFrom, gapTo) });
      }
    } else if (gapFrom <= todayIso) {
      // Nobody holds it now — the gap runs to today and stays open.
      out.push({ kind: "empty", from: gapFrom, to: null, open: true, days: daysBetween(gapFrom, todayIso) });
    }
  }

  return out;
}

/** Who holds it right now, or null when nobody does. */
export function holderNow(segments: OccupancySegment[]): string | null {
  const last = segments[segments.length - 1];
  return last && last.kind === "held" && last.open ? last.holderName : null;
}

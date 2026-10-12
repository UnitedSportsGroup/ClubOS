// Which weekly sessions a term programme is MISSING — the one decider shared by
// script/ensure-term-sessions.ts and the server's daily job.
//
// Daniel, 2026-10-12: "for any new term, it shows the new session dates, the
// new roll … always done for us every single new term." Term 4 2026 opened with
// the FUNiño roll still showing Term 3, because sessions were only ever made by
// someone pressing Generate after flipping the programme's term.
//
// Pure: no DB, no clock. Dates are plain y-m-d strings walked as calendar
// parts — never through toISOString() (NZ is UTC+13 and reads a day early).

export type PatternSlot = {
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  name?: string | null;
  capacity?: number | null;
};
export type TermRow = { id: number; start: string; end: string };
export type PlannedSession = {
  termId: number; date: string; startTime: string; endTime: string;
  name: string | null; capacity: number | null;
};

const HHMM = /^\d{2}:\d{2}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
function dow(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function validateSlots(slots: unknown): PatternSlot[] {
  if (!Array.isArray(slots) || slots.length === 0) throw new Error("pattern must be a non-empty array of slots");
  for (const s of slots as PatternSlot[]) {
    if (!Array.isArray(s.daysOfWeek) || !s.daysOfWeek.length || s.daysOfWeek.some(d => !Number.isInteger(d) || d < 0 || d > 6))
      throw new Error("each slot needs daysOfWeek 0..6 (Sun=0)");
    if (!HHMM.test(s.startTime) || !HHMM.test(s.endTime)) throw new Error("startTime/endTime must be HH:MM");
  }
  return slots as PatternSlot[];
}

/**
 * Every (date, slot) the pattern implies inside each term that is running
 * today or starts within `horizonDays`, minus what already exists. Past days
 * of a running term are included too: a roll for last Tuesday is still a roll
 * someone may need to fill in.
 */
export function planTermSessions(opts: {
  slots: unknown; terms: TermRow[]; existing: { date: string; start: string }[];
  today: string; horizonDays: number;
}): PlannedSession[] {
  const slots = validateSlots(opts.slots);
  if (!YMD.test(opts.today)) throw new Error("today must be YYYY-MM-DD");
  const horizonEnd = addDays(opts.today, opts.horizonDays);
  const seen = new Set(opts.existing.map(e => `${e.date}|${(e.start ?? "").slice(0, 5)}`));
  const out: PlannedSession[] = [];
  for (const t of opts.terms) {
    if (!YMD.test(t.start) || !YMD.test(t.end)) continue;
    const relevant = t.end >= opts.today && t.start <= horizonEnd;
    if (!relevant) continue;
    for (let d = t.start; d <= t.end; d = addDays(d, 1)) {
      const w = dow(d);
      for (const s of slots) {
        if (!s.daysOfWeek.includes(w)) continue;
        const key = `${d}|${s.startTime}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ termId: t.id, date: d, startTime: s.startTime, endTime: s.endTime,
          name: s.name ?? null, capacity: s.capacity ?? null });
      }
    }
  }
  return out.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}

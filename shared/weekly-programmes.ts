// 🔴 COPIED from apps/cufc-coaching/src/data/weeklyProgrammes.ts (2026-11-20) so the
// ClubOS term roll and the coaches' term roll draw the SAME columns. Change both.
/* Programmes that train ONCE A WEEK, all year round apart from the school
 * holidays (Daniel, 2026-11-18: "technification it's all year around once a
 * week apart from the holidays … show every monday of the term and grey out
 * monday public holidays … show the term attendance on right side").
 *
 * Their roll reads as the TERM — one column per session — not a 7-day week
 * where six columns are always empty. Keyed on the ClubOS programme slug the
 * group is synced from; 1 = Monday (JS getUTCDay). Add a programme here and
 * its roll becomes a term roll. */
export const WEEKLY_PROGRAMMES: Record<string, { weekday: number; label: string }> = {
  technification: { weekday: 1, label: "Monday" },
};

/** Programmes whose training days are SET for the whole term (Daniel,
 *  2026-11-20: "attendance should be tue thu sat for the whole term for pre
 *  academy U9-U12 their schedule is set"). Their term roll is exactly these
 *  weekdays, every week of the term, holidays greyed — a day a coach planned
 *  or marked on another weekday is not a session of this programme. */
export const SET_SCHEDULES: Record<string, { weekdays: number[]; label: string }> = {
  "pre-academy-u9-u12": { weekdays: [2, 4, 6], label: "Tue · Thu · Sat" },
};

/** Every session day of the term for a set schedule, in date order. */
export function scheduleDays(from: string, to: string, weekdays: number[]): string[] {
  return weekdays.flatMap((w) => weekdaysInRange(from, to, w)).sort();
}

/** Open-training players may come this many times in a term before they must
 *  see the office (Daniel, 2026-11-18: "came like 3 times this term and not
 *  marked as paid then he needs to go to office before can train"). */
export const OPEN_TRAINING_FREE_SESSIONS = 3;

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** The nth Monday of a month (n = 1..5). */
function nthMonday(y: number, m: number, n: number): string {
  const first = dow(y, m, 1);
  const day = 1 + ((8 - first) % 7) + (n - 1) * 7;
  return iso(y, m, day);
}
/** A holiday that falls on a weekend moves to the Monday (Mondayised). */
function mondayised(y: number, m: number, d: number): string {
  const w = dow(y, m, d);
  if (w === 6) return iso(y, m, d + 2);
  if (w === 0) return iso(y, m, d + 1);
  return iso(y, m, d);
}
/** Easter Sunday (Anonymous Gregorian algorithm). */
function easterSunday(y: number): { m: number; d: number } {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
}

/** NZ public holidays that can fall on a weekday, for Christchurch (national +
 *  Canterbury Anniversary). Matariki is a Friday set by law each year, listed
 *  for the years published. Date → name. */
export function nzPublicHolidays(year: number): Map<string, string> {
  const out = new Map<string, string>();
  out.set(mondayised(year, 1, 1), "New Year's Day");
  // 2 January: Mondayised, and pushed past New Year's if they collide.
  const ny = mondayised(year, 1, 1);
  let jan2 = mondayised(year, 1, 2);
  if (jan2 === ny) jan2 = iso(year, 1, Number(ny.slice(8)) + 1);
  out.set(jan2, "Day after New Year's Day");
  out.set(mondayised(year, 2, 6), "Waitangi Day");
  const e = easterSunday(year);
  const es = new Date(Date.UTC(year, e.m - 1, e.d));
  const gf = new Date(es); gf.setUTCDate(es.getUTCDate() - 2);
  const em = new Date(es); em.setUTCDate(es.getUTCDate() + 1);
  out.set(gf.toISOString().slice(0, 10), "Good Friday");
  out.set(em.toISOString().slice(0, 10), "Easter Monday");
  out.set(mondayised(year, 4, 25), "ANZAC Day");
  out.set(nthMonday(year, 6, 1), "King's Birthday");
  const MATARIKI: Record<number, string> = { 2025: "2025-06-20", 2026: "2026-07-10", 2027: "2027-06-25", 2028: "2028-07-14", 2029: "2029-07-06", 2030: "2030-06-21" };
  if (MATARIKI[year]) out.set(MATARIKI[year], "Matariki");
  out.set(nthMonday(year, 10, 4), "Labour Day");
  // Canterbury Anniversary: the second Friday after the first Tuesday in November.
  const firstTue = 1 + ((9 - dow(year, 11, 1)) % 7);
  out.set(iso(year, 11, firstTue + 10), "Canterbury Anniversary");
  out.set(mondayised(year, 12, 25), "Christmas Day");
  let boxing = mondayised(year, 12, 26);
  if (boxing === mondayised(year, 12, 25)) boxing = iso(year, 12, Number(boxing.slice(8)) + 1);
  out.set(boxing, "Boxing Day");
  return out;
}

/** Every given weekday between two ISO dates (inclusive). */
export function weekdaysInRange(from: string, to: string, weekday: number): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

/** The holiday on this date, if any. */
export function holidayOn(date: string): string | null {
  return nzPublicHolidays(Number(date.slice(0, 4))).get(date) ?? null;
}

/** 🔴 ONE decider: is this programme's roll taken on coach.cufc.co.nz? Then
 *  ClubOS only DISPLAYS it — no roll buttons, and the server refuses a mark
 *  (Daniel, 2026-11-20: "clubos should just display what coaches put into
 *  coaches platform … one place to take roll"). Pre-Academy and Academy (by
 *  stream) and every once-a-week programme (Technification). U4–U8 is still
 *  rolled in ClubOS by its coaches, so it is NOT here. */
export function rollTakenOnCoachPlatform(slug: string | null | undefined, stream: string | null | undefined): boolean {
  return stream === "pre_academy" || stream === "academy" || (!!slug && slug in WEEKLY_PROGRAMMES);
}

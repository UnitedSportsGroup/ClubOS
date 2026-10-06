// A date of birth, typed — the pure half of the DobInput field.
//
// Zach, 2026-10-07: "if there's any way to improve the smoothness of inputting
// the DOB on ClubOS". Erika Bruning, 5 Oct: "struggling to register". What a
// parent met: on the camp checkout a calendar popover opened on THIS month, so
// a 2017 birthday was ~110 taps of "previous month"; on the academy checkout
// the phone's own date wheel, starting at today, spun back ten years.
//
// A date of birth is a MEMORISED date, not a chosen one. The most-tested
// pattern for it (GOV.UK design system; Baymard's checkout research) is three
// plain boxes — day, month, year — with a number keypad and no picker at all.
// That is what the field draws. Nothing here touches the DOM; the React
// component and the node test both read these functions, and the brand sites
// carry a byte-identical copy (cufc-website, cugc-website).
//
// 🔴 Never through a JS Date. `new Date("2018-07-11")` is UTC midnight, which
// is the 11th in London and the 12th in Christchurch — a child's birthday
// would move by a day depending on where the server runs. Calendar maths on
// the parts only.

export interface DobParts {
  day: string;
  month: string;
  year: string;
}

export const EMPTY_DOB: DobParts = { day: "", month: "", year: "" };

/** Digits only, capped. */
export function digits(raw: string, max: number): string {
  return raw.replace(/\D+/g, "").slice(0, max);
}

/** The three parts of an ISO `YYYY-MM-DD`, or empty parts for anything else. */
export function partsFromIso(iso: string | null | undefined): DobParts {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? "").trim());
  if (!m) return { ...EMPTY_DOB };
  return { year: m[1], month: m[2], day: m[3] };
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** True when every box has something in it. */
export function partsComplete(p: DobParts): boolean {
  return p.day.length >= 1 && p.month.length >= 1 && p.year.length === 4;
}

export type DobProblem =
  | "incomplete"
  | "not_a_date"
  | "future"
  | "too_old";

export interface DobCheck {
  iso: string | null;
  problem: DobProblem | null;
}

/** ISO date from the parts — or why not. `todayIso` is the NZ date
 *  (shared/academy's nzTodayIso); a date of birth can't be after it. A year
 *  before 1900 is a typo, not a person. */
export function checkDobParts(p: DobParts, todayIso: string): DobCheck {
  if (!partsComplete(p)) return { iso: null, problem: "incomplete" };
  const day = Number(p.day);
  const month = Number(p.month);
  const year = Number(p.year);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return { iso: null, problem: "not_a_date" };
  }
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return { iso: null, problem: "not_a_date" };
  }
  if (year < 1900) return { iso: null, problem: "too_old" };
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (iso > todayIso.slice(0, 10)) return { iso: null, problem: "future" };
  return { iso, problem: null };
}

/** What to tell the person, in plain words. Null while they are still typing. */
export function dobProblemMessage(problem: DobProblem | null): string | null {
  switch (problem) {
    case "not_a_date": return "That isn't a real date — check the day and month.";
    case "future": return "A date of birth can't be in the future.";
    case "too_old": return "Check the year.";
    default: return null;
  }
}

/** Whole years old on `todayIso`, on calendar parts. */
export function ageOnDate(iso: string, todayIso: string): number | null {
  const [by, bm, bd] = iso.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = todayIso.slice(0, 10).split("-").map(Number);
  if (!by || !bm || !bd || !ty || !tm || !td) return null;
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age >= 0 && age < 130 ? age : null;
}

/** A pasted or autofilled whole date, in any of the ways people write one:
 *  11/07/2018 · 11-07-2018 · 11.07.2018 · 2018-07-11 · 11 07 2018 · 11072018.
 *  Day-first everywhere a human typed it — this is New Zealand. Null when it
 *  isn't a whole date (so a single box's own typing is never mistaken for one). */
export function parseWholeDate(text: string): DobParts | null {
  const s = String(text ?? "").trim();
  let m = /^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})$/.exec(s);
  if (m) return { year: m[1], month: m[2].padStart(2, "0"), day: m[3].padStart(2, "0") };
  m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/.exec(s);
  if (m) return { day: m[1].padStart(2, "0"), month: m[2].padStart(2, "0"), year: m[3] };
  m = /^(\d{2})(\d{2})(\d{4})$/.exec(s);
  if (m) return { day: m[1], month: m[2], year: m[3] };
  return null;
}

/** Does a box "finish" on this value, so focus can move on? A day of 4–9 or a
 *  month of 2–9 can only be one digit, so they finish at once (and are
 *  zero-padded on the way out); otherwise two digits. The year needs four. */
export function boxComplete(box: keyof DobParts, value: string): boolean {
  if (box === "year") return value.length === 4;
  if (value.length >= 2) return true;
  if (value.length === 1) {
    const n = Number(value);
    return box === "day" ? n >= 4 : n >= 2;
  }
  return false;
}

/** "7" → "07" for day/month once the person leaves the box. */
export function padBox(box: keyof DobParts, value: string): string {
  if (box === "year" || value.length !== 1) return value;
  return value === "0" ? "" : `0${value}`;
}

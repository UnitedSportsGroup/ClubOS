/**
 * TERM PROGRAMME HISTORY — every academy term the club has run (FUNiño,
 * Technification, Pre-Academy, Academy, Goalkeeper, Morning), from every system
 * it was ever sold through, on one timeline. The term-programme twin of
 * @shared/holiday-camp-history.
 *
 * Daniel, 2026-10-13: "add this type of history tab to all academy sign ups,
 * u4-u8, technification etc… for us to track it as well."
 *
 * Sources, all already inside ClubOS:
 *   fm_payment_history — Friendly Manager payments and Xero invoices (history import)
 *   registrations      — ClubOS's own term registrations (each stamped with its term)
 * A history row that ClubOS ALSO holds as a registration (the 2026 Xero and FM
 * migrations — linked by fee number = registrations.legacy_external_id) is
 * counted once, from ClubOS, which knows the programme exactly.
 *
 * 🔴 Pure functions, one decider. 🔴 Nothing is guessed silently: a left-out row
 * carries a reason, a row placed by its payment date is flagged, and a whole-year
 * invoice stays a whole-year figure — it is never spread across terms.
 */

export type TermStream = "funino" | "technification" | "pre_academy" | "academy" | "academy_unsplit" | "goalkeeper" | "morning";

export const TERM_STREAMS: Array<{ key: TermStream; label: string; color: string }> = [
  { key: "funino", label: "FUNiño (U4–U8)", color: "#3b82f6" },
  { key: "technification", label: "Technification", color: "#8b5cf6" },
  { key: "pre_academy", label: "Pre-Academy (U9–U12)", color: "#f59e0b" },
  { key: "academy", label: "Academy (U13+)", color: "#10b981" },
  { key: "academy_unsplit", label: "Academy (ages not stated)", color: "#64748b" },
  { key: "goalkeeper", label: "Goalkeeper", color: "#ec4899" },
  { key: "morning", label: "Morning / Football Institute", color: "#0ea5e9" },
];

/** "2025-t3" for a term, "2019-yr" for money paid for a whole year or season. */
export type PeriodKey = `${number}-t${1 | 2 | 3 | 4}` | `${number}-yr`;

export function periodOrder(k: string): number {
  const [y, p] = k.split("-");
  return Number(y) * 10 + (p === "yr" ? 5 : Number(p.slice(1)));
}
export function periodTitle(k: string): string {
  const [y, p] = k.split("-");
  return p === "yr" ? `${y} (whole year)` : `Term ${p.slice(1)} ${y}`;
}
export function samePeriodLastYear(k: string): string {
  const [y, p] = k.split("-");
  return `${Number(y) - 1}-${p}`;
}
export const periodYear = (k: string) => Number(k.split("-")[0]);

/** The term a payment on this date is most likely FOR. Families pay before a
 *  term or in its first weeks, so a date maps to the term running or the next
 *  one. NZ school terms: T1 Feb–mid Apr, T2 late Apr–early Jul, T3 mid Jul–late
 *  Sep, T4 mid Oct–mid Dec. Works on y-m-d parts, never a Date. */
export function termForPaidDate(iso: string): PeriodKey {
  const y = Number(iso.slice(0, 4));
  const md = iso.slice(5, 10);
  if (md <= "03-31") return `${y}-t1`;
  if (md <= "06-15") return `${y}-t2`;
  if (md <= "09-05") return `${y}-t3`;
  if (md <= "12-10") return `${y}-t4`;
  return `${y + 1}-t1`;
}

export interface TermHistoryRow {
  id: number;
  source: string;            // friendly_manager | xero | shopify
  first_name: string | null;
  last_name: string | null;
  fee_description: string | null;
  programme: string | null;
  term_name: string | null;
  season_year: number | null;
  paid_on: string;           // yyyy-mm-dd
  amount_cents: number;
}

export type TermClassified =
  | { include: true; stream: TermStream; period: PeriodKey; how: "named" | "paid_date" }
  | { include: false; reason: string };

const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();

/** The youngest age group a description names ("U11/U12" → 11, "U 9" → 9). */
export function ageOf(t: string): number | null {
  const m = /\bu\s?(\d{1,2})\b/.exec(t);
  return m ? Number(m[1]) : null;
}

function streamOf(t: string): TermStream | { reason: string } | null {
  if (/residency/.test(t)) return { reason: "Residency (counted with housing, not a term programme)" };
  if (/holiday|hol prog|\bcamp\b|fundament|world cup|christmas|multi sport/.test(t)) return { reason: "Holiday camp (on the holiday camp History tab)" };
  if (/uniform|\bkit\b|shirt|sock/.test(t)) return { reason: "Uniform or kit" };
  if (/referee|match fee/.test(t)) return { reason: "Referee or match fees" };
  if (/tournament|trials?\b|reimburse|reversal|charged back|online course|ole academy/.test(t)) return { reason: "Tournament, trial, reimbursement or other one-off" };
  if (/technification/.test(t)) return "technification";
  if (/goal ?keep|\bgk\b/.test(t)) return "goalkeeper";
  if (/\bfs \d{4}|\bfs\b.*term|funi|first (skills|kicks)|u4\s*-?\s*(u?8)|u4 - u8/.test(t)) return "funino";
  const age = ageOf(t);
  if (age !== null && age >= 4 && age <= 8) return "funino";
  if (age !== null && age >= 9 && age <= 12) return "pre_academy";
  if (age !== null && age >= 13 && age <= 23) return "academy";
  if (/morning programme|football institute/.test(t)) return "morning";
  if (/pre[- ]?academy/.test(t)) return "pre_academy";
  if (/academy|winter (season|programme)|term ?\d registration|levies/.test(t)) return "academy_unsplit";
  return null;
}

/** The term or year a description NAMES, when it names one. */
function namedPeriod(t: string, seasonYear: number | null, paidOn: string): PeriodKey | null {
  // 🔴 A child's BIRTH year is not the term's year — "U11 Term 1 (Birth Year -
  // 2015)" put Pre-Academy money in 2013–2016, before the records began.
  const clean = t.replace(/birth ?year\s*[-:]?\s*20\d{2}/g, " ").replace(/born( in)?\s*20\d{2}/g, " ");
  const yr = (() => {
    const named = /term ?[1-4]\s*(20\d{2})/.exec(clean) ?? /(20\d{2})\s*-?\s*term/.exec(clean) ?? /\b(20\d{2})\b/.exec(clean);
    return named ? Number(named[1]) : seasonYear ?? null;
  })();
  const term = /\bterm ?([1-4])\b|\bt([1-4])\b/.exec(clean);
  if (term) {
    const n = Number(term[1] ?? term[2]) as 1 | 2 | 3 | 4;
    // No year written: the paid year — except Term 1 paid in Oct–Dec, which is
    // next year's Term 1 paid early.
    const paidY = Number(paidOn.slice(0, 4)), paidM = Number(paidOn.slice(5, 7));
    const y = yr ?? (n === 1 && paidM >= 10 ? paidY + 1 : paidY);
    return `${y}-t${n}`;
  }
  if (/whole year|full year|academy 20\d{2}|winter season|season/.test(clean) && yr != null) return `${yr}-yr` as PeriodKey;
  return null;
}

export function classifyTermRow(r: TermHistoryRow): TermClassified {
  const who = `${lower(r.first_name)} ${lower(r.last_name)}`;
  if (/\btest(er)?\d*\b|fusion5/.test(who)) return { include: false, reason: "Test booking" };
  if (!r.amount_cents) return { include: false, reason: "Free (no money changed hands)" };
  const t = [r.programme, r.fee_description, r.term_name].map(lower).join(" | ");
  const s = streamOf(t);
  if (s === null) return { include: false, reason: "Not a term programme we can place (e.g. a bare “Payment” or “Registration”)" };
  if (typeof s === "object") return { include: false, reason: s.reason };
  const named = namedPeriod(t, r.season_year, r.paid_on);
  if (named) return { include: true, stream: s, period: named, how: "named" };
  return { include: true, stream: s, period: termForPaidDate(r.paid_on), how: "paid_date" };
}

/** A ClubOS programme's stream, from its slug. */
export function streamForProgramme(slug: string | null | undefined, name?: string | null): TermStream | null {
  const k = `${lower(slug)} ${lower(name)}`;
  if (/technification/.test(k)) return "technification";
  if (/gk|goalkeep/.test(k)) return "goalkeeper";
  if (/morning|football-institute|football institute/.test(k)) return "morning";
  if (/u4-u8|funi/.test(k)) return "funino";
  if (/pre-academy|pre academy/.test(k)) return "pre_academy";
  if (/academy/.test(k)) return "academy";
  return null;
}

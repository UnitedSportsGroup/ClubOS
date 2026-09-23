/**
 * HOLIDAY CAMP HISTORY — every school-holiday camp the club has run, from every
 * system it was ever sold through, on one timeline.
 *
 * Daniel, 2026-09-23: "add stats for holiday camps previous through friendly
 * manager, xero, shopify data so we have historical comparisons and can see
 * growth as far back as possible … often in recent years used eftpos, friendly
 * manager and shopify for holiday camps so can be hard to get accurate numbers."
 *
 * Sources, all already inside ClubOS:
 *   fm_payment_history  — Friendly Manager payments, Xero sales invoices and
 *                         Shopify orders, imported by the history migration
 *   registrations       — ClubOS's own camps (2026 on)
 * plus Xero's P&L income line per calendar year (HOLIDAY_CAMP_XERO_YEARS), the
 * only place counter EFTPOS, cash and bank transfers show up at all.
 *
 * 🔴 Pure functions, one decider. The server and the verify script both call
 * classifyHistoryRow(); a row is never classified twice two different ways.
 * 🔴 Nothing is guessed silently: every row that is left out carries a reason,
 * and the page lists the totals left out.
 */

export type CampSeries = "fundamentals" | "world_cup" | "specialist" | "general";

export const CAMP_SERIES: Array<{ key: CampSeries; label: string; color: string }> = [
  { key: "fundamentals", label: "FUNdamentals (U4–U8)", color: "#3b82f6" },
  { key: "world_cup", label: "World Cup (U9–U13)", color: "#f59e0b" },
  { key: "specialist", label: "Specialist & elite camps", color: "#8b5cf6" },
  { key: "general", label: "Holiday camp (ages not split)", color: "#64748b" },
];

export type HolidayPeriod = "apr" | "jul" | "sep" | "summer";

/** "2025-sep" — sorts chronologically as a string only within a year, so use
 *  editionOrder() to sort. Summer is keyed by its DECEMBER year. */
export type EditionKey = `${number}-${HolidayPeriod}`;

const PERIOD_ORDER: Record<HolidayPeriod, number> = { apr: 1, jul: 2, sep: 3, summer: 4 };

export function editionOrder(k: string): number {
  const [y, p] = k.split("-");
  return Number(y) * 10 + (PERIOD_ORDER[p as HolidayPeriod] ?? 0);
}

export function editionTitle(k: string): string {
  const [ys, p] = k.split("-");
  const y = Number(ys);
  switch (p) {
    case "apr": return `Apr ${y}`;
    case "jul": return `Jul ${y}`;
    case "sep": return `Sep–Oct ${y}`;
    case "summer": return `Dec ${y} – Jan ${y + 1}`;
    default: return k;
  }
}

/** Same holiday, one year earlier — the growth comparison. */
export function sameHolidayLastYear(k: string): string {
  const [y, p] = k.split("-");
  return `${Number(y) - 1}-${p}`;
}

/** The school holiday a camp on (or a booking paid on) this date belongs to.
 *  NZ school holidays: mid-April, early July, late Sep–mid Oct, mid-Dec to
 *  early Feb. A booking is made BEFORE the camp, so a date maps to the NEXT
 *  holiday that has not finished. Works on the y-m-d parts, never a Date. */
export function editionForDate(iso: string): EditionKey {
  const y = Number(iso.slice(0, 4));
  const md = iso.slice(5, 10);
  if (md <= "02-10") return `${y - 1}-summer`;
  if (md <= "05-05") return `${y}-apr`;
  if (md <= "07-25") return `${y}-jul`;
  if (md <= "10-20") return `${y}-sep`;
  return `${y}-summer`;
}

/** A camp's own start date, not a payment date — a camp that STARTS on 28 Sep
 *  is Sep–Oct even though 28 Sep is "before" the window closes. */
export function editionForCampStart(iso: string): EditionKey {
  return editionForDate(iso);
}

export interface HistoryRow {
  id: number;
  source: string;             // friendly_manager | xero | shopify
  first_name: string | null;
  last_name: string | null;
  fee_description: string | null;
  programme: string | null;
  term_name: string | null;
  paid_on: string;            // yyyy-mm-dd
  amount_cents: number;
}

export type Classified =
  | { include: true; series: CampSeries; edition: EditionKey; how: "named" | "paid_date" }
  | { include: false; reason: string };

const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();

/** Which series a description belongs to, or why it is not a holiday camp. */
function seriesOf(t: string): CampSeries | { reason: string } | null {
  if (/residency/.test(t)) return { reason: "Residency camp (a live-in camp, counted separately)" };
  if (/in school programme/.test(t)) return { reason: "In-school programme, not a holiday camp" };
  if (/reversal|charged back/.test(t)) return { reason: "Bank reversal or chargeback" };
  if (/sumner camp/.test(t)) return { reason: "“Sumner Camp” — not clearly one of ours" };
  if (/\b(hp camp|high performance|elite|individual development|goal ?scorer|netbusters|shotstopper)/.test(t)) return "specialist";
  if (/fundament|first skills|u4\s*[-–]\s*u8/.test(t)) return "fundamentals";
  if (/world cup|u9\s*[-–]\s*u13/.test(t)) return "world_cup";
  if (/holiday|christmas|multi sport|school hol|easter camp|october fun|hol prog/.test(t)) return "general";
  return null;
}

/** The holiday a description NAMES, when it names one. */
function namedEdition(t: string, paidOn: string): EditionKey | null {
  const paidY = Number(paidOn.slice(0, 4));
  const paidM = Number(paidOn.slice(5, 7));
  const firstYear = /\b(20\d{2})\b/.exec(t);
  const yr = firstYear ? Number(firstYear[1]) : undefined;
  // "2022/2023 School Holiday Camp" — a summer spanning two years is keyed by December.
  const span = /\b(20\d{2})\s*\/\s*20\d{2}\b/.exec(t);
  if (span) return `${Number(span[1])}-summer`;
  if (/january/.test(t)) return `${(yr ?? (paidM >= 7 ? paidY + 1 : paidY)) - 1}-summer`;
  if (/december|christmas|summer|term 4/.test(t)) return `${yr ?? (paidM >= 7 ? paidY : paidY - 1)}-summer`;
  if (/april|easter|\bterm ?1\b|\bt1\b/.test(t)) return `${yr ?? paidY}-apr`;
  if (/\bjuly\b|\bterm ?2\b|\bt2\b/.test(t)) return `${yr ?? paidY}-jul`;
  if (/october|\bterm ?3\b|\bt3\b|\bsep/.test(t)) return `${yr ?? paidY}-sep`;
  return null;
}

export function classifyHistoryRow(r: HistoryRow): Classified {
  const who = `${lower(r.first_name)} ${lower(r.last_name)}`;
  if (/\btest(er)?\d*\b|fusion5/.test(who)) return { include: false, reason: "Test booking" };
  // Only the product text decides — never a free-text payment reference.
  const t = [r.fee_description, r.programme, r.term_name].map(lower).join(" | ");
  const s = seriesOf(t);
  if (s === null) return { include: false, reason: "Mentions a camp but not a holiday camp we can place" };
  if (typeof s === "object") return { include: false, reason: s.reason };
  const named = namedEdition(t, r.paid_on);
  if (named) return { include: true, series: s, edition: named, how: "named" };
  return { include: true, series: s, edition: editionForDate(r.paid_on), how: "paid_date" };
}

/** One booking recorded in two systems — Friendly Manager took the payment and
 *  an invoice was raised in Xero for the same thing. Same first name, same
 *  amount, within a week: keep Friendly Manager's row (it names the product). */
export function crossSourceDuplicates(rows: HistoryRow[]): Set<number> {
  const drop = new Set<number>();
  const fm = rows.filter((r) => r.source === "friendly_manager");
  for (const x of rows) {
    if (x.source !== "xero") continue;
    const f = lower(x.first_name).trim();
    if (!f) continue;
    const hit = fm.find((m) =>
      lower(m.first_name).trim() === f && m.amount_cents === x.amount_cents &&
      Math.abs(dayNumber(m.paid_on) - dayNumber(x.paid_on)) <= 7);
    if (hit) drop.add(x.id);
  }
  return drop;
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** A child, as far as the records can tell: the name on the booking.
 *  Friendly Manager and Shopify carry the CHILD's name; a Xero invoice carries
 *  whoever it was addressed to, usually a parent — so a family paying by
 *  invoice for two children counts once. That is why children is a floor. */
export function personKey(first: string | null, last: string | null): string | null {
  const k = `${lower(first).trim()} ${lower(last).trim()}`.replace(/\s+/g, " ").trim();
  return k.length >= 2 ? k : null;
}

/** Xero's own P&L line "Holiday Program - Academy" per calendar year, excl.
 *  GST, with the direct costs beside it (Coaches Holiday Camps; in 2017 Field
 *  Hire Holiday Programme). Pulled 23 Sep 2026 by
 *  outputs/holiday-camp-history/fetch_xero_pl_years.py. Closed years are final;
 *  the current year is to date. The club's books are the only record that
 *  includes EFTPOS, cash and bank transfers taken at the counter. */
export const HOLIDAY_CAMP_XERO_YEARS = {
  asOf: "2026-09-23",
  account: "Holiday Program - Academy",
  years: [
    { year: 2017, incomeExGstCents: 2_130_067, directCostCents: 840_000 },
    { year: 2018, incomeExGstCents: 3_043, directCostCents: 0 },
    { year: 2019, incomeExGstCents: 0, directCostCents: 0 },
    { year: 2020, incomeExGstCents: 1_110_262, directCostCents: 0 },
    { year: 2021, incomeExGstCents: 2_099_482, directCostCents: 129_000 },
    { year: 2022, incomeExGstCents: 1_735_916, directCostCents: 285_760 },
    { year: 2023, incomeExGstCents: 3_183_355, directCostCents: 871_230 },
    { year: 2024, incomeExGstCents: 5_163_085, directCostCents: 440_000 },
    { year: 2025, incomeExGstCents: 3_893_687, directCostCents: 567_500 },
    { year: 2026, incomeExGstCents: 5_422_739, directCostCents: 1_325_050 },
  ],
} as const;

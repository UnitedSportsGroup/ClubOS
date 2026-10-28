/**
 * Mini Football Leagues — income history, for the MFL Analytics "History" tab.
 *
 * Isaac Living, 28 Oct 2026: "Would you have the total income from term 1 mini
 * football? … I'm trying to get the accurate numbers for our income this year."
 * Daniel: "have it all in there for him … the histogram … the trends … so I
 * don't have to do techie spreadsheets or send numbers over WhatsApp."
 *
 * Three views of the same money, each saying what it is:
 *  1. BY TERM, from the team records (Friendly Manager 2021→, Shopify, SportNinja,
 *     ClubOS) — the same dataset the Lifetime tab uses (server/league-lifetime.ts).
 *     Paid amounts, incl GST. Older terms are INCOMPLETE: a team whose fee was
 *     never recorded counts as a team with no dollars, and the coverage is
 *     returned so the page can say "fee known for 34 of 59 teams".
 *  2. BY YEAR, from Xero's P&L league income accounts (excl GST) — the
 *     accounting figure. Pulled 20 Oct 2026 (outputs/mfl-ltv/2026-10-20/
 *     xero_league_lines_by_year.json); a constant with its date, not a guess.
 *  3. BY MONTH this year, from the latest Financial Insight snapshot (Xero bank
 *     lines at payment date, excl GST), Mini Football payers only — academy,
 *     U17/U20 and staff payments coded to the Leagues account are left out and
 *     totalled separately.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";
import { getLeagueDataset, termLabel } from "./league-lifetime";

/** Xero P&L, league income accounts (Leagues · 5-Aside · 7-Aside · 9-Aside ·
 *  Social Competition), excl GST, pulled 20 Oct 2026. */
export const XERO_LEAGUE_INCOME_BY_YEAR: { year: number; cents: number; partial: boolean; lines: Record<string, number> }[] = [
  { year: 2022, cents: 973476, partial: false, lines: { Leagues: 14783, "5-Aside": 166956, "7-Aside": 708259, "9-Aside": 83478 } },
  { year: 2023, cents: 5240609, partial: false, lines: { Leagues: 2758551, "5-Aside": 385144, "7-Aside": 2007349, "9-Aside": 89565 } },
  { year: 2024, cents: 5529844, partial: false, lines: { Leagues: 3311496, "5-Aside": 61234, "7-Aside": 1900052, "9-Aside": 257062 } },
  { year: 2025, cents: 7076721, partial: false, lines: { Leagues: 2149564, "5-Aside": 1392382, "7-Aside": 3534775 } },
  { year: 2026, cents: 7027860, partial: true, lines: { Leagues: 5796052, "5-Aside": -38695, "7-Aside": 1227025, "Social Competition": 43478 } },
];
export const XERO_YEARS_AS_OF = "2026-10-20";

export type IncomeTerm = {
  term: string;
  label: string;
  year: number;
  startDate: string | null;
  teams: number;
  entries: number;
  newTeams: number;
  returningTeams: number;
  incomeCents: number;
  /** Teams whose fee is recorded / all teams that term. */
  teamsWithFee: number;
  unattributedCents: number;
  byFormat: Record<string, number>;
  sources: string[];
  avgFeeCents: number | null;
};

export type LeagueIncomeHistory = {
  builtAt: string;
  terms: IncomeTerm[];
  years: { year: number; recordsCents: number; xeroExGstCents: number | null; xeroPartial: boolean }[];
  xeroAsOf: string;
  months: { month: string; cents: number }[] | null;
  monthsThrough: string | null;
  monthsExcluded: { cents: number; lines: string[] };
};

const SOURCE_NAME: Record<string, string> = { fm: "Friendly Manager", fm_payment: "Friendly Manager", shopify: "Shopify", sportninja: "SportNinja", clubos: "ClubOS" };
// Payers coded to the Leagues account who are not Mini Football teams.
const NOT_MFL = /academy|u1\d|u20|football institute|staff/i;

export async function leagueIncomeHistory(): Promise<LeagueIncomeHistory> {
  const ds = await getLeagueDataset();
  const terms: IncomeTerm[] = ds.all.termRows
    .filter((r) => r.has_data)
    .map((r) => {
      const tt = ds.teamTerms.filter((x) => x.term === r.term_label);
      const byFormat: Record<string, number> = {};
      const sources = new Set<string>();
      let withFee = 0;
      let income = 0;
      for (const x of tt) {
        x.sources.forEach((s) => sources.add(SOURCE_NAME[s] ?? s));
        if (x.amount != null) {
          withFee++;
          income += x.amount;
          const f = String(x.format || "other");
          byFormat[f] = (byFormat[f] ?? 0) + x.amount;
        }
      }
      return {
        term: r.term_label,
        label: termLabel(r.term_label),
        year: Number(r.term_label.slice(0, 4)),
        startDate: r.start_date ?? ds.termStarts[r.term_label] ?? null,
        teams: r.teams_total,
        entries: r.team_entries,
        newTeams: r.teams_new,
        returningTeams: r.teams_returning,
        incomeCents: income + (r.unattributed_cents || 0),
        teamsWithFee: withFee,
        unattributedCents: r.unattributed_cents || 0,
        byFormat,
        sources: Array.from(sources),
        avgFeeCents: withFee ? Math.round(income / withFee) : null,
      };
    });

  const recordsByYear = new Map<number, number>();
  for (const t of terms) recordsByYear.set(t.year, (recordsByYear.get(t.year) ?? 0) + t.incomeCents);
  const yearSet = new Set<number>([...Array.from(recordsByYear.keys()), ...XERO_LEAGUE_INCOME_BY_YEAR.map((y) => y.year)]);
  const years = Array.from(yearSet).sort((a, b) => a - b).map((year) => {
    const x = XERO_LEAGUE_INCOME_BY_YEAR.find((y) => y.year === year);
    return { year, recordsCents: recordsByYear.get(year) ?? 0, xeroExGstCents: x ? x.cents : null, xeroPartial: !!x?.partial };
  });

  // This year by month — the latest Financial Insight snapshot, MFL payers only.
  let months: LeagueIncomeHistory["months"] = null;
  let monthsThrough: string | null = null;
  const monthsExcluded = { cents: 0, lines: [] as string[] };
  try {
    const r: any = await db.execute(sql`SELECT model FROM finance_insight_snapshots ORDER BY generated_at DESC, id DESC LIMIT 1`);
    const model = (r?.rows ?? r ?? [])[0]?.model;
    if (model && Array.isArray(model.nodes) && Array.isArray(model.months)) {
      monthsThrough = model.dataThrough ?? null;
      const sum = new Map<string, number>();
      for (const n of model.nodes) {
        if (n?.side !== "income" || n?.brand !== "Mini Football Leagues") continue;
        const vals = n.vals ?? {};
        const total = Object.values(vals).reduce((a: number, v: any) => a + Number(v || 0), 0) as number;
        if (NOT_MFL.test(String(n.sub ?? n.label ?? ""))) {
          monthsExcluded.cents += Math.round(total * 100);
          monthsExcluded.lines.push(String(n.label));
          continue;
        }
        for (const [m, v] of Object.entries(vals)) sum.set(m, (sum.get(m) ?? 0) + Math.round(Number(v || 0) * 100));
      }
      months = model.months
        .filter((m: string) => !monthsThrough || m <= monthsThrough)
        .map((m: string) => ({ month: m, cents: sum.get(m) ?? 0 }));
    }
  } catch {
    months = null; // the snapshot is optional; the term and year views stand on their own
  }

  return { builtAt: ds.builtAt, terms, years, xeroAsOf: XERO_YEARS_AS_OF, months, monthsThrough, monthsExcluded };
}

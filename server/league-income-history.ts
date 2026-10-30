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
import { getLeagueDataset, termLabel, tokenSetRatio, type TermRecord, type TeamTerm } from "./league-lifetime";

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
  /** Money not yet tied to a team (an order with no team name, an FM payment by an unknown payer). */
  unattributedCents: number;
  unmatchedPayments: number;
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

const SOURCE_NAME: Record<string, string> = { fm: "Friendly Manager", fm_payment: "Friendly Manager", shopify: "Shopify", sportninja: "SportNinja", clubos: "ClubOS", sheet: "Isaac's sheet" };
// Payers coded to the Leagues account who are not Mini Football teams.
const NOT_MFL = /academy|u1\d|u20|football institute|staff/i;

export async function leagueIncomeHistory(): Promise<LeagueIncomeHistory> {
  const ds = await getLeagueDataset();
  const bbRow = new Map(ds.bb.termRows.map((r) => [r.term_label, r]));
  const terms: IncomeTerm[] = ds.all.termRows
    .filter((r) => r.has_data)
    .map((r) => {
      const all = ds.teamTerms.filter((x) => x.term === r.term_label);
      const { teams: tt, orphans } = splitTeamsAndPayments(all);
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
      // Money that reached the league but is not tied to a team yet.
      const unmatched = orphans.reduce((a, x) => a + (x.amount ?? 0), 0) + (r.unattributed_cents || 0);
      const nr = bbRow.get(r.term_label) ?? r;
      return {
        term: r.term_label,
        label: termLabel(r.term_label),
        year: Number(r.term_label.slice(0, 4)),
        startDate: r.start_date ?? ds.termStarts[r.term_label] ?? null,
        teams: tt.length,
        entries: r.team_entries,
        newTeams: Math.min(nr.teams_new, tt.length),
        returningTeams: Math.max(0, tt.length - Math.min(nr.teams_new, tt.length)),
        incomeCents: income + unmatched,
        teamsWithFee: withFee,
        unattributedCents: unmatched,
        unmatchedPayments: orphans.length + ds.unattributedPayments.filter((p) => p.term === r.term_label).length,
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

// ---------------------------------------------------------------------------
// One term, team by team — the drop-down under "Every term".
//
// Daniel + Isaac, 30 Oct 2026: "why 85 teams term 4 2025 but then money looks
// like 52 … give breakdown of where each team came from … each transaction team
// details by league … so we can find the discrepancies of double ups or mistakes
// based on our old spreadsheets."
//
// A team-term is stitched from up to six systems; this shows every record behind
// it and FLAGS what a human should look at. Flags are derived here, never stored.
// ---------------------------------------------------------------------------

export type BreakdownFlag = { code: string; label: string };
export type BreakdownTeam = {
  key: string;
  name: string;
  otherNames: string[];
  league: string;
  leagues: string[];
  captain: string | null;
  email: string | null;
  phone: string | null;
  amountCents: number | null;
  sources: string[];
  flags: BreakdownFlag[];
  records: (TermRecord & { sourceName: string })[];
};
export type BreakdownPayment = {
  source: string;
  sourceName: string;
  amountCents: number;
  date: string | null;
  payer: string | null;
  email: string | null;
  detail: string | null;
  ref: string;
  suggestions: { key: string; name: string; why: string }[];
};
export type TermBreakdown = {
  term: string;
  label: string;
  hasSheet: boolean;
  summary: { teams: number; paid: number; noPayment: number; needsALook: number; matchedCents: number; unmatchedCents: number; unmatchedCount: number };
  leagues: { league: string; teams: BreakdownTeam[]; paidCents: number }[];
  unmatched: BreakdownPayment[];
};

const DRAW_SOURCES = ["fm", "sportninja", "clubos", "sheet"];
/**
 * ONE decider for "is this a team or just a payment?", used by the Every term
 * table AND the breakdown so the two never disagree. A team-term with no name
 * (a Shopify order carrying only an email), or one that only exists as a payment
 * in a term where a draw or Isaac's sheet exists, is a PAYMENT waiting for its
 * team — counting it as a team is how Term 4 2025 read 85 teams instead of ~57.
 */
export function splitTeamsAndPayments(tt: TeamTerm[]): { teams: TeamTerm[]; orphans: TeamTerm[] } {
  const hasDraw = tt.some((x) => x.sources.some((s) => DRAW_SOURCES.includes(s)));
  // With no draw and no sheet that term (Shopify-only terms), every order IS the team.
  const orphan = (x: TeamTerm) => hasDraw && (!x.names.length || !x.sources.some((s) => DRAW_SOURCES.includes(s)));
  return { teams: tt.filter((x) => !orphan(x)), orphans: tt.filter(orphan) };
}

const SOURCE_LABEL: Record<string, string> = { ...SOURCE_NAME, sheet: "Isaac's sheet", fm_payment: "Friendly Manager payment", fm: "Friendly Manager draw", sportninja: "SportNinja draw", shopify: "Shopify order", clubos: "ClubOS" };
const DRAW = ["fm", "sportninja", "clubos"];
const PAYMENT = ["shopify", "fm_payment", "sportninja", "clubos"];
const isGrading = (d: string | null) => !!d && /grading/i.test(d);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

/** The league a person would file this team under: the sheet's tab (also for a
 *  team only in SportNinja, when its division is the same night + format as a tab),
 *  else the first non-grading draw division. */
function leagueOf(records: TermRecord[], sheetLeagueByDiv: Map<string, string> = new Map()): string {
  const sheet = records.find((r) => r.source === "sheet" && r.division);
  if (sheet) return sheet.division!;
  for (const r of records) for (const d of r.divs) if (sheetLeagueByDiv.has(d)) return sheetLeagueByDiv.get(d)!;
  const draw = records.find((r) => DRAW.includes(r.source) && r.division && !isGrading(r.division));
  if (draw) return draw.division!;
  return records.find((r) => r.division)?.division ?? "No league recorded";
}

export async function leagueTermBreakdown(term: string): Promise<TermBreakdown | null> {
  const ds = await getLeagueDataset();
  const tt = ds.teamTerms.filter((x) => x.term === term);
  if (!tt.length && !ds.unattributedPayments.some((p) => p.term === term)) return null;
  const hasSheet = tt.some((x) => x.sources.includes("sheet"));
  const { teams: teamsRaw, orphans } = splitTeamsAndPayments(tt);
  const sheetLeagueByDiv = new Map<string, string>();
  for (const x of tt) for (const r of x.records) if (r.source === "sheet" && r.division) for (const d of r.divs) if (!d.startsWith("?")) sheetLeagueByDiv.set(d, r.division);
  const leagueFor = (recs: TermRecord[]) => leagueOf(recs, sheetLeagueByDiv);
  const weekly = (x: TeamTerm) => x.records.some((r) => /weekly/i.test(r.division || "") || (r.source === "sheet" && /pays weekly/i.test(r.note)));

  // Typical fee per league, to spot an amount that looks wrong.
  const feeByLeague = new Map<string, number[]>();
  for (const x of teamsRaw) if (x.amount != null && x.amount > 0 && !weekly(x)) {
    const l = leagueFor(x.records);
    feeByLeague.set(l, [...(feeByLeague.get(l) ?? []), x.amount / Math.max(1, x.n_entries)]);
  }

  const teams: BreakdownTeam[] = teamsRaw.map((x) => {
    const recs = x.records.map((r) => ({ ...r, sourceName: SOURCE_LABEL[r.source] ?? r.source }));
    const flags: BreakdownFlag[] = [];
    if (x.amount == null) flags.push({ code: "no_payment", label: "No payment found" });
    if (hasSheet && !x.sources.includes("sheet")) flags.push({ code: "not_on_sheet", label: "Not on Isaac's sheet" });
    if (!x.sources.some((s) => DRAW.includes(s)) && tt.some((y) => y.sources.some((s) => DRAW.includes(s)))) flags.push({ code: "not_in_draw", label: "Not in the draw" });
    const drawDivs = x.records.filter((r) => DRAW.includes(r.source)).map((r) => r.division);
    if (drawDivs.length && drawDivs.every(isGrading)) flags.push({ code: "grading_only", label: "Grading games only" });
    const payments = x.records.filter((r) => PAYMENT.includes(r.source) && r.amountCents != null && r.amountCents > 0);
    const paymentCount = payments.length + payments.reduce((a, r) => a + r.extraPayments.length, 0);
    if (paymentCount > Math.max(1, x.n_entries) && !payments.some((r) => /weekly/i.test(r.division || ""))) flags.push({ code: "paid_twice", label: `${paymentCount} payments for ${x.n_entries === 1 ? "one entry" : `${x.n_entries} entries`} — a double-up?` });
    if (weekly(x)) flags.push({ code: "weekly", label: "Weekly payer — only the deposit is in these records" });
    else if (x.amount != null && x.amount > 0) {
      const m = median(feeByLeague.get(leagueFor(x.records)) ?? []);
      const per = x.amount / Math.max(1, x.n_entries);
      if (m && (per > m * 1.6 || per < m * 0.4)) flags.push({ code: "odd_amount", label: `Unusual amount (league typical ${money(m)})` });
    }
    const names = x.names.length ? x.names : ["(no name)"];
    const leagues = Array.from(new Set(x.records.filter((r) => (r.source === "sheet" || DRAW.includes(r.source)) && r.division && !isGrading(r.division)).map((r) => r.division!)));
    const contact = x.records.find((r) => r.source === "sheet") ?? x.records.find((r) => r.captain || r.email);
    return {
      key: x.team_key,
      name: names[0],
      otherNames: names.slice(1),
      league: leagueFor(x.records),
      leagues,
      captain: contact?.captain ?? null,
      email: contact?.email ?? x.emails[0] ?? null,
      phone: contact?.phone ?? x.phones[0] ?? null,
      amountCents: x.amount,
      sources: x.sources.map((s) => SOURCE_LABEL[s] ?? s),
      flags,
      records: recs,
    };
  });

  // Two separate teams whose names look alike, in the same league — a missed match or a real pair?
  for (let i = 0; i < teams.length; i++)
    for (let j = i + 1; j < teams.length; j++) {
      const a = teams[i], b = teams[j];
      if (a.league !== b.league || a.name === "(no name)" || b.name === "(no name)") continue;
      if (tokenSetRatio(a.name, b.name) >= 0.8) {
        a.flags.push({ code: "similar_name", label: `Looks like "${b.name}"` });
        b.flags.push({ code: "similar_name", label: `Looks like "${a.name}"` });
      }
    }

  // Payments not tied to a team: the orphan team-terms plus money the build could not place at all.
  const unpaid = teams.filter((t) => t.amountCents == null);
  const suggest = (divs: string[], payer: string | null): BreakdownPayment["suggestions"] => {
    const out: BreakdownPayment["suggestions"] = [];
    const p = (payer || "").toLowerCase();
    for (const t of unpaid) {
      const teamDivs = t.records.flatMap((r) => r.divs);
      const sameLeague = divs.some((d) => teamDivs.includes(d) && !d.startsWith("?"));
      const sameName = !!p && t.records.some((r) => (r.captain || "").toLowerCase() === p);
      if (sameName) out.push({ key: t.key, name: t.name, why: "same captain name" });
      else if (sameLeague) out.push({ key: t.key, name: t.name, why: "same league, no payment found" });
    }
    return out.sort((a, b) => (a.why === "same captain name" ? -1 : 0) - (b.why === "same captain name" ? -1 : 0)).slice(0, 6);
  };
  const unmatched: BreakdownPayment[] = [];
  for (const x of orphans)
    for (const r of x.records.filter((r) => r.amountCents != null)) {
      unmatched.push({
        source: r.source, sourceName: SOURCE_LABEL[r.source] ?? r.source, amountCents: r.amountCents!, date: r.date,
        payer: r.captain, email: r.email, detail: r.division, ref: r.ref, suggestions: suggest(r.divs, r.captain),
      });
    }
  for (const p of ds.unattributedPayments.filter((p) => p.term === term))
    unmatched.push({ source: p.source, sourceName: SOURCE_LABEL[p.source] ?? p.source, amountCents: p.amountCents, date: p.date, payer: p.payer, email: null, detail: p.detail, ref: p.ref, suggestions: suggest([], p.payer) });

  const byLeague = new Map<string, BreakdownTeam[]>();
  for (const t of teams) byLeague.set(t.league, [...(byLeague.get(t.league) ?? []), t]);
  const leagues = Array.from(byLeague.entries())
    .map(([league, ts]) => ({
      league,
      teams: ts.sort((a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name)),
      paidCents: ts.reduce((a, t) => a + (t.amountCents ?? 0), 0),
    }))
    .sort((a, b) => a.league.localeCompare(b.league));

  const matchedCents = teams.reduce((a, t) => a + (t.amountCents ?? 0), 0);
  const unmatchedCents = unmatched.reduce((a, p) => a + p.amountCents, 0);
  return {
    term,
    label: termLabel(term),
    hasSheet,
    summary: {
      teams: teams.length,
      paid: teams.filter((t) => t.amountCents != null).length,
      noPayment: teams.filter((t) => t.amountCents == null).length,
      needsALook: teams.filter((t) => t.flags.length).length + unmatched.length,
      matchedCents,
      unmatchedCents,
      unmatchedCount: unmatched.length,
    },
    leagues,
    unmatched,
  };
}

const money = (c: number) => `$${Math.round(c / 100).toLocaleString("en-NZ")}`;

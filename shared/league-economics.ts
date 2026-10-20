/**
 * Mini Football Leagues — the unit-economics constants and the shapes the
 * Lifetime / Acquisition views share between server and client.
 *
 * The customer is a TEAM: the captain who enters and pays each term.
 *
 * 🔴 Money in a team fee is what the card was charged — INCL GST. A gross
 * profit (LTGP) is EXCL GST: fee ÷ 1.15 − the cost of serving the team. Every
 * figure that reaches the page says which it is.
 */

/** NZ GST. A team fee is a domestic supply, so the fee carries 15% GST. */
export const GST_RATE = 0.15;

/**
 * What one team costs in referees for one term, when ClubOS cannot count it.
 * From Xero: $20,994 across 189 entries in 2025 ($111) and $13,695 across 136
 * entries Jan–Sep 2026 ($101) — called $105. Shown with an "assumed" badge
 * wherever it is used (outputs/mfl-ltv/2026-10-20/LTV-CAC.md §1).
 */
export const REFEREE_COST_PER_TEAM_TERM_CENTS = 10500;

/**
 * The per-game referee rate MFL advertises ("from $23.95 a game",
 * minifootball.co.nz/careers/referee). Used only when ClubOS holds referee-
 * assigned games for a term: games × rate ÷ team entries.
 */
export const REFEREE_RATE_PER_GAME_CENTS = 2395;

/** Hormozi's floor for paid acquisition ($100M Leads): LTGP : CAC ≥ 3 : 1. */
export const LTGP_CAC_FLOOR = 3;

/** The 30-day test ($100M Money Models): first-term gross profit ≥ 2 × CAC. */
export const THIRTY_DAY_MULTIPLE = 2;

/** Spend in the 8 weeks before a term starts recruits for that term. */
export const CAC_LOOKBACK_DAYS = 56;

/** A team is "mature" once its first term is at least this many terms before the latest. */
export const MATURE_AFTER_TERMS = 4;

export type LeagueFormat = "5s" | "7s" | "6s" | "9s" | "other";
export const LEAGUE_FORMATS: LeagueFormat[] = ["5s", "7s", "6s", "9s", "other"];
export const LEAGUE_FORMAT_LABEL: Record<LeagueFormat, string> = {
  "5s": "5-a-side",
  "7s": "7-a-side",
  "6s": "6-a-side (old format)",
  "9s": "9-a-side",
  other: "Other / not stated",
};

/**
 * The format of one division / product name, e.g. "Monday 5's", "6 a-side
 * Social Competition - Monday", "Cage Football (5v5) / Full", "Competitive 7s
 * (Thursday)". Cage football is 5v5. A name with no player count
 * ("Mini Football Weekly Payment") is "other" — never guessed.
 */
export function leagueFormat(division: string | null | undefined): LeagueFormat {
  const t = String(division ?? "").toLowerCase();
  if (!t) return "other";
  const m =
    t.match(/\b([5-9])\s*(?:-|\s)?\s*(?:a[- ]?side|aside|'s|’s|s\b|v\s?\d)/) ||
    t.match(/\b([5-9])\s*a\s+side\b/);
  if (m) {
    const n = m[1];
    if (n === "5") return "5s";
    if (n === "6") return "6s";
    if (n === "7") return "7s";
    if (n === "9") return "9s";
  }
  if (/cage/.test(t)) return "5s";
  return "other";
}

/** A fee incl GST → the same money excl GST, in whole cents. */
export function exGst(cents: number): number {
  return Math.round(cents / (1 + GST_RATE));
}

// ── API shapes ──────────────────────────────────────────────────────────────

export type LtvScenario = "all" | "backbone";

export type StatTriple = { n: number; mean: number | null; median: number | null };

export type RetentionRow = {
  term: string;
  label: string;
  hasData: boolean;
  teams: number;
  newTeams: number;
  returning: number;
  prevTeams: number | null;
  cameBack: number | null;
  /** 0..1, null when the previous term holds no data. */
  rate: number | null;
  revenueKnownCents: number;
  note: string | null;
};

export type FormatRow = {
  format: LeagueFormat;
  label: string;
  entries: number;
  /** ClubOS terms only (2026-T3 on): the division's list price. */
  avgListCents: number | null;
  /** ClubOS terms only: what was agreed after early-bird / codes. */
  avgContractedCents: number | null;
  /** ClubOS terms only: what has actually been paid so far, per entry (instalments may still land). */
  avgPaidClubosCents: number | null;
  /** Every term with a known fee: what was actually paid, per entry. */
  avgPaidCents: number | null;
  paidEntries: number;
  /** 0..1, discount ÷ list, ClubOS entries only. */
  discountPct: number | null;
  clubosEntries: number;
  /** Teams whose FIRST term was this format. */
  firstFormatTeams: number;
  meanTerms: number | null;
  medianTerms: number | null;
  /** 0..1 among mature first-format teams. */
  everReturnPct: number | null;
  meanLifetimeRevenueCents: number | null;
};

export type RefereeCost = {
  term: string;
  cents: number;
  basis: "clubos" | "assumed";
  games: number | null;
};

export type LifetimeResponse = {
  generatedAt: string;
  scenario: LtvScenario;
  term: string | null;
  latestTerm: string;
  matureRule: string;
  terms: { term: string; label: string; hasData: boolean }[];
  totals: { identities: number; teamTerms: number; dataTerms: number };
  stay: {
    scope: string;
    all: StatTriple;
    mature: StatTriple;
    histogram: { bucket: string; teams: number }[];
    everReturnMaturePct: number | null;
    longestRun: { terms: number; team: string } | null;
    longestTotal: { terms: number; team: string } | null;
  };
  retention: RetentionRow[];
  retentionBest: string[];
  retentionWorst: string[];
  formats: FormatRow[];
  ltv: {
    scope: string;
    rule: string;
    teams: number;
    meanRevenueCents: number | null;
    medianRevenueCents: number | null;
    meanLtgpCents: number | null;
    medianLtgpCents: number | null;
    contributionPerTeamTermCents: number | null;
    recentRetention: number | null;
    recentSteps: { term: string; rate: number }[];
    forwardTerms: number | null;
    forwardLtgpCents: number | null;
    refereeAssumedTerms: number;
    refereeClubosTerms: number;
  };
  referee: RefereeCost[];
  survivors: { cohort: number; playing: number; latestTerm: string; names: string[] };
  notes: string[];
};

export type AcquisitionTermRow = {
  term: string;
  label: string;
  newTeams: number;
  /** null = the hub holds no spend for this term's window (before Sep 2025). */
  spendCents: number | null;
  spendBasis: string | null;
  campaigns: { name: string; spendCents: number; basis: "name" | "date" }[];
  ballersSpendCents: number;
  metaPurchases: number | null;
  cacCents: number | null;
  ltgpCacRatio: number | null;
  firstTermContributionCents: number | null;
  thirtyDayPass: boolean | null;
};

export type AcquisitionResponse = {
  generatedAt: string;
  term: string | null;
  latestTerm: string;
  hubFrom: string | null;
  ltgpCents: number | null;
  ltgpBasis: string;
  rows: AcquisitionTermRow[];
  trend: {
    term: string;
    cacCents: number | null;
    prevTerm: string | null;
    prevCacCents: number | null;
    lastYearTerm: string | null;
    lastYearCacCents: number | null;
    ltgpCacRatio: number | null;
  };
  ballersNote: { spendCents: number; campaigns: string[] };
  howHeard: { source: string; count: number }[];
  howHeardAnswered: number;
  howHeardTotal: number;
  firstTouch: {
    registrations: { channel: string; count: number }[];
    registrationsWithHistory: number;
    registrationsTotal: number;
    siteFirstVisits: { channel: string; count: number }[];
    siteFirstVisitsTotal: number;
    stampedDirectBeforeFix: number;
  };
  notes: string[];
};

/**
 * Mini Football Leagues — customer lifetime engine (who is a team, which terms
 * it played, what it paid), computed on read from five sources and cached.
 *
 * Ported from outputs/mfl-ltv/2026-10-20/build_mfl_ltv.cjs. METHOD.md beside it
 * explains every source and matching rule; read it before changing this file.
 * The CSVs in that folder are the acceptance test:
 *   npx tsx --env-file=.env script/_test-league-lifetime.ts
 *
 * Sources: Friendly Manager (fm_*, T4 2021 → T1 2025) · Shopify
 * (mfl_customer_history, 2023 → 2026 T1) · SportNinja (sn_*, 2024 T4 → 2026 T2)
 * · live ClubOS (league_teams + registrations, 2026 T3 →).
 *
 * Identity: union-find over every participation record — within-term roster
 * bridges, then exact normalised team name, then captain email, then phone,
 * then ONE fuzzy rule (adjacent terms, same format). A merge is refused when it
 * would put two differently-named teams from one source in one term together,
 * so a captain running two teams keeps two teams.
 *
 * 🔴 Dates: plain DATE columns are read as text and the two timestamptz columns
 * are converted in SQL with the original script's own rule (UTC + 13h), so the
 * answer does not depend on the server's time zone (this Mac is NZ, Fly is UTC).
 *
 * 🔴 READ-ONLY. Nothing here writes.
 */
import { pool } from "./db";
import {
  CAC_LOOKBACK_DAYS,
  LTGP_CAC_FLOOR,
  LEAGUE_FORMATS,
  LEAGUE_FORMAT_LABEL,
  MATURE_AFTER_TERMS,
  REFEREE_COST_PER_TEAM_TERM_CENTS,
  REFEREE_RATE_PER_GAME_CENTS,
  THIRTY_DAY_MULTIPLE,
  exGst,
  leagueFormat,
  type AcquisitionResponse,
  type AcquisitionTermRow,
  type FormatRow,
  type LeagueFormat,
  type LifetimeResponse,
  type LtvScenario,
  type RefereeCost,
  type RetentionRow,
  type StatTriple,
} from "@shared/league-economics";
import { workspaceForCampaign } from "@shared/marketing-hub";
import { qSorted } from "./marketing-hub/common";

type Q = (text: string, params?: unknown[]) => Promise<any[]>;

const MFL_ORG = 3;

// ---------- term master list ----------
export const TERMS: [string, string, string][] = [
  ["2021-T4", "2021-10-01", "2021-12-31"],
  ["2022-T1", "2022-01-01", "2022-03-31"],
  ["2022-T2", "2022-04-01", "2022-06-30"],
  ["2022-T3", "2022-07-01", "2022-09-30"],
  ["2022-T4", "2022-10-01", "2022-12-31"],
  ["2023-T1", "2023-01-01", "2023-03-15"],
  ["2023-T2", "2023-03-16", "2023-05-31"],
  ["2023-T3", "2023-06-01", "2023-08-31"],
  ["2023-T4", "2023-09-01", "2023-12-31"],
  ["2024-T1", "2024-01-01", "2024-03-31"],
  ["2024-T2", "2024-04-01", "2024-06-30"],
  ["2024-T3", "2024-07-01", "2024-08-31"],
  ["2024-T4", "2024-09-01", "2024-12-31"],
  ["2025-T1", "2025-01-01", "2025-03-31"],
  ["2025-T2", "2025-04-01", "2025-06-30"],
  ["2025-T3", "2025-07-01", "2025-09-20"],
  ["2025-T4", "2025-09-21", "2025-12-31"],
  ["2026-T1", "2026-01-01", "2026-04-10"],
  ["2026-T2", "2026-04-11", "2026-07-10"],
  ["2026-T3", "2026-07-11", "2026-09-30"],
  ["2026-T4", "2026-10-01", "2026-12-31"],
  // Future terms: present so a new ClubOS competition lands somewhere when it opens.
  ["2027-T1", "2027-01-01", "2027-04-10"],
  ["2027-T2", "2027-04-11", "2027-07-10"],
  ["2027-T3", "2027-07-11", "2027-09-30"],
  ["2027-T4", "2027-10-01", "2027-12-31"],
];
const TIDX: Record<string, number> = Object.fromEntries(TERMS.map((t, i) => [t[0], i]));
export const termLabel = (t: string) => {
  const [y, n] = t.split("-");
  return `Term ${n.slice(1)} ${y}`;
};
const termForDate = (iso: string | null): string | null => {
  if (!iso) return null;
  for (const [l, s, e] of TERMS) if (iso >= s && iso <= e) return l;
  return null;
};
// Values arrive as YYYY-MM-DD text (see the SQL); a Date would only appear if a
// query below were changed, so treat it the way the original script did.
const nzDate = (d: unknown): string | null => {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  if (d instanceof Date) return new Date(d.getTime() + 13 * 3600e3).toISOString().slice(0, 10);
  return null;
};

// Shopify product title -> term. Explicit, every title listed.
const SHOPIFY_TERM: Record<string, [string, string | null]> = {
  "Social Leagues: 19th June - 17th of August": ["2023-T3", "2023-06-19"],
  "Summer 7-Aside: 10th October - 19th December (Early Bird Special)": ["2023-T4", "2023-10-09"],
  "Social Leagues: 11th September - 20th November (Early Bird Special)": ["2023-T4", "2023-09-11"],
  "Summer 7-Aside: 9th October - 18th December (Early Bird Special)": ["2023-T4", "2023-10-09"],
  "Social Leagues: 11th September - 20th November": ["2023-T4", "2023-09-11"],
  "Social Leagues: 15th January - 21st March 2024 (Early Bird Discount)": ["2024-T1", "2024-01-15"],
  "Summer 7-Aside: 15th January - 18th March (Early Bird Special)": ["2024-T1", "2024-01-15"],
  "Social Leagues: 1st April - 6th June 2024 (Early Bird Discount)": ["2024-T2", "2024-04-01"],
  "Social Leagues: 29th of April - 5th of July": ["2024-T2", "2024-04-29"],
  "Social Leagues: 22nd of July - 27th Of September": ["2024-T3", "2024-07-22"],
  "Social Leagues: 7-A Side Monday & Thursday (16th September - 14th December)": ["2024-T4", "2024-09-16"],
  "Social Leagues: 7-A Side Monday & Thursday (30th September - 14th December)": ["2024-T4", "2024-09-30"],
  "Social Leagues: 9-A Side Tuesday (30th September - 14th December)": ["2024-T4", "2024-09-30"],
  "Mini Football Leagues": ["2024-T4", null],
  "Mini Football 2025": ["2025-T1", null],
  "Mini Football Autumn Leagues (Term 2)": ["2025-T2", null],
  "Mini Football Term 2": ["2025-T2", null],
  "Mini Football Winter Season (Term 3)": ["2025-T3", null],
  "Mini Football Term 3 (Monday 5s)": ["2025-T3", null],
  "Mini Football Term 3": ["2025-T3", null],
  "Mini Football Weekly Payment": ["2025-T3", null],
  "Mini Football Youth Leagues (Term 4)": ["2025-T4", null],
  "Mini Football Summer Leagues (Term 4)": ["2025-T4", null],
  "Mini Football Summer Leagues (2026 - Term 1)": ["2026-T1", null],
  "Mini Football Youth Leagues (Term 1 - 2026)": ["2026-T1", null],
};

// ---------- normalisers ----------
const IGNORE_EMAIL = /@(minifootball\.co\.nz|cufc\.co\.nz|unitedsportsgroup\.co\.nz)$/;
const normEmail = (e: unknown): string | null => {
  if (!e) return null;
  const s = String(e).trim().toLowerCase();
  if (!s.includes("@") || IGNORE_EMAIL.test(s)) return null;
  return s;
};
const normPhone = (p: unknown): string | null => {
  if (!p) return null;
  let d = String(p).replace(/\D/g, "");
  if (d.startsWith("64")) d = "0" + d.slice(2);
  else if (d.startsWith("00")) d = d.slice(1);
  else if (!d.startsWith("0") && /^2\d{7,9}$/.test(d)) d = "0" + d;
  if (d.startsWith("00")) d = d.slice(1);
  return d.length >= 8 && d.length <= 11 ? d : null;
};
const STOP = new Set(["fc", "the", "afc", "football", "club"]);
const nameTokens = (n: unknown): string[] =>
  n
    ? String(n)
        .toLowerCase()
        .replace(/[’'`´]/g, "")
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter((t) => t && !STOP.has(t))
    : [];
const nameKey = (n: unknown): string | null => {
  let k = nameTokens(n).join("");
  if (k.length < 3) k = String(n || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return k.length >= 3 ? k : null;
};
const BAD_NAME = /^(bye|bye friendly|tbd|tba|tbc|test|team \d+|placeholder)$/i;

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let p = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const c = [i];
    for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    p = c;
  }
  return p[n];
}
const ratio = (a: string, b: string) => (a.length + b.length ? 1 - lev(a, b) / Math.max(a.length, b.length) : 1);
function tokenSetRatio(x: string, y: string): number {
  const A = new Set(nameTokens(x)), B = new Set(nameTokens(y));
  const inter = Array.from(A).filter((t) => B.has(t)).sort().join(" ");
  const da = Array.from(A).filter((t) => !B.has(t)).sort().join(" ");
  const db = Array.from(B).filter((t) => !A.has(t)).sort().join(" ");
  const s1 = inter, s2 = (inter + " " + da).trim(), s3 = (inter + " " + db).trim();
  if (!s2 || !s3) return 0;
  if (!inter) return ratio(s2, s3);
  return Math.max(ratio(s1, s2), ratio(s1, s3), ratio(s2, s3));
}

const DAYS: Record<string, string> = { monday: "mon", tuesday: "tue", wednesday: "wed", thursday: "thu", friday: "fri", saturday: "sat", sunday: "sun" };
function divKeys(text: unknown): string[] {
  if (!text) return [];
  const t = String(text).toLowerCase();
  const parts = t.split(" / ").filter((p) => !/^(full|weekly|weekly \(deposit\))$/.test(p.trim()));
  const out = new Set<string>();
  for (const p of parts) {
    let day: string | null = null;
    for (const [k, v] of Object.entries(DAYS)) if (p.includes(k)) { day = v; break; }
    let fmt: string | null = (p.match(/(\d)\s*(?:-|\s)?\s*(?:a[- ]?side|aside|'s|s\b|v\d)/) || p.match(/\b([5-9])\b/) || [])[1] || null;
    if (/cage/.test(p)) { fmt = "5cage"; day = day || "mon"; }
    if (/youth|u9|u10|u11|u12/.test(p) && fmt) fmt = fmt + "youth";
    if (!day && !fmt) continue;
    out.add(`${day || "?"}-${fmt || "?"}`);
  }
  return Array.from(out);
}

// ---------- types ----------
type ClubosEntry = { format: LeagueFormat; listCents: number | null; contractedCents: number; discountCents: number; paidCents: number };
type Entry = {
  id: number;
  source: "fm" | "fm_payment" | "shopify" | "sportninja" | "clubos";
  term: string;
  team_name?: string | null;
  emails: Set<string>;
  phones: Set<string>;
  captain_name?: string | null;
  divs: string[];
  division?: string | null;
  amount_cents: number | null;
  contracted_cents?: number | null;
  qty?: number;
  notes: string;
  ref: string;
  payer?: string;
  grading?: boolean;
  nkey: string | null;
  clubos?: ClubosEntry;
};
export type TeamTerm = {
  team_key: string;
  term: string;
  names: string[];
  emails: string[];
  phones: string[];
  divisions: string[];
  sources: string[];
  amount: number | null;
  contracted: number | null;
  n_entries: number;
  format: LeagueFormat;
  clubos: ClubosEntry[];
};
type TeamRow = {
  team_key: string;
  canonical_name: string;
  first_term: string;
  last_term: string;
  n_terms: number;
  terms: string[];
  total_revenue_cents: number;
  terms_with_unknown_revenue: number;
  still_active_latest_term: boolean;
  first_format: LeagueFormat;
};
type TermRow = {
  term_label: string;
  has_data: boolean;
  teams_total: number;
  team_entries: number;
  teams_new: number;
  teams_returning: number;
  returning_from_previous_term: number | null;
  prev_term_teams: number | null;
  retention_from_previous: number | null;
  revenue_known_cents: number;
  unattributed_cents: number;
  start_date: string | null;
};
type Analysis = { termRows: TermRow[]; teamRows: TeamRow[]; dataTerms: string[]; LATEST: string; teamTermSet: Map<string, Set<string>> };

export type LeagueDataset = {
  builtAt: string;
  teamTerms: TeamTerm[];
  backbone: TeamTerm[];
  all: Analysis;
  bb: Analysis;
  identities: number;
  unattributedByTerm: Record<string, number>;
  termStarts: Record<string, string>;
  referee: RefereeCost[];
};

// ---------- build ----------
export async function buildLeagueDataset(q: Q): Promise<LeagueDataset> {
  const entries: Entry[] = [];
  const unattributed: { term: string; amount_cents: number }[] = [];
  const add = (e: any): Entry | null => {
    e.id = entries.length;
    e.emails = new Set((e.emails || []).map(normEmail).filter(Boolean));
    e.phones = new Set((e.phones || []).map(normPhone).filter(Boolean));
    if (e.team_name && BAD_NAME.test(String(e.team_name).trim())) return null;
    e.nkey = nameKey(e.team_name);
    e.divs = e.divs || [];
    entries.push(e as Entry);
    return e as Entry;
  };

  const termStarts: Record<string, string> = {};
  const noteTerm = (term: string | null, start: string | null) => {
    if (!term) return;
    if (start && (!termStarts[term] || start < termStarts[term])) termStarts[term] = start;
  };

  // ---------- 1. Friendly Manager competitions (org 3) ----------
  const fmComps = await q(`select fm_comp_id, name, start_date::text start_date, end_date::text end_date from fm_competition_history where organization_id=3 order by start_date`);
  const fmTeams = await q(`select fm_comp_id, team_name, division_name, manager_name, manager_phone, manager_email from fm_competition_teams where organization_id=3`);
  const fmGames = await q(`select fm_comp_id, home_team t from fm_competition_games where organization_id=3 union select fm_comp_id, away_team from fm_competition_games where organization_id=3`);
  for (const comp of fmComps) {
    const start = nzDate(comp.start_date), term = termForDate(start);
    if (!term) continue;
    const teams = fmTeams.filter((t) => t.fm_comp_id === comp.fm_comp_id);
    const names = new Set(teams.map((t) => (t.team_name || "").trim()));
    const extra = fmGames.filter((g) => g.fm_comp_id === comp.fm_comp_id && g.t && !names.has(g.t.trim()));
    if (!teams.length && !extra.length) continue;
    noteTerm(term, start);
    for (const t of teams)
      add({ source: "fm", term, team_name: t.team_name?.trim(), emails: [t.manager_email], phones: [t.manager_phone], captain_name: t.manager_name, divs: divKeys(comp.name), division: comp.name, amount_cents: null, notes: "", ref: `fm_comp ${comp.fm_comp_id}` });
    for (const g of extra)
      add({ source: "fm", term, team_name: g.t.trim(), divs: divKeys(comp.name), division: comp.name, amount_cents: null, notes: "name from FM fixtures only", ref: `fm_comp ${comp.fm_comp_id}` });
  }

  // FM payments that are MFL league fees
  const fmPays = await q(`select id, programme, fee_description, paid_on::text paid_on, amount_cents, first_name, last_name from fm_payment_history where programme ilike any(array['side social comp%','%mini football%','league entry','winter league']) order by paid_on`);
  const fmPayPending: any[] = [];
  for (const p of fmPays) {
    const date = nzDate(p.paid_on)!;
    let term = termForDate(date);
    const m = (p.fee_description || "").match(/Social Competition - (\w+): (.+)$/);
    if (/Term 2/.test(p.programme)) term = "2025-T2";
    if (/Term 3/.test(p.programme)) term = "2025-T3";
    if (m) {
      if (date >= "2023-03-01" && date <= "2023-05-31") term = "2023-T2";
      add({ source: "fm_payment", term, team_name: m[2].trim(), divs: divKeys(p.fee_description), division: p.fee_description, amount_cents: Number(p.amount_cents), notes: "", ref: `fm_payment ${p.id}`, payer: `${p.first_name} ${p.last_name}`.toLowerCase() });
    } else fmPayPending.push({ ...p, term, date });
  }

  // ---------- 2. Shopify ----------
  const shop = await q(`select h.category, h.source, h.product_title, h.financial_status, h.quantity, h.raw_json, h.team_name, h.buyer_email, h.buyer_phone, h.buyer_first_name, h.buyer_last_name, h.variant, h.amount_cents, h.external_ref,
      c.email c_email, c.phone c_phone, c.first_name c_first, c.last_name c_last
    from mfl_customer_history h left join contacts c on c.id=h.contact_id order by purchased_at`);
  for (const r of shop) {
    if (r.category === "fill_ins") continue;
    const map = SHOPIFY_TERM[r.product_title];
    if (!map) continue;
    if (r.financial_status === "refunded" || r.financial_status === "pending") continue;
    const [term, start] = map;
    noteTerm(term, start);
    const orderNote = r.raw_json?.order?.note;
    let team: string | null = r.team_name || null;
    if (!team && orderNote && orderNote.trim() && !/competitive level/i.test(orderNote)) team = orderNote.replace(/^team name\s*[:=]\s*/i, "").replace(/['"]/g, "").trim() || null;
    const payer = [r.buyer_first_name || r.c_first, r.buyer_last_name || r.c_last].filter(Boolean).join(" ");
    const e = add({ source: "shopify", term, team_name: team, emails: [r.buyer_email, r.c_email], phones: [r.buyer_phone, r.c_phone], captain_name: payer, divs: divKeys(r.variant), division: r.variant || r.product_title, amount_cents: Number(r.amount_cents), qty: r.quantity, notes: "", ref: `shopify ${r.external_ref}`, payer: payer.toLowerCase() });
    if (e && !e.emails.size && !e.phones.size && !e.nkey) {
      entries.pop();
      unattributed.push({ term, amount_cents: Number(r.amount_cents) });
    }
  }
  for (const p of fmPayPending) {
    const nm = `${p.first_name} ${p.last_name}`.toLowerCase();
    const hit = entries.find((e) => e.term === p.term && ((e.captain_name || "").toLowerCase() === nm || e.payer === nm));
    if (hit) hit.amount_cents = (hit.amount_cents || 0) + Number(p.amount_cents);
    else unattributed.push({ term: p.term, amount_cents: Number(p.amount_cents) });
  }

  // ---------- 3. SportNinja ----------
  const seasons = await q(`select s.sn_schedule_id, s.name, s.starts_on::text starts_on, s.ends_on::text ends_on,
      to_char(min(g.starts_at) at time zone 'UTC' + interval '13 hours', 'YYYY-MM-DD') g0
    from sn_seasons s left join sn_games g using (sn_schedule_id)
    where s.organization_name='Mini Football Leagues' group by 1,2,3,4 order by min(g.starts_at) nulls last`);
  const snGames = await q(`select sn_schedule_id, home_team t from sn_games union select sn_schedule_id, visitor_team from sn_games`);
  const snRoster = await q(`select sn_schedule_id, team_name, lower(trim(email)) email, lower(trim(coalesce(first_name,'')||' '||coalesce(last_name,''))) pname from sn_roster where organization_name='Mini Football Leagues'`);
  const snRegs = await q(`select competition_name, team_name, registration_status, raw_json from sn_registrations where kind='team'`);
  const snPays = await q(`select competition_name, team_name, sum(amount_cents) filter (where payment_status='PAID') paid, count(*) n from sn_payments group by 1,2`);
  const snEntriesByTerm: Record<string, Entry[]> = {};
  const rosterEmails: Record<number, Set<string>> = {};
  const rosterNames: Record<number, Set<string>> = {};
  for (const s of seasons) {
    if (/^(test|copy of test competition)$/i.test(s.name)) continue;
    const start = nzDate(s.g0 || s.starts_on), term = termForDate(start);
    if (!term) continue;
    const names = new Set(
      [...snGames.filter((g) => g.sn_schedule_id === s.sn_schedule_id).map((g) => g.t), ...snRoster.filter((r) => r.sn_schedule_id === s.sn_schedule_id).map((r) => r.team_name)]
        .filter(Boolean)
        .map((x: string) => x.trim()),
    );
    if (!names.size) continue;
    noteTerm(term, start);
    for (const n of Array.from(names)) {
      const reg = snRegs.find((r) => r.competition_name === s.name && (r.team_name || r.raw_json?.Team || "").trim() === n);
      const pay = snPays.find((p) => p.competition_name === s.name && (p.team_name || "").trim() === n);
      const amount = pay ? Number(pay.paid || 0) : null;
      const e = add({
        source: "sportninja", term, team_name: n,
        emails: reg ? [reg.raw_json?.Email] : [],
        phones: reg ? [reg.raw_json?.["Phone Number"], reg.raw_json?.Phone] : [],
        captain_name: reg ? `${reg.raw_json?.["First Name"] || ""} ${reg.raw_json?.["Last Name"] || ""}`.trim() : null,
        divs: divKeys(s.name), division: s.name, amount_cents: amount, notes: "", ref: `sn ${s.sn_schedule_id}`, grading: /grading/i.test(s.name),
      });
      if (!e) continue;
      rosterEmails[e.id] = new Set(snRoster.filter((r) => r.sn_schedule_id === s.sn_schedule_id && (r.team_name || "").trim() === n && r.email).map((r) => r.email));
      rosterNames[e.id] = new Set(snRoster.filter((r) => r.sn_schedule_id === s.sn_schedule_id && (r.team_name || "").trim() === n && r.pname && r.pname.includes(" ")).map((r) => r.pname.replace(/\s+/g, " ")));
      (snEntriesByTerm[term] ||= []).push(e);
    }
  }

  // ---------- 4. Live ClubOS (org 3 league teams) ----------
  const live = await q(`
    select t.id lt_id, t.name, t.contact_name, t.contact_email, t.contact_phone, t.payment_status, t.registration_id, t.competition_id,
           d.name div, coalesce(d.list_price_cents, d.team_cost_cents) list_cents, c.start_date::text start_date,
           r.status, r.total_cents, r.amount_paid, r.refunded_amount_cents, r.subtotal_cents, r.discount_cents, ct.email c_email, ct.phone c_phone
    from league_teams t join league_divisions d on d.id=t.division_id join league_competitions c on c.id=t.competition_id
    left join registrations r on r.id=t.registration_id left join contacts ct on ct.id=r.contact_id
    where t.organization_id=3`);
  for (const t of live) {
    const start = nzDate(t.start_date), term = termForDate(start);
    if (!term) continue;
    let amount: number | null = null;
    let clubos: ClubosEntry | undefined;
    if (t.registration_id) {
      if (t.status === "refunded") continue;
      if (!["confirmed", "partially_refunded"].includes(t.status)) continue;
      amount = Math.round(Number(t.amount_paid || 0) * 100) - Number(t.refunded_amount_cents || 0);
      const list = t.list_cents != null ? Number(t.list_cents) : null;
      clubos = {
        format: leagueFormat(t.div),
        listCents: list,
        contractedCents: Number(t.total_cents || 0),
        // The discount the registration recorded; subtotal is the price before it.
        discountCents: Number(t.discount_cents || 0),
        paidCents: amount,
      };
    }
    noteTerm(term, start);
    add({ source: "clubos", term, team_name: t.name?.trim(), emails: [t.contact_email, t.c_email], phones: [t.contact_phone, t.c_phone], captain_name: t.contact_name, divs: divKeys(t.div), division: t.div, amount_cents: amount, contracted_cents: t.registration_id ? Number(t.total_cents) : null, notes: "", ref: `league_team ${t.lt_id}`, clubos });
  }

  // ---------- union-find ----------
  const parent = entries.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const members = new Map<number, number[]>(entries.map((e) => [e.id, [e.id]]));
  function conflict(a: number, b: number, rule: string): boolean {
    const A = members.get(a)!.map((i) => entries[i]), B = members.get(b)!.map((i) => entries[i]);
    for (const x of A)
      for (const y of B) {
        if (x.term !== y.term || x.source !== y.source) continue;
        if (x.nkey && y.nkey && x.nkey !== y.nkey) return true;
        if ((rule === "name" || rule === "fuzzy") && x.emails.size && y.emails.size && !Array.from(x.emails).some((m) => y.emails.has(m)) && x.ref !== y.ref) return true;
      }
    return false;
  }
  function union(i: number, j: number, rule: string): boolean {
    const a = find(i), b = find(j);
    if (a === b) return false;
    if (conflict(a, b, rule)) return false;
    parent[b] = a;
    members.set(a, members.get(a)!.concat(members.get(b)!));
    members.delete(b);
    return true;
  }

  // Rule 0: within-term roster bridges
  const bridgeRules: [string, (e: Entry, s: Entry) => boolean][] = [
    ["roster_email_bridge", (e, s) => Array.from(e.emails).some((m) => rosterEmails[s.id]?.has(m))],
    ["roster_name_bridge", (e, s) => !!(e.payer && e.payer.includes(" ") && rosterNames[s.id]?.has(e.payer.replace(/\s+/g, " ")))],
  ];
  for (const [rule, test] of bridgeRules)
    for (const e of entries.filter((x) => x.source === "shopify")) {
      if ((snEntriesByTerm[e.term] || []).some((s) => find(s.id) === find(e.id))) continue;
      const cands = (snEntriesByTerm[e.term] || []).filter((s) => test(e, s));
      let pick: Entry | null = null;
      const byName = new Map<string | null, Entry[]>();
      for (const s of cands) byName.set(s.nkey, (byName.get(s.nkey) || []).concat(s));
      if (byName.size === 1) pick = cands[0];
      else if (byName.size > 1) {
        const dm = cands.filter((s) => s.divs.some((d) => e.divs.includes(d)));
        const dn = new Set(dm.map((s) => s.nkey));
        if (dn.size === 1) pick = dm[0];
      }
      if (pick) for (const s of cands.filter((x) => x.nkey === pick!.nkey)) union(e.id, s.id, rule);
    }
  // Exact normalised name (before email/phone, so named clusters exist first)
  const byTime = [...entries].sort((x, y) => TIDX[x.term] - TIDX[y.term] || x.id - y.id);
  {
    const idx = new Map<string, number[]>();
    for (const e of byTime) if (e.nkey) { if (!idx.has(e.nkey)) idx.set(e.nkey, []); idx.get(e.nkey)!.push(e.id); }
    idx.forEach((ids) => {
      for (let n = 1; n < ids.length; n++) {
        if (!union(ids[0], ids[n], "name")) {
          for (let m = 1; m < n; m++) if (union(ids[m], ids[n], "name")) break;
        }
      }
    });
  }
  // Email, then phone
  const contactRules: [string, (e: Entry) => string[]][] = [["email", (e) => Array.from(e.emails)], ["phone", (e) => Array.from(e.phones)]];
  for (const [rule, keyf] of contactRules) {
    const idx = new Map<string, number[]>();
    for (const e of byTime) for (const k of keyf(e)) { if (!idx.has(k)) idx.set(k, []); idx.get(k)!.push(e.id); }
    idx.forEach((ids) => {
      const named = ids.filter((i) => entries[i].nkey), unnamed = ids.filter((i) => !entries[i].nkey);
      for (let n = 1; n < named.length; n++) for (let m = 0; m < n; m++) if (union(named[m], named[n], rule)) break;
      const namedRoots = Array.from(new Set(named.map(find)));
      for (const u of unnamed) {
        if (namedRoots.length === 0) { if (u !== unnamed[0]) union(unnamed[0], u, rule); continue; }
        if (namedRoots.length === 1 || new Set(namedRoots.map(find)).size === 1) { union(namedRoots[0], u, rule); continue; }
        const e = entries[u];
        const fits = Array.from(new Set(namedRoots.map(find))).filter((r) => members.get(r)?.some((i) => entries[i].divs.some((d) => e.divs.includes(d) && !d.startsWith("?"))));
        if (fits.length === 1) union(fits[0], u, rule + "+division");
        else {
          const lone = unnamed.filter((x) => !entries[x].nkey && find(x) === x && x !== u);
          if (lone.length) union(lone[0], u, rule + " (unnamed only)");
        }
      }
    });
  }
  // Fuzzy names, adjacent terms, matching format
  const clusterTerms = () => { const m = new Map<number, Set<string>>(); members.forEach((ids, r) => m.set(r, new Set(ids.map((i) => entries[i].term)))); return m; };
  const named = entries.filter((e) => e.nkey);
  for (let i = 0; i < named.length; i++)
    for (let j = i + 1; j < named.length; j++) {
      const x = named[i], y = named[j];
      if (find(x.id) === find(y.id) || x.nkey === y.nkey) continue;
      if (Math.abs(TIDX[x.term] - TIDX[y.term]) !== 1) continue;
      const divOk = x.divs.some((d) => y.divs.some((f) => { const [a, b] = d.split("-"), [c2, e2] = f.split("-"); return b === e2 && b !== "?" && (a === c2 || a === "?" || c2 === "?"); }));
      if (!divOk) continue;
      const s = tokenSetRatio(x.team_name || "", y.team_name || "");
      if (s >= 0.9) {
        const ct = clusterTerms();
        const tx = ct.get(find(x.id))!, ty = ct.get(find(y.id))!;
        if (Array.from(tx).some((t) => ty.has(t))) continue;
        union(x.id, y.id, "fuzzy");
      }
    }

  // ---------- collapse to team-terms ----------
  const roots = Array.from(members.keys());
  const clusterOf = new Map<number, Entry[]>();
  roots.forEach((r) => clusterOf.set(r, members.get(r)!.map((i) => entries[i])));
  const firstIdx = (es: Entry[]) => Math.min(...es.map((e) => TIDX[e.term]));
  roots.sort((a, b) => firstIdx(clusterOf.get(a)!) - firstIdx(clusterOf.get(b)!) || a - b);
  const keyOf = new Map<number, string>();
  roots.forEach((r, n) => keyOf.set(r, "MFL" + String(n + 1).padStart(4, "0")));
  const teamTerms: TeamTerm[] = [];
  for (const r of roots) {
    const es = clusterOf.get(r)!;
    const byTerm: Record<string, Entry[]> = {};
    for (const e of es) (byTerm[e.term] ||= []).push(e);
    for (const [term, xs] of Object.entries(byTerm)) {
      const perSrc: Record<string, { divs: Set<string> }> = {};
      for (const e of xs) { const s = (perSrc[e.source] ||= { divs: new Set() }); e.divs.forEach((d) => s.divs.add(d)); }
      const nEntries = Math.max(1, ...Object.values(perSrc).map((v) => v.divs.size), ...xs.filter((e) => e.source === "shopify").map((e) => e.qty || 1));
      const money = xs.filter((e) => e.amount_cents != null);
      const amt = money.length ? money.reduce((s, e) => s + (e.amount_cents as number), 0) : null;
      const divisions = Array.from(new Set(xs.map((e) => e.division).filter(Boolean) as string[]));
      const fmts = divisions.map(leagueFormat).filter((f) => f !== "other");
      teamTerms.push({
        team_key: keyOf.get(r)!, term,
        names: Array.from(new Set(xs.map((e) => e.team_name).filter(Boolean) as string[])),
        emails: Array.from(new Set(xs.flatMap((e) => Array.from(e.emails)))),
        phones: Array.from(new Set(xs.flatMap((e) => Array.from(e.phones)))),
        divisions,
        sources: Array.from(new Set(xs.map((e) => e.source))),
        amount: amt,
        contracted: xs.some((e) => e.contracted_cents != null) ? xs.reduce((s, e) => s + (e.contracted_cents || 0), 0) : null,
        n_entries: nEntries,
        format: fmts[0] ?? "other",
        clubos: xs.map((e) => e.clubos).filter(Boolean) as ClubosEntry[],
      });
    }
  }
  teamTerms.sort((a, b) => TIDX[a.term] - TIDX[b.term] || a.team_key.localeCompare(b.team_key));

  const unattributedByTerm: Record<string, number> = {};
  for (const u of unattributed) unattributedByTerm[u.term] = (unattributedByTerm[u.term] || 0) + u.amount_cents;

  const backboneTerms = new Set(teamTerms.filter((x) => x.sources.some((s) => ["fm", "sportninja", "clubos"].includes(s))).map((x) => x.term));
  const backbone = teamTerms.filter((x) => !(x.sources.every((s) => s === "shopify" || s === "fm_payment") && backboneTerms.has(x.term)));

  const referee = await refereeCosts(q, teamTerms);

  return {
    builtAt: new Date().toISOString(),
    teamTerms,
    backbone,
    all: analyse(teamTerms, unattributedByTerm, termStarts),
    bb: analyse(backbone, unattributedByTerm, termStarts),
    identities: roots.length,
    unattributedByTerm,
    termStarts,
    referee,
  };
}

function analyse(teamTerms: TeamTerm[], unattrByTerm: Record<string, number>, termStarts: Record<string, string>): Analysis {
  const dataTerms = TERMS.map((t) => t[0]).filter((t) => teamTerms.some((x) => x.term === t));
  const LATEST = dataTerms[dataTerms.length - 1];
  const teamTermSet = new Map<string, Set<string>>();
  for (const x of teamTerms) { if (!teamTermSet.has(x.team_key)) teamTermSet.set(x.team_key, new Set()); teamTermSet.get(x.team_key)!.add(x.term); }
  const termRows: TermRow[] = [];
  const lastData = TIDX[LATEST];
  for (const [label] of TERMS) {
    if (TIDX[label] > lastData) break;
    const xs = teamTerms.filter((x) => x.term === label);
    const prevData = TERMS[TIDX[label] - 1] ? TERMS[TIDX[label] - 1][0] : null;
    const prevHasData = !!prevData && dataTerms.includes(prevData) && xs.length > 0;
    const isNew = (k: string) => !Array.from(teamTermSet.get(k)!).some((t) => TIDX[t] < TIDX[label]);
    const known = xs.filter((x) => x.amount != null);
    const prevTeams = prevHasData ? teamTerms.filter((x) => x.term === prevData).length : null;
    const back = prevHasData ? xs.filter((x) => teamTermSet.get(x.team_key)!.has(prevData!)).length : null;
    termRows.push({
      term_label: label,
      has_data: xs.length > 0,
      teams_total: xs.length,
      team_entries: xs.reduce((a, x) => a + x.n_entries, 0),
      teams_new: xs.filter((x) => isNew(x.team_key)).length,
      teams_returning: xs.filter((x) => !isNew(x.team_key)).length,
      returning_from_previous_term: back,
      prev_term_teams: prevTeams,
      retention_from_previous: prevHasData && prevTeams ? +(back! / prevTeams).toFixed(3) : null,
      revenue_known_cents: known.reduce((a, x) => a + (x.amount as number), 0) + (unattrByTerm[label] || 0),
      unattributed_cents: unattrByTerm[label] || 0,
      start_date: termStarts[label] || null,
    });
  }
  const keys = Array.from(teamTermSet.keys());
  const teamRows: TeamRow[] = keys.map((k) => {
    const xs = teamTerms.filter((x) => x.team_key === k);
    const terms = xs.map((x) => x.term).sort((a, b) => TIDX[a] - TIDX[b]);
    const nameCount: Record<string, number> = {};
    xs.forEach((x) => x.names.forEach((n) => (nameCount[n] = (nameCount[n] || 0) + 1 + TIDX[x.term] / 100)));
    const canonical = Object.entries(nameCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "(no team name)";
    const first = xs.find((x) => x.term === terms[0])!;
    return {
      team_key: k,
      canonical_name: canonical,
      first_term: terms[0],
      last_term: terms[terms.length - 1],
      n_terms: terms.length,
      terms,
      total_revenue_cents: xs.reduce((a, x) => a + (x.amount || 0), 0),
      terms_with_unknown_revenue: xs.filter((x) => x.amount == null).length,
      still_active_latest_term: terms.includes(LATEST),
      first_format: first.format,
    };
  });
  return { termRows, teamRows, dataTerms, LATEST, teamTermSet };
}

async function refereeCosts(q: Q, teamTerms: TeamTerm[]): Promise<RefereeCost[]> {
  // Games ClubOS knows a referee was assigned to, per competition (= per term).
  const rows = await q(`
    select c.start_date::text start_date,
      count(distinct g.id) filter (where exists (select 1 from league_referee_assignments a where a.game_id=g.id)
                                    or exists (select 1 from league_game_referees b where b.game_id=g.id)) ref_games
    from league_competitions c left join league_games g on g.competition_id=c.id
    where c.organization_id=$1 group by c.id, c.start_date`, [MFL_ORG]);
  const gamesByTerm: Record<string, number> = {};
  for (const r of rows) {
    const t = termForDate(r.start_date);
    if (t) gamesByTerm[t] = (gamesByTerm[t] || 0) + Number(r.ref_games || 0);
  }
  const terms = Array.from(new Set(teamTerms.map((x) => x.term)));
  return terms.map((term) => {
    const games = gamesByTerm[term] ?? null;
    const entries = teamTerms.filter((x) => x.term === term && x.sources.includes("clubos")).reduce((a, x) => a + x.n_entries, 0);
    if (games && entries) return { term, cents: Math.round((games * REFEREE_RATE_PER_GAME_CENTS) / entries), basis: "clubos" as const, games };
    return { term, cents: REFEREE_COST_PER_TEAM_TERM_CENTS, basis: "assumed" as const, games };
  });
}

// ---------- cache ----------
const SIX_HOURS = 6 * 3600 * 1000;
let cached: { key: string; at: number; ds: LeagueDataset } | null = null;
let inflight: Promise<LeagueDataset> | null = null;
const poolQ: Q = async (text, params = []) => (await pool.query(text, params as any[])).rows;

/** Cache key: a new sign-up or a new team changes it, so the view refreshes. */
async function cacheKey(): Promise<string> {
  const r = await poolQ(`select (select coalesce(max(id),0) from registrations) mr, (select count(*) from league_teams) lt`);
  return `${r[0].mr}|${r[0].lt}`;
}

export async function getLeagueDataset(): Promise<LeagueDataset> {
  const key = await cacheKey();
  if (cached && cached.key === key && Date.now() - cached.at < SIX_HOURS) return cached.ds;
  if (inflight) return inflight;
  inflight = buildLeagueDataset(poolQ)
    .then((ds) => { cached = { key, at: Date.now(), ds }; return ds; })
    .finally(() => { inflight = null; });
  return inflight;
}

// ---------- the Lifetime view ----------
const stats = (arr: number[]): StatTriple => {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return { n, mean: n ? +(s.reduce((a, b) => a + b, 0) / n).toFixed(2) : null, median: n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null };
};
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const pct = (num: number, den: number) => (den ? +(num / den).toFixed(3) : null);

export function isKnownTerm(t: string) {
  return t in TIDX;
}

function ltvCore(ds: LeagueDataset, scenario: LtvScenario) {
  const A = scenario === "backbone" ? ds.bb : ds.all;
  const tt = scenario === "backbone" ? ds.backbone : ds.teamTerms;
  const L = TIDX[A.LATEST];
  const refBy = new Map(ds.referee.map((r) => [r.term, r]));
  const refFor = (term: string) => refBy.get(term)?.cents ?? REFEREE_COST_PER_TEAM_TERM_CENTS;
  // Contribution of one team-term: paid ÷ 1.15 − referees per entry.
  const contribution = (x: TeamTerm) => (x.amount == null ? null : exGst(x.amount) - refFor(x.term) * x.n_entries);

  // Fairest lifetime: mature, first term 2023-T3 or later, a fee for every term played.
  const fullyPriced = A.teamRows.filter((t) => TIDX[t.first_term] <= L - MATURE_AFTER_TERMS && t.terms_with_unknown_revenue === 0 && TIDX[t.first_term] >= TIDX["2023-T3"]);
  const ltgpOf = (k: string) => tt.filter((x) => x.team_key === k).reduce((a, x) => a + (contribution(x) ?? 0), 0);

  // Recent retention = mean of the last 4 term-over-term steps.
  const steps = A.termRows.filter((r) => r.retention_from_previous != null).slice(-4).map((r) => ({ term: r.term_label, rate: r.retention_from_previous as number }));
  const recentRetention = steps.length ? +(mean(steps.map((s) => s.rate)) as number).toFixed(3) : null;
  // Contribution per team-term: the last 4 data terms with a known fee (today's price).
  const recentTerms = new Set(A.dataTerms.slice(-4));
  const recentKnown = tt.filter((x) => recentTerms.has(x.term) && x.amount != null);
  const contribPerTT = recentKnown.length ? Math.round(recentKnown.reduce((a, x) => a + (contribution(x) as number), 0) / recentKnown.length) : null;
  const forwardTerms = recentRetention != null && recentRetention < 1 ? +(1 / (1 - recentRetention)).toFixed(2) : null;
  const forwardLtgp = contribPerTT != null && forwardTerms != null ? Math.round(contribPerTT * forwardTerms) : null;
  return { A, tt, L, refFor, contribution, fullyPriced, ltgpOf, steps, recentRetention, contribPerTT, forwardTerms, forwardLtgp };
}

export function computeLifetime(ds: LeagueDataset, opts: { scenario: LtvScenario; term: string | null }): LifetimeResponse {
  const { scenario, term } = opts;
  const core = ltvCore(ds, scenario);
  const { A, tt, L } = core;
  const matureRule = `first term at or before ${termLabel(TERMS[L - MATURE_AFTER_TERMS][0])} (${MATURE_AFTER_TERMS}+ terms before ${termLabel(A.LATEST)})`;

  // Scope: every team, or the teams that played the chosen term.
  const inScope = (t: TeamRow) => !term || t.terms.includes(term);
  const scoped = A.teamRows.filter(inScope);
  const isMature = (t: TeamRow) => TIDX[t.first_term] <= L - MATURE_AFTER_TERMS;
  const mature = scoped.filter(isMature);
  const scopeText = term ? `Teams that played ${termLabel(term)} — their whole history` : "Every team since Term 4 2021";

  const buckets = ["1", "2", "3", "4", "5", "6+"];
  const histogram = buckets.map((b) => ({ bucket: b, teams: scoped.filter((t) => (b === "6+" ? t.n_terms >= 6 : t.n_terms === Number(b))).length }));

  // Longest consecutive run over data terms (empty terms are not counted as a break).
  const dataIdx = new Map(A.dataTerms.map((t, i) => [t, i]));
  let longestRun: { terms: number; team: string } | null = null;
  let longestTotal: { terms: number; team: string } | null = null;
  for (const t of scoped) {
    const idx = t.terms.map((x) => dataIdx.get(x)!).sort((a, b) => a - b);
    let best = 1, cur = 1;
    for (let i = 1; i < idx.length; i++) { cur = idx[i] === idx[i - 1] + 1 ? cur + 1 : 1; best = Math.max(best, cur); }
    if (!longestRun || best > longestRun.terms) longestRun = { terms: best, team: t.canonical_name };
    if (!longestTotal || t.n_terms > longestTotal.terms) longestTotal = { terms: t.n_terms, team: t.canonical_name };
  }

  const retention: RetentionRow[] = A.termRows.map((r) => ({
    term: r.term_label,
    label: termLabel(r.term_label),
    hasData: r.has_data,
    teams: r.teams_total,
    newTeams: r.teams_new,
    returning: r.teams_returning,
    prevTeams: r.prev_term_teams,
    cameBack: r.returning_from_previous_term,
    rate: r.retention_from_previous,
    revenueKnownCents: r.revenue_known_cents,
    note: !r.has_data ? "No records in any source" : r.term_label === "2025-T2" ? "Only Shopify holds this term — understated" : r.term_label === "2025-T3" ? "Previous term is incomplete — overstated" : r.term_label === A.LATEST ? "In progress" : null,
  }));
  // Best / worst two, from 2023-T2 on (the comparable era), excluding the flagged terms.
  const comparable = retention.filter((r) => r.rate != null && TIDX[r.term] >= TIDX["2023-T2"] && !["2025-T2", "2025-T3"].includes(r.term));
  const byRate = [...comparable].sort((a, b) => (b.rate as number) - (a.rate as number));
  const retentionBest = byRate.slice(0, 2).map((r) => r.term);
  const retentionWorst = byRate.slice(-2).map((r) => r.term);

  // Formats: entries in scope (all team-terms, or the chosen term's).
  const ttScope = term ? tt.filter((x) => x.term === term) : tt;
  const formats: FormatRow[] = LEAGUE_FORMATS.map((f) => {
    const xs = ttScope.filter((x) => x.format === f);
    const entries = xs.reduce((a, x) => a + x.n_entries, 0);
    const paid = xs.filter((x) => x.amount != null);
    const paidEntries = paid.reduce((a, x) => a + x.n_entries, 0);
    // ClubOS entries carry their own division, so they are split by their own format.
    const cl = ttScope.flatMap((x) => x.clubos).filter((c) => c.format === f);
    const clList = cl.filter((c) => c.listCents != null);
    const firstTeams = scoped.filter((t) => t.first_format === f);
    const firstMature = firstTeams.filter(isMature);
    return {
      format: f,
      label: LEAGUE_FORMAT_LABEL[f],
      entries,
      avgListCents: clList.length ? Math.round(clList.reduce((a, c) => a + (c.listCents as number), 0) / clList.length) : null,
      avgContractedCents: cl.length ? Math.round(cl.reduce((a, c) => a + c.contractedCents, 0) / cl.length) : null,
      avgPaidClubosCents: cl.length ? Math.round(cl.reduce((a, c) => a + c.paidCents, 0) / cl.length) : null,
      avgPaidCents: paidEntries ? Math.round(paid.reduce((a, x) => a + (x.amount as number), 0) / paidEntries) : null,
      paidEntries,
      discountPct: clList.length ? pct(clList.reduce((a, c) => a + Math.max(0, (c.listCents as number) - c.contractedCents), 0), clList.reduce((a, c) => a + (c.listCents as number), 0)) : null,
      clubosEntries: cl.length,
      firstFormatTeams: firstTeams.length,
      meanTerms: stats(firstMature.map((t) => t.n_terms)).mean,
      medianTerms: stats(firstMature.map((t) => t.n_terms)).median,
      everReturnPct: pct(firstMature.filter((t) => t.n_terms >= 2).length, firstMature.length),
      meanLifetimeRevenueCents: firstMature.length ? Math.round(firstMature.reduce((a, t) => a + t.total_revenue_cents, 0) / firstMature.length) : null,
    };
  }).filter((r) => r.entries > 0 || r.firstFormatTeams > 0);

  const fp = core.fullyPriced.filter(inScope);
  const rev = fp.map((t) => t.total_revenue_cents);
  const ltgps = fp.map((t) => core.ltgpOf(t.team_key));
  const rs = stats(rev), ls = stats(ltgps);

  const survivorCohort = A.teamRows.filter((t) => t.terms.some((x) => x.startsWith("2023")));
  const survivors = survivorCohort.filter((t) => t.still_active_latest_term);

  const refUsed = ds.referee.filter((r) => tt.some((x) => x.term === r.term && x.amount != null));

  return {
    generatedAt: ds.builtAt,
    scenario,
    term,
    latestTerm: A.LATEST,
    matureRule,
    terms: A.termRows.map((r) => ({ term: r.term_label, label: termLabel(r.term_label), hasData: r.has_data })),
    totals: { identities: A.teamRows.length, teamTerms: tt.length, dataTerms: A.dataTerms.length },
    stay: {
      scope: scopeText,
      all: stats(scoped.map((t) => t.n_terms)),
      mature: stats(mature.map((t) => t.n_terms)),
      histogram,
      everReturnMaturePct: pct(mature.filter((t) => t.n_terms >= 2).length, mature.length),
      longestRun,
      longestTotal,
    },
    retention,
    retentionBest,
    retentionWorst,
    formats,
    ltv: {
      scope: scopeText,
      rule: "Mature teams that started Term 3 2023 or later and have a fee for every term they played",
      teams: fp.length,
      meanRevenueCents: rs.mean != null ? Math.round(rs.mean) : null,
      medianRevenueCents: rs.median != null ? Math.round(rs.median) : null,
      meanLtgpCents: ls.mean != null ? Math.round(ls.mean) : null,
      medianLtgpCents: ls.median != null ? Math.round(ls.median) : null,
      contributionPerTeamTermCents: core.contribPerTT,
      recentRetention: core.recentRetention,
      recentSteps: core.steps,
      forwardTerms: core.forwardTerms,
      forwardLtgpCents: core.forwardLtgp,
      refereeAssumedTerms: refUsed.filter((r) => r.basis === "assumed").length,
      refereeClubosTerms: refUsed.filter((r) => r.basis === "clubos").length,
    },
    referee: ds.referee,
    survivors: { cohort: survivorCohort.length, playing: survivors.length, latestTerm: A.LATEST, names: survivors.map((t) => t.canonical_name).sort() },
    notes: [
      "Fees are what the card was charged (incl GST). LTGP = paid ÷ 1.15 − referees, so it is excl GST.",
      "Friendly Manager (Term 4 2021 – Term 2 2023) kept who played, not what they paid, so lifetime revenue leaves those terms out.",
      "Term 2 – Term 4 2022 hold no records in any source; they are not counted as breaks.",
      `${termLabel(A.LATEST)} is in progress: instalments are still landing.`,
      scenario === "all"
        ? "All records: every payment counts, including Shopify payers we could not tie to a named team (2024–26). Upper bound on team count, lower bound on retention."
        : "Backbone: in a term that has a named team list, a team seen only as a Shopify payment is dropped. Lower bound on team count, upper bound on retention.",
    ],
  };
}

// ---------- the Acquisition view ----------
/** The term a campaign recruits for, from its name, given the year it ran. */
function termFromCampaignName(name: string, firstDay: string): string | null {
  const n = name.toLowerCase();
  const y = Number(firstDay.slice(0, 4));
  const yearInName = n.match(/\b(20\d\d)\b/);
  const year = yearInName ? Number(yearInName[1]) : y;
  const tm = n.match(/\bterm\s*([1-4])\b/) || n.match(/\bt([1-4])\b/);
  if (tm) {
    // A Term 1 campaign launched in Oct–Dec recruits for next year's Term 1.
    const t = Number(tm[1]);
    const yr = !yearInName && t === 1 && Number(firstDay.slice(5, 7)) >= 10 ? year + 1 : year;
    return `${yr}-T${t}`;
  }
  if (/\bsummer\b/.test(n)) {
    const m = Number(firstDay.slice(5, 7));
    return m >= 7 ? `${year}-T4` : `${year}-T1`;
  }
  return null;
}
/** The term whose start is within CAC_LOOKBACK_DAYS after a given day (or that is running). */
function termFromDate(day: string, starts: Record<string, string>): string | null {
  const t = new Date(day + "T00:00:00Z").getTime();
  let best: string | null = null;
  for (const [label] of TERMS) {
    const s = starts[label];
    if (!s) continue;
    const st = new Date(s + "T00:00:00Z").getTime();
    if (t <= st && st - t <= CAC_LOOKBACK_DAYS * 86400e3) return label;
    if (t > st) best = label; // the term already running
  }
  return best;
}

type CampaignDay = { campaign_id: string; name: string; day: string; spend: number; purchases: number; source_org: number | null };

async function mflCampaignSpend(): Promise<{ rows: CampaignDay[]; hubFrom: string | null }> {
  const rows = await poolQ(`
    with names as (
      select distinct on (d.source_id, d.dim_key) d.source_id, d.dim_key, d.dim_label
      from marketing_daily d where d.dim_type='campaign' and d.dim_label is not null
      order by d.source_id, d.dim_key, d.day desc
    )
    select d.dim_key campaign_id, n.dim_label name, d.day::text as day, s.organization_id as source_org,
      sum(d.value) filter (where d.metric='spend_cents') spend,
      sum(d.value) filter (where d.metric='purchases') purchases
    from marketing_daily d join marketing_sources s on s.id=d.source_id
    left join names n on n.source_id=d.source_id and n.dim_key=d.dim_key
    where d.dim_type='campaign' and s.platform='meta_ads'
    group by 1,2,3,4`);
  const from = await poolQ(`select min(d.day)::text d from marketing_daily d join marketing_sources s on s.id=d.source_id where s.platform='meta_ads' and d.dim_type='campaign'`);
  const mfl = rows
    .filter((r) => workspaceForCampaign(r.name, null).workspace === "mini-football-leagues")
    .map((r) => ({ campaign_id: r.campaign_id, name: r.name || r.campaign_id, day: r.day, spend: Number(r.spend || 0), purchases: Number(r.purchases || 0), source_org: r.source_org }));
  return { rows: mfl, hubFrom: from[0]?.d ?? null };
}

const isBallers = (name: string) => /\bballers\b/i.test(name);

async function attributionMix(): Promise<AcquisitionResponse["firstTouch"] & { howHeard: { source: string; count: number }[]; howHeardAnswered: number; howHeardTotal: number }> {
  const base = `from registrations r join programs p on p.id=r.program_id
    where p.organization_id=${MFL_ORG} and p.type='league_team' and r.status in ('confirmed','partially_refunded')`;
  const [hh, ft, stamped, site] = await Promise.all([
    poolQ(`select coalesce(nullif(trim(r.referral_source),''),'(not answered)') source, count(*)::int count ${base} group by 1 order by 2 desc`),
    // First touch per registration: the visitor's (or the stitched person's) earliest
    // non-bot event within 30 days before registering. Not the stamped channel.
    // Two joins UNIONed rather than one OR join: same rows, a third of the time.
    poolQ(`with regs as (select r.id, r.visitor_id, r.person_id, r.registered_at ${base}),
      ev as (
        select regs.id, e.channel, e."timestamp" from regs join analytics_events e
          on e.visitor_id = regs.visitor_id
         and e."timestamp" <= regs.registered_at and e."timestamp" > regs.registered_at - interval '30 days' and not e.is_bot
        union all
        select regs.id, e.channel, e."timestamp" from regs join analytics_events e
          on regs.person_id is not null and e.person_id = regs.person_id
         and e."timestamp" <= regs.registered_at and e."timestamp" > regs.registered_at - interval '30 days' and not e.is_bot),
      ft as (select distinct on (id) id, channel from ev order by id, "timestamp")
      select coalesce(channel,'(unclassified)') channel, count(*)::int count,
        (select count(*)::int from regs) total from ft group by 1 order by 2 desc`),
    poolQ(`select count(*)::int n ${base} and r.attribution_channel='direct' and r.registered_at < '2026-10-14 03:10:00'`),
    // First visit per visitor to an MFL site in the last 12 months, by channel.
    // Bounded like the Marketing hub's own reads; all-time scanned every event.
    qSorted(`with fv as (
        select distinct on (visitor_id) visitor_id, channel from analytics_events
        where "timestamp" > now() - interval '365 days' and not is_bot and visitor_id is not null
          and substring(coalesce(landing_url, page) from '^https?://(?:www\\.)?([^/:?#]+)') in ('minifootball.co.nz','mini-football.co.nz','join.minifootball.co.nz','shop.minifootball.co.nz')
        order by visitor_id, "timestamp")
      select coalesce(channel,'(unclassified)') channel, count(*)::int count from fv group by 1 order by 2 desc`),
  ]);
  const regTotal = ft[0]?.total ?? (await poolQ(`select count(*)::int n ${base}`))[0].n;
  const answered = hh.filter((h) => h.source !== "(not answered)").reduce((a, h) => a + h.count, 0);
  return {
    howHeard: hh.map((h) => ({ source: h.source, count: h.count })),
    howHeardAnswered: answered,
    howHeardTotal: hh.reduce((a, h) => a + h.count, 0),
    registrations: ft.map((r) => ({ channel: r.channel, count: r.count })),
    registrationsWithHistory: ft.reduce((a, r) => a + r.count, 0),
    registrationsTotal: regTotal,
    siteFirstVisits: site.map((r) => ({ channel: r.channel, count: r.count })),
    siteFirstVisitsTotal: site.reduce((a, r) => a + r.count, 0),
    stampedDirectBeforeFix: stamped[0]?.n ?? 0,
  };
}

type AttributionMix = Awaited<ReturnType<typeof attributionMix>>;
type AcqInputs = { key: string; at: number; spend: { rows: CampaignDay[]; hubFrom: string | null }; mix: AttributionMix };
let acqCache: AcqInputs | null = null;
let acqInflight: Promise<AcqInputs> | null = null;
async function acquisitionInputs(key: string): Promise<AcqInputs> {
  if (acqCache && acqCache.key === key && Date.now() - acqCache.at < SIX_HOURS) return acqCache;
  if (acqInflight) return acqInflight;
  acqInflight = Promise.all([mflCampaignSpend(), attributionMix()])
    .then(([spend, mix]) => (acqCache = { key, at: Date.now(), spend, mix }))
    .finally(() => { acqInflight = null; });
  return acqInflight;
}

export async function getAcquisition(ds: LeagueDataset, term: string | null): Promise<AcquisitionResponse> {
  const key = await cacheKey();
  const { spend, mix } = await acquisitionInputs(key);
  return computeAcquisition(ds, term, spend, mix);
}

function computeAcquisition(
  ds: LeagueDataset,
  term: string | null,
  spend: { rows: CampaignDay[]; hubFrom: string | null },
  mix: AttributionMix,
): AcquisitionResponse {
  const core = ltvCore(ds, "all");
  const { A, tt } = core;
  // LTGP for the ratio: the realised mean for fully-priced mature teams.
  const fp = core.fullyPriced;
  const ltgpCents = fp.length ? Math.round(fp.reduce((a, t) => a + core.ltgpOf(t.team_key), 0) / fp.length) : null;

  // Assign each campaign to a term: by name, else by the date of its first spend.
  const byCampaign = new Map<string, { name: string; first: string; days: CampaignDay[] }>();
  for (const r of spend.rows) {
    const c = byCampaign.get(r.campaign_id) ?? { name: r.name, first: r.day, days: [] };
    c.days.push(r);
    if (r.day < c.first) c.first = r.day;
    byCampaign.set(r.campaign_id, c);
  }
  const campaignTerm = new Map<string, { term: string | null; basis: "name" | "date" }>();
  byCampaign.forEach((c, id) => {
    const spending = c.days.filter((d) => d.spend > 0).map((d) => d.day).sort();
    const first = spending[0] ?? c.first;
    const byName = termFromCampaignName(c.name, first);
    if (byName) campaignTerm.set(id, { term: byName, basis: "name" });
    else campaignTerm.set(id, { term: termFromDate(first, ds.termStarts), basis: "date" });
  });

  const hubFrom = spend.hubFrom;
  const ballers: { spend: number; names: Set<string> } = { spend: 0, names: new Set() };
  const rows: AcquisitionTermRow[] = A.termRows
    .filter((r) => r.has_data)
    .map((r) => {
      const t = r.term_label;
      const camps: AcquisitionTermRow["campaigns"] = [];
      let total = 0, purchases = 0, ballersSpend = 0;
      byCampaign.forEach((c, id) => {
        const ct = campaignTerm.get(id)!;
        if (ct.term !== t) return;
        const s = c.days.reduce((a, d) => a + d.spend, 0);
        const p = c.days.reduce((a, d) => a + d.purchases, 0);
        if (isBallers(c.name)) { ballersSpend += s; if (s > 0) { ballers.spend += s; ballers.names.add(c.name); } return; }
        if (s <= 0 && p <= 0) return;
        total += s; purchases += p;
        camps.push({ name: c.name, spendCents: s, basis: ct.basis });
      });
      // The hub cannot see before its first day: a term that starts more than the
      // lookback before it has unknown spend, never $0.
      const termStart = r.start_date ?? TERMS[TIDX[t]][1];
      const windowStart = new Date(new Date(termStart + "T00:00:00Z").getTime() - CAC_LOOKBACK_DAYS * 86400e3).toISOString().slice(0, 10);
      const known = !!hubFrom && windowStart >= hubFrom;
      const spendCents = known ? total : camps.length ? total : null;
      const partial = !known && camps.length > 0;
      const newTeams = r.teams_new;
      const cac = spendCents != null && newTeams > 0 ? Math.round(spendCents / newTeams) : null;
      const newKeys = new Set(tt.filter((x) => x.term === t).map((x) => x.team_key).filter((k) => A.teamRows.find((tr) => tr.team_key === k)?.first_term === t));
      const firstContribs = tt.filter((x) => x.term === t && newKeys.has(x.team_key)).map(core.contribution).filter((v): v is number => v != null);
      const firstTermContribution = firstContribs.length ? Math.round(firstContribs.reduce((a, b) => a + b, 0) / firstContribs.length) : null;
      return {
        term: t,
        label: termLabel(t),
        newTeams,
        spendCents,
        spendBasis: spendCents == null ? `No spend data before ${hubFrom ? new Date(hubFrom + "T00:00:00Z").toLocaleDateString("en-NZ", { month: "short", year: "numeric", timeZone: "UTC" }) : "the hub's first pull"}` : partial ? "Meta via the hub — its first day falls inside this term's 8-week window, so earlier spend may be missing" : spendCents === 0 ? "No MFL ads ran for this term" : "Meta, via the Marketing hub",
        campaigns: camps.sort((a, b) => b.spendCents - a.spendCents),
        ballersSpendCents: ballersSpend,
        metaPurchases: spendCents != null ? purchases : null,
        cacCents: cac,
        ltgpCacRatio: cac && ltgpCents != null ? +(ltgpCents / cac).toFixed(1) : null,
        firstTermContributionCents: firstTermContribution,
        thirtyDayPass: cac && firstTermContribution != null ? firstTermContribution >= THIRTY_DAY_MULTIPLE * cac : null,
      };
    });

  const focus = term && rows.some((r) => r.term === term) ? term : rows.filter((r) => r.cacCents != null).slice(-1)[0]?.term ?? A.LATEST;
  const fi = TIDX[focus];
  const prev = rows.filter((r) => TIDX[r.term] < fi).slice(-1)[0] ?? null;
  const ly = rows.find((r) => TIDX[r.term] === fi - 4) ?? null;
  const cur = rows.find((r) => r.term === focus) ?? null;

  return {
    generatedAt: ds.builtAt,
    term,
    latestTerm: A.LATEST,
    hubFrom,
    ltgpCents,
    ltgpBasis: `Realised lifetime gross profit per team, mean of ${fp.length} fully-priced mature teams (excl GST)`,
    rows,
    trend: {
      term: focus,
      cacCents: cur?.cacCents ?? null,
      prevTerm: prev?.term ?? null,
      prevCacCents: prev?.cacCents ?? null,
      lastYearTerm: ly?.term ?? null,
      lastYearCacCents: ly?.cacCents ?? null,
      ltgpCacRatio: cur?.ltgpCacRatio ?? null,
    },
    ballersNote: { spendCents: ballers.spend, campaigns: Array.from(ballers.names) },
    howHeard: mix.howHeard,
    howHeardAnswered: mix.howHeardAnswered,
    howHeardTotal: mix.howHeardTotal,
    firstTouch: {
      registrations: mix.registrations,
      registrationsWithHistory: mix.registrationsWithHistory,
      registrationsTotal: mix.registrationsTotal,
      siteFirstVisits: mix.siteFirstVisits,
      siteFirstVisitsTotal: mix.siteFirstVisitsTotal,
      stampedDirectBeforeFix: mix.stampedDirectBeforeFix,
    },
    notes: [
      "CAC is blended: all MFL ad spend recruiting for a term ÷ every NEW team that term. The ad click is rarely still attached by the time a captain registers, so a paid-only CAC cannot be measured from tags.",
      `Spend is Meta, read from the Marketing hub, which holds data from ${hubFrom ?? "—"}. Earlier terms show no figure, not $0.`,
      "A campaign goes to the term its name says (\"Term 4\", \"T1\", \"Summer\"); otherwise to the term starting within 8 weeks of its first spend.",
      "Meta purchases are pixel counts across overlapping campaigns: they over-count. New teams come from ClubOS, never from Meta.",
      `LTGP:CAC uses the Lifetime view's realised LTGP. Hormozi's floor is ${LTGP_CAC_FLOOR}:1; the 30-day test asks first-term gross profit ≥ ${THIRTY_DAY_MULTIPLE} × CAC.`,
    ],
  };
}

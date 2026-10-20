/**
 * MFL lifetime engine — acceptance test against the standalone build of 20 Oct 2026.
 *
 *   npx tsx --env-file=.env script/_test-league-lifetime.ts
 *
 * READ-ONLY: the session is set to default_transaction_read_only before any query.
 *
 * outputs/mfl-ltv/2026-10-20/terms.csv is the reference (369 identities, 755
 * team-terms, 18 terms with data). Every CLOSED term must match it exactly —
 * team count, new, returning, came back from the previous term, known revenue.
 * The latest term (2026-T4) is still selling, so it may only have grown.
 */
import pg from "pg";
import { readFileSync } from "fs";
import { buildLeagueDataset, computeLifetime } from "../server/league-lifetime";

const REF = process.env.LTV_REF_CSV || "/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/outputs/mfl-ltv/2026-10-20/terms.csv";
const REF_IDENTITIES = 369, REF_TEAM_TERMS = 755, REF_DATA_TERMS = 18, REF_LATEST = "2026-T4";

let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  const head = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const cells: string[] = [];
    let cur = "", q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""]));
  });
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query("SET default_transaction_read_only = on");
  const q = async (text: string, params: unknown[] = []) => (await client.query(text, params as any[])).rows;

  const t0 = Date.now();
  const ds = await buildLeagueDataset(q);
  console.log(`\nBuilt in ${Date.now() - t0} ms\n`);
  const A = ds.all;
  const ref = parseCsv(readFileSync(REF, "utf8"));

  console.log("Totals");
  ok(`latest term is ${REF_LATEST}`, A.LATEST === REF_LATEST, A.LATEST);
  ok(`${REF_DATA_TERMS} terms with data`, A.dataTerms.length === REF_DATA_TERMS, String(A.dataTerms.length));
  ok(`identities ≥ ${REF_IDENTITIES}`, ds.identities >= REF_IDENTITIES, String(ds.identities));
  ok(`team-terms ≥ ${REF_TEAM_TERMS}`, ds.teamTerms.length >= REF_TEAM_TERMS, String(ds.teamTerms.length));
  const latestNow = A.termRows.find((r) => r.term_label === REF_LATEST)!;
  const latestRef = ref.find((r) => r.term_label === REF_LATEST)!;
  const grown = latestNow.teams_total - Number(latestRef.teams_total);
  ok("identities and team-terms grew only by the latest term's new sign-ups",
    ds.teamTerms.length - REF_TEAM_TERMS === grown,
    `latest term ${latestRef.teams_total} → ${latestNow.teams_total}`);

  console.log("\nEvery closed term matches terms.csv exactly");
  for (const r of ref) {
    const mine = A.termRows.find((x) => x.term_label === r.term_label);
    if (!mine) { ok(`${r.term_label} present`, false); continue; }
    if (r.term_label === REF_LATEST) {
      ok(`${r.term_label} (live) teams ≥ ${r.teams_total}`, mine.teams_total >= Number(r.teams_total), String(mine.teams_total));
      ok(`${r.term_label} (live) revenue ≥ ${r.revenue_known_cents}`, mine.revenue_known_cents >= Number(r.revenue_known_cents), String(mine.revenue_known_cents));
      continue;
    }
    const fields: [string, number | null][] = [
      ["teams_total", mine.teams_total],
      ["teams_new", mine.teams_new],
      ["teams_returning", mine.teams_returning],
      ["returning_from_previous_term", mine.returning_from_previous_term],
      ["revenue_known_cents", mine.revenue_known_cents],
      ["team_entries", mine.team_entries],
    ];
    const diffs = fields.filter(([k, v]) => String(v ?? "") !== String(r[k] ?? "")).map(([k, v]) => `${k} ${r[k] || "—"}→${v ?? "—"}`);
    ok(r.term_label, diffs.length === 0, diffs.join(", "));
  }

  console.log("\nBackbone scenario (terms.csv *_backbone columns)");
  const bbDiffs: string[] = [];
  for (const r of ref) {
    if (r.term_label === REF_LATEST || !r.teams_total_backbone) continue;
    const mine = ds.bb.termRows.find((x) => x.term_label === r.term_label);
    const v = mine?.teams_total ?? 0;
    if (String(v) !== r.teams_total_backbone) bbDiffs.push(`${r.term_label} ${r.teams_total_backbone}→${v}`);
  }
  ok("backbone team counts match for every closed term", bbDiffs.length === 0, bbDiffs.join(", "));

  console.log("\nThe Lifetime view computes");
  const lv = computeLifetime(ds, { scenario: "all", term: null });
  console.log(`        stay: mean ${lv.stay.all.mean} (median ${lv.stay.all.median}) · mature mean ${lv.stay.mature.mean} n=${lv.stay.mature.n} · ever return ${lv.stay.everReturnMaturePct}`);
  console.log(`        last 4 steps: ${lv.ltv.recentSteps.map((s) => `${s.term} ${(s.rate * 100).toFixed(0)}%`).join(" · ")}`);
  console.log(`        LTV ${lv.ltv.teams} teams: revenue mean $${(lv.ltv.meanRevenueCents! / 100).toFixed(2)} median $${(lv.ltv.medianRevenueCents! / 100).toFixed(2)} · LTGP mean $${(lv.ltv.meanLtgpCents! / 100).toFixed(2)} · forward $${((lv.ltv.forwardLtgpCents ?? 0) / 100).toFixed(2)} (${lv.ltv.forwardTerms} terms × $${((lv.ltv.contributionPerTeamTermCents ?? 0) / 100).toFixed(2)})`);
  for (const f of lv.formats) console.log(`        ${f.label}: ${f.entries} entries · list ${f.avgListCents ?? "—"} · contracted ${f.avgContractedCents ?? "—"} · paid ${f.avgPaidCents ?? "—"} (ClubOS ${f.avgPaidClubosCents ?? "—"}) · discount ${f.discountPct ?? "—"} · first-format teams ${f.firstFormatTeams} mean ${f.meanTerms} median ${f.medianTerms} return ${f.everReturnPct}`);
  console.log(`        survivors: ${lv.survivors.playing} of ${lv.survivors.cohort} 2023 teams playing ${lv.survivors.latestTerm}`);
  ok("fairest-lifetime cohort matches METHOD.md (105 teams, mean $1,195.95, median $630)",
    lv.ltv.teams === 105 && lv.ltv.meanRevenueCents === 119595 && lv.ltv.medianRevenueCents === 63000,
    `${lv.ltv.teams} · ${lv.ltv.meanRevenueCents} · ${lv.ltv.medianRevenueCents}`);
  ok("11 of the 2023 teams are playing the latest term", lv.survivors.playing === 11, String(lv.survivors.playing));
  ok("blanks are null, never 0 (a format with no ClubOS entries has no list price)",
    lv.formats.filter((f) => f.clubosEntries === 0).every((f) => f.avgListCents === null && f.discountPct === null));

  await client.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

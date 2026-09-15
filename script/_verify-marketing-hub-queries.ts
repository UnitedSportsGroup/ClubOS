/**
 * Marketing hub — run every section against PRODUCTION data, read-only, before
 * the page ever asks for it.
 *
 *   npx tsx --env-file=.env script/_verify-marketing-hub-queries.ts
 *
 * It calls the SAME builders the routes call (exported from
 * server/marketing-hub/routes.ts) with scopes parsed by the same parseScope(),
 * so a SQL mistake or a number that doesn't add up fails here and not as a 500
 * or a wrong figure on Daniel's screen.
 *
 * The checks are the ones a person would notice going wrong:
 *   - a total that isn't the sum of its own chart
 *   - two sections disagreeing about the same number
 *   - revenue that differs from an independent calculation of it
 *   - a programme filter that silently shows the whole workspace as if split
 *   - a filter from the wrong workspace being accepted
 */
import { eachDay } from "@shared/dashboard";
import { HUB_WORKSPACES } from "@shared/marketing-hub";
import { REAL_REGISTRATION_STATUS_SQL } from "@shared/registrations";
import { pool } from "../server/db";
import { HubInputError, orgs, parseScope, type HubScope } from "../server/marketing-hub/common";
import { ads, forms, organic, overview, sources, tracked, websites } from "../server/marketing-hub/routes";

let pass = 0;
let fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};
const AVAILABILITY = new Set(["ok", "not_connected", "no_data", "not_split"]);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const nonNeg = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;

const scope = (query: Record<string, string>) => parseScope({ query } as any);

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const r = await fn();
  const ms = Date.now() - t;
  ok(`${label} answers in under 10s`, ms < 10_000, `${ms}ms`);
  return r;
}

async function independentConfirmedRevenue(orgId: number, s: HubScope): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(t.total_cents), 0)::float8 AS c
     FROM registrations t JOIN programs p ON p.id = t.program_id
     WHERE p.organization_id = $1 AND t.status = 'confirmed'
       AND (t.registered_at AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific/Auckland')::date BETWEEN $2::date AND $3::date`,
    [orgId, s.range.from, s.range.to],
  );
  return Math.round(Number(rows[0].c));
}

async function independentPaidRegistrations(orgId: number, s: HubScope): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n
     FROM registrations t JOIN programs p ON p.id = t.program_id
     WHERE p.organization_id = $1 AND t.status IN ${REAL_REGISTRATION_STATUS_SQL}
       AND (t.registered_at AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific/Auckland')::date BETWEEN $2::date AND $3::date`,
    [orgId, s.range.from, s.range.to],
  );
  return Number(rows[0].n);
}

async function checkScope(name: string, s: HubScope) {
  console.log(`\n${name}  (${s.range.from} → ${s.range.to}${s.filter.workspace ? `, ${s.filter.workspace}` : ""}${s.programme ? `, ${s.programme.name}` : ""})`);
  const days = eachDay(s.range).length;

  const o = await timed("overview", () => overview(s));
  ok("overview chart has one point per day", o.series.length === days, `${o.series.length}/${days}`);
  for (const [k, t] of Object.entries(o.tiles)) {
    ok(`tile ${k} has a known status`, AVAILABILITY.has((t as any).status), (t as any).status);
  }
  ok("submissions tile = sum of its chart", o.tiles.submissions.current === sum(o.series.map((p) => p.submissions)),
    `${o.tiles.submissions.current} vs ${sum(o.series.map((p) => p.submissions))}`);
  ok("paid registrations tile = sum of its chart", o.tiles.paidRegistrations.current === sum(o.series.map((p) => p.paidRegistrations)));
  ok("ad spend tile = sum of its chart", o.tiles.adSpendCents.current === sum(o.series.map((p) => p.adSpendCents)),
    `${o.tiles.adSpendCents.current} vs ${sum(o.series.map((p) => p.adSpendCents))}`);
  ok("visitors over the period ≥ any single day (distinct, never summed)",
    o.tiles.visitors.current >= Math.max(0, ...o.series.map((p) => p.visitors)));
  ok("every tile number is non-negative",
    [o.tiles.visitors, o.tiles.submissions, o.tiles.paidRegistrations, o.tiles.revenueCents, o.tiles.adSpendCents]
      .every((t) => nonNeg(t.current) && nonNeg(t.previous)));
  const inScope = HUB_WORKSPACES.filter((w) => !s.filter.workspace || w.slug === s.filter.workspace);
  ok("one row per workspace in scope", o.byWorkspace.length === inScope.length, `${o.byWorkspace.length}/${inScope.length}`);
  ok("workspace submissions add up to the tile", sum(o.byWorkspace.map((w) => w.submissions)) === o.tiles.submissions.current);
  ok("workspace paid registrations add up to the tile", sum(o.byWorkspace.map((w) => w.paidRegistrations)) === o.tiles.paidRegistrations.current);

  const { bySlug } = await orgs();
  const cufc = bySlug.get("christchurch-united")!;
  const cufcRow = o.byWorkspace.find((w) => w.slug === "christchurch-united");
  if (cufcRow && !s.programme) {
    const rev = await independentConfirmedRevenue(cufc.id, s);
    ok("CUFC revenue matches an independent calculation", cufcRow.revenueCents === rev, `${cufcRow.revenueCents} vs ${rev}`);
    const paid = await independentPaidRegistrations(cufc.id, s);
    ok("CUFC paid registrations match an independent count", cufcRow.paidRegistrations === paid, `${cufcRow.paidRegistrations} vs ${paid}`);
  }
  const cic = o.byWorkspace.find((w) => w.slug === "christchurch-international-cup");
  if (cic) ok("the Cup's revenue is labelled as partial (7's only), not presented as the whole Cup",
    cic.revenueCents == null || /only\)/.test(cic.revenueLabel ?? ""), cic.revenueLabel ?? "null");

  const f = await timed("forms", () => forms(s));
  ok("forms total = overview submissions", f.total.current === o.tiles.submissions.current, `${f.total.current} vs ${o.tiles.submissions.current}`);
  ok("forms total = sum of form rows", f.total.current === sum(f.forms.map((x) => x.current)));
  ok("forms total = sum of its chart", f.total.current === sum(f.series.map((p) => p.submissions)));
  if (s.programme) ok("with a programme, only programme-aware forms are counted", f.forms.every((x) => x.programmeAware));

  const w = await timed("websites", () => websites(s));
  ok("site chart has one point per day", w.firstParty.series.length === days);
  ok("visitors per site add up to at least the organisation total",
    sum(w.firstParty.sites.map((x) => x.visitors)) >= (s.programme ? 0 : o.tiles.visitors.current));
  ok("no staff host is counted as a website",
    !w.firstParty.sites.some((x) => /app\.usg\.co\.nz|fly\.dev|vercel\.app|localhost/.test(x.host)),
    w.firstParty.sites.map((x) => x.host).join(", "));
  ok("Google Analytics has a known status", AVAILABILITY.has(w.ga4.status), w.ga4.status);

  const a = await timed("ads", () => ads(s));
  ok("ad spend total = sum of campaigns", a.totals.spendCents.current === sum(a.campaigns.map((c) => c.spendCents)),
    `${a.totals.spendCents.current} vs ${sum(a.campaigns.map((c) => c.spendCents))}`);
  ok("ad spend total = sum of its chart", a.totals.spendCents.current === sum(a.series.map((p) => p.spendCents)));
  ok("ad spend total = overview ad spend", a.totals.spendCents.current === o.tiles.adSpendCents.current);
  ok("spend by workspace adds up to the total", sum(a.byWorkspace.map((x) => x.spendCents)) === a.totals.spendCents.current);
  if (s.filter.workspace) ok("every campaign shown belongs to the chosen workspace", a.campaigns.every((c) => c.workspace === s.filter.workspace));
  ok("Google Ads, TikTok and LinkedIn say they aren't built, never zero",
    a.platforms.filter((p) => p.key !== "meta_ads").every((p) => p.status === "not_built"));
  ok("programme filter flag is honest", a.notSplitByProgramme === Boolean(s.programme));

  const t = await timed("tracked sign-ups", () => tracked(s));
  ok("tracked sign-ups have a known status", AVAILABILITY.has(t.status), t.status);

  const so = await timed("social", () => organic(s));
  ok("social has a known status", AVAILABILITY.has(so.status), so.status);
  ok("follower totals are never negative", so.accounts.every((x) => x.followers == null || x.followers >= 0));

  if (s.programme) {
    ok("with a programme, visitors say not_split rather than a whole-workspace number", o.tiles.visitors.status === "not_split");
    ok("with a programme, ad spend is not_split or not_connected",
      o.tiles.adSpendCents.status === "not_split" || o.tiles.adSpendCents.status === "not_connected");
  }

  for (const row of a.campaigns.slice(0, 6)) {
    console.log(`        $${(row.spendCents / 100).toFixed(2).padStart(9)}  ${String(row.workspace).padEnd(32)} ${row.basis.padEnd(8)} ${row.name}`);
  }
}

async function main() {
  console.log("\nMarketing hub — every section against production (read-only)");

  await checkScope("Whole organisation, last 30 days", await scope({ period: "30d" }));
  await checkScope("Christchurch United, year to date", await scope({ period: "ytd", workspace: "christchurch-united" }));
  await checkScope("Mini Football, last 30 days", await scope({ period: "30d", workspace: "mini-football-leagues" }));

  const { rows: mflProg } = await pool.query(
    `SELECT p.id FROM programs p JOIN organizations o ON o.id = p.organization_id
     WHERE o.slug = 'mini-football-leagues' ORDER BY p.is_active DESC, p.id LIMIT 1`,
  );
  if (mflProg[0]) {
    await checkScope("Mini Football, one programme, custom range",
      await scope({ period: "custom", from: "2026-07-01", to: "2026-09-14", workspace: "mini-football-leagues", program: String(mflProg[0].id) }));
  }

  console.log("\nFilters that must be refused");
  const refuses = async (label: string, query: Record<string, string>) => {
    try {
      await scope(query);
      ok(label, false, "was accepted");
    } catch (e) {
      ok(label, e instanceof HubInputError, (e as Error).message);
    }
  };
  await refuses("an unknown workspace", { workspace: "not-a-workspace" });
  await refuses("a programme without a workspace", { program: "1" });
  await refuses("a programme from another workspace", {
    workspace: "christchurch-united",
    program: String(mflProg[0]?.id ?? 999999),
  });

  console.log("\nData sources");
  const src = await sources();
  ok("all 19 registered accounts are listed", src.sources.length >= 19, String(src.sources.length));
  ok("all seven platforms are described", src.platforms.length === 7);
  const failing = src.sources.filter((x) => x.lastStatus === "error");
  ok("no account's last pull failed", failing.length === 0, failing.map((x) => `${x.label}: ${x.lastError}`).join(" | "));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});

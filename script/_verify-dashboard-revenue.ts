/**
 * Verify the dashboard revenue engine against the real database.
 *
 * Runs `metricSeries()` — the exact function the route calls — for every
 * workspace, and checks each answer against an independently written control
 * query. A reimplementation that agrees with itself proves nothing; these
 * controls are deliberately written a different way (plain SQL, no shared
 * helpers) so a bug in the engine has to survive both to go unnoticed.
 *
 *   npx tsx --env-file=.env script/_verify-dashboard-revenue.ts
 *
 * Read-only. Touches no HTTP, starts no worker.
 */
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { metricSeries } from "../server/dashboard-routes";
import {
  DASHBOARD_METRICS,
  metricFor,
  eachDay,
  nzTodayIso,
  previousRange,
  resolvePeriod,
  addDaysIso,
  daysInclusive,
  percentChange,
  type DashboardPeriod,
} from "../shared/dashboard";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function one(q: string): Promise<any> {
  const r: any = await db.execute(sql.raw(q));
  return r.rows?.[0] ?? {};
}

async function main() {
  console.log("\n── Pure date logic (no database) ─────────────────────────");
  {
    const today = "2026-09-02";
    check("today resolves to a single day", JSON.stringify(resolvePeriod("today", undefined, today)) === JSON.stringify({ from: "2026-09-02", to: "2026-09-02" }));
    check("7d is 7 days inclusive, ending today", (() => {
      const r = resolvePeriod("7d", undefined, today);
      return r.from === "2026-08-27" && r.to === today && daysInclusive(r.from, r.to) === 7;
    })());
    check("30d is 30 days inclusive", (() => {
      const r = resolvePeriod("30d", undefined, today);
      return daysInclusive(r.from, r.to) === 30 && r.from === "2026-08-04";
    })());
    check("ytd starts 1 January", resolvePeriod("ytd", undefined, today).from === "2026-01-01");
    check("previous range is the same length, ending the day before", (() => {
      const r = resolvePeriod("30d", undefined, today);
      const p = previousRange(r);
      return daysInclusive(p.from, p.to) === 30 && p.to === addDaysIso(r.from, -1);
    })());
    check("a backwards custom range is swapped, not rejected", (() => {
      const r = resolvePeriod("custom", { from: "2026-05-10", to: "2026-05-01" }, today);
      return r.from === "2026-05-01" && r.to === "2026-05-10";
    })());
    // 🔴 Month-end and leap day: the arithmetic is UTC-anchored precisely so
    // these do not drift. A naive local-Date implementation gets these wrong
    // on the days either side of a DST change.
    check("crossing a month boundary backwards", addDaysIso("2026-03-01", -1) === "2026-02-28");
    check("leap day exists in 2028", addDaysIso("2028-02-28", 1) === "2028-02-29");
    check("NZ DST start (late Sep) does not eat a day", daysInclusive("2026-09-20", "2026-09-30") === 11);
    check("NZ DST end (early Apr) does not add a day", daysInclusive("2026-04-01", "2026-04-10") === 10);
    check("eachDay covers the range with no gaps", eachDay({ from: "2026-01-30", to: "2026-02-02" }).join(",") === "2026-01-30,2026-01-31,2026-02-01,2026-02-02");
    check("percentChange from zero is null, never Infinity", percentChange(500, 0) === null);
    check("percentChange is signed correctly", percentChange(150, 100) === 50 && percentChange(50, 100) === -50);
    check("nzTodayIso is a bare YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(nzTodayIso()));
  }

  console.log("\n── Workspaces ────────────────────────────────────────────");
  const orgs: any[] = ((await db.execute(sql.raw("SELECT id, slug FROM organizations ORDER BY id"))) as any).rows;

  for (const org of orgs) {
    const src = (DASHBOARD_METRICS[org.slug] ?? []).find((m: any) => m.key === 'revenue');
    // Every money metric here has exactly ONE part; the control query below is
    // written against that part independently of the engine. A metric that
    // grows a second part (CIC 7's, whose fee can be settled by the players or
    // by the manager) is controlled separately further down.
    const part: any = src?.parts?.[0];
    console.log(`\n  ${org.slug} (org ${org.id})${part ? ` → ${part.table}.${part.amountColumn}` : " → no source"}`);
    if (src) check("this money metric has exactly one part", src.parts.length === 1, `${src.parts.length} parts`);

    const ytd = await metricSeries(org.slug, org.id, "revenue", "ytd");

    if (!src || !part) {
      // 🔴 The whole point of the unwired case: it must be distinguishable
      // from zero revenue, or the Cup's dashboard states the tournament
      // earned nothing.
      check("unwired workspace reports source: null", ytd.source === null);
      check("unwired workspace reports no series", ytd.series.length === 0);
      continue;
    }

    check("source is labelled", !!ytd.source?.label);

    // Control: a plain query written independently of the engine.
    const st = part.statuses.length
      ? `AND ${part.statusColumn ?? "status"} IN (${part.statuses.map((s) => `'${s}'`).join(",")})`
      : "";
    const dt = await one(
      `SELECT data_type FROM information_schema.columns WHERE table_name='${part.table}' AND column_name='${part.dateColumn}'`,
    );
    const kind = String(dt.data_type ?? "").toLowerCase();
    const expr =
      kind === "date"
        ? part.dateColumn
        : kind.includes("with time zone")
          ? `(${part.dateColumn} AT TIME ZONE 'Pacific/Auckland')::date`
          : `(${part.dateColumn} AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific/Auckland')::date`;

    // The control writes the org scope independently too — the engine's
    // assumption that every table has an organization_id is exactly the bug
    // this script caught on its first run.
    const scopeSql =
      part.orgScope.kind === "column"
        ? `${part.orgScope.column} = ${org.id}`
        : `${part.orgScope.column} IN (SELECT id FROM programs WHERE organization_id = ${org.id})`;

    const control = await one(`
      SELECT COALESCE(SUM(${part.amountColumn}),0)::bigint cents, COUNT(*)::int n
      FROM ${part.table}
      WHERE ${scopeSql}
        ${st}
        AND ${part.dateColumn} IS NOT NULL
        AND ${expr} BETWEEN '${ytd.range.from}'::date AND '${ytd.range.to}'::date
    `);
    check(
      `YTD total matches an independent query ($${(ytd.total / 100).toFixed(2)})`,
      ytd.total === Number(control.cents),
      `engine ${ytd.total} vs control ${control.cents}`,
    );
    check(`YTD count matches (${ytd.count})`, ytd.count === Number(control.n));

    // 🔴 The series must sum to the headline. A total that exceeds the sum of
    // its own bars is the thing that makes people stop believing a chart.
    const seriesSum = ytd.series.reduce((a, p) => a + p.value, 0);
    check("daily series sums to the headline total", seriesSum === ytd.total, `series ${seriesSum} vs total ${ytd.total}`);
    check("series has one point per calendar day", ytd.series.length === daysInclusive(ytd.range.from, ytd.range.to));
    check("series is in date order with no duplicates", (() => {
      const ds = ytd.series.map((p) => p.date);
      return ds.every((d, i) => i === 0 || d > ds[i - 1]);
    })());
    check("no negative day totals", ytd.series.every((p) => p.value >= 0));

    // Periods must nest: a day cannot exceed the 30 days containing it.
    const today = await metricSeries(org.slug, org.id, "revenue", "today");
    const d30 = await metricSeries(org.slug, org.id, "revenue", "30d");
    check("today ≤ last 30 days ≤ year to date", today.total <= d30.total && d30.total <= ytd.total,
      `${today.total} / ${d30.total} / ${ytd.total}`);

    // The previous-period figure must be the real preceding window, not a copy.
    const prev = previousRange(d30.range);
    const prevControl = await one(`
      SELECT COALESCE(SUM(${part.amountColumn}),0)::bigint cents
      FROM ${part.table}
      WHERE ${scopeSql} ${st}
        AND ${part.dateColumn} IS NOT NULL
        AND ${expr} BETWEEN '${prev.from}'::date AND '${prev.to}'::date
    `);
    check("previous-period figure matches its own window", d30.previous === Number(prevControl.cents),
      `engine ${d30.previous} vs control ${prevControl.cents}`);

    // 🔴 Scoping: this workspace's number must not include another's rows.
    const global = await one(`
      SELECT COALESCE(SUM(${part.amountColumn}),0)::bigint cents
      FROM ${part.table}
      WHERE 1=1 ${st} AND ${part.dateColumn} IS NOT NULL
        AND ${expr} BETWEEN '${ytd.range.from}'::date AND '${ytd.range.to}'::date
    `);
    check("workspace total never exceeds the all-orgs total", ytd.total <= Number(global.cents));
  }

  // ── The Cup: counts, sub-views, and a two-part money metric ───────────────
  console.log("\n── The Cup ───────────────────────────────────────────────");
  {
    const CIC = 5;
    // Youth charts INTEREST, not money: its 132 team entries all carry
    // paid_amount_cents = 0, and a $0.00 there would say the tournament earned
    // nothing rather than that we do not hold the number.
    const youth = await metricSeries("christchurch-international-cup", CIC, "interest", "ytd");
    check("Youth charts a count, not money", youth.source?.kind === "count", String(youth.source?.kind));
    const yctl = await one(`SELECT count(*)::int n FROM cic_interest_registrations WHERE organization_id = ${CIC}
      AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific/Auckland')::date
          BETWEEN '${youth.range.from}'::date AND '${youth.range.to}'::date`);
    check(`Youth interest matches an independent count (${youth.total})`,
      youth.total === Number(yctl.n), `engine ${youth.total} vs control ${yctl.n}`);
    check("Youth series sums to its headline",
      youth.series.reduce((a, p) => a + p.value, 0) === youth.total);
    check("Youth has NO money metric", metricFor("christchurch-international-cup", null, "revenue") === null);

    // 7's is a sub-view of the SAME workspace and must not inherit Youth's.
    const sevens = await metricSeries("christchurch-international-cup", CIC, "interest", "ytd", { view: "7s" });
    const sctl = await one(`SELECT count(*)::int n FROM cic7s_registrations WHERE organization_id = ${CIC}
      AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific/Auckland')::date
          BETWEEN '${sevens.range.from}'::date AND '${sevens.range.to}'::date`);
    check(`7's interest matches an independent count (${sevens.total})`,
      sevens.total === Number(sctl.n), `engine ${sevens.total} vs control ${sctl.n}`);
    check("7's interest is a DIFFERENT number from Youth's",
      sevens.total !== youth.total, `7's ${sevens.total}, youth ${youth.total}`);

    // 🔴 The two-part one. A team's fee is settled either by the players or by
    // the manager, and both settle the same balance — so the control adds both
    // tables independently of the engine.
    const money = await metricSeries("christchurch-international-cup", CIC, "revenue", "ytd", { view: "7s" });
    check("7's charts money", money.source?.kind === "money", String(money.source?.kind));
    const mctl = await one(`
      SELECT (
        COALESCE((SELECT SUM(pl.paid_cents) FROM teampay_players pl
           WHERE pl.entry_id IN (SELECT id FROM teampay_entries WHERE competition_id IN
             (SELECT id FROM teampay_competitions WHERE organization_id = ${CIC} AND brand = 'cic7s'))
             AND pl.paid_at IS NOT NULL
             AND (pl.paid_at AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific/Auckland')::date
                 BETWEEN '${money.range.from}'::date AND '${money.range.to}'::date), 0)
      + COALESCE((SELECT SUM(en.team_paid_cents) FROM teampay_entries en
           WHERE en.competition_id IN (SELECT id FROM teampay_competitions WHERE organization_id = ${CIC} AND brand = 'cic7s')
             AND en.team_paid_at IS NOT NULL
             AND (en.team_paid_at AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific/Auckland')::date
                 BETWEEN '${money.range.from}'::date AND '${money.range.to}'::date), 0)
      )::bigint AS cents`);
    check(`7's revenue counts BOTH payment routes ($${(money.total / 100).toFixed(2)})`,
      money.total === Number(mctl.cents), `engine ${money.total} vs control ${mctl.cents}`);
    check("7's revenue series sums to its headline",
      money.series.reduce((a, p) => a + p.value, 0) === money.total);
    // The Ethnic Cup shares these tables and must not leak into the 7's figure.
    const ethnic = await one(`SELECT COALESCE(SUM(pl.paid_cents),0)::bigint cents FROM teampay_players pl
      WHERE pl.entry_id IN (SELECT id FROM teampay_entries WHERE competition_id IN
        (SELECT id FROM teampay_competitions WHERE organization_id = ${CIC} AND brand = 'ethniccup'))`);
    check("the Ethnic Cup's money is NOT in the 7's figure",
      Number(ethnic.cents) === 0 || money.total !== Number(ethnic.cents),
      `ethnic ${ethnic.cents}, 7s ${money.total}`);
  }

  console.log("\n── Cross-workspace ───────────────────────────────────────");
  {
    // 🔴 Two workspaces sharing a table must not report each other's money.
    const cufc = await metricSeries("christchurch-united", 1, "revenue", "ytd");
    const mfl = await metricSeries("mini-football-leagues", 3, "revenue", "ytd");
    check("CUFC and MFL share `registrations` but report different totals",
      cufc.total !== mfl.total || (cufc.total === 0 && mfl.total === 0),
      `cufc ${cufc.total}, mfl ${mfl.total}`);

    const both = await one(`
      SELECT COALESCE(SUM(r.total_cents),0)::bigint cents FROM registrations r
      JOIN programs p ON p.id = r.program_id
      WHERE p.organization_id IN (1,3) AND r.status='confirmed'
        AND (r.registered_at AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific/Auckland')::date
            BETWEEN '${cufc.range.from}'::date AND '${cufc.range.to}'::date
    `);
    // registrations has no organization_id of its own — it scopes through
    // programs — so this also proves the engine is joining, not guessing.
    check("CUFC + MFL equals the two orgs' combined registrations",
      cufc.total + mfl.total === Number(both.cents),
      `${cufc.total} + ${mfl.total} vs ${both.cents}`);
  }

  console.log("\n──────────────────────────────────────────────────────────");
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  • ${f}`);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});

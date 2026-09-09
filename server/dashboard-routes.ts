/**
 * Dashboard revenue — one endpoint, one honest number.
 *
 * Replaces the four stat tiles that used to sit on the CUFC dashboard, of
 * which the only one anybody looked at was Revenue and it read $0.00.
 *
 * Two rules this endpoint exists to keep:
 *
 * 🔴 NEVER answer 200 with zeros when something went wrong. The old
 * /api/admin/stats path let the client render `stats?.totalRevenueCents ?? 0`,
 * so a failed request, a missing workspace header and a genuinely empty
 * workspace all painted the same confident "$0.00". A dashboard that cannot
 * tell you it is broken is worse than one that is obviously broken.
 *
 * 🔴 NEVER report $0.00 for a workspace whose money simply is not in ClubOS.
 * Six of the nine workspaces have no `programs` row, and the Cup's 132 team
 * entries all carry `paid_amount_cents = 0`. Those workspaces get an explicit
 * "not wired up" answer, not a zero that reads as "you earned nothing".
 */
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import {
  DASHBOARD_PERIODS,
  eachDay,
  previousRange,
  resolvePeriod,
  metricFor,
  metricsFor,
  type DashboardMetric,
  type DashboardPeriod,
  type DateRange,
  type MetricPart,
  type MetricResponse,
} from "@shared/dashboard";

// Identifiers come from the REVENUE_SOURCES registry in shared/dashboard.ts —
// never from the request — but they are interpolated into SQL, so they are
// asserted here too. A registry entry with a typo should fail loudly at the
// boundary rather than become a query.
const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(name: string): string {
  if (!SAFE_IDENT.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return name;
}

/**
 * How to turn this source's date column into a NEW ZEALAND calendar date.
 *
 * 🔴 Three column types, three different expressions, and getting it wrong
 * moves money between days:
 *
 *  - `date` — already a calendar date. Casting it through a timezone is what
 *    produces off-by-one days, so it is left alone.
 *  - `timestamp with time zone` — an instant; shift to NZ, then take the date.
 *  - `timestamp without time zone` — verified against production to hold UTC
 *    (a row written at 22:17 naive belongs to the NEXT day in NZ). It must be
 *    told it is UTC *first*; a bare `AT TIME ZONE 'Pacific/Auckland'` on a
 *    naive column means "interpret this as NZ wall time", which is the exact
 *    opposite and shifts every row 12 hours the wrong way.
 *
 * The type is read from information_schema rather than declared in the source
 * registry, so a column that changes type cannot leave a stale assumption
 * behind. Cached per process — these never change while the app is running.
 */
const dateKindCache = new Map<string, "date" | "timestamptz" | "timestamp">();

async function dateKind(table: string, column: string) {
  const key = `${table}.${column}`;
  const hit = dateKindCache.get(key);
  if (hit) return hit;
  const rows = await db.execute(
    sql.raw(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = '${ident(table)}' AND column_name = '${ident(column)}'
      LIMIT 1
    `),
  );
  const dt = String(((rows as any).rows?.[0]?.data_type ?? "")).toLowerCase();
  const kind =
    dt === "date" ? "date" : dt.includes("with time zone") ? "timestamptz" : "timestamp";
  dateKindCache.set(key, kind);
  return kind;
}

function dateExprFor(column: string, kind: "date" | "timestamptz" | "timestamp"): string {
  const col = `t.${ident(column)}`;
  if (kind === "date") return `${col}`;
  if (kind === "timestamptz") return `(${col} AT TIME ZONE 'Pacific/Auckland')::date`;
  return `(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific/Auckland')::date`;
}

/** Brands come from the registry, never a request, but they are interpolated
 *  into SQL — so they are asserted at the boundary like every identifier. */
function brandLiteral(brand: string): string {
  if (!/^[a-z0-9_-]+$/.test(brand)) throw new Error(`Unsafe brand: ${brand}`);
  return `'${brand}'`;
}

function whereFor(source: MetricPart, orgId: number, range: DateRange, dateExpr: string) {
  const scope = source.orgScope;
  const parts: string[] =
    scope.kind === "column"
      ? [`t.${ident(scope.column)} = ${orgId}`]
      : scope.kind === "viaPrograms"
      ? // `registrations` reaches its workspace through the programme it is
        // for; it has no organization_id of its own.
        [`t.${ident(scope.column)} IN (SELECT id FROM programs WHERE organization_id = ${orgId})`]
      : scope.kind === "viaTeampayCompetition"
      ? [
          `t.${ident(scope.column)} IN (SELECT id FROM teampay_competitions ` +
            `WHERE organization_id = ${orgId} AND brand = ${brandLiteral(scope.brand)})`,
        ]
      : // A player's payment reaches the workspace through its entry, and the
        // entry's competition carries the brand — which is what keeps CIC 7's
        // money apart from the Ethnic Cup's inside the one Cup workspace.
        [
          `t.${ident(scope.column)} IN (SELECT id FROM teampay_entries WHERE competition_id IN ` +
            `(SELECT id FROM teampay_competitions WHERE organization_id = ${orgId} ` +
            `AND brand = ${brandLiteral(scope.brand)}))`,
        ];
  parts.push(`${dateExpr} BETWEEN '${range.from}'::date AND '${range.to}'::date`);
  if (source.statuses.length > 0) {
    const col = ident(source.statusColumn ?? "status");
    const list = source.statuses.map((s) => `'${s.replace(/'/g, "''")}'`).join(", ");
    parts.push(`t.${col} IN (${list})`);
  }
  // A NULL date cannot be placed on a chart. Excluding it here means the total
  // and the series always agree — a total that exceeds the sum of its own bars
  // is the kind of thing people stop trusting a dashboard over.
  parts.push(`t.${ident(source.dateColumn)} IS NOT NULL`);
  return parts.join(" AND ");
}

// 🔴 A money metric SUMS a column; a count metric counts ROWS. Summing a
// missing column would throw, and counting rows for money would report the
// number of payments as dollars — so the kind decides the expression, once.
const valueExpr = (metric: DashboardMetric, part: MetricPart) =>
  metric.kind === "money"
    ? `COALESCE(SUM(t.${ident(part.amountColumn ?? "")}), 0)::bigint`
    : `COUNT(*)::bigint`;

async function sumFor(
  metric: DashboardMetric,
  part: MetricPart,
  orgId: number,
  range: DateRange,
  dateExpr: string,
) {
  const rows = await db.execute(
    sql.raw(`
      SELECT ${valueExpr(metric, part)} AS value,
             COUNT(*)::int AS n
      FROM ${ident(part.table)} t
      WHERE ${whereFor(part, orgId, range, dateExpr)}
    `),
  );
  const row: any = (rows as any).rows?.[0] ?? {};
  return { value: Number(row.value ?? 0), count: Number(row.n ?? 0) };
}

async function seriesFor(
  metric: DashboardMetric,
  part: MetricPart,
  orgId: number,
  range: DateRange,
  dateExpr: string,
  into: Map<string, number>,
) {
  const rows = await db.execute(
    sql.raw(`
      SELECT ${dateExpr} AS d, ${valueExpr(metric, part)} AS value
      FROM ${ident(part.table)} t
      WHERE ${whereFor(part, orgId, range, dateExpr)}
      GROUP BY 1
      ORDER BY 1
    `),
  );
  for (const r of ((rows as any).rows ?? []) as any[]) {
    // pg returns a `date` as a local-midnight JS Date. Formatting it with
    // toISOString() would shift it a day; read the calendar parts instead.
    const d = r.d instanceof Date ? isoFromLocalDate(r.d) : String(r.d).slice(0, 10);
    // Accumulated, because a metric can have more than one part and both may
    // land on the same day.
    into.set(d, (into.get(d) ?? 0) + Number(r.value ?? 0));
  }
}

function isoFromLocalDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The whole engine, callable without an HTTP request — so the verification
 * script exercises exactly the code the route runs, rather than a
 * reimplementation of it that can agree with itself while both are wrong.
 */
export async function metricSeries(
  orgSlug: string,
  orgId: number,
  metricKey: string,
  period: DashboardPeriod,
  opts?: { from?: string; to?: string; view?: string | null },
): Promise<MetricResponse> {
  const range = resolvePeriod(period, opts);
  const metric = metricFor(orgSlug, opts?.view, metricKey);
  // 🔴 No metric is NOT a zero. A workspace that charts nothing says so, or a
  // club reads "$0.00" in its own dashboard and takes it as a fact about the
  // month rather than a fact about our instrumentation.
  if (!metric) {
    return { source: null, range, total: 0, previous: 0, series: [], count: 0 };
  }
  const prev = previousRange(range);
  const byDate = new Map<string, number>();
  let total = 0;
  let previous = 0;
  let count = 0;

  for (const part of metric.parts) {
    const kind = await dateKind(part.table, part.dateColumn);
    const expr = dateExprFor(part.dateColumn, kind);
    const [cur, before] = await Promise.all([
      sumFor(metric, part, orgId, range, expr),
      sumFor(metric, part, orgId, prev, expr),
    ]);
    await seriesFor(metric, part, orgId, range, expr, byDate);
    total += cur.value;
    previous += before.value;
    count += cur.count;
  }

  return {
    source: {
      title: metric.title,
      label: metric.label,
      caveat: metric.dateCaveat,
      kind: metric.kind,
      unit: metric.unit,
    },
    range,
    total,
    previous,
    // Fill every day so the chart shows real gaps rather than joining across them.
    series: eachDay(range).map((date) => ({ date, value: byDate.get(date) ?? 0 })),
    count,
  };
}

export function registerDashboardRoutes(
  app: Express,
  requireAuth: any,
  workspaceOrg: (req: any) => Promise<{ id: number; slug: string } | null>,
) {
  // One endpoint for every dashboard number. `metric` picks which (revenue,
  // interest, …) and `view` narrows to a sub-tournament inside the Cup.
  const handler = async (req: any, res: any) => {
    try {
      const org = await workspaceOrg(req);
      // 🔴 An unresolved workspace is an ERROR, not an empty result. Answering
      // 200 with zeros here is precisely how the old dashboard hid the fact
      // that it had no idea which club it was talking about.
      if (!org) {
        return res.status(400).json({
          message:
            "No workspace selected. Reload the page, or pick a workspace from the switcher.",
        });
      }

      const rawPeriod = String(req.query.period ?? "30d");
      const period: DashboardPeriod = (DASHBOARD_PERIODS as readonly string[]).includes(rawPeriod)
        ? (rawPeriod as DashboardPeriod)
        : "30d";
      const view = req.query.view ? String(req.query.view) : null;
      const metricKey = String(req.query.metric ?? "revenue");

      const body = await metricSeries(org.slug, org.id, metricKey, period, {
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        view,
      });
      res.json(body);
    } catch (error: any) {
      // Let the client show "couldn't load" rather than a plausible zero.
      res.status(500).json({ message: error?.message ?? "Failed to load dashboard metric" });
    }
  };

  app.get("/api/admin/dashboard/metric", requireAuth, handler);
  // The original path, kept so a stale client keeps working; it defaults to
  // metric=revenue, which is exactly what it always returned.
  app.get("/api/admin/dashboard/revenue", requireAuth, handler);

  // Which cards this workspace (and sub-view) should draw, so a dashboard page
  // never hardcodes a list that drifts from the registry.
  app.get("/api/admin/dashboard/metrics", requireAuth, async (req: any, res: any) => {
    try {
      const org = await workspaceOrg(req);
      if (!org) return res.status(400).json({ message: "No workspace selected." });
      const view = req.query.view ? String(req.query.view) : null;
      res.json({
        metrics: metricsFor(org.slug, view).map((m) => ({
          key: m.key, kind: m.kind, title: m.title, label: m.label, unit: m.unit,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ message: error?.message ?? "Failed to load dashboard metrics" });
    }
  });
}

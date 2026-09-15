/**
 * What marketing turned into: paid registrations and revenue, read live.
 *
 * 🔴 Two existing deciders, reused rather than re-implemented:
 *   - a registration is real only if paid — shared/registrations.ts
 *     ("If you ain't paid you ain't registered", Daniel 2026-09-08);
 *   - a workspace's revenue is whatever its own dashboard says — metricSeries()
 *     in dashboard-routes.ts, driven by DASHBOARD_METRICS. The hub must never
 *     show a different revenue figure from the workspace's own dashboard.
 */
import { DASHBOARD_METRICS, metricFor, type DashboardMetric } from "@shared/dashboard";
import { REAL_REGISTRATION_STATUS_SQL } from "@shared/registrations";
import { HUB_WORKSPACES } from "@shared/marketing-hub";
import { dateExprFor, dateKind, metricSeries } from "../dashboard-routes";
import { hubSlugForOrg, nzBounds, orgs, periodOf, q, type HubScope } from "./common";

export type PaidSummary = {
  current: number;
  previous: number;
  byOrg: Map<number, number>;
  series: Map<string, number>;
};

export async function paidRegistrations(scope: HubScope): Promise<PaidSummary> {
  const out: PaidSummary = { current: 0, previous: 0, byOrg: new Map(), series: new Map() };
  const add = (org: number, day: string, n: number) => {
    const half = periodOf(day, scope);
    if (!half) return;
    out[half] += n;
    if (half === "current") {
      out.byOrg.set(org, (out.byOrg.get(org) ?? 0) + n);
      out.series.set(day, (out.series.get(day) ?? 0) + n);
    }
  };

  const regKind = await dateKind("registrations", "registered_at");
  const params: unknown[] = [scope.previous.from, scope.range.to, scope.orgIds];
  let programmeCond = "";
  if (scope.programme) {
    params.push(scope.programme.id);
    programmeCond = ` AND t.program_id = $4`;
  }
  const regs = await q<{ org: number; day: string; n: number }>(
    `SELECT p.organization_id AS org, ${dateExprFor("registered_at", regKind)}::text AS day, count(*)::int AS n
     FROM registrations t
     JOIN programs p ON p.id = t.program_id
     WHERE t.status IN ${REAL_REGISTRATION_STATUS_SQL}
       AND ${nzBounds("t.registered_at", regKind, "$1", "$2")}
       AND p.organization_id = ANY($3::int[])${programmeCond}
     GROUP BY 1, 2`,
    params,
  );
  for (const r of regs) add(r.org, r.day, r.n);

  // Gymnastics enrols through its own table and its own Stripe account, and
  // has no programmes, so it only counts when no programme is selected.
  if (!scope.programme) {
    const cugc = await q<{ org: number; day: string; n: number }>(
      `SELECT t.organization_id AS org, ${dateExprFor("paid_at", "timestamptz")}::text AS day, count(*)::int AS n
       FROM cugc_registrations t
       WHERE t.status = 'paid'
         AND ${nzBounds("t.paid_at", "timestamptz", "$1", "$2")}
         AND t.organization_id = ANY($3::int[])
       GROUP BY 1, 2`,
      [scope.previous.from, scope.range.to, scope.orgIds],
    );
    for (const r of cugc) add(r.org, r.day, r.n);
  }
  return out;
}

/** The revenue metric a workspace's own dashboard draws, and the sub-view it lives under. */
function revenueMetricFor(slug: string): { metric: DashboardMetric; view: string | null } | null {
  const own = metricFor(slug, null, "revenue");
  if (own) return { metric: own, view: null };
  // The Cup keeps money only under its 7's view (Team Pay); Youth takes its
  // money outside ClubOS.
  for (const key of Object.keys(DASHBOARD_METRICS)) {
    if (!key.startsWith(`${slug}:`)) continue;
    const view = key.slice(slug.length + 1);
    const m = metricFor(slug, view, "revenue");
    if (m) return { metric: m, view };
  }
  return null;
}

export type RevenueCell = { current: number; previous: number; series: Map<string, number>; label: string };

/**
 * Revenue per workspace in scope. `null` = this workspace's money is not
 * recorded in ClubOS — which is not the same as earning nothing.
 */
export async function revenueByWorkspace(scope: HubScope): Promise<Map<string, RevenueCell | null>> {
  const { bySlug } = await orgs();
  const out = new Map<string, RevenueCell | null>();
  const workspaces = HUB_WORKSPACES.filter((w) => !scope.filter.workspace || w.slug === scope.filter.workspace);

  await Promise.all(
    workspaces.map(async (w) => {
      const org = bySlug.get(w.slug);
      const found = revenueMetricFor(w.slug);
      if (!org || !found) {
        out.set(w.slug, null);
        return;
      }
      if (scope.programme) {
        out.set(w.slug, await programmeRevenue(scope, found.metric));
        return;
      }
      const res = await metricSeries(w.slug, org.id, "revenue", "custom", {
        from: scope.range.from,
        to: scope.range.to,
        view: found.view,
      });
      if (!res.source) {
        out.set(w.slug, null);
        return;
      }
      out.set(w.slug, {
        current: res.total,
        previous: res.previous,
        series: new Map(res.series.map((p) => [p.date, p.value])),
        label: found.view ? `${res.source.label} (${found.view} only)` : res.source.label,
      });
    }),
  );
  return out;
}

/**
 * Revenue for one programme: the workspace's own registrations rule (table,
 * statuses, money and date columns) with the programme added — so it can never
 * disagree with the workspace total it is a slice of.
 */
async function programmeRevenue(scope: HubScope, metric: DashboardMetric): Promise<RevenueCell | null> {
  const part = metric.parts.find((p) => p.table === "registrations");
  if (!part || !scope.programme || !part.amountColumn) return null;
  const kind = await dateKind("registrations", part.dateColumn);
  const statuses = part.statuses;
  const rows = await q<{ day: string; cents: number }>(
    `SELECT ${dateExprFor(part.dateColumn, kind)}::text AS day, COALESCE(SUM(t.${part.amountColumn}), 0)::float8 AS cents
     FROM registrations t
     WHERE t.program_id = $3
       AND ${nzBounds(`t.${part.dateColumn}`, kind, "$1", "$2")}
       ${statuses.length ? `AND t.${part.statusColumn ?? "status"} = ANY($4::text[])` : ""}
     GROUP BY 1`,
    statuses.length
      ? [scope.previous.from, scope.range.to, scope.programme.id, statuses]
      : [scope.previous.from, scope.range.to, scope.programme.id],
  );
  const cell: RevenueCell = { current: 0, previous: 0, series: new Map(), label: `${metric.label} — ${scope.programme.name}` };
  for (const r of rows) {
    const half = periodOf(r.day, scope);
    if (!half) continue;
    const cents = Math.round(Number(r.cents));
    cell[half] += cents;
    if (half === "current") cell.series.set(r.day, cents);
  }
  return cell;
}

export { hubSlugForOrg };

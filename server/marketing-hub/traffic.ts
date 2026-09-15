/**
 * Website visitors, from ClubOS's own tracker (/t.js → analytics_events).
 *
 * First-party and counted the same way on every site, which Google Analytics is
 * not: GA only exists on two of the group's sites, and the two tools define a
 * "visit" differently, so the page shows them side by side and never adds them.
 *
 * 🔴 Distinct visitors cannot be summed. A person on cufc.co.nz and
 * join.cufc.co.nz in the same week is one visitor to Christchurch United, so
 * every total here is a COUNT(DISTINCT) over the right set of hosts, never the
 * sum of smaller counts.
 */
import { eachDay } from "@shared/dashboard";
import {
  SITES,
  STAFF_HOST_PATTERN_SOURCES,
  channelLabel,
  hubWorkspace,
  type WebsitesResponse,
} from "@shared/marketing-hub";
import { nzBounds, qSorted, type HubScope } from "./common";

// Host from the page's own URL, lower-cased, with port, trailing dot and "www."
// removed — the same normalisation as normaliseHost() in shared/marketing-hub.ts.
const HOST = `lower(regexp_replace(regexp_replace(regexp_replace(substring(t.landing_url from '^https?://([^/?#]+)'), ':[0-9]+$', ''), '[.]$', ''), '^www[.]', ''))`;
const DAY = `(t."timestamp" AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific/Auckland')::date`;

/**
 * Page views across the current AND previous period in one pass, each tagged
 * with its period and workspace. Staff and build hosts are removed here, using
 * the patterns from shared/marketing-hub.ts. A customer host that is not listed
 * in SITES keeps a NULL workspace: it still counts towards the whole
 * organisation, and is dropped only when a single workspace is chosen.
 */
//
// 🔴 Two shapes, both MATERIALIZED so the host expression (three regexes) runs
// once per row instead of once per reference. The visitor-count shape also
// drops duplicate page views of the same visitor on the same site and day
// BEFORE counting — the counts are identical and the sort is a fraction of the
// size. Measured on production: 30 days went from 5.1s to 0.8s, with the
// totals checked equal to the digit.
function scopedCte(mode: "visitors" | "detail"): string {
  const columns =
    mode === "visitors"
      ? `DISTINCT ${HOST} AS host, t.visitor_id, ${DAY} AS day`
      : `${HOST} AS host, t.visitor_id, t.session_id, t.channel,
             split_part(COALESCE(t.page, ''), '?', 1) AS path, ${DAY} AS day`;
  return `
    WITH pv AS MATERIALIZED (
      SELECT ${columns}
      FROM analytics_events t
      WHERE t.event_type = 'page_view'
        AND COALESCE(t.is_bot, false) = false
        AND ${nzBounds('t."timestamp"', "timestamp", "$1", "$2")}
    ),
    scoped AS MATERIALIZED (
      SELECT pv.*,
             m.ws,
             CASE WHEN pv.day >= $3::date THEN 'current' ELSE 'previous' END AS period
      FROM pv
      LEFT JOIN unnest($4::text[], $5::text[]) AS m(host, ws) ON m.host = pv.host
      WHERE pv.host IS NOT NULL AND pv.host <> ''
        AND NOT (pv.host ~ ANY($6::text[]))
        AND ($7::text IS NULL OR m.ws = $7::text)
    )`;
}

function params(scope: HubScope): unknown[] {
  const hosts = Object.keys(SITES);
  return [
    scope.previous.from,
    scope.range.to,
    scope.range.from,
    hosts,
    hosts.map((h) => SITES[h].workspace),
    STAFF_HOST_PATTERN_SOURCES,
    scope.filter.workspace,
  ];
}

export type TrafficOverview = {
  current: number;
  previous: number;
  byWorkspace: Map<string, number>;
  series: Map<string, number>;
  /** Listed sites in scope with no page view in either period. */
  untracked: string[];
};

export async function trafficOverview(scope: HubScope): Promise<TrafficOverview> {
  const rows = await qSorted<{
    period: string;
    ws: string | null;
    host: string | null;
    day: string | null;
    visitors: number;
    g_ws: number;
    g_host: number;
    g_day: number;
  }>(
    `${scopedCte("visitors")}
     SELECT period, ws, host, day::text AS day,
            count(DISTINCT visitor_id)::int AS visitors,
            GROUPING(ws)::int AS g_ws, GROUPING(host)::int AS g_host, GROUPING(day)::int AS g_day
     FROM scoped
     GROUP BY GROUPING SETS ((period), (period, ws), (period, day), (host))`,
    params(scope),
  );

  const out: TrafficOverview = { current: 0, previous: 0, byWorkspace: new Map(), series: new Map(), untracked: [] };
  const seenHosts = new Set<string>();
  for (const r of rows) {
    if (r.g_host === 0) {
      if (r.host) seenHosts.add(r.host);
    } else if (r.g_ws === 1 && r.g_day === 1) {
      if (r.period === "current") out.current = r.visitors;
      else out.previous = r.visitors;
    } else if (r.g_ws === 0 && r.period === "current") {
      if (r.ws) out.byWorkspace.set(r.ws, r.visitors);
    } else if (r.g_day === 0 && r.period === "current" && r.day) {
      out.series.set(r.day, r.visitors);
    }
  }
  out.untracked = Object.entries(SITES)
    .filter(([host, s]) => s.kind === "site" && !seenHosts.has(host))
    .filter(([, s]) => !scope.filter.workspace || s.workspace === scope.filter.workspace)
    .map(([host]) => host);
  return out;
}

export async function trafficDetail(scope: HubScope): Promise<WebsitesResponse["firstParty"]> {
  const p = params(scope);
  const [grouped, pages] = await Promise.all([
    qSorted<{
      period: string;
      host: string | null;
      channel: string | null;
      day: string | null;
      visitors: number;
      views: number;
      sessions: number;
      g_host: number;
      g_channel: number;
      g_day: number;
    }>(
      `${scopedCte("detail")}
       SELECT period, host, channel, day::text AS day,
              count(DISTINCT visitor_id)::int AS visitors,
              count(*)::int AS views,
              count(DISTINCT session_id)::int AS sessions,
              GROUPING(host)::int AS g_host, GROUPING(channel)::int AS g_channel, GROUPING(day)::int AS g_day
       FROM scoped
       GROUP BY GROUPING SETS ((period, host), (period, channel), (period, day))`,
      p,
    ),
    qSorted<{ host: string; path: string; views: number }>(
      `${scopedCte("detail")}
       SELECT host, path, count(*)::int AS views
       FROM scoped
       WHERE period = 'current'
       GROUP BY 1, 2
       ORDER BY 3 DESC
       LIMIT 15`,
      p,
    ),
  ]);

  const sites = new Map<string, { visitors: number; visitorsPrevious: number; pageViews: number; sessions: number }>();
  const channels = new Map<string, number>();
  const days = new Map<string, { visitors: number; pageViews: number }>();
  for (const r of grouped) {
    if (r.g_host === 0 && r.host) {
      const s = sites.get(r.host) ?? { visitors: 0, visitorsPrevious: 0, pageViews: 0, sessions: 0 };
      if (r.period === "current") {
        s.visitors = r.visitors;
        s.pageViews = r.views;
        s.sessions = r.sessions;
      } else {
        s.visitorsPrevious = r.visitors;
      }
      sites.set(r.host, s);
    } else if (r.g_channel === 0 && r.period === "current") {
      channels.set(r.channel ?? "", r.visitors);
    } else if (r.g_day === 0 && r.period === "current" && r.day) {
      days.set(r.day, { visitors: r.visitors, pageViews: r.views });
    }
  }

  const siteRows = Array.from(sites.entries())
    .map(([host, s]) => {
      const def = SITES[host];
      return {
        host,
        label: def?.label ?? host,
        workspace: def?.workspace ?? null,
        kind: def?.kind ?? ("other" as const),
        ...s,
      };
    })
    .sort((a, b) => b.visitors - a.visitors || b.visitorsPrevious - a.visitorsPrevious);

  const untrackedSites = Object.entries(SITES)
    .filter(([host, s]) => s.kind === "site" && !sites.has(host))
    .filter(([, s]) => !scope.filter.workspace || s.workspace === scope.filter.workspace)
    .map(([host, s]) => ({ host, label: s.label, workspace: s.workspace }))
    .filter((s) => hubWorkspace(s.workspace));

  return {
    status: grouped.length ? "ok" : "no_data",
    sites: siteRows,
    channels: Array.from(channels.entries())
      .map(([channel, visitors]) => ({ channel: channel || "unclassified", label: channelLabel(channel || null), visitors }))
      .sort((a, b) => b.visitors - a.visitors),
    topPages: pages.map((r) => ({ host: r.host, path: r.path || "/", views: r.views })),
    series: eachDay(scope.range).map((date) => ({
      date,
      visitors: days.get(date)?.visitors ?? 0,
      pageViews: days.get(date)?.pageViews ?? 0,
    })),
    untrackedSites,
  };
}

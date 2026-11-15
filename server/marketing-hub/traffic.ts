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
import { type HubScope } from "./common";
import { slimPageViews, type PvRow } from "./web-slim";

export { DAY, HOST } from "./web-slim";

// 🔴 Rewritten 2026-11-11. This used to count distinct visitors in Postgres
// straight off analytics_events (17–28 s on a cold cache; 10 s even from the
// narrow copy, because GROUPING SETS over count(DISTINCT) sorts the rows once
// per grouping). Now the rows are read once from web_events_slim and counted
// here. Checked against the old queries on production: identical to the digit.

const STAFF = STAFF_HOST_PATTERN_SOURCES.map((src) => new RegExp(src));

/**
 * Page views across the current AND previous period, each tagged with its
 * period. Staff and build hosts are removed. A customer host that is not listed
 * in SITES has no workspace: it still counts towards the whole organisation,
 * and is dropped only when a single workspace is chosen.
 */
async function scopedRows(scope: HubScope): Promise<{ r: PvRow; host: string; ws: string | null; current: boolean }[]> {
  const rows = await slimPageViews(scope.previous.from, scope.range.to);
  const want = scope.filter.workspace;
  const out: { r: PvRow; host: string; ws: string | null; current: boolean }[] = [];
  for (const r of rows) {
    const host = r.host;
    if (!host || STAFF.some((re) => re.test(host))) continue;
    const ws = SITES[host]?.workspace ?? null;
    if (want && ws !== want) continue;
    out.push({ r, host, ws, current: r.day >= scope.range.from });
  }
  return out;
}

const add = (map: Map<string, Set<string>>, key: string, v: string | null) => {
  if (!v) return;
  const s = map.get(key);
  if (s) s.add(v);
  else map.set(key, new Set([v]));
};

export type TrafficOverview = {
  current: number;
  previous: number;
  byWorkspace: Map<string, number>;
  series: Map<string, number>;
  /** Listed sites in scope with no page view in either period. */
  untracked: string[];
};

export async function trafficOverview(scope: HubScope): Promise<TrafficOverview> {
  const rows = await scopedRows(scope);
  const cur = new Set<string>();
  const prev = new Set<string>();
  const byWs = new Map<string, Set<string>>();
  const byDay = new Map<string, Set<string>>();
  const seenHosts = new Set<string>();
  for (const { r, host, ws, current } of rows) {
    seenHosts.add(host);
    if (!r.visitor_id) continue;
    if (!current) {
      prev.add(r.visitor_id);
      continue;
    }
    cur.add(r.visitor_id);
    if (ws) add(byWs, ws, r.visitor_id);
    add(byDay, r.day, r.visitor_id);
  }
  const out: TrafficOverview = {
    current: cur.size,
    previous: prev.size,
    byWorkspace: new Map(Array.from(byWs, ([k, v]) => [k, v.size])),
    series: new Map(Array.from(byDay, ([k, v]) => [k, v.size])),
    untracked: [],
  };
  out.untracked = Object.entries(SITES)
    .filter(([host, s]) => s.kind === "site" && !seenHosts.has(host))
    .filter(([, s]) => !scope.filter.workspace || s.workspace === scope.filter.workspace)
    .map(([host]) => host);
  return out;
}

export async function trafficDetail(scope: HubScope): Promise<WebsitesResponse["firstParty"]> {
  const rows = await scopedRows(scope);
  type SiteTally = { v: Set<string>; pv: Set<string>; s: Set<string>; views: number };
  const siteTally = new Map<string, SiteTally>();
  const channelSets = new Map<string, Set<string>>();
  const daySets = new Map<string, Set<string>>();
  const dayViews = new Map<string, number>();
  const pageViews = new Map<string, number>();
  for (const { r, host, current } of rows) {
    let t = siteTally.get(host);
    if (!t) siteTally.set(host, (t = { v: new Set(), pv: new Set(), s: new Set(), views: 0 }));
    if (!current) {
      if (r.visitor_id) t.pv.add(r.visitor_id);
      continue;
    }
    t.views++;
    if (r.visitor_id) t.v.add(r.visitor_id);
    if (r.session_id) t.s.add(r.session_id);
    const ch = r.channel ?? "";
    if (!channelSets.has(ch)) channelSets.set(ch, new Set());
    if (r.visitor_id) channelSets.get(ch)!.add(r.visitor_id);
    if (!daySets.has(r.day)) daySets.set(r.day, new Set());
    if (r.visitor_id) daySets.get(r.day)!.add(r.visitor_id);
    dayViews.set(r.day, (dayViews.get(r.day) ?? 0) + 1);
    const pk = `${host}|${r.path ?? ""}`;
    pageViews.set(pk, (pageViews.get(pk) ?? 0) + 1);
  }

  const sites = new Map<string, { visitors: number; visitorsPrevious: number; pageViews: number; sessions: number }>();
  siteTally.forEach((t, host) => sites.set(host, { visitors: t.v.size, visitorsPrevious: t.pv.size, pageViews: t.views, sessions: t.s.size }));
  const channels = new Map<string, number>(Array.from(channelSets, ([k, v]) => [k, v.size]));
  const days = new Map<string, { visitors: number; pageViews: number }>(
    Array.from(daySets, ([k, v]) => [k, { visitors: v.size, pageViews: dayViews.get(k) ?? 0 }]),
  );
  const grouped = rows;
  const pages = Array.from(pageViews, ([key, views]) => {
    const i = key.indexOf("|");
    return { host: key.slice(0, i), path: key.slice(i + 1), views };
  })
    .sort((a, b) => b.views - a.views)
    .slice(0, 15);

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

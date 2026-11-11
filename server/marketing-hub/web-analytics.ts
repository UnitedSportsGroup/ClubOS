/**
 * Website analytics — one website (or all of them) in depth, from ClubOS's own
 * tracker. United Sports Group → Marketing → Website analytics.
 *
 * Route: requireAuth → requireTab("web-analytics") → group workspace only.
 *
 * 🔴 Distinct visitors are never summed: every total is a COUNT(DISTINCT) over
 *    the hosts in scope (see traffic.ts).
 * 🔴 Only a page_view row knows which website it was on (landing_url). Time on
 *    page, scroll depth, bounces and button clicks carry a session and a path
 *    but no host, so they are matched to a page view of the SAME session on the
 *    SAME path — an event that matches none is left out rather than guessed.
 * 🔴 A behaviour number with nothing recorded is null ("—"), never zero.
 */
import type { Express, Request, Response } from "express";
import { eachDay } from "@shared/dashboard";
import { SITES, STAFF_HOST_PATTERN_SOURCES, channelLabel, hubWorkspace, normaliseHost } from "@shared/marketing-hub";
import { WEB_ANALYTICS_TAB, type WebAnalyticsResponse, type WebCount } from "@shared/web-analytics";
import { requireAuth, requireTab } from "../auth";
import { HubInputError, cached, nzBounds, parseScope, q, requireHubWorkspace, str, type HubScope } from "./common";
import { topUpSlim } from "./web-slim";

// 🔴 Measured 2026-11-10: counting distinct visitors seven ways in Postgres took
// 30–50 seconds for a month (three heavy sorts at once on a small database).
// So the database only READS the rows — two plain index scans — and the
// counting is done here, where sixty thousand rows is nothing.

type PvRow = {
  host: string | null;
  visitor_id: string | null;
  session_id: string | null;
  channel: string | null;
  path: string | null;
  day: string;
  device: string | null;
  ref: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
};
type EvRow = { event_type: string; session_id: string | null; path: string | null; s: string | null; m: string | null; n: string | null; txt: string | null; href: string | null };

const rawCache = new Map<string, { at: number; p: Promise<unknown[]> }>();
/** The raw rows for a date range, kept ten minutes: reading a month takes ~15s, changing website should take none. */
function raw<T>(key: string, fn: () => Promise<T[]>): Promise<T[]> {
  const hit = rawCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p as Promise<T[]>;
  const p = fn();
  rawCache.set(key, { at: Date.now(), p });
  p.then((rows) => {
    // A year of rows is not worth holding in memory on two machines.
    if (rows.length > 120_000) rawCache.delete(key);
  }).catch(() => rawCache.delete(key));
  if (rawCache.size > 6) rawCache.delete(rawCache.keys().next().value as string);
  return p;
}

// 🔴 Measured 2026-11-11: analytics_events is 400 MB with page views scattered
// through it; a month of visits meant ~500 MB of pages and 6–50 seconds when
// they were not in memory. The report reads web_events_slim instead: a narrow,
// time-ordered copy with the website name already worked out (web-slim.ts).
const pageViews = (from: string, to: string) =>
  raw<PvRow>(`pv|${from}|${to}`, () =>
    q<PvRow>(
      `SELECT t.host, t.visitor_id, t.session_id, t.channel, t.path, t.day::text AS day, t.device, t.ref_host AS ref,
              t.utm_source, t.utm_medium, t.utm_campaign
       FROM web_events_slim t
       WHERE t.kind = 'page_view' AND ${nzBounds("t.ts", "timestamp", "$1", "$2")}`,
      [from, to],
    ),
  );

const behaviourEvents = (from: string, to: string) =>
  raw<EvRow>(`ev|${from}|${to}`, () =>
    q<EvRow>(
      `SELECT t.kind AS event_type, t.session_id, t.path, t.s, t.m, t.n, t.txt, t.href
       FROM web_events_slim t
       WHERE t.kind <> 'page_view' AND ${nzBounds("t.ts", "timestamp", "$1", "$2")}`,
      [from, to],
    ),
  );

const STAFF_HOSTS = STAFF_HOST_PATTERN_SOURCES.map((src) => new RegExp(src));
const isStaffHost = (h: string) => STAFF_HOSTS.some((re) => re.test(h));
const OWN_HOSTS = Object.keys(SITES);
/**
 * One of the club's own sites, listed or not. dinner.southislandunited.com and
 * packages.cicyouth.com are not in SITES, and a visitor arriving from them has
 * not been "referred" by another website (found by the live check, 2026-11-10).
 */
const isOwnHost = (h: string) => OWN_HOSTS.some((own) => h === own || h.endsWith(`.${own}`));

class Tally {
  visitors = new Set<string>();
  sessions = new Set<string>();
  views = 0;
  add(r: PvRow) {
    this.views++;
    if (r.visitor_id) this.visitors.add(r.visitor_id);
    if (r.session_id) this.sessions.add(r.session_id);
  }
  count(): WebCount {
    return { visitors: this.visitors.size, pageViews: this.views, sessions: this.sessions.size };
  }
}
function tally<K>(map: Map<K, Tally>, key: K, r: PvRow) {
  let t = map.get(key);
  if (!t) map.set(key, (t = new Tally()));
  t.add(r);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = values.slice().sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
const mean = (values: number[]): number | null => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const numeric = (v: string | null): number | null => (v != null && /^[0-9]+([.][0-9]+)?$/.test(v) ? Number(v) : null);

export async function webAnalytics(scope: HubScope, site: string | null): Promise<WebAnalyticsResponse> {
  const ws = scope.filter.workspace;
  await topUpSlim();
  const [pvAll, evAll, live] = await Promise.all([
    pageViews(scope.previous.from, scope.range.to),
    behaviourEvents(scope.range.from, scope.range.to),
    q<{ host: string | null; visitor_id: string | null }>(
      `SELECT DISTINCT t.host, t.visitor_id
       FROM web_events_slim t
       WHERE t.kind = 'page_view' AND t.ts > (now() AT TIME ZONE 'UTC') - interval '30 minutes'`,
    ),
  ]);

  // Staff and build hosts never count. A customer host that is not listed in
  // SITES still counts toward "all websites", and drops out only when one
  // workspace is chosen.
  const inScope = (host: string | null): host is string => {
    if (!host || isStaffHost(host)) return false;
    if (site && host !== site) return false;
    if (ws && SITES[host]?.workspace !== ws) return false;
    return true;
  };

  const totals = new Tally();
  const previous = new Tally();
  const days = new Map<string, Tally>();
  const sites = new Map<string, { cur: Tally; prev: Tally }>();
  const channels = new Map<string, Tally>();
  const devices = new Map<string, Tally>();
  const refs = new Map<string, Tally>();
  const utms = new Map<string, Tally>();
  const pageTally = new Map<string, Tally>();
  /** session|path → host, for matching behaviour events to a website. */
  const sessionPage = new Map<string, string>();

  for (const r of pvAll) {
    if (!inScope(r.host)) continue;
    const cur = r.day >= scope.range.from;
    let s = sites.get(r.host);
    if (!s) sites.set(r.host, (s = { cur: new Tally(), prev: new Tally() }));
    if (!cur) {
      previous.add(r);
      s.prev.add(r);
      continue;
    }
    totals.add(r);
    s.cur.add(r);
    tally(days, r.day, r);
    tally(channels, r.channel || "", r);
    tally(devices, r.device || "not recorded", r);
    if (r.ref && !isOwnHost(normaliseHost(r.ref)) && !isStaffHost(r.ref)) tally(refs, r.ref, r);
    if (r.utm_source) tally(utms, JSON.stringify([r.utm_source, r.utm_medium, r.utm_campaign]), r);
    const path = r.path || "/";
    tally(pageTally, `${r.host}|${path}`, r);
    if (r.session_id) sessionPage.set(`${r.session_id}|${path}`, r.host);
  }

  let bounces = 0;
  let started = 0;
  let newStarts = 0;
  const allSeconds: number[] = [];
  const allScroll: number[] = [];
  const pageSeconds = new Map<string, number[]>();
  const pageScroll = new Map<string, number[]>();
  const entries = new Map<string, number>();
  const buttons = new Map<string, { clicks: number; href: string | null }>();
  const push = (map: Map<string, number[]>, key: string, v: number) => {
    const a = map.get(key);
    if (a) a.push(v);
    else map.set(key, [v]);
  };
  for (const e of evAll) {
    if (!e.session_id) continue;
    const path = e.path || "/";
    const host = sessionPage.get(`${e.session_id}|${path}`);
    if (!host) continue; // no page view of this session on this path in scope
    const key = `${host}|${path}`;
    if (e.event_type === "bounce") bounces++;
    else if (e.event_type === "session_start") {
      started++;
      if (e.n === "true") newStarts++;
      entries.set(key, (entries.get(key) ?? 0) + 1);
    } else if (e.event_type === "time_on_page") {
      const v = numeric(e.s);
      if (v != null) {
        allSeconds.push(v);
        push(pageSeconds, key, v);
      }
    } else if (e.event_type === "scroll_depth") {
      const v = numeric(e.m);
      if (v != null) {
        allScroll.push(Math.min(v, 100));
        push(pageScroll, key, Math.min(v, 100));
      }
    } else if (e.event_type === "cta_click" && e.txt) {
      const b = buttons.get(e.txt) ?? { clicks: 0, href: e.href };
      b.clicks++;
      buttons.set(e.txt, b);
    }
  }

  const liveVisitors = new Set<string>();
  for (const r of live) if (inScope(r.host) && r.visitor_id) liveVisitors.add(r.visitor_id);

  const split = (key: string) => {
    const i = key.indexOf("|");
    return { host: key.slice(0, i), path: key.slice(i + 1) };
  };
  const top = <T extends { visitors: number }>(rows: T[], n: number) => rows.sort((a, b) => b.visitors - a.visitors).slice(0, n);

  const siteRows = Array.from(sites.entries())
    .map(([host, s]) => ({
      host,
      label: SITES[host]?.label ?? host,
      workspace: SITES[host]?.workspace ?? null,
      kind: SITES[host]?.kind ?? "other",
      visitors: s.cur.visitors.size,
      visitorsPrevious: s.prev.visitors.size,
      pageViews: s.cur.views,
      sessions: s.cur.sessions.size,
    }))
    .sort((a, b) => b.visitors - a.visitors || b.visitorsPrevious - a.visitorsPrevious);

  return {
    range: scope.range,
    previousRange: scope.previous,
    site,
    workspace: ws,
    status: totals.views || previous.views ? "ok" : "no_data",
    totals: totals.count(),
    previous: previous.count(),
    liveNow: liveVisitors.size,
    behaviour: {
      bounces: started ? bounces : null,
      sessionsStarted: started || null,
      newVisitorSessions: started ? newStarts : null,
      medianSeconds: median(allSeconds),
      avgScrollPercent: mean(allScroll),
    },
    series: eachDay(scope.range).map((date) => ({ date, visitors: days.get(date)?.visitors.size ?? 0, pageViews: days.get(date)?.views ?? 0 })),
    sites: siteRows,
    untrackedSites: Object.entries(SITES)
      .filter(([host, s]) => s.kind === "site" && !sites.has(host))
      .filter(([host, s]) => (!ws || s.workspace === ws) && (!site || host === site))
      .filter(([, s]) => hubWorkspace(s.workspace))
      .map(([host, s]) => ({ host, workspace: s.workspace })),
    pages: Array.from(pageTally.entries())
      .sort((a, b) => b[1].views - a[1].views)
      .slice(0, 50)
      .map(([key, t]) => ({
        ...split(key),
        views: t.views,
        visitors: t.visitors.size,
        medianSeconds: median(pageSeconds.get(key) ?? []),
        avgScrollPercent: mean(pageScroll.get(key) ?? []),
      })),
    entryPages: Array.from(entries.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([key, sessions]) => ({ ...split(key), sessions })),
    channels: top(
      Array.from(channels.entries()).map(([key, t]) => ({ key: key || "unclassified", label: channelLabel(key || null), visitors: t.visitors.size, sessions: t.sessions.size })),
      30,
    ),
    referrers: top(Array.from(refs.entries()).map(([host, t]) => ({ host, visitors: t.visitors.size, sessions: t.sessions.size })), 20),
    campaigns: top(
      Array.from(utms.entries()).map(([key, t]) => {
        const [source, medium, campaign] = JSON.parse(key) as [string, string | null, string | null];
        return { source, medium, campaign, visitors: t.visitors.size, sessions: t.sessions.size };
      }),
      25,
    ),
    devices: top(Array.from(devices.entries()).map(([key, t]) => ({ key, visitors: t.visitors.size })), 6),
    buttons: Array.from(buttons.entries())
      .sort((a, b) => b[1].clicks - a[1].clicks)
      .slice(0, 20)
      .map(([text, b]) => ({ text, href: b.href, clicks: b.clicks })),
  };
}

export function registerWebAnalyticsRoutes(app: Express) {
  app.get(
    "/api/admin/web-analytics/report",
    requireAuth,
    requireTab(WEB_ANALYTICS_TAB),
    requireHubWorkspace,
    async (req: Request, res: Response) => {
      try {
        const scope = await parseScope(req);
        const raw = str(req.query.site);
        const site = raw ? normaliseHost(raw) : null;
        if (site && !/^[a-z0-9.-]{3,120}$/.test(site)) throw new HubInputError("Unknown website.");
        if (site && scope.filter.workspace && SITES[site] && SITES[site].workspace !== scope.filter.workspace) {
          throw new HubInputError("That website is not in this workspace.");
        }
        const key = `web-analytics|${scope.range.from}|${scope.range.to}|${scope.filter.workspace ?? ""}|${site ?? ""}`;
        res.json(await cached(key, 5 * 60_000, () => webAnalytics(scope, site)));
      } catch (e: any) {
        if (e instanceof HubInputError) return res.status(400).json({ message: e.message });
        console.error("[WebAnalytics]", e?.message ?? e);
        res.status(500).json({ message: "Website analytics could not be loaded. Try again." });
      }
    },
  );
}

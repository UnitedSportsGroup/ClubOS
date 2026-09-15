/**
 * Reads of what the sync pulled from other platforms (marketing_daily).
 * Every total, ratio and change is derived here, on read — none is stored.
 */
import { eachDay } from "@shared/dashboard";
import {
  PLATFORMS,
  hubWorkspace,
  workspaceForCampaign,
  type AdsResponse,
  type OrganicResponse,
  type PlatformKey,
  type WebsitesResponse,
} from "@shared/marketing-hub";
import { hubSlugForOrg, periodOf, q, type HubScope } from "./common";

export type SourceRow = {
  id: number;
  platform: PlatformKey;
  label: string;
  external_id: string;
  organization_id: number | null;
  site: string | null;
};

const AD_PLATFORMS: PlatformKey[] = PLATFORMS.filter((p) => p.group === "ads").map((p) => p.key);

export async function activeSources(platforms: PlatformKey[]): Promise<SourceRow[]> {
  return q<SourceRow>(
    `SELECT id, platform, label, external_id, organization_id, site
     FROM marketing_sources
     WHERE active AND platform = ANY($1::text[])
     ORDER BY platform, id`,
    [platforms],
  );
}

/** Sources whose own workspace is in scope. An account with no workspace only
 *  appears when the whole organisation is being looked at. */
function inScope(sources: SourceRow[], scope: HubScope): SourceRow[] {
  return sources.filter((s) =>
    s.organization_id == null ? scope.filter.workspace == null : scope.orgIds.includes(s.organization_id),
  );
}

export type RunState = {
  status: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  lastOkAt: string | null;
};

export async function lastRuns(): Promise<Map<number, RunState>> {
  const [latest, oks] = await Promise.all([
    q<{ source_id: number; status: string; error: string | null; started_at: Date; finished_at: Date | null }>(
      `SELECT DISTINCT ON (source_id) source_id, status, error, started_at, finished_at
       FROM marketing_sync_runs
       WHERE source_id IS NOT NULL
       ORDER BY source_id, started_at DESC`,
    ),
    q<{ source_id: number; last_ok: Date }>(
      `SELECT source_id, max(finished_at) AS last_ok
       FROM marketing_sync_runs
       WHERE status = 'ok' AND source_id IS NOT NULL
       GROUP BY 1`,
    ),
  ]);
  const okBy = new Map(oks.map((r) => [r.source_id, r.last_ok]));
  const out = new Map<number, RunState>();
  for (const r of latest) {
    out.set(r.source_id, {
      status: r.status,
      error: r.error,
      startedAt: new Date(r.started_at).toISOString(),
      finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
      lastOkAt: okBy.get(r.source_id) ? new Date(okBy.get(r.source_id)!).toISOString() : null,
    });
  }
  return out;
}

/** A platform counts as connected once one of its sources has pulled successfully. */
export async function everPulled(platforms: PlatformKey[]): Promise<boolean> {
  const rows = await q(
    `SELECT 1 FROM marketing_sync_runs WHERE platform = ANY($1::text[]) AND status = 'ok' LIMIT 1`,
    [platforms],
  );
  return rows.length > 0;
}

// ── Ads ─────────────────────────────────────────────────────────────────────

type CampaignAgg = AdsResponse["campaigns"][number];

export type AdsData = Omit<AdsResponse, "range" | "previousRange" | "filter" | "platforms" | "notSplitByProgramme"> & {
  spendByDay: Map<string, number>;
  spendByWorkspace: Map<string | null, number>;
};

export async function adsData(scope: HubScope): Promise<AdsData> {
  const sources = await activeSources(AD_PLATFORMS);
  const ids = sources.map((s) => s.id);
  const byId = new Map(sources.map((s) => [s.id, s]));
  const empty = { current: 0, previous: 0 };
  const totals: AdsResponse["totals"] = {
    spendCents: { ...empty },
    impressions: { ...empty },
    linkClicks: { ...empty },
    landingPageViews: { ...empty },
    leads: { ...empty },
    purchases: { ...empty },
  };
  const out: AdsData = {
    totals,
    campaigns: [],
    byWorkspace: [],
    series: [],
    spendByDay: new Map(),
    spendByWorkspace: new Map(),
  };
  if (!ids.length) {
    out.series = eachDay(scope.range).map((date) => ({ date, spendCents: 0 }));
    return out;
  }

  const [rows, names] = await Promise.all([
    q<{ source_id: number; campaign_id: string; day: string; metric: string; value: number }>(
      `SELECT d.source_id, d.dim_key AS campaign_id, d.day::text AS day, d.metric, d.value::float8 AS value
       FROM marketing_daily d
       WHERE d.source_id = ANY($1::int[]) AND d.dim_type = 'campaign'
         AND d.day BETWEEN $2::date AND $3::date`,
      [ids, scope.previous.from, scope.range.to],
    ),
    // The latest name each campaign was known by — campaigns get renamed.
    q<{ source_id: number; campaign_id: string; name: string }>(
      `SELECT DISTINCT ON (d.source_id, d.dim_key) d.source_id, d.dim_key AS campaign_id, d.dim_label AS name
       FROM marketing_daily d
       WHERE d.source_id = ANY($1::int[]) AND d.dim_type = 'campaign' AND d.dim_label IS NOT NULL
       ORDER BY d.source_id, d.dim_key, d.day DESC`,
      [ids],
    ),
  ]);
  const nameOf = new Map(names.map((n) => [`${n.source_id}|${n.campaign_id}`, n.name]));
  const accountWs = new Map<number, string | null>();
  for (const s of sources) accountWs.set(s.id, await hubSlugForOrg(s.organization_id));

  const campaigns = new Map<string, CampaignAgg>();
  const metricToTotal: Record<string, keyof AdsResponse["totals"]> = {
    spend_cents: "spendCents",
    impressions: "impressions",
    link_clicks: "linkClicks",
    landing_page_views: "landingPageViews",
    leads: "leads",
    purchases: "purchases",
  };

  for (const r of rows) {
    const key = `${r.source_id}|${r.campaign_id}`;
    const src = byId.get(r.source_id)!;
    const name = nameOf.get(key) ?? r.campaign_id;
    const { workspace, basis } = workspaceForCampaign(name, accountWs.get(r.source_id) ?? null);
    if (scope.filter.workspace && workspace !== scope.filter.workspace) continue;
    const half = periodOf(r.day, scope);
    if (!half) continue;
    const value = Math.round(Number(r.value));
    const totalKey = metricToTotal[r.metric];
    if (totalKey) totals[totalKey][half] += value;
    if (half !== "current") continue;

    const c =
      campaigns.get(key) ??
      ({
        sourceId: r.source_id,
        account: src.label,
        platform: src.platform,
        campaignId: r.campaign_id,
        name,
        workspace,
        basis,
        spendCents: 0,
        impressions: 0,
        linkClicks: 0,
        leads: 0,
        purchases: 0,
        firstDay: r.day,
        lastDay: r.day,
      } as CampaignAgg);
    if (r.metric === "spend_cents") {
      c.spendCents += value;
      out.spendByDay.set(r.day, (out.spendByDay.get(r.day) ?? 0) + value);
      out.spendByWorkspace.set(workspace, (out.spendByWorkspace.get(workspace) ?? 0) + value);
    } else if (r.metric === "impressions") c.impressions += value;
    else if (r.metric === "link_clicks") c.linkClicks += value;
    else if (r.metric === "leads") c.leads += value;
    else if (r.metric === "purchases") c.purchases += value;
    if (value > 0) {
      if (r.day < c.firstDay) c.firstDay = r.day;
      if (r.day > c.lastDay) c.lastDay = r.day;
    }
    campaigns.set(key, c);
  }

  out.campaigns = Array.from(campaigns.values())
    .filter((c) => c.spendCents > 0 || c.impressions > 0)
    .sort((a, b) => b.spendCents - a.spendCents);
  const wsAgg = new Map<string | null, { spendCents: number; leads: number; purchases: number }>();
  for (const c of out.campaigns) {
    const cell = wsAgg.get(c.workspace) ?? { spendCents: 0, leads: 0, purchases: 0 };
    cell.spendCents += c.spendCents;
    cell.leads += c.leads;
    cell.purchases += c.purchases;
    wsAgg.set(c.workspace, cell);
  }
  out.byWorkspace = Array.from(wsAgg.entries())
    .map(([workspace, cell]) => ({ workspace, ...cell }))
    .sort((a, b) => b.spendCents - a.spendCents);
  out.series = eachDay(scope.range).map((date) => ({ date, spendCents: out.spendByDay.get(date) ?? 0 }));
  return out;
}

export async function adPlatforms(): Promise<AdsResponse["platforms"]> {
  const [sources, runs] = await Promise.all([activeSources(AD_PLATFORMS), lastRuns()]);
  return PLATFORMS.filter((p) => p.group === "ads").map((p) => {
    const mine = sources.filter((s) => s.platform === p.key);
    const states = mine.map((s) => runs.get(s.id)).filter((x): x is RunState => Boolean(x));
    const lastOk = states.map((s) => s.lastOkAt).filter(Boolean).sort().pop() ?? null;
    const failing = states.find((s) => s.status === "error");
    let status: AdsResponse["platforms"][number]["status"];
    if (!p.built) status = "not_built";
    else if (!mine.length || !states.length) status = "not_connected";
    else if (failing) status = "error";
    else status = lastOk ? "connected" : "not_connected";
    return {
      key: p.key,
      label: p.label,
      status,
      lastSyncAt: lastOk,
      lastError: failing?.error ?? null,
      setup: p.setup ?? null,
    };
  });
}

// ── Google Analytics ────────────────────────────────────────────────────────

export async function ga4Data(scope: HubScope): Promise<WebsitesResponse["ga4"]> {
  const sources = inScope(await activeSources(["ga4"]), scope);
  const connected = await everPulled(["ga4"]);
  if (!sources.length || !connected) {
    return { status: "not_connected", properties: [], channels: [], series: [] };
  }
  const ids = sources.map((s) => s.id);
  const [rows, lastDays] = await Promise.all([
    q<{ source_id: number; dim_type: string; dim_key: string; day: string; metric: string; value: number }>(
      `SELECT source_id, dim_type, dim_key, day::text AS day, metric, value::float8 AS value
       FROM marketing_daily
       WHERE source_id = ANY($1::int[]) AND day BETWEEN $2::date AND $3::date`,
      [ids, scope.previous.from, scope.range.to],
    ),
    q<{ source_id: number; last_day: string }>(
      `SELECT source_id, max(day)::text AS last_day
       FROM marketing_daily
       WHERE source_id = ANY($1::int[]) AND dim_type = 'total' AND metric = 'sessions' AND value > 0
       GROUP BY 1`,
      [ids],
    ),
  ]);
  const lastBy = new Map(lastDays.map((r) => [r.source_id, r.last_day]));
  const props = new Map<number, WebsitesResponse["ga4"]["properties"][number]>();
  for (const s of sources) {
    props.set(s.id, {
      sourceId: s.id,
      label: s.label,
      site: s.site,
      workspace: await hubSlugForOrg(s.organization_id),
      sessions: 0,
      sessionsPrevious: 0,
      engagedSessions: 0,
      pageViews: 0,
      keyEvents: 0,
      lastDay: lastBy.get(s.id) ?? null,
    });
  }
  const channels = new Map<string, number>();
  const days = new Map<string, number>();
  for (const r of rows) {
    const half = periodOf(r.day, scope);
    if (!half) continue;
    const v = Math.round(Number(r.value));
    const p = props.get(r.source_id)!;
    if (r.dim_type === "channel") {
      if (half === "current" && r.metric === "sessions") channels.set(r.dim_key, (channels.get(r.dim_key) ?? 0) + v);
      continue;
    }
    if (r.dim_type !== "total") continue;
    if (r.metric === "sessions") {
      if (half === "previous") p.sessionsPrevious += v;
      else {
        p.sessions += v;
        days.set(r.day, (days.get(r.day) ?? 0) + v);
      }
    }
    if (half !== "current") continue;
    if (r.metric === "engaged_sessions") p.engagedSessions += v;
    else if (r.metric === "page_views") p.pageViews += v;
    else if (r.metric === "key_events") p.keyEvents += v;
  }
  return {
    status: "ok",
    properties: Array.from(props.values()).sort((a, b) => b.sessions - a.sessions),
    channels: Array.from(channels.entries())
      .map(([channel, sessions]) => ({ channel, sessions }))
      .sort((a, b) => b.sessions - a.sessions),
    series: eachDay(scope.range).map((date) => ({ date, sessions: days.get(date) ?? 0 })),
  };
}

// ── Organic social ──────────────────────────────────────────────────────────

export type OrganicData = Omit<OrganicResponse, "range" | "previousRange" | "filter" | "notSplitByProgramme"> & {
  followersNow: number | null;
  followersBefore: number | null;
  followersByWorkspace: Map<string, number>;
};

export async function organicData(scope: HubScope): Promise<OrganicData> {
  const sources = inScope(await activeSources(["facebook_page", "instagram"]), scope);
  const connected = await everPulled(["facebook_page", "instagram"]);
  const none: OrganicData = {
    status: "not_connected",
    accounts: [],
    series: [],
    followersNow: null,
    followersBefore: null,
    followersByWorkspace: new Map(),
  };
  if (!sources.length || !connected) return none;
  const ids = sources.map((s) => s.id);

  const [rows, latest, earliest, before] = await Promise.all([
    q<{ source_id: number; day: string; metric: string; value: number }>(
      `SELECT source_id, day::text AS day, metric, value::float8 AS value
       FROM marketing_daily
       WHERE source_id = ANY($1::int[]) AND dim_type = 'total' AND day BETWEEN $2::date AND $3::date`,
      [ids, scope.range.from, scope.range.to],
    ),
    // Followers is a stock: the latest reading on or before the end of the range.
    q<{ source_id: number; day: string; value: number }>(
      `SELECT DISTINCT ON (source_id) source_id, day::text AS day, value::float8 AS value
       FROM marketing_daily
       WHERE source_id = ANY($1::int[]) AND metric = 'followers' AND day <= $2::date
       ORDER BY source_id, day DESC`,
      [ids, scope.range.to],
    ),
    q<{ source_id: number; day: string; value: number }>(
      `SELECT DISTINCT ON (source_id) source_id, day::text AS day, value::float8 AS value
       FROM marketing_daily
       WHERE source_id = ANY($1::int[]) AND metric = 'followers' AND day BETWEEN $2::date AND $3::date
       ORDER BY source_id, day ASC`,
      [ids, scope.range.from, scope.range.to],
    ),
    q<{ source_id: number; value: number }>(
      `SELECT DISTINCT ON (source_id) source_id, value::float8 AS value
       FROM marketing_daily
       WHERE source_id = ANY($1::int[]) AND metric = 'followers' AND day <= $2::date
       ORDER BY source_id, day DESC`,
      [ids, scope.previous.to],
    ),
  ]);

  const latestBy = new Map(latest.map((r) => [r.source_id, r]));
  const earliestBy = new Map(earliest.map((r) => [r.source_id, r]));
  const accounts = new Map<number, OrganicResponse["accounts"][number] & { reachSum: number; reachDays: number }>();
  for (const s of sources) {
    const last = latestBy.get(s.id);
    const first = earliestBy.get(s.id);
    accounts.set(s.id, {
      sourceId: s.id,
      platform: s.platform as "facebook_page" | "instagram",
      label: s.label,
      workspace: await hubSlugForOrg(s.organization_id),
      followers: last ? Math.round(last.value) : null,
      // Only meaningful once there are two readings inside the range.
      followersAtStart: first && last && first.day < last.day ? Math.round(first.value) : null,
      newFollows: 0,
      views: 0,
      interactions: 0,
      profileViews: 0,
      websiteClicks: 0,
      avgReach: null,
      lastDay: last?.day ?? null,
      reachSum: 0,
      reachDays: 0,
    });
  }
  const followersByDay = new Map<string, number>();
  for (const r of rows) {
    const a = accounts.get(r.source_id);
    if (!a) continue;
    const v = Math.round(Number(r.value));
    if (r.metric === "new_follows") a.newFollows += v;
    else if (r.metric === "views") a.views += v;
    else if (r.metric === "interactions") a.interactions += v;
    else if (r.metric === "profile_views") a.profileViews += v;
    else if (r.metric === "website_clicks") a.websiteClicks += v;
    else if (r.metric === "reach") {
      a.reachSum += v;
      a.reachDays += 1;
    } else if (r.metric === "followers") {
      followersByDay.set(r.day, (followersByDay.get(r.day) ?? 0) + v);
    }
  }

  const list = Array.from(accounts.values()).map(({ reachSum, reachDays, ...a }) => ({
    ...a,
    avgReach: reachDays ? Math.round(reachSum / reachDays) : null,
  }));
  const withFollowers = list.filter((a) => a.followers != null);
  const followersByWorkspace = new Map<string, number>();
  for (const a of withFollowers) {
    if (a.workspace && hubWorkspace(a.workspace)) {
      followersByWorkspace.set(a.workspace, (followersByWorkspace.get(a.workspace) ?? 0) + (a.followers ?? 0));
    }
  }

  return {
    status: withFollowers.length || rows.length ? "ok" : "no_data",
    accounts: list.sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1)),
    series: eachDay(scope.range)
      .filter((d) => followersByDay.has(d))
      .map((date) => ({ date, followers: followersByDay.get(date)! })),
    followersNow: withFollowers.length ? withFollowers.reduce((s, a) => s + (a.followers ?? 0), 0) : null,
    followersBefore: before.length ? before.reduce((s, r) => s + Math.round(r.value), 0) : null,
    followersByWorkspace,
  };
}

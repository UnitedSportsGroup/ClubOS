/**
 * Marketing hub — the endpoints behind United Sports Group → Marketing.
 *
 * Every route: requireAuth → requireTab("marketing-hub") → group workspace
 * only (requireHubWorkspace). Read-only, except POST /sync, which only asks the
 * puller to run early.
 *
 * 🔴 Never 200-with-zeros. A failed read is a 500 the page shows as an error;
 * a source that isn't connected says "not_connected"; a number that can't be
 * split by the chosen programme says "not_split". A zero is only ever a zero.
 */
import type { Express, Request, Response } from "express";
import { eachDay } from "@shared/dashboard";
import {
  HUB_WORKSPACES,
  MARKETING_HUB_TAB,
  PLATFORMS,
  channelLabel,
  hubWorkspace,
  type AdsResponse,
  type Availability,
  type FormsResponse,
  type OrganicResponse,
  type OverviewResponse,
  type PlatformKey,
  type ProgrammesResponse,
  type SourcesResponse,
  type TrackedResponse,
  type WebsitesResponse,
} from "@shared/marketing-hub";
import { requireAuth, requireTab } from "../auth";
import { attributionOverview } from "../attribution-reports";
import {
  HubInputError,
  cached,
  orgs,
  parseScope,
  q,
  requireHubWorkspace,
  scopeKey,
  str,
  type HubScope,
} from "./common";
import { paidRegistrations, revenueByWorkspace } from "./conversions";
import { formsDetail, formsSummary } from "./forms";
import { adPlatforms, adsData, everPulled, ga4Data, lastRuns, organicData } from "./platform-data";
import { nextManualSyncAt, runMarketingSync } from "./sync";
import { trafficDetail, trafficOverview } from "./traffic";

const BASE = "/api/admin/marketing-hub";
const TTL_MS = 2 * 60_000;
const AD_PLATFORMS: PlatformKey[] = PLATFORMS.filter((p) => p.group === "ads").map((p) => p.key);

const rangeInfo = (s: HubScope) => ({ range: s.range, previousRange: s.previous, filter: s.filter });

// ── Overview ────────────────────────────────────────────────────────────────

async function overview(scope: HubScope): Promise<OverviewResponse> {
  const [traffic, forms, paid, revenue, ads, adsConnected, organic, orgMap] = await Promise.all([
    trafficOverview(scope),
    formsSummary(scope),
    paidRegistrations(scope),
    revenueByWorkspace(scope),
    adsData(scope),
    everPulled(AD_PLATFORMS),
    organicData(scope),
    orgs(),
  ]);
  const programme = Boolean(scope.programme);
  const inScope = HUB_WORKSPACES.filter((w) => !scope.filter.workspace || w.slug === scope.filter.workspace);

  let revenueCurrent = 0;
  let revenuePrevious = 0;
  let withRevenue = 0;
  for (const cell of Array.from(revenue.values())) {
    if (!cell) continue;
    withRevenue++;
    revenueCurrent += cell.current;
    revenuePrevious += cell.previous;
  }

  const notSplit: Availability = "not_split";
  const visitorsStatus: Availability = programme
    ? notSplit
    : traffic.current + traffic.previous === 0
      ? "no_data"
      : "ok";
  const adStatus: Availability = !adsConnected ? "not_connected" : programme ? notSplit : "ok";
  const followerStatus: Availability =
    organic.status === "not_connected"
      ? "not_connected"
      : programme
        ? notSplit
        : organic.followersNow == null
          ? "no_data"
          : "ok";

  const byWorkspace: OverviewResponse["byWorkspace"] = inScope.map((w) => {
    const orgId = orgMap.bySlug.get(w.slug)?.id ?? -1;
    const rev = revenue.get(w.slug) ?? null;
    return {
      slug: w.slug,
      name: w.name,
      short: w.short,
      visitors: traffic.byWorkspace.get(w.slug) ?? 0,
      submissions: forms.byOrg.get(orgId) ?? 0,
      paidRegistrations: paid.byOrg.get(orgId) ?? 0,
      revenueCents: rev ? rev.current : null,
      revenueLabel: rev ? rev.label : null,
      adSpendCents: ads.spendByWorkspace.get(w.slug) ?? 0,
      followers: organic.followersByWorkspace.get(w.slug) ?? null,
    };
  });

  const notes: string[] = [];
  if (programme) {
    notes.push("Website visitors, ad spend and followers aren't recorded per programme, so those tiles are left out while a programme is selected.");
  }
  if (traffic.untracked.length) {
    notes.push(`ClubOS tracking hasn't seen any visits to ${traffic.untracked.join(", ")} in this period, so they aren't in the visitor count.`);
  }
  const noRevenue = inScope.filter((w) => revenue.get(w.slug) === null).map((w) => w.name);
  if (noRevenue.length) notes.push(`Revenue isn't recorded in ClubOS for ${noRevenue.join(", ")}.`);
  const partial = inScope.filter((w) => revenue.get(w.slug)?.label.includes(" only)"));
  for (const w of partial) notes.push(`${w.name} revenue is ${revenue.get(w.slug)!.label.toLowerCase()}.`);
  if (adsConnected && !scope.filter.workspace) {
    notes.push("Ad spend is given to a workspace by the campaign's name. The Ads section shows which campaigns went where.");
  }
  notes.push("Paid registrations count only sign-ups that paid, the same rule as the Registrations page.");

  return {
    ...rangeInfo(scope),
    tiles: {
      visitors: { current: traffic.current, previous: traffic.previous, status: visitorsStatus },
      submissions: { ...forms.total, status: "ok" },
      paidRegistrations: { current: paid.current, previous: paid.previous, status: "ok" },
      revenueCents: {
        current: revenueCurrent,
        previous: revenuePrevious,
        status: withRevenue ? "ok" : "not_connected",
        workspacesWithRevenue: withRevenue,
      },
      adSpendCents: { ...ads.totals.spendCents, status: adStatus },
      followers: { current: organic.followersNow, previous: organic.followersBefore, status: followerStatus },
    },
    series: eachDay(scope.range).map((date) => ({
      date,
      visitors: traffic.series.get(date) ?? 0,
      submissions: forms.series.get(date) ?? 0,
      paidRegistrations: paid.series.get(date) ?? 0,
      adSpendCents: ads.spendByDay.get(date) ?? 0,
    })),
    byWorkspace,
    notes,
  };
}

// ── Sections ────────────────────────────────────────────────────────────────

async function websites(scope: HubScope): Promise<WebsitesResponse> {
  const [firstParty, ga4] = await Promise.all([trafficDetail(scope), ga4Data(scope)]);
  return { ...rangeInfo(scope), firstParty, ga4 };
}

async function forms(scope: HubScope): Promise<FormsResponse> {
  return { ...rangeInfo(scope), ...(await formsDetail(scope)) };
}

async function ads(scope: HubScope): Promise<AdsResponse> {
  const [data, platforms] = await Promise.all([adsData(scope), adPlatforms()]);
  return {
    ...rangeInfo(scope),
    platforms,
    totals: data.totals,
    campaigns: data.campaigns,
    byWorkspace: data.byWorkspace,
    series: data.series,
    notSplitByProgramme: Boolean(scope.programme),
  };
}

async function tracked(scope: HubScope): Promise<TrackedResponse> {
  // The attribution layer takes epoch ms; the NZ midnights come from Postgres
  // so daylight saving is right on both ends of the range.
  const [b] = await q<{ start_ms: number; end_ms: number }>(
    `SELECT (extract(epoch FROM ($1::date::timestamp AT TIME ZONE 'Pacific/Auckland')) * 1000)::float8 AS start_ms,
            (extract(epoch FROM (($2::date + 1)::timestamp AT TIME ZONE 'Pacific/Auckland')) * 1000 - 1)::float8 AS end_ms`,
    [scope.range.from, scope.range.to],
  );
  const data: any = await attributionOverview({
    orgIds: scope.orgIds,
    startMs: Number(b.start_ms),
    endMs: Number(b.end_ms),
  });
  const channels: TrackedResponse["channels"] = (data?.channels ?? []).map((c: any) => ({
    key: String(c.key),
    label: c.key === "unattributed" ? "Couldn't tell" : channelLabel(String(c.key)),
    conversions: Number(c.conversions) || 0,
    leads: Number(c.leads) || 0,
    sales: Number(c.sales) || 0,
    revenueCents: Math.round(Number(c.revenueCents) || 0),
  }));
  const stats = data?.stats
    ? {
        totalConversions: Number(data.stats.totalConversions) || 0,
        totalLeads: Number(data.stats.totalLeads) || 0,
        totalSales: Number(data.stats.totalSales) || 0,
        trackedRevenueCents: Math.round(Number(data.stats.trackedRevenueCents) || 0),
        pctUnattributed: Number(data.stats.pctUnattributed) || 0,
      }
    : null;
  return {
    ...rangeInfo(scope),
    status: scope.programme ? "not_split" : stats && stats.totalConversions > 0 ? "ok" : "no_data",
    model: String(data?.model ?? ""),
    stats,
    channels,
  };
}

async function organic(scope: HubScope): Promise<OrganicResponse> {
  const d = await organicData(scope);
  return {
    ...rangeInfo(scope),
    status: d.status,
    accounts: d.accounts,
    series: d.series,
    notSplitByProgramme: Boolean(scope.programme),
  };
}

async function sources(): Promise<SourcesResponse> {
  const [rows, runs, spans, recent, next, orgMap] = await Promise.all([
    q<{ id: number; platform: PlatformKey; label: string; external_id: string; organization_id: number | null; site: string | null; active: boolean }>(
      `SELECT id, platform, label, external_id, organization_id, site, active FROM marketing_sources ORDER BY platform, id`,
    ),
    lastRuns(),
    q<{ source_id: number; first_day: string; last_day: string }>(
      `SELECT source_id, min(day)::text AS first_day, max(day)::text AS last_day FROM marketing_daily GROUP BY 1`,
    ),
    q<{ id: number; platform: string; trigger: string; status: string; rows_written: number; error: string | null; started_at: Date; finished_at: Date | null; label: string | null }>(
      `SELECT r.id, r.platform, r.trigger, r.status, r.rows_written, r.error, r.started_at, r.finished_at, s.label
       FROM marketing_sync_runs r LEFT JOIN marketing_sources s ON s.id = r.source_id
       ORDER BY r.started_at DESC LIMIT 30`,
    ),
    nextManualSyncAt(),
    orgs(),
  ]);
  const spanBy = new Map(spans.map((s) => [s.source_id, s]));
  const slugFor = (orgId: number | null) => {
    const slug = orgId == null ? null : orgMap.byId.get(orgId)?.slug ?? null;
    return hubWorkspace(slug) ? slug : null;
  };
  return {
    syncEnabled: process.env.MARKETING_HUB_SYNC === "1",
    nextManualSyncAt: next,
    sources: rows.map((s) => {
      const run = runs.get(s.id);
      return {
        id: s.id,
        platform: s.platform,
        label: s.label,
        externalId: s.external_id,
        workspace: slugFor(s.organization_id),
        site: s.site,
        active: s.active,
        firstDay: spanBy.get(s.id)?.first_day ?? null,
        lastDay: spanBy.get(s.id)?.last_day ?? null,
        lastRunAt: run?.startedAt ?? null,
        lastStatus: run?.status ?? null,
        lastOkAt: run?.lastOkAt ?? null,
        lastError: run?.error ?? null,
      };
    }),
    platforms: PLATFORMS.map((p) => ({ ...p, sourceCount: rows.filter((s) => s.platform === p.key && s.active).length })),
    recentRuns: recent.map((r) => ({
      id: Number(r.id),
      label: r.label ?? r.platform,
      platform: r.platform,
      trigger: r.trigger,
      status: r.status,
      rowsWritten: r.rows_written,
      error: r.error,
      startedAt: new Date(r.started_at).toISOString(),
      finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    })),
  };
}

async function programmes(req: Request): Promise<ProgrammesResponse> {
  const slug = str((req.query as Record<string, unknown>).workspace);
  if (!slug || !hubWorkspace(slug)) throw new HubInputError("Choose a workspace.");
  const org = (await orgs()).bySlug.get(slug);
  if (!org) throw new HubInputError(`Workspace "${slug}" does not exist.`);
  const rows = await q<{ id: number; name: string; is_active: boolean }>(
    `SELECT id, name, is_active FROM programs WHERE organization_id = $1 ORDER BY is_active DESC, name`,
    [org.id],
  );
  return { programmes: rows.map((r) => ({ id: r.id, name: r.name, workspace: slug, active: Boolean(r.is_active) })) };
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function handle(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      res.json(await fn(req));
    } catch (e: any) {
      if (e instanceof HubInputError) return res.status(400).json({ message: e.message });
      console.error(`[MarketingHub] ${req.path} failed:`, e?.message ?? e);
      res.status(500).json({ message: "Couldn't load marketing data.", detail: String(e?.message ?? e).slice(0, 300) });
    }
  };
}

function scoped<T>(name: string, fn: (s: HubScope) => Promise<T>) {
  return handle(async (req) => {
    const scope = await parseScope(req);
    return cached(scopeKey(name, scope), TTL_MS, () => fn(scope));
  });
}

export function registerMarketingHubRoutes(app: Express) {
  const tab = requireTab(MARKETING_HUB_TAB);

  app.get(`${BASE}/overview`, requireAuth, tab, requireHubWorkspace, scoped("overview", overview));
  app.get(`${BASE}/websites`, requireAuth, tab, requireHubWorkspace, scoped("websites", websites));
  app.get(`${BASE}/forms`, requireAuth, tab, requireHubWorkspace, scoped("forms", forms));
  app.get(`${BASE}/ads`, requireAuth, tab, requireHubWorkspace, scoped("ads", ads));
  app.get(`${BASE}/tracked`, requireAuth, tab, requireHubWorkspace, scoped("tracked", tracked));
  app.get(`${BASE}/organic`, requireAuth, tab, requireHubWorkspace, scoped("organic", organic));
  app.get(`${BASE}/sources`, requireAuth, tab, requireHubWorkspace, handle(() => sources()));
  app.get(`${BASE}/programmes`, requireAuth, tab, requireHubWorkspace, handle(programmes));

  app.post(`${BASE}/sync`, requireAuth, tab, requireHubWorkspace, async (_req: Request, res: Response) => {
    try {
      if (process.env.MARKETING_HUB_SYNC !== "1") {
        return res.status(409).json({ message: "Automatic pulls are switched off on this server, so there's nothing to start." });
      }
      const next = await nextManualSyncAt();
      if (next) {
        return res.status(429).json({ message: "A pull was started in the last ten minutes.", nextManualSyncAt: next });
      }
      // Runs in the background on this long-lived server; the page polls the
      // sources list to see it finish. The lease stops a second machine joining in.
      void runMarketingSync("manual").catch((e) => console.error("[MarketingHub] Manual sync crashed:", e?.message ?? e));
      res.status(202).json({ message: "Pulling the latest numbers. They'll appear in a few minutes." });
    } catch (e: any) {
      res.status(500).json({ message: "Couldn't start the pull.", detail: String(e?.message ?? e).slice(0, 300) });
    }
  });
}

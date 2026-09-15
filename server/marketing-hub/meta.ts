/**
 * Meta — ad spend per campaign per day, and Facebook page / Instagram insights.
 *
 * Two tokens, both long-lived and both already in use by the Mac collectors:
 *   META_MARKETING_TOKEN      the system-user token with ads access. NOT the
 *                             server's META_ACCESS_TOKEN — that one is the
 *                             Conversions API token, and on 2026-09-15 it
 *                             answered "(#200) Missing Permissions" for every
 *                             ad account.
 *   META_SOCIAL_ACCESS_TOKEN  pages + Instagram insights.
 *
 * 🔴 A request URL carries the access token, so errors are rebuilt from Meta's
 * own message and never include the URL.
 */
import { addDaysIso, nzTodayIso } from "@shared/dashboard";
import type { HubMetricKey } from "@shared/marketing-hub";
import { NotConfiguredError, q } from "./common";
import type { DailyRow, PullContext } from "./sync";

const GRAPH = "https://graph.facebook.com/v23.0";

async function graphFetch(url: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch (e: any) {
    throw new Error(`Meta: request failed (${e?.name === "TimeoutError" ? "timed out" : e?.message ?? "network error"})`);
  }
  const json: any = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    throw new Error(`Meta: ${json?.error?.message ?? `HTTP ${res.status}`}`);
  }
  return json;
}

function graphUrl(path: string, params: Record<string, string>, token: string): string {
  return `${GRAPH}${path}?${new URLSearchParams({ ...params, access_token: token }).toString()}`;
}

function token(name: "META_MARKETING_TOKEN" | "META_SOCIAL_ACCESS_TOKEN"): string {
  const v = process.env[name];
  if (!v) throw new NotConfiguredError(`${name} is not set on this server.`);
  return v;
}

/** Inclusive date windows of at most `days` days. */
function windows(from: string, to: string, days: number): [string, string][] {
  const out: [string, string][] = [];
  let start = from;
  while (start <= to) {
    const end = addDaysIso(start, days - 1) < to ? addDaysIso(start, days - 1) : to;
    out.push([start, end]);
    start = addDaysIso(end, 1);
  }
  return out;
}

const count = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));

// ── Insight day labels ──────────────────────────────────────────────────────
//
// 🔴 Facebook and Instagram label a daily value DIFFERENTLY, and both in US
// Pacific time. Measured 2026-09-15 with since=2026-09-10, until=2026-09-13:
//   Facebook page_media_view  → end_time 09-11T07:00Z, 09-12T07:00Z, 09-13T07:00Z
//   Instagram reach           → end_time 09-10T07:00Z, 09-11T07:00Z, 09-12T07:00Z
// 07:00Z is midnight in Los Angeles. So a Facebook value is stamped with the
// END of its day and an Instagram value with the START. Treating them the same
// shifts one platform a whole day against the other.
const LA_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const laDate = (iso: string) => LA_DATE.format(new Date(iso));
const facebookDay = (endTime: string) => addDaysIso(laDate(endTime), -1);
const instagramDay = (endTime: string) => laDate(endTime);

// ── Ads ─────────────────────────────────────────────────────────────────────

type Action = { action_type?: string; value?: string };

/** The first action type present, in priority order — never a sum of overlapping types. */
function actionValue(actions: Action[] | undefined, types: string[]): number {
  if (!Array.isArray(actions)) return 0;
  for (const t of types) {
    const hit = actions.find((a) => a?.action_type === t);
    if (hit) return count(hit.value);
  }
  return 0;
}

export async function pullMetaAds(ctx: PullContext): Promise<void> {
  const t = token("META_MARKETING_TOKEN");
  const act = ctx.source.external_id;
  if (!/^act_\d+$/.test(act)) throw new Error(`"${act}" is not a Meta ad account id.`);

  // 🔴 Money from two accounts is only added together if both are NZD.
  const account = await graphFetch(graphUrl(`/${act}`, { fields: "currency,name" }, t));
  if (account.currency !== "NZD") {
    throw new Error(`Ad account ${account.name ?? act} reports in ${account.currency}; the hub only adds up NZD.`);
  }
  if (ctx.source.currency !== account.currency) {
    await q(`UPDATE marketing_sources SET currency = $1 WHERE id = $2`, [account.currency, ctx.source.id]);
  }

  for (const [since, until] of windows(ctx.from, ctx.to, 90)) {
    let url: string | null = graphUrl(
      `/${act}/insights`,
      {
        level: "campaign",
        time_increment: "1",
        time_range: JSON.stringify({ since, until }),
        fields: "campaign_id,campaign_name,spend,impressions,inline_link_clicks,actions",
        limit: "500",
      },
      t,
    );
    for (let page = 0; url && page < 50; page++) {
      const json: any = await graphFetch(url);
      const rows: DailyRow[] = [];
      for (const r of json.data ?? []) {
        // date_start is the account's own day (Pacific/Auckland for all three).
        const day = String(r.date_start ?? "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !r.campaign_id) continue;
        const base = { day, dimType: "campaign" as const, dimKey: String(r.campaign_id), dimLabel: r.campaign_name ?? null };
        rows.push({ ...base, metric: "spend_cents", value: Math.round((Number(r.spend) || 0) * 100) });
        rows.push({ ...base, metric: "impressions", value: count(r.impressions) });
        rows.push({ ...base, metric: "link_clicks", value: count(r.inline_link_clicks) });
        rows.push({ ...base, metric: "leads", value: actionValue(r.actions, ["lead"]) });
        rows.push({
          ...base,
          metric: "purchases",
          value: actionValue(r.actions, ["omni_purchase", "offsite_conversion.fb_pixel_purchase", "purchase"]),
        });
        rows.push({
          ...base,
          metric: "landing_page_views",
          value: actionValue(r.actions, ["landing_page_view", "omni_landing_page_view"]),
        });
      }
      await ctx.write(rows);
      url = json.paging?.next ?? null;
    }
  }
}

// ── Facebook pages ──────────────────────────────────────────────────────────

type PageAccount = { token: string; followers: number | null };

/** Page tokens + follower counts for every page the social token manages. Once per run. */
async function pageAccounts(ctx: PullContext): Promise<Map<string, PageAccount>> {
  const hit = ctx.cache.get("meta:pages") as Map<string, PageAccount> | undefined;
  if (hit) return hit;
  const t = token("META_SOCIAL_ACCESS_TOKEN");
  const out = new Map<string, PageAccount>();
  let url: string | null = graphUrl("/me/accounts", { fields: "id,access_token,followers_count", limit: "100" }, t);
  for (let page = 0; url && page < 10; page++) {
    const json: any = await graphFetch(url);
    for (const p of json.data ?? []) {
      out.set(String(p.id), {
        token: String(p.access_token),
        followers: p.followers_count == null ? null : count(p.followers_count),
      });
    }
    url = json.paging?.next ?? null;
  }
  ctx.cache.set("meta:pages", out);
  return out;
}

// page_impressions_unique and page_fans were retired by Meta and now answer
// "(#100) The value must be a valid insights metric" — the reason the Mac
// collector's Facebook numbers silently stopped in May 2026. These four were
// each checked live on 2026-09-15.
const PAGE_METRICS: Record<string, HubMetricKey> = {
  page_media_view: "views",
  page_post_engagements: "interactions",
  page_views_total: "profile_views",
  page_daily_follows_unique: "new_follows",
};

export async function pullFacebookPage(ctx: PullContext): Promise<void> {
  const pages = await pageAccounts(ctx);
  const page = pages.get(ctx.source.external_id);
  if (!page) throw new Error(`The social token can no longer see the Facebook page "${ctx.source.label}".`);

  for (const [since, until] of windows(ctx.from, ctx.to, 90)) {
    const json = await graphFetch(
      graphUrl(
        `/${ctx.source.external_id}/insights`,
        { metric: Object.keys(PAGE_METRICS).join(","), period: "day", since, until: addDaysIso(until, 1) },
        page.token,
      ),
    );
    const rows: DailyRow[] = [];
    for (const series of json.data ?? []) {
      const metric = PAGE_METRICS[series.name];
      if (!metric) continue;
      for (const v of series.values ?? []) {
        if (!v?.end_time || typeof v.value !== "number") continue;
        const day = facebookDay(v.end_time);
        if (day < ctx.from || day > ctx.to) continue;
        rows.push({ day, dimType: "total", dimKey: "", dimLabel: null, metric, value: count(v.value) });
      }
    }
    await ctx.write(rows);
  }

  // Followers is a reading, not a history: Meta only gives today's figure.
  if (page.followers != null) {
    await ctx.write([
      { day: nzTodayIso(), dimType: "total", dimKey: "", dimLabel: null, metric: "followers", value: page.followers },
    ]);
  }
}

// ── Instagram ───────────────────────────────────────────────────────────────

const IG_TOTAL_VALUE: Record<string, HubMetricKey> = {
  accounts_engaged: "accounts_engaged",
  profile_views: "profile_views",
  total_interactions: "interactions",
  views: "views",
  website_clicks: "website_clicks",
};

export async function pullInstagram(ctx: PullContext): Promise<void> {
  const t = token("META_SOCIAL_ACCESS_TOKEN");
  const ig = ctx.source.external_id;
  if (!/^\d+$/.test(ig)) throw new Error(`"${ig}" is not an Instagram account id.`);

  // Daily series. Instagram allows at most 30 days per request, and
  // follower_count only for the last 30 days.
  for (const [since, until] of windows(ctx.from, ctx.to, 29)) {
    const json = await graphFetch(
      graphUrl(`/${ig}/insights`, { metric: "reach,follower_count", period: "day", since, until: addDaysIso(until, 1) }, t),
    );
    const rows: DailyRow[] = [];
    for (const series of json.data ?? []) {
      const metric: HubMetricKey | null =
        series.name === "reach" ? "reach" : series.name === "follower_count" ? "new_follows" : null;
      if (!metric) continue;
      for (const v of series.values ?? []) {
        if (!v?.end_time || typeof v.value !== "number") continue;
        const day = instagramDay(v.end_time);
        if (day < ctx.from || day > ctx.to) continue;
        rows.push({ day, dimType: "total", dimKey: "", dimLabel: null, metric, value: count(v.value) });
      }
    }
    await ctx.write(rows);
  }

  // These metrics only come as a total for the requested window, so each day is
  // asked for on its own. A day is one request carrying all five metrics.
  let day = ctx.from;
  while (day <= ctx.to) {
    const json = await graphFetch(
      graphUrl(
        `/${ig}/insights`,
        {
          metric: Object.keys(IG_TOTAL_VALUE).join(","),
          period: "day",
          metric_type: "total_value",
          since: day,
          until: addDaysIso(day, 1),
        },
        t,
      ),
    );
    const rows: DailyRow[] = [];
    for (const m of json.data ?? []) {
      const metric = IG_TOTAL_VALUE[m.name];
      const value = m?.total_value?.value;
      if (!metric || typeof value !== "number") continue;
      rows.push({ day, dimType: "total", dimKey: "", dimLabel: null, metric, value: count(value) });
    }
    await ctx.write(rows);
    day = addDaysIso(day, 1);
  }

  const profile = await graphFetch(graphUrl(`/${ig}`, { fields: "followers_count" }, t));
  if (profile.followers_count != null) {
    await ctx.write([
      { day: nzTodayIso(), dimType: "total", dimKey: "", dimLabel: null, metric: "followers", value: count(profile.followers_count) },
    ]);
  }
}

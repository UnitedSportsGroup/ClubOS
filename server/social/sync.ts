/**
 * Social media — find the accounts, pull every post and keep a follower
 * reading per day. See shared/social.ts and migrations/2026-11-10_social_media.sql.
 *
 *   Meta (Facebook + Instagram)  found automatically: the business system-user
 *                                token (META_SOCIAL_ACCESS_TOKEN) lists every
 *                                page it manages and the Instagram account on it.
 *   YouTube                      public channel data, by link. Needs "YouTube
 *                                Data API v3" switched on in the Google project
 *                                (YOUTUBE_API_KEY, else the service account).
 *   X                            read with X_BEARER_TOKEN (pay per read, so a
 *                                scheduled pull reads the newest 50 posts only).
 *   TikTok · LinkedIn            saved links only; no puller until each
 *                                platform grants read access.
 *
 * 🔴 Every pull is a row in social_sync_runs with the platform's own error.
 * 🔴 A request URL carries a token, so errors are rebuilt from the platform's
 *    message and never include the URL.
 * 🔴 Two Fly machines run the schedule; a Postgres advisory lock lets one pull.
 *    Every write is an upsert on a natural key, so an overlap could only
 *    rewrite the same numbers.
 */
import { JWT } from "google-auth-library";
import { nzTodayIso } from "@shared/dashboard";
import { META_BRAND_BY_ID, socialBrand, type SocialPlatformKey } from "@shared/social";
import { pool } from "../db";

const GRAPH = "https://graph.facebook.com/v23.0";
const LOCK_KEY = 772011;

export class SocialNotConfigured extends Error {}

async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(text, params as any[]);
  return r.rows as T[];
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// ── HTTP ────────────────────────────────────────────────────────────────────

async function getJson(url: string, platform: string, headers?: Record<string, string>): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  } catch (e: any) {
    throw new Error(`${platform}: request failed (${e?.name === "TimeoutError" ? "timed out" : "network error"})`);
  }
  const json: any = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    throw new Error(`${platform}: ${json?.error?.message ?? `HTTP ${res.status}`}`);
  }
  return json;
}

function metaToken(): string {
  const t = process.env.META_SOCIAL_ACCESS_TOKEN;
  if (!t) throw new SocialNotConfigured("META_SOCIAL_ACCESS_TOKEN is not set on this server.");
  return t;
}

const graph = (path: string, params: Record<string, string>, token: string) =>
  getJson(`${GRAPH}${path}?${new URLSearchParams({ ...params, access_token: token }).toString()}`, "Meta");

/** Follow a Graph "next" link. It already carries the token. */
const graphNext = (url: string) => getJson(url, "Meta");

// ── Meta: find every account ────────────────────────────────────────────────

type MetaPage = {
  id: string;
  name?: string;
  username?: string;
  followers_count?: number;
  access_token?: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: {
    id: string;
    username?: string;
    name?: string;
    followers_count?: number;
    media_count?: number;
    profile_picture_url?: string;
  };
};

let pageCache: { at: number; pages: MetaPage[] } | null = null;

async function metaPages(fresh = false): Promise<MetaPage[]> {
  if (!fresh && pageCache && Date.now() - pageCache.at < 30 * 60_000) return pageCache.pages;
  const token = metaToken();
  const pages: MetaPage[] = [];
  let json = await graph(
    "/me/accounts",
    {
      fields:
        "id,name,username,followers_count,access_token,picture{url},instagram_business_account{id,username,name,followers_count,media_count,profile_picture_url}",
      limit: "100",
    },
    token,
  );
  for (let i = 0; i < 10; i++) {
    pages.push(...(json.data ?? []));
    if (!json.paging?.next) break;
    json = await graphNext(json.paging.next);
  }
  pageCache = { at: Date.now(), pages };
  return pages;
}

async function upsertFound(a: {
  platform: SocialPlatformKey;
  externalId: string;
  handle: string;
  displayName: string | null;
  profileUrl: string;
  avatarUrl: string | null;
  hubPlatform: "facebook_page" | "instagram";
  hubLabel: string;
}): Promise<{ id: number; created: boolean }> {
  const brand = META_BRAND_BY_ID[a.externalId] ?? null;
  // A person may have saved this account as a link before it was found.
  await q(
    `UPDATE social_accounts SET external_id = $3
     WHERE platform = $1 AND lower(handle) = lower($2) AND external_id IS NULL AND archived_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM social_accounts WHERE platform = $1 AND external_id = $3)`,
    [a.platform, a.handle, a.externalId],
  );
  // The Marketing hub pulls this account's daily insights; make sure it knows it.
  await q(
    `INSERT INTO marketing_sources (platform, external_id, label, organization_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT (platform, external_id) DO NOTHING`,
    [a.hubPlatform, a.externalId, a.hubLabel, socialBrand(brand)?.orgId ?? null],
  );
  const [row] = await q<{ id: number; created: boolean }>(
    `INSERT INTO social_accounts (platform, brand, external_id, handle, display_name, profile_url, avatar_url, connection, marketing_source_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'api',
             (SELECT id FROM marketing_sources WHERE platform = $8 AND external_id = $3))
     ON CONFLICT (platform, external_id) WHERE external_id IS NOT NULL DO UPDATE
       SET handle = EXCLUDED.handle,
           display_name = EXCLUDED.display_name,
           profile_url = EXCLUDED.profile_url,
           avatar_url = COALESCE(EXCLUDED.avatar_url, social_accounts.avatar_url),
           connection = 'api',
           marketing_source_id = EXCLUDED.marketing_source_id
           -- brand is NOT touched: once a person has filed it, it stays filed.
     RETURNING id, (xmax = 0) AS created`,
    [a.platform, brand, a.externalId, a.handle, a.displayName, a.profileUrl, a.avatarUrl, a.hubPlatform],
  );
  return row;
}

/** List every Facebook page and Instagram account the business login manages. */
export async function discoverMetaAccounts(): Promise<{ found: number; added: number }> {
  const pages = await metaPages(true);
  let found = 0;
  let added = 0;
  for (const p of pages) {
    const handle = p.username || p.id;
    const fb = await upsertFound({
      platform: "facebook",
      externalId: String(p.id),
      handle,
      displayName: p.name ?? null,
      profileUrl: `https://www.facebook.com/${handle}`,
      avatarUrl: p.picture?.data?.url ?? null,
      hubPlatform: "facebook_page",
      hubLabel: p.name ?? handle,
    });
    found++;
    if (fb.created) added++;
    const ig = p.instagram_business_account;
    if (ig?.id && ig.username) {
      const r = await upsertFound({
        platform: "instagram",
        externalId: String(ig.id),
        handle: ig.username,
        displayName: ig.name ?? null,
        profileUrl: `https://www.instagram.com/${ig.username}/`,
        avatarUrl: ig.profile_picture_url ?? null,
        hubPlatform: "instagram",
        hubLabel: `@${ig.username}`,
      });
      found++;
      if (r.created) added++;
    }
  }
  return { found, added };
}

// ── Storing ─────────────────────────────────────────────────────────────────

export type AccountRow = {
  id: number;
  platform: SocialPlatformKey;
  external_id: string | null;
  handle: string;
  connection: string;
  history_complete: boolean;
  marketing_source_id: number | null;
};

type PostIn = {
  externalId: string;
  postedAt: string;
  kind: string;
  caption: string | null;
  permalink: string | null;
  thumbUrl: string | null;
  likes: number | null;
  comments: number | null;
  shares?: number | null;
  views?: number | null;
  clicks?: number | null;
  /** True when views/clicks came with the listing (Facebook, YouTube). */
  insightsIncluded?: boolean;
};

async function upsertPosts(accountId: number, posts: PostIn[]): Promise<number> {
  const clean = posts.filter((p) => p.externalId && !Number.isNaN(Date.parse(p.postedAt)));
  for (let i = 0; i < clean.length; i += 200) {
    const c = clean.slice(i, i + 200);
    await q(
      `INSERT INTO social_posts (account_id, external_id, posted_at, kind, caption, permalink, thumb_url, thumb_fetched_at,
                                 likes, comments, shares, views, clicks, metrics_at, insights_at)
       SELECT $1, u.external_id, u.posted_at::timestamptz, u.kind, u.caption, u.permalink, u.thumb_url,
              CASE WHEN u.thumb_url IS NULL THEN NULL ELSE now() END,
              u.likes, u.comments, u.shares, u.views, u.clicks, now(),
              CASE WHEN u.insights_included THEN now() ELSE NULL END
       FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
                   $8::bigint[], $9::bigint[], $10::bigint[], $11::bigint[], $12::bigint[], $13::boolean[])
            AS u(external_id, posted_at, kind, caption, permalink, thumb_url, likes, comments, shares, views, clicks, insights_included)
       ON CONFLICT (account_id, external_id) DO UPDATE SET
         kind = EXCLUDED.kind,
         caption = EXCLUDED.caption,
         permalink = COALESCE(EXCLUDED.permalink, social_posts.permalink),
         thumb_url = COALESCE(EXCLUDED.thumb_url, social_posts.thumb_url),
         thumb_fetched_at = CASE WHEN EXCLUDED.thumb_url IS NULL THEN social_posts.thumb_fetched_at ELSE now() END,
         likes = COALESCE(EXCLUDED.likes, social_posts.likes),
         comments = COALESCE(EXCLUDED.comments, social_posts.comments),
         shares = COALESCE(EXCLUDED.shares, social_posts.shares),
         views = COALESCE(EXCLUDED.views, social_posts.views),
         clicks = COALESCE(EXCLUDED.clicks, social_posts.clicks),
         metrics_at = now(),
         insights_at = COALESCE(EXCLUDED.insights_at, social_posts.insights_at)`,
      [
        accountId,
        c.map((p) => p.externalId),
        c.map((p) => new Date(p.postedAt).toISOString()),
        c.map((p) => p.kind),
        c.map((p) => p.caption),
        c.map((p) => p.permalink),
        c.map((p) => p.thumbUrl),
        c.map((p) => p.likes),
        c.map((p) => p.comments),
        c.map((p) => p.shares ?? null),
        c.map((p) => p.views ?? null),
        c.map((p) => p.clicks ?? null),
        c.map((p) => Boolean(p.insightsIncluded)),
      ],
    );
  }
  return clean.length;
}

export async function saveReading(
  accountId: number,
  r: { followers: number | null; postsCount?: number | null; totalViews?: number | null },
  source: "api" | "manual" = "api",
  userId: number | null = null,
) {
  await q(
    `INSERT INTO social_account_daily (account_id, day, followers, posts_count, total_views, source, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (account_id, day) DO UPDATE SET
       followers = COALESCE(EXCLUDED.followers, social_account_daily.followers),
       posts_count = COALESCE(EXCLUDED.posts_count, social_account_daily.posts_count),
       total_views = COALESCE(EXCLUDED.total_views, social_account_daily.total_views),
       source = EXCLUDED.source, recorded_by = EXCLUDED.recorded_by, recorded_at = now()`,
    [accountId, nzTodayIso(), r.followers, r.postsCount ?? null, r.totalViews ?? null, source, userId],
  );
}

type SyncOpts = { insightBudget: number; fullHistory: boolean };

// ── Instagram ───────────────────────────────────────────────────────────────

function igKind(m: any): string {
  if (m.media_product_type === "REELS") return "reel";
  if (m.media_type === "CAROUSEL_ALBUM") return "carousel";
  if (m.media_type === "VIDEO") return "video";
  return "image";
}

async function syncInstagram(a: AccountRow, opts: SyncOpts): Promise<number> {
  const token = metaToken();
  const ig = a.external_id!;
  const profile = await graph(`/${ig}`, { fields: "username,name,followers_count,media_count,profile_picture_url" }, token);
  await saveReading(a.id, { followers: num(profile.followers_count), postsCount: num(profile.media_count) });
  if (profile.profile_picture_url) {
    await q(`UPDATE social_accounts SET avatar_url = $2, display_name = COALESCE($3, display_name) WHERE id = $1`, [
      a.id,
      profile.profile_picture_url,
      profile.name ?? null,
    ]);
  }

  let written = 0;
  let reachedEnd = false;
  const maxPages = opts.fullHistory ? 120 : 1;
  let json = await graph(
    `/${ig}/media`,
    {
      fields: "id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count",
      limit: "100",
    },
    token,
  );
  for (let page = 0; page < maxPages; page++) {
    const rows: PostIn[] = (json.data ?? []).map((m: any) => ({
      externalId: String(m.id),
      postedAt: m.timestamp,
      kind: igKind(m),
      caption: m.caption ?? null,
      permalink: m.permalink ?? null,
      thumbUrl: m.thumbnail_url ?? m.media_url ?? null,
      likes: num(m.like_count),
      comments: num(m.comments_count),
    }));
    written += await upsertPosts(a.id, rows);
    if (!json.paging?.next) {
      reachedEnd = true;
      break;
    }
    if (page + 1 < maxPages) json = await graphNext(json.paging.next);
  }
  if (opts.fullHistory && reachedEnd) await q(`UPDATE social_accounts SET history_complete = true WHERE id = $1`, [a.id]);

  // Per-post insights, newest and never-read first, within this run's budget.
  const due = await q<{ id: number; external_id: string }>(
    `SELECT id, external_id FROM social_posts
     WHERE account_id = $1 AND (
       insights_at IS NULL
       OR (posted_at > now() - interval '30 days' AND insights_at < now() - interval '12 hours')
       OR (posted_at > now() - interval '365 days' AND insights_at < now() - interval '14 days'))
     ORDER BY (insights_at IS NULL) DESC, posted_at DESC
     LIMIT $2`,
    [a.id, opts.insightBudget],
  );
  for (let i = 0; i < due.length; i += 5) {
    await Promise.all(
      due.slice(i, i + 5).map(async (p) => {
        try {
          let json: any;
          try {
            json = await graph(`/${p.external_id}/insights`, { metric: "reach,views,saved,shares" }, token);
          } catch {
            // Older posts do not have `views`.
            json = await graph(`/${p.external_id}/insights`, { metric: "reach,saved" }, token);
          }
          const got: Record<string, number | null> = {};
          for (const m of json.data ?? []) got[m.name] = num(m.values?.[0]?.value);
          await q(
            `UPDATE social_posts SET reach = COALESCE($2, reach), views = COALESCE($3, views), saves = COALESCE($4, saves),
                    shares = COALESCE($5, shares), insights_at = now(), insights_error = NULL WHERE id = $1`,
            [p.id, got.reach ?? null, got.views ?? null, got.saved ?? null, got.shares ?? null],
          );
        } catch (e: any) {
          await q(`UPDATE social_posts SET insights_at = now(), insights_error = $2 WHERE id = $1`, [
            p.id,
            String(e?.message ?? e).slice(0, 300),
          ]);
        }
      }),
    );
  }
  return written;
}

// ── Facebook ────────────────────────────────────────────────────────────────

function fbKind(p: any): string {
  const t = p.attachments?.data?.[0]?.media_type;
  if (typeof p.permalink_url === "string" && /\/reel\//.test(p.permalink_url)) return "reel";
  if (t === "video") return "video";
  if (t === "album") return "carousel";
  if (t === "photo") return "image";
  if (t === "link" || t === "share") return "link";
  return p.full_picture ? "image" : "text";
}

const FB_FIELDS =
  "id,created_time,message,permalink_url,full_picture,attachments{media_type},shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)";

async function pageToken(pageId: string): Promise<string> {
  const page = (await metaPages()).find((p) => String(p.id) === pageId) ?? (await metaPages(true)).find((p) => String(p.id) === pageId);
  if (!page?.access_token) throw new Error("Meta: the business login can no longer see this Facebook page.");
  return page.access_token;
}

/**
 * One page of a Facebook page's posts.
 *
 * 🔴 Meta answers "Please reduce the amount of data you're asking for" when a
 * page of posts with their insights is too heavy (measured 2026-11-10 on the
 * CUFC and Gymnastics pages, mid-history). The same page is asked for again
 * in smaller pieces, and last of all without the per-post insights — fewer
 * numbers for those posts beats no posts at all.
 */
async function fbPostsPage(url: string): Promise<any> {
  const attempts: ((u: URL) => void)[] = [
    () => {},
    (u) => u.searchParams.set("limit", "8"),
    (u) => u.searchParams.set("limit", "3"),
    (u) => {
      u.searchParams.set("limit", "10");
      u.searchParams.set("fields", FB_FIELDS);
    },
  ];
  let last: unknown;
  for (const change of attempts) {
    const u = new URL(url);
    change(u);
    try {
      return await getJson(u.toString(), "Meta");
    } catch (e: any) {
      last = e;
      if (!/reduce the amount of data|timed out|unknown error|unexpected error/i.test(String(e?.message))) throw e;
    }
  }
  throw last;
}

async function syncFacebook(a: AccountRow, opts: SyncOpts): Promise<number> {
  const id = a.external_id!;
  const token = await pageToken(id);
  const page = await graph(`/${id}`, { fields: "name,username,followers_count,picture{url}" }, token);
  await saveReading(a.id, { followers: num(page.followers_count) });
  if (page.picture?.data?.url) await q(`UPDATE social_accounts SET avatar_url = $2 WHERE id = $1`, [a.id, page.picture.data.url]);

  let written = 0;
  let reachedEnd = false;
  const maxPages = opts.fullHistory ? 600 : 2;
  const first = `${GRAPH}/${id}/posts?${new URLSearchParams({
    fields: `${FB_FIELDS},insights.metric(post_media_view,post_clicks){name,values}`,
    limit: "25",
    access_token: token,
  }).toString()}`;
  let json: any = await fbPostsPage(first);
  for (let pageNo = 0; pageNo < maxPages; pageNo++) {
    const rows: PostIn[] = (json.data ?? []).map((p: any) => {
      const ins: Record<string, number | null> = {};
      for (const m of p.insights?.data ?? []) ins[m.name] = num(m.values?.[0]?.value);
      return {
        externalId: String(p.id),
        postedAt: p.created_time,
        kind: fbKind(p),
        caption: p.message ?? null,
        permalink: p.permalink_url ?? null,
        thumbUrl: p.full_picture ?? null,
        likes: num(p.reactions?.summary?.total_count),
        comments: num(p.comments?.summary?.total_count),
        shares: p.shares ? num(p.shares.count) : null,
        views: ins.post_media_view ?? null,
        clicks: ins.post_clicks ?? null,
        insightsIncluded: Boolean(p.insights),
      };
    });
    written += await upsertPosts(a.id, rows);
    if (!json.paging?.next) {
      reachedEnd = true;
      break;
    }
    if (pageNo + 1 < maxPages) json = await fbPostsPage(json.paging.next);
  }
  if (opts.fullHistory && reachedEnd) await q(`UPDATE social_accounts SET history_complete = true WHERE id = $1`, [a.id]);
  return written;
}

// ── YouTube ─────────────────────────────────────────────────────────────────

let ytClient: JWT | null = null;

async function youtube(path: string, params: Record<string, string>): Promise<any> {
  const key = process.env.YOUTUBE_API_KEY;
  const url = `https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams(key ? { ...params, key } : params).toString()}`;
  if (key) return getJson(url, "YouTube");
  const b64 = process.env.MARKETING_GA4_SA_JSON_B64;
  if (!b64) throw new SocialNotConfigured("No Google credentials on this server for YouTube.");
  if (!ytClient) {
    const creds = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    ytClient = new JWT({ email: creds.client_email, key: creds.private_key, scopes: ["https://www.googleapis.com/auth/youtube.readonly"] });
  }
  const { token } = await ytClient.getAccessToken();
  try {
    return await getJson(url, "YouTube", { Authorization: `Bearer ${token}` });
  } catch (e: any) {
    if (/has not been used in project|is disabled/i.test(String(e?.message))) {
      throw new SocialNotConfigured("YouTube Data API v3 is not switched on in the Google Cloud project yet.");
    }
    throw e;
  }
}

/** Look a channel up by id or @handle. Used when connecting and on every pull. */
export async function youtubeChannel(ref: { channelId?: string | null; handle?: string | null }) {
  const params: Record<string, string> = { part: "snippet,statistics,contentDetails" };
  if (ref.channelId) params.id = ref.channelId;
  else params.forHandle = `@${ref.handle}`;
  const json = await youtube("channels", params);
  const c = json.items?.[0];
  if (!c) throw new Error("YouTube: no channel with that name was found.");
  return {
    id: String(c.id),
    title: (c.snippet?.title as string) ?? null,
    handle: String(c.snippet?.customUrl ?? "").replace(/^@/, "") || null,
    avatar: (c.snippet?.thumbnails?.default?.url as string) ?? null,
    subscribers: c.statistics?.hiddenSubscriberCount ? null : num(c.statistics?.subscriberCount),
    videos: num(c.statistics?.videoCount),
    views: num(c.statistics?.viewCount),
    uploads: c.contentDetails?.relatedPlaylists?.uploads as string | undefined,
  };
}

async function syncYoutube(a: AccountRow, opts: SyncOpts): Promise<number> {
  const ch = await youtubeChannel({ channelId: a.external_id, handle: a.handle });
  await q(
    `UPDATE social_accounts SET external_id = COALESCE(external_id, $2), display_name = COALESCE($3, display_name),
            avatar_url = COALESCE($4, avatar_url), connection = 'api' WHERE id = $1`,
    [a.id, ch.id, ch.title, ch.avatar],
  );
  await saveReading(a.id, { followers: ch.subscribers, postsCount: ch.videos, totalViews: ch.views });
  if (!ch.uploads) return 0;

  let written = 0;
  let pageToken: string | undefined;
  let reachedEnd = false;
  const maxPages = opts.fullHistory ? 100 : 1;
  for (let page = 0; page < maxPages; page++) {
    const list = await youtube("playlistItems", {
      part: "contentDetails",
      playlistId: ch.uploads,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    const ids: string[] = (list.items ?? []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
    if (ids.length) {
      const vids = await youtube("videos", { part: "snippet,statistics", id: ids.join(","), maxResults: "50" });
      written += await upsertPosts(
        a.id,
        (vids.items ?? []).map((v: any) => ({
          externalId: String(v.id),
          postedAt: v.snippet?.publishedAt,
          kind: "video",
          caption: v.snippet?.title ?? null,
          permalink: `https://www.youtube.com/watch?v=${v.id}`,
          thumbUrl: v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url ?? null,
          likes: num(v.statistics?.likeCount),
          comments: num(v.statistics?.commentCount),
          views: num(v.statistics?.viewCount),
          insightsIncluded: true,
        })),
      );
    }
    pageToken = list.nextPageToken;
    if (!pageToken) {
      reachedEnd = true;
      break;
    }
  }
  if (opts.fullHistory && reachedEnd) await q(`UPDATE social_accounts SET history_complete = true WHERE id = $1`, [a.id]);
  return written;
}

// ── X ───────────────────────────────────────────────────────────────────────
//
// X is pay-per-read (a post 0.5c, a profile 1c; the same thing read twice in
// one UTC day is charged once). So a scheduled pull reads the profile and the
// newest 50 posts only; the whole history is read once, on a full pull.

async function xApi(path: string, params: Record<string, string>): Promise<any> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new SocialNotConfigured("No X access on this server yet.");
  const url = `https://api.x.com/2/${path}?${new URLSearchParams(params).toString()}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  } catch (e: any) {
    throw new Error(`X: request failed (${e?.name === "TimeoutError" ? "timed out" : "network error"})`);
  }
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 402 || /credit/i.test(String(json?.detail ?? json?.title ?? ""))) {
      throw new Error("X: the account has run out of credit or reached its monthly spending limit.");
    }
    throw new Error(`X: ${json?.detail ?? json?.title ?? json?.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
  }
  return json;
}

/** Look an X account up by id or @handle. Used when connecting and on every pull. */
export async function xProfile(ref: { id?: string | null; handle?: string | null }) {
  const fields = { "user.fields": "public_metrics,profile_image_url,name,username" };
  const json = ref.id ? await xApi(`users/${ref.id}`, fields) : await xApi(`users/by/username/${encodeURIComponent(String(ref.handle))}`, fields);
  const u = json?.data;
  if (!u?.id) throw new Error("X: no account with that name was found.");
  return {
    id: String(u.id),
    name: (u.name as string) ?? null,
    handle: (u.username as string) ?? null,
    avatar: (u.profile_image_url as string) ?? null,
    followers: num(u.public_metrics?.followers_count),
    posts: num(u.public_metrics?.tweet_count),
  };
}

async function syncX(a: AccountRow, opts: SyncOpts): Promise<number> {
  const u = await xProfile({ id: a.external_id, handle: a.handle });
  await q(
    `UPDATE social_accounts SET external_id = COALESCE(external_id, $2), display_name = COALESCE($3, display_name),
            avatar_url = COALESCE($4, avatar_url), connection = 'api' WHERE id = $1`,
    [a.id, u.id, u.name, u.avatar],
  );
  await saveReading(a.id, { followers: u.followers, postsCount: u.posts });

  let written = 0;
  let next: string | undefined;
  let reachedEnd = false;
  // X only lists an account's newest 3,200 posts; 40 pages of 100 covers that.
  const maxPages = opts.fullHistory ? 40 : 1;
  for (let page = 0; page < maxPages; page++) {
    const list = await xApi(`users/${u.id}/tweets`, {
      max_results: opts.fullHistory ? "100" : "50",
      exclude: "retweets,replies",
      "tweet.fields": "created_at,public_metrics,attachments",
      expansions: "attachments.media_keys",
      "media.fields": "type,url,preview_image_url",
      ...(next ? { pagination_token: next } : {}),
    });
    const media = new Map<string, any>((list.includes?.media ?? []).map((m: any) => [String(m.media_key), m]));
    written += await upsertPosts(
      a.id,
      (list.data ?? []).map((t: any) => {
        const m = media.get(String(t.attachments?.media_keys?.[0] ?? ""));
        const pm = t.public_metrics ?? {};
        const shares = num(pm.retweet_count);
        const quotes = num(pm.quote_count);
        return {
          externalId: String(t.id),
          postedAt: t.created_at,
          kind: m?.type === "video" || m?.type === "animated_gif" ? "video" : m ? "image" : "text",
          caption: (t.text as string) ?? null,
          permalink: `https://x.com/${u.handle ?? a.handle}/status/${t.id}`,
          thumbUrl: m?.preview_image_url ?? m?.url ?? null,
          likes: num(pm.like_count),
          comments: num(pm.reply_count),
          shares: shares == null && quotes == null ? null : (shares ?? 0) + (quotes ?? 0),
          views: num(pm.impression_count),
          insightsIncluded: true,
        };
      }),
    );
    next = list.meta?.next_token;
    if (!next) {
      reachedEnd = true;
      break;
    }
  }
  if (opts.fullHistory && reachedEnd) await q(`UPDATE social_accounts SET history_complete = true WHERE id = $1`, [a.id]);
  return written;
}

// ── Picture links expire ────────────────────────────────────────────────────

/** Ask the platform for a fresh picture link for one post. Null if it has none. */
export async function refreshThumb(postId: number): Promise<string | null> {
  const [p] = await q<{ external_id: string; platform: string; account_external: string | null; thumb_url: string | null }>(
    `SELECT p.external_id, a.platform, a.external_id AS account_external, p.thumb_url
     FROM social_posts p JOIN social_accounts a ON a.id = p.account_id WHERE p.id = $1`,
    [postId],
  );
  if (!p) return null;
  let url: string | null = null;
  if (p.platform === "instagram") {
    const m = await graph(`/${p.external_id}`, { fields: "media_url,thumbnail_url" }, metaToken());
    url = m.thumbnail_url ?? m.media_url ?? null;
  } else if (p.platform === "facebook" && p.account_external) {
    const m = await graph(`/${p.external_id}`, { fields: "full_picture" }, await pageToken(p.account_external));
    url = m.full_picture ?? null;
  } else {
    return p.thumb_url;
  }
  if (url) await q(`UPDATE social_posts SET thumb_url = $2, thumb_fetched_at = now() WHERE id = $1`, [postId, url]);
  return url;
}

// ── Running ─────────────────────────────────────────────────────────────────

const PULLERS: Partial<Record<SocialPlatformKey, (a: AccountRow, o: SyncOpts) => Promise<number>>> = {
  instagram: syncInstagram,
  facebook: syncFacebook,
  youtube: syncYoutube,
  x: syncX,
};

export type SocialSyncResult = { accountId: number; label: string; status: "ok" | "error" | "skipped"; posts: number; error: string | null };

async function runOne(a: AccountRow, trigger: string, opts: SyncOpts): Promise<SocialSyncResult> {
  const puller = PULLERS[a.platform];
  const label = `${a.platform} @${a.handle}`;
  if (!puller) return { accountId: a.id, label, status: "skipped", posts: 0, error: null };
  const [run] = await q<{ id: number }>(
    `INSERT INTO social_sync_runs (account_id, trigger) VALUES ($1, $2) RETURNING id`,
    [a.id, trigger],
  );
  let status: SocialSyncResult["status"] = "ok";
  let error: string | null = null;
  let posts = 0;
  try {
    posts = await puller(a, { ...opts, fullHistory: opts.fullHistory || !a.history_complete });
  } catch (e: any) {
    status = e instanceof SocialNotConfigured ? "skipped" : "error";
    error = String(e?.message ?? e).slice(0, 1000);
  }
  await q(`UPDATE social_sync_runs SET status = $2, posts_written = $3, error = $4, finished_at = now() WHERE id = $1`, [
    run.id,
    status,
    posts,
    error,
  ]);
  await q(
    `UPDATE social_accounts SET last_error = $2, last_synced_at = CASE WHEN $3 THEN now() ELSE last_synced_at END WHERE id = $1`,
    // A pull that was skipped (the platform is not switched on yet) is not a failure.
    [a.id, status === "error" ? error : null, status === "ok"],
  );
  if (status === "error") console.error(`[Social] ${label}: ${error}`);
  return { accountId: a.id, label, status, posts, error };
}

/** Carry the Marketing hub's follower readings (kept since Sept 2026) into the history. */
async function copyHubReadings() {
  await q(
    `INSERT INTO social_account_daily (account_id, day, followers, source)
     SELECT a.id, d.day, d.value, 'api'
     FROM social_accounts a
     JOIN marketing_daily d ON d.source_id = a.marketing_source_id AND d.metric = 'followers' AND d.dim_type = 'total'
     ON CONFLICT (account_id, day) DO NOTHING`,
  );
}

export async function runSocialSync(
  trigger: "schedule" | "manual" | "script",
  only?: { accountId?: number; insightBudget?: number; fullHistory?: boolean },
): Promise<{ ran: boolean; reason?: string; discovered?: { found: number; added: number }; results: SocialSyncResult[] }> {
  const lock = await pool.connect();
  const results: SocialSyncResult[] = [];
  let discovered: { found: number; added: number } | undefined;
  try {
    const got = await lock.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK_KEY]);
    if (!got.rows[0]?.ok) return { ran: false, reason: "Another server is already pulling social media.", results };
    try {
      if (!only?.accountId) {
        try {
          discovered = await discoverMetaAccounts();
        } catch (e: any) {
          if (!(e instanceof SocialNotConfigured)) console.error(`[Social] Finding Meta accounts failed: ${e?.message ?? e}`);
        }
      }
      await copyHubReadings();
      const accounts = await q<AccountRow>(
        `SELECT id, platform, external_id, handle, connection, history_complete, marketing_source_id
         FROM social_accounts
         WHERE archived_at IS NULL AND (connection = 'api' OR platform = 'youtube' OR (platform = 'x' AND $2::boolean)) AND ($1::int IS NULL OR id = $1)
         ORDER BY id`,
        [only?.accountId ?? null, Boolean(process.env.X_BEARER_TOKEN)],
      );
      for (const a of accounts) {
        results.push(
          await runOne(a, trigger, { insightBudget: only?.insightBudget ?? 150, fullHistory: Boolean(only?.fullHistory) }),
        );
      }
    } finally {
      await lock.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]).catch(() => {});
    }
  } finally {
    lock.release();
  }
  return { ran: true, discovered, results };
}

// ── Schedule ────────────────────────────────────────────────────────────────

let started = false;

/** Every six hours, behind the same switch as the Marketing hub's pull. */
export function startSocialCron(): void {
  if (started) return;
  started = true;
  if (process.env.MARKETING_HUB_SYNC !== "1") {
    console.log("[Social] Not scheduled — set MARKETING_HUB_SYNC=1 to pull social media.");
    return;
  }
  const tick = async () => {
    try {
      const r = await runSocialSync("schedule");
      if (!r.ran) return;
      const failed = r.results.filter((x) => x.status === "error").length;
      console.log(`[Social] Pulled ${r.results.length} accounts, ${r.results.reduce((s, x) => s + x.posts, 0)} posts, ${failed} failed.`);
    } catch (e: any) {
      console.error("[Social] Sync crashed:", e?.message ?? e);
    }
  };
  setTimeout(() => void tick(), 7 * 60 * 1000);
  setInterval(() => void tick(), 6 * 60 * 60 * 1000);
  console.log("[Social] Social media pull scheduled (every 6h).");
}

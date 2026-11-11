/**
 * Social media — the endpoints behind United Sports Group → Marketing → Social media.
 *
 * Every route: requireAuth → requireTab("social-media") → group workspace only
 * (the same 404-from-anywhere-else gate as the Marketing hub, because
 * canAccessTab passes any slug for an admin of any workspace).
 *
 * 🔴 Never 200-with-zeros: a number the platform did not give is null, and the
 *    page draws "—". A follower change is only given when there is a reading at
 *    the start of the period for every account being added up.
 * 🔴 /thumb/:id is opened by an <img>, which cannot send the workspace header,
 *    so it is gated by requireTabAnywhere instead.
 */
import type { Express, Request, Response } from "express";
import { addDaysIso, nzTodayIso } from "@shared/dashboard";
import {
  SOCIAL_TAB,
  isSocialPlatform,
  parseProfileInput,
  socialBrand,
  socialPeriod,
  socialPlatform,
  type SocialAccount,
  type SocialAccountsResponse,
  type SocialCalendarResponse,
  type SocialOverviewResponse,
  type SocialPost,
  type SocialPostsResponse,
  type SocialSeriesPoint,
} from "@shared/social";
import { requireAuth, requireTab, requireTabAnywhere } from "../auth";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import sharp from "sharp";
import { pool } from "../db";
import { keepWarm, requireHubWorkspace } from "../marketing-hub/common";
import {
  SocialNotConfigured,
  checkOauthState,
  connectTiktok,
  discoverMetaAccounts,
  refreshThumb,
  runSocialSync,
  saveReading,
  signOauthState,
  tiktokAuthUrl,
  tiktokConfigured,
  xProfile,
  youtubeChannel,
} from "./sync";

const BASE = "/api/admin/social";
const NZ = "Pacific/Auckland";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(text, params as any[]);
  return r.rows as T[];
}

class InputError extends Error {}

// ── Small pictures ──────────────────────────────────────────────────────────

const THUMB_DIR = join(tmpdir(), "clubos-social-thumbs");
let thumbsRunning = 0;
const thumbsWaiting: (() => void)[] = [];

/** At most four pictures are fetched and shrunk at once, so a grid of sixty cannot swamp the machine. */
async function withThumbSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (thumbsRunning >= 4) await new Promise<void>((resolve) => thumbsWaiting.push(resolve));
  thumbsRunning++;
  try {
    return await fn();
  } finally {
    thumbsRunning--;
    thumbsWaiting.shift()?.();
  }
}

async function fetchBytes(url: string): Promise<Buffer | null> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!r || !r.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}

async function smallThumb(postId: number): Promise<Buffer | null> {
  const file = join(THUMB_DIR, `${postId}.webp`);
  const cached = await fs.readFile(file).catch(() => null);
  if (cached) return cached;
  return withThumbSlot(async () => {
    const [row] = await q<{ thumb_url: string | null }>(`SELECT thumb_url FROM social_posts WHERE id = $1`, [postId]);
    if (!row?.thumb_url) return null;
    let src = await fetchBytes(row.thumb_url);
    if (!src) {
      const fresh = await refreshThumb(postId).catch(() => null);
      if (fresh) src = await fetchBytes(fresh);
    }
    if (!src) return null;
    const out = await sharp(src).rotate().resize({ width: 480, height: 480, fit: "cover", withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
    await fs.mkdir(THUMB_DIR, { recursive: true }).catch(() => {});
    await fs.writeFile(file, out).catch(() => {});
    return out;
  });
}

type Scope = { brand: string | null; accountId: number | null; platform: string | null; from: string | null; to: string; period: ReturnType<typeof socialPeriod> };

function parseScope(req: Request): Scope {
  const brandRaw = String(req.query.brand ?? "");
  const brand = brandRaw && brandRaw !== "all" ? brandRaw : null;
  if (brand && brand !== "none" && !socialBrand(brand)) throw new InputError("Unknown brand.");
  const accountRaw = req.query.account ? Number(req.query.account) : null;
  if (accountRaw != null && !Number.isInteger(accountRaw)) throw new InputError("Unknown account.");
  const platformRaw = String(req.query.platform ?? "");
  if (platformRaw && !isSocialPlatform(platformRaw)) throw new InputError("Unknown platform.");
  const period = socialPeriod(req.query.period);
  const to = nzTodayIso();
  const from = period.days == null ? null : addDaysIso(to, -(period.days - 1));
  return { brand, accountId: accountRaw, platform: platformRaw || null, from, to, period };
}

/** WHERE for accounts `a`, parameters $1..$3. "none" = not filed under a brand yet. */
const ACCOUNT_SCOPE = `a.archived_at IS NULL
  AND ($1::text IS NULL OR ($1 = 'none' AND a.brand IS NULL) OR a.brand = $1)
  AND ($2::int IS NULL OR a.id = $2)
  AND ($3::text IS NULL OR a.platform = $3)`;
const scopeParams = (s: Scope) => [s.brand, s.accountId, s.platform];

const POST_COLUMNS = `p.id, p.account_id, a.platform, a.brand, a.handle, p.posted_at,
  (p.posted_at AT TIME ZONE '${NZ}')::date::text AS day, p.kind, p.caption, p.permalink,
  p.thumb_url, p.thumb_fetched_at, p.likes, p.comments, p.shares, p.saves, p.views, p.reach, p.clicks,
  (COALESCE(p.likes,0) + COALESCE(p.comments,0) + COALESCE(p.shares,0) + COALESCE(p.saves,0))::bigint AS interactions`;

const n = (v: unknown): number | null => (v == null ? null : Number(v));

function toPost(r: any): SocialPost {
  // Instagram and Facebook picture links stop working after a few days, so they
  // run through /thumb, which also hands back a small picture: the platforms'
  // own files are 300KB–1MB each, and a grid of sixty of those is 30MB.
  const thumb = !r.thumb_url ? null : r.platform === "youtube" ? r.thumb_url : `${BASE}/thumb/${r.id}`;
  return {
    id: Number(r.id),
    accountId: r.account_id,
    platform: r.platform,
    brand: r.brand,
    handle: r.handle,
    postedAt: new Date(r.posted_at).toISOString(),
    day: r.day,
    kind: r.kind,
    caption: r.caption,
    permalink: r.permalink,
    thumb,
    likes: n(r.likes),
    comments: n(r.comments),
    shares: n(r.shares),
    saves: n(r.saves),
    views: n(r.views),
    reach: n(r.reach),
    clicks: n(r.clicks),
    interactions: Number(r.interactions),
  };
}

/**
 * A bucket with no posts is a zero, and has to be on the line: joining only the
 * days that had posts draws a slope across a fortnight of silence.
 */
function fillBuckets(points: SocialSeriesPoint[], bucket: "day" | "week" | "month", from: string | null, to: string): SocialSeriesPoint[] {
  if (!points.length && !from) return [];
  const have = new Map(points.map((p) => [p.day, p.value]));
  const out: SocialSeriesPoint[] = [];
  if (bucket === "month") {
    let [y, m] = (points[0]?.day ?? to).split("-").map(Number);
    const end = to.slice(0, 7);
    for (let i = 0; i < 600; i++) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      if (key > end) break;
      out.push({ day: `${key}-01`, value: have.get(`${key}-01`) ?? 0 });
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return out;
  }
  const step = bucket === "week" ? 7 : 1;
  // Weeks start on the Monday Postgres gave; days start at the period's first day.
  let day = bucket === "week" ? points[0]?.day ?? to : from ?? points[0].day;
  for (let i = 0; i < 800 && day <= to; i++) {
    out.push({ day, value: have.get(day) ?? 0 });
    day = addDaysIso(day, step);
  }
  return out;
}

function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      if (e instanceof InputError) return res.status(400).json({ message: e.message });
      console.error(`[Social] ${req.method} ${req.path}:`, e?.message ?? e);
      res.status(500).json({ message: "Social media could not be loaded. Try again." });
    }
  };
}

async function listAccounts(s: Scope): Promise<SocialAccount[]> {
  const rows = await q(
    `SELECT a.id, a.platform, a.brand, a.handle, a.display_name, a.profile_url, a.avatar_url, a.connection,
            a.history_complete, a.last_synced_at, a.last_error,
            lr.followers, lr.day::text AS followers_day, lr.source AS followers_source,
            (SELECT d.followers FROM social_account_daily d
              WHERE d.account_id = a.id AND d.followers IS NOT NULL AND $4::date IS NOT NULL AND d.day <= $4::date
              ORDER BY d.day DESC LIMIT 1) AS followers_start,
            (SELECT count(*) FROM social_posts p WHERE p.account_id = a.id)::int AS posts_stored,
            (SELECT count(*) FROM social_posts p WHERE p.account_id = a.id
               AND ($4::date IS NULL OR (p.posted_at AT TIME ZONE '${NZ}')::date >= $4::date))::int AS posts_period,
            (SELECT min(p.posted_at) FROM social_posts p WHERE p.account_id = a.id) AS first_post
     FROM social_accounts a
     LEFT JOIN LATERAL (
       SELECT d.followers, d.day, d.source FROM social_account_daily d
       WHERE d.account_id = a.id AND d.followers IS NOT NULL ORDER BY d.day DESC LIMIT 1) lr ON true
     WHERE ${ACCOUNT_SCOPE}
     ORDER BY a.brand NULLS LAST, a.platform, a.id`,
    [...scopeParams(s), s.from],
  );
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    brand: r.brand,
    handle: r.handle,
    displayName: r.display_name,
    profileUrl: r.profile_url,
    avatarUrl: r.avatar_url,
    connection: r.connection,
    followers: n(r.followers),
    followersAt: r.followers_day,
    followersSource: r.followers_source,
    followersAtStart: n(r.followers_start),
    postsStored: r.posts_stored,
    postsInPeriod: r.posts_period,
    firstPostAt: r.first_post ? new Date(r.first_post).toISOString() : null,
    historyComplete: r.history_complete,
    lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : null,
    lastError: r.last_error,
  }));
}

async function syncState(): Promise<{ nextSyncAt: string | null; syncing: boolean }> {
  const [row] = await q<{ next: Date | null; running: boolean }>(
    `SELECT (SELECT max(started_at) + interval '10 minutes' FROM social_sync_runs WHERE trigger = 'manual') AS next,
            EXISTS (SELECT 1 FROM social_sync_runs WHERE status = 'running' AND started_at > now() - interval '40 minutes') AS running`,
  );
  const next = row?.next ? new Date(row.next) : null;
  return { nextSyncAt: next && next.getTime() > Date.now() ? next.toISOString() : null, syncing: Boolean(row?.running) };
}

export function registerSocialRoutes(app: Express) {
  const gate = [requireAuth, requireTab(SOCIAL_TAB), requireHubWorkspace] as const;

  // Nothing reads this answer: running the account list every few minutes keeps
  // its rows in the database's memory, so the first person in does not wait
  // 2–3 seconds for a cold read. The page itself is never served from a cache
  // (a brand change or a new account must show at once).
  keepWarm(
    "social-accounts-db",
    () => {
      const to = nzTodayIso();
      return listAccounts({ brand: null, accountId: null, platform: null, from: addDaysIso(to, -29), to, period: socialPeriod("30d") });
    },
    () => "warm|social-accounts",
  );

  // ── Accounts ──────────────────────────────────────────────────────────────
  app.get(`${BASE}/accounts`, ...gate, handle(async (req, res) => {
    // The account list is never narrowed to one account: the strip shows them all.
    const s = { ...parseScope(req), accountId: null, platform: null };
    const [accounts, state] = await Promise.all([listAccounts(s), syncState()]);
    const body: SocialAccountsResponse = { today: s.to, period: s.period.key, accounts, ...state, tiktokSignIn: tiktokConfigured() };
    res.json(body);
  }));

  // ── Overview ──────────────────────────────────────────────────────────────
  app.get(`${BASE}/overview`, ...gate, handle(async (req, res) => {
    const s = parseScope(req);
    const params = [...scopeParams(s), s.from];
    const inPeriod = `($4::date IS NULL OR (p.posted_at AT TIME ZONE '${NZ}')::date >= $4::date)`;
    const bucket = s.period.days == null ? "month" : s.period.days > 90 ? "week" : "day";

    const [accounts, totals, byKind, over, top, readings, daily] = await Promise.all([
      listAccounts(s),
      q(
        `SELECT count(*)::int AS posts,
                COALESCE(sum(COALESCE(p.likes,0) + COALESCE(p.comments,0) + COALESCE(p.shares,0) + COALESCE(p.saves,0)),0)::bigint AS interactions,
                sum(p.views)::bigint AS views
         FROM social_posts p JOIN social_accounts a ON a.id = p.account_id
         WHERE ${ACCOUNT_SCOPE} AND ${inPeriod}`,
        params,
      ),
      q(
        `SELECT p.kind, count(*)::int AS posts,
                COALESCE(sum(COALESCE(p.likes,0) + COALESCE(p.comments,0) + COALESCE(p.shares,0) + COALESCE(p.saves,0)),0)::bigint AS interactions,
                sum(p.views)::bigint AS views
         FROM social_posts p JOIN social_accounts a ON a.id = p.account_id
         WHERE ${ACCOUNT_SCOPE} AND ${inPeriod} GROUP BY p.kind ORDER BY posts DESC`,
        params,
      ),
      q(
        `SELECT date_trunc('${bucket}', p.posted_at AT TIME ZONE '${NZ}')::date::text AS day, count(*)::int AS value
         FROM social_posts p JOIN social_accounts a ON a.id = p.account_id
         WHERE ${ACCOUNT_SCOPE} AND ${inPeriod} GROUP BY 1 ORDER BY 1`,
        params,
      ),
      q(
        `SELECT ${POST_COLUMNS} FROM social_posts p JOIN social_accounts a ON a.id = p.account_id
         WHERE ${ACCOUNT_SCOPE} AND ${inPeriod}
         ORDER BY interactions DESC, p.posted_at DESC LIMIT 8`,
        params,
      ),
      q<{ account_id: number; day: string; followers: string }>(
        `SELECT d.account_id, d.day::text AS day, d.followers
         FROM social_account_daily d JOIN social_accounts a ON a.id = d.account_id
         WHERE ${ACCOUNT_SCOPE} AND d.followers IS NOT NULL ORDER BY d.day`,
        scopeParams(s),
      ),
      q<{ day: string; metric: string; value: string; sources: number }>(
        `SELECT d.day::text AS day, d.metric, sum(d.value)::bigint AS value, count(DISTINCT d.source_id)::int AS sources
         FROM marketing_daily d JOIN social_accounts a ON a.marketing_source_id = d.source_id
         WHERE ${ACCOUNT_SCOPE} AND d.dim_type = 'total' AND d.metric IN ('views','interactions','reach')
           AND ($4::date IS NULL OR d.day >= $4::date) AND d.day <= $5::date
         GROUP BY 1, 2 ORDER BY 1`,
        [...params, s.to],
      ),
    ]);

    // Followers: only accounts that have a reading are added up, and a change is
    // only given when every one of them also has a reading at the period start.
    const counted = accounts.filter((a) => a.followers != null);
    const total = counted.length ? counted.reduce((sum, a) => sum + (a.followers ?? 0), 0) : null;
    const atStart =
      counted.length && counted.every((a) => a.followersAtStart != null)
        ? counted.reduce((sum, a) => sum + (a.followersAtStart ?? 0), 0)
        : null;

    // Follower line: carry each account's last reading forward, and only draw
    // accounts that already had a reading on the line's first day — an account
    // connected later would otherwise look like a jump in followers.
    const followerSeries: SocialSeriesPoint[] = [];
    if (readings.length) {
      const firstByAccount = new Map<number, string>();
      for (const r of readings) if (!firstByAccount.has(r.account_id)) firstByAccount.set(r.account_id, r.day);
      const earliest = readings[0].day;
      const start = s.from && s.from > earliest ? s.from : earliest;
      const drawn = new Set(Array.from(firstByAccount.entries()).filter(([, d]) => d <= start).map(([id]) => id));
      if (drawn.size) {
        const last = new Map<number, number>();
        let i = 0;
        for (let day = start; day <= s.to; day = addDaysIso(day, 1)) {
          while (i < readings.length && readings[i].day <= day) {
            if (drawn.has(readings[i].account_id)) last.set(readings[i].account_id, Number(readings[i].followers));
            i++;
          }
          if (last.size === drawn.size) followerSeries.push({ day, value: Array.from(last.values()).reduce((a, b) => a + b, 0) });
        }
      }
    }

    const series = (metric: string) => daily.filter((d) => d.metric === metric).map((d) => ({ day: d.day, value: Number(d.value) }));
    // Daily reach counts people; two accounts' reach added together counts some
    // people twice, so it is only shown for one account on its own.
    const oneSource = daily.every((d) => d.sources <= 1);

    const body: SocialOverviewResponse = {
      period: s.period.key,
      range: { from: s.from, to: s.to },
      followers: { total, atStart, accountsCounted: counted.length, accountsMissing: accounts.length - counted.length },
      posts: totals[0].posts,
      interactions: Number(totals[0].interactions),
      postViews: n(totals[0].views),
      daily: daily.length ? { views: series("views"), interactions: series("interactions"), reach: oneSource ? series("reach") : [] } : null,
      followerSeries,
      postsOverTime: { bucket, points: fillBuckets(over.map((r: any) => ({ day: r.day, value: r.value })), bucket, s.from, s.to) },
      byKind: byKind.map((r: any) => ({ kind: r.kind, posts: r.posts, interactions: Number(r.interactions), views: n(r.views) })),
      topPosts: top.map(toPost),
    };
    res.json(body);
  }));

  // ── Posts ─────────────────────────────────────────────────────────────────
  app.get(`${BASE}/posts`, ...gate, handle(async (req, res) => {
    const s = parseScope(req);
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    if ((from && !ISO_DAY.test(from)) || (to && !ISO_DAY.test(to))) throw new InputError("Dates must be YYYY-MM-DD.");
    const kind = req.query.kind ? String(req.query.kind) : null;
    const sort = String(req.query.sort ?? "recent");
    const order =
      sort === "top" ? "interactions DESC, p.posted_at DESC"
      : sort === "views" ? "p.views DESC NULLS LAST, p.posted_at DESC"
      : sort === "oldest" ? "p.posted_at ASC"
      : "p.posted_at DESC";
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 60));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const where = `${ACCOUNT_SCOPE}
      AND ($4::date IS NULL OR (p.posted_at AT TIME ZONE '${NZ}')::date >= $4::date)
      AND ($5::date IS NULL OR (p.posted_at AT TIME ZONE '${NZ}')::date <= $5::date)
      AND ($6::text IS NULL OR p.kind = $6)`;
    // An explicit from/to (the calendar) wins over the period.
    const params = [...scopeParams(s), from ?? (to ? null : s.from), to, kind];
    const [[count], rows] = await Promise.all([
      q<{ total: number }>(`SELECT count(*)::int AS total FROM social_posts p JOIN social_accounts a ON a.id = p.account_id WHERE ${where}`, params),
      q(
        `SELECT ${POST_COLUMNS} FROM social_posts p JOIN social_accounts a ON a.id = p.account_id
         WHERE ${where} ORDER BY ${order} LIMIT $7 OFFSET $8`,
        [...params, limit, offset],
      ),
    ]);
    const body: SocialPostsResponse = { total: count.total, posts: rows.map(toPost) };
    res.json(body);
  }));

  // ── Calendar: posts per day, all time ─────────────────────────────────────
  app.get(`${BASE}/calendar`, ...gate, handle(async (req, res) => {
    const s = parseScope(req);
    const rows = await q<{ day: string; posts: number }>(
      `SELECT (p.posted_at AT TIME ZONE '${NZ}')::date::text AS day, count(*)::int AS posts
       FROM social_posts p JOIN social_accounts a ON a.id = p.account_id
       WHERE ${ACCOUNT_SCOPE} GROUP BY 1 ORDER BY 1`,
      scopeParams(s),
    );
    const body: SocialCalendarResponse = {
      days: rows,
      firstDay: rows[0]?.day ?? null,
      lastDay: rows[rows.length - 1]?.day ?? null,
    };
    res.json(body);
  }));

  // ── Connect an account by link ────────────────────────────────────────────
  app.post(`${BASE}/accounts`, ...gate, handle(async (req, res) => {
    const platform = req.body?.platform;
    if (!isSocialPlatform(platform)) throw new InputError("Pick a platform.");
    const brand = req.body?.brand ? String(req.body.brand) : null;
    if (brand && !socialBrand(brand)) throw new InputError("Pick a brand.");
    const def = socialPlatform(platform);
    if (def.mode === "auto") {
      throw new InputError(`${def.label} accounts are found automatically. Press "Find accounts"; if one is missing, it needs adding to the club's Meta business account.`);
    }
    const parsed = parseProfileInput(platform, req.body?.profile);
    if ("error" in parsed) throw new InputError(parsed.error);

    let externalId: string | null = null;
    let displayName: string | null = null;
    let avatar: string | null = null;
    let connection: "api" | "link" = "link";
    let note: string | null = null;
    let reading: { followers: number | null; postsCount: number | null; totalViews: number | null } | null = null;
    let handleName = parsed.handle;
    if (platform === "youtube") {
      try {
        const ch = await youtubeChannel({ channelId: parsed.channelId, handle: parsed.handle });
        externalId = ch.id;
        displayName = ch.title;
        avatar = ch.avatar;
        handleName = ch.handle ?? parsed.handle;
        connection = "api";
        reading = { followers: ch.subscribers, postsCount: ch.videos, totalViews: ch.views };
      } catch (e: any) {
        if (!(e instanceof SocialNotConfigured)) throw new InputError(String(e?.message ?? e));
        note = "Saved. ClubOS will read this channel once YouTube access is switched on.";
      }
    }
    if (platform === "x") {
      try {
        const u = await xProfile({ handle: parsed.handle });
        externalId = u.id;
        displayName = u.name;
        avatar = u.avatar;
        handleName = u.handle ?? parsed.handle;
        connection = "api";
        reading = { followers: u.followers, postsCount: u.posts, totalViews: null };
      } catch (e: any) {
        if (!(e instanceof SocialNotConfigured)) throw new InputError(String(e?.message ?? e));
        note = "Saved. ClubOS will read this account once X access is switched on.";
      }
    }
    const dup = await q(
      `SELECT 1 FROM social_accounts WHERE platform = $1 AND archived_at IS NULL
         AND (lower(handle) = lower($2) OR ($3::text IS NOT NULL AND external_id = $3))`,
      [platform, handleName, externalId],
    );
    if (dup.length) throw new InputError(`That ${def.label} account is already connected.`);
    const [row] = await q<{ id: number }>(
      `INSERT INTO social_accounts (platform, brand, external_id, handle, display_name, profile_url, avatar_url, connection, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (platform, external_id) WHERE external_id IS NOT NULL DO UPDATE
         SET archived_at = NULL, brand = EXCLUDED.brand, handle = EXCLUDED.handle, connection = EXCLUDED.connection
       RETURNING id`,
      [platform, brand, externalId, handleName, displayName, parsed.profileUrl, avatar, connection, req.session.userId ?? null],
    );
    if (reading) await saveReading(row.id, reading);
    // A channel that could be read is pulled straight away, in the background.
    if (connection === "api") void runSocialSync("manual", { accountId: row.id }).catch(() => {});
    res.status(201).json({ id: row.id, connection, note });
  }));

  // ── File under a brand · remove ───────────────────────────────────────────
  app.patch(`${BASE}/accounts/:id`, ...gate, handle(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new InputError("Unknown account.");
    const sets: string[] = [];
    const params: unknown[] = [id];
    if ("brand" in (req.body ?? {})) {
      const brand = req.body.brand ? String(req.body.brand) : null;
      if (brand && !socialBrand(brand)) throw new InputError("Pick a brand.");
      params.push(brand);
      sets.push(`brand = $${params.length}`);
    }
    if (req.body?.archived === true) sets.push(`archived_at = now()`);
    if (req.body?.archived === false) sets.push(`archived_at = NULL`);
    if (!sets.length) throw new InputError("Nothing to change.");
    const rows = await q(`UPDATE social_accounts SET ${sets.join(", ")} WHERE id = $1 RETURNING id`, params);
    if (!rows.length) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  }));

  // ── Type in today's follower count (accounts ClubOS cannot read) ──────────
  app.post(`${BASE}/accounts/:id/followers`, ...gate, handle(async (req, res) => {
    const id = Number(req.params.id);
    const followers = Number(req.body?.followers);
    if (!Number.isInteger(id)) throw new InputError("Unknown account.");
    if (!Number.isInteger(followers) || followers < 0 || followers > 2_000_000_000) throw new InputError("Type the follower count as a whole number.");
    const [a] = await q<{ connection: string }>(`SELECT connection FROM social_accounts WHERE id = $1 AND archived_at IS NULL`, [id]);
    if (!a) return res.status(404).json({ message: "Not found" });
    if (a.connection === "api") throw new InputError("ClubOS reads this account's followers itself.");
    await saveReading(id, { followers }, "manual", req.session.userId ?? null);
    res.json({ ok: true });
  }));

  // ── Find accounts + pull now ──────────────────────────────────────────────
  app.post(`${BASE}/discover`, ...gate, handle(async (_req, res) => {
    try {
      res.json(await discoverMetaAccounts());
    } catch (e: any) {
      if (e instanceof SocialNotConfigured) return res.status(503).json({ message: "The Meta business login is not set up on this server." });
      res.status(502).json({ message: String(e?.message ?? "Meta could not be reached.") });
    }
  }));

  app.post(`${BASE}/sync`, ...gate, handle(async (_req, res) => {
    const state = await syncState();
    if (state.syncing) return res.status(409).json({ message: "A pull is already running." });
    if (state.nextSyncAt) return res.status(429).json({ message: "Pulled a few minutes ago. Try again shortly.", nextSyncAt: state.nextSyncAt });
    // Runs in the background: a full pull takes minutes, and the page polls.
    void runSocialSync("manual").catch((e) => console.error("[Social] Manual sync crashed:", e?.message ?? e));
    res.status(202).json({ started: true });
  }));

  // ── A post's picture, small ───────────────────────────────────────────────
  // Fetched from the platform, shrunk to 480px WebP (~25KB) and kept on this
  // machine's disk. If the platform's link has expired, a fresh one is asked for.
  // ── TikTok sign-in ────────────────────────────────────────────────────────
  // Both are opened by the browser itself (a link, then TikTok sending the
  // person back), so neither can carry the workspace header: requireTabAnywhere.
  const back = (res: Response, result: string, extra = "") =>
    res.redirect(`/admin/social-media?view=accounts&tiktok=${result}${extra}`);

  app.get(`${BASE}/connect/tiktok`, requireAuth, requireTabAnywhere(SOCIAL_TAB), (req, res) => {
    try {
      res.redirect(tiktokAuthUrl(signOauthState(req.session.userId!)));
    } catch {
      back(res, "off");
    }
  });

  app.get(`${BASE}/oauth/tiktok/callback`, requireAuth, requireTabAnywhere(SOCIAL_TAB), async (req, res) => {
    if (!checkOauthState(req.query.state, req.session.userId!)) return back(res, "expired");
    if (req.query.error || !req.query.code) return back(res, "declined");
    try {
      const r = await connectTiktok(String(req.query.code), req.session.userId!);
      void runSocialSync("manual", { accountId: r.accountId }).catch(() => {});
      back(res, r.added ? "added" : "connected", `&name=${encodeURIComponent(r.handle)}`);
    } catch (e: any) {
      console.error(`[Social] TikTok sign-in failed: ${String(e?.message ?? e).slice(0, 300)}`);
      back(res, "failed");
    }
  });

  // ── Small pictures ────────────────────────────────────────────────────────
  app.get(`${BASE}/thumb/:id`, requireAuth, requireTabAnywhere(SOCIAL_TAB), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).end();
    try {
      const bytes = await smallThumb(id);
      if (!bytes) return res.status(404).end();
      res.setHeader("Content-Type", "image/webp");
      res.setHeader("Cache-Control", "private, max-age=2592000, immutable");
      res.end(bytes);
    } catch {
      res.status(404).end();
    }
  });
}

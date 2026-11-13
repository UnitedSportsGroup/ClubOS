/**
 * Social media labels — the Feed and Labels views of Marketing → Social media.
 *
 * Same gate as the rest of the tab (requireAuth → requireTab("social-media") →
 * group workspace only), handed in by registerSocialRoutes.
 *
 * 🔴 Every total is read from the posts' own numbers at request time and counts
 *    CONFIRMED labels only. Rambo's unchecked suggestions ride beside the total
 *    as `toCheck`, never inside it.
 * 🔴 Views are added up; "people reached" never is (shared/social-labels.ts).
 */
import type { Express, Request, RequestHandler } from "express";
import {
  LABEL_RUN_MAX,
  isLabelKind,
  labelWindow,
  parseLabelInput,
  previousWindow,
  type AdCost,
  type FeedPost,
  type FeedResponse,
  type LabelFindState,
  type LabelPlatformRow,
  type LabelReportResponse,
  type LabelSummaryResponse,
  type LabelSummaryRow,
  type LabelWindow,
  type LabelsResponse,
  type PostLabel,
  type SocialLabel,
} from "@shared/social-labels";
import { isSocialPlatform } from "@shared/social";
import { addDaysIso, nzTodayIso } from "@shared/dashboard";
import { ACCOUNT_SCOPE, InputError, POST_COLUMNS, handle, parseScope, q, scopeParams, toPost, type Scope } from "./routes";
import { labelFindState, startLabelRun, stopLabelRun } from "./label-finder";

const BASE = "/api/admin/social";
const NZ = "Pacific/Auckland";
const DAY = `(p.posted_at AT TIME ZONE '${NZ}')::date`;
const INTERACTIONS = `(COALESCE(p.likes,0) + COALESCE(p.comments,0) + COALESCE(p.shares,0) + COALESCE(p.saves,0))`;

const toLabel = (r: any): SocialLabel => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  hint: r.hint,
  partnerId: r.partner_id,
  archived: r.archived_at != null,
});

export async function liveLabels(): Promise<SocialLabel[]> {
  const rows = await q(`SELECT id, kind, name, hint, partner_id, archived_at FROM social_labels WHERE archived_at IS NULL ORDER BY kind, lower(name)`);
  return rows.map(toLabel);
}

function windowOf(req: Request): { window: LabelWindow; year: string; month: string | null } {
  const year = String(req.query.year ?? "all");
  const monthRaw = req.query.month ? String(req.query.month) : null;
  if (year !== "all" && !/^\d{4}$/.test(year)) throw new InputError("Unknown year.");
  if (monthRaw && !/^(0[1-9]|1[0-2])$/.test(monthRaw)) throw new InputError("Unknown month.");
  const month = year === "all" ? null : monthRaw;
  return { window: labelWindow(year, month), year, month };
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

/** Confirmed totals per label and platform inside one window. */
async function totals(s: Scope, w: LabelWindow, labelId: number | null) {
  return q<{ label_id: number; platform: string; posts: number; views: string | null; no_views: number; interactions: string; to_check: number; likes: string; comments: string; shares: string; saves: string; reach_sum: string; reach_posts: number }>(
    `SELECT pl.label_id, a.platform,
            count(*) FILTER (WHERE pl.confirmed_at IS NOT NULL)::int AS posts,
            sum(p.views) FILTER (WHERE pl.confirmed_at IS NOT NULL) AS views,
            count(*) FILTER (WHERE pl.confirmed_at IS NOT NULL AND p.views IS NULL)::int AS no_views,
            COALESCE(sum(${INTERACTIONS}) FILTER (WHERE pl.confirmed_at IS NOT NULL), 0) AS interactions,
            COALESCE(sum(p.likes) FILTER (WHERE pl.confirmed_at IS NOT NULL), 0) AS likes,
            COALESCE(sum(p.comments) FILTER (WHERE pl.confirmed_at IS NOT NULL), 0) AS comments,
            COALESCE(sum(p.shares) FILTER (WHERE pl.confirmed_at IS NOT NULL), 0) AS shares,
            COALESCE(sum(p.saves) FILTER (WHERE pl.confirmed_at IS NOT NULL), 0) AS saves,
            COALESCE(sum(p.reach) FILTER (WHERE pl.confirmed_at IS NOT NULL), 0) AS reach_sum,
            count(p.reach) FILTER (WHERE pl.confirmed_at IS NOT NULL)::int AS reach_posts,
            count(*) FILTER (WHERE pl.confirmed_at IS NULL)::int AS to_check
     FROM social_post_labels pl
     JOIN social_posts p ON p.id = pl.post_id
     JOIN social_accounts a ON a.id = p.account_id
     WHERE ${ACCOUNT_SCOPE}
       AND pl.rejected_at IS NULL
       AND ($4::date IS NULL OR ${DAY} >= $4::date)
       AND ($5::date IS NULL OR ${DAY} <= $5::date)
       AND ($6::int IS NULL OR pl.label_id = $6)
     GROUP BY 1, 2`,
    [...scopeParams(s), w.from, w.to, labelId],
  );
}

async function summaryRows(s: Scope, w: LabelWindow, prev: LabelWindow | null, labels: SocialLabel[], labelId: number | null): Promise<LabelSummaryRow[]> {
  const [now, before] = await Promise.all([totals(s, w, labelId), prev ? totals(s, prev, labelId) : Promise.resolve([])]);
  return labels.map((label) => {
    const mine = now.filter((r) => r.label_id === label.id);
    const byPlatform: LabelPlatformRow[] = mine
      .filter((r) => r.posts > 0)
      .map((r) => ({
        platform: r.platform as any,
        posts: r.posts,
        // Every post on this platform lacking a view count leaves the sum NULL: say "no number", not 0.
        views: num(r.views),
        postsWithoutViews: r.no_views,
        interactions: Number(r.interactions),
        likes: Number(r.likes),
        comments: Number(r.comments),
        shares: Number(r.shares),
        saves: Number(r.saves),
        reachSum: Number(r.reach_sum),
        reachPosts: r.reach_posts,
      }))
      .sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
    const anyViews = byPlatform.some((p) => p.views != null);
    const old = before.filter((r) => r.label_id === label.id);
    const oldAnyViews = old.some((r) => r.views != null && r.posts > 0);
    return {
      label,
      posts: byPlatform.reduce((t, p) => t + p.posts, 0),
      views: anyViews ? byPlatform.reduce((t, p) => t + (p.views ?? 0), 0) : null,
      postsWithoutViews: byPlatform.reduce((t, p) => t + p.postsWithoutViews, 0),
      interactions: byPlatform.reduce((t, p) => t + p.interactions, 0),
      likes: byPlatform.reduce((t, p) => t + p.likes, 0),
      comments: byPlatform.reduce((t, p) => t + p.comments, 0),
      shares: byPlatform.reduce((t, p) => t + p.shares, 0),
      saves: byPlatform.reduce((t, p) => t + p.saves, 0),
      reachSum: byPlatform.reduce((t, p) => t + p.reachSum, 0),
      reachPosts: byPlatform.reduce((t, p) => t + p.reachPosts, 0),
      byPlatform,
      previous: prev
        ? { posts: old.reduce((t, r) => t + r.posts, 0), views: oldAnyViews ? old.reduce((t, r) => t + Number(r.views ?? 0), 0) : null }
        : null,
      toCheck: mine.reduce((t, r) => t + r.to_check, 0),
    };
  });
}

/** What the club's own Meta ads cost for the views they bought, last 12 months. */
async function adCost(): Promise<AdCost> {
  const to = nzTodayIso();
  const from = addDaysIso(to, -364);
  const [r] = await q<{ spend: string | null; impressions: string | null }>(
    `SELECT sum(d.value) FILTER (WHERE d.metric = 'spend_cents') AS spend,
            sum(d.value) FILTER (WHERE d.metric = 'impressions') AS impressions
     FROM marketing_daily d JOIN marketing_sources s ON s.id = d.source_id
     WHERE s.platform = 'meta_ads' AND d.dim_type = 'campaign' AND d.day BETWEEN $1::date AND $2::date`,
    [from, to],
  ).catch(() => [] as any[]);
  const spendCents = Number(r?.spend ?? 0);
  const impressions = Number(r?.impressions ?? 0);
  return spendCents > 0 && impressions > 0 ? { spendCents, impressions, from, to } : null;
}

async function labelsFor(postIds: number[]): Promise<Map<number, PostLabel[]>> {
  const out = new Map<number, PostLabel[]>();
  if (!postIds.length) return out;
  const rows = await q(
    `SELECT pl.post_id, pl.label_id, l.kind, l.name, pl.source, pl.reason, pl.confirmed_at
     FROM social_post_labels pl JOIN social_labels l ON l.id = pl.label_id
     WHERE pl.post_id = ANY($1::bigint[]) AND pl.rejected_at IS NULL
     ORDER BY l.kind, lower(l.name)`,
    [postIds],
  );
  for (const r of rows) {
    const id = Number(r.post_id);
    const list = out.get(id) ?? [];
    list.push({ labelId: r.label_id, kind: r.kind, name: r.name, status: r.confirmed_at ? "confirmed" : "suggested", source: r.source, reason: r.reason });
    out.set(id, list);
  }
  return out;
}

const intParam = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new InputError("Not found.");
  return n;
};

export function registerSocialLabelRoutes(app: Express, gate: readonly RequestHandler[]) {
  // ── The labels themselves ─────────────────────────────────────────────────
  app.get(`${BASE}/labels`, ...gate, handle(async (_req, res) => {
    const body: LabelsResponse = { labels: await liveLabels() };
    res.json(body);
  }));

  app.post(`${BASE}/labels`, ...gate, handle(async (req, res) => {
    const v = parseLabelInput(req.body);
    if ("error" in v) throw new InputError(v.error);
    const [dupe] = await q(`SELECT id FROM social_labels WHERE kind = $1 AND lower(name) = lower($2) AND archived_at IS NULL`, [v.kind, v.name]);
    if (dupe) throw new InputError(`There is already a label called "${v.name}".`);
    const [row] = await q(
      `INSERT INTO social_labels (kind, name, hint, partner_id, created_by) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, kind, name, hint, partner_id, archived_at`,
      [v.kind, v.name, v.hint, v.partnerId, req.session.userId ?? null],
    );
    res.status(201).json(toLabel(row));
  }));

  app.patch(`${BASE}/labels/:id`, ...gate, handle(async (req, res) => {
    const id = intParam(req.params.id);
    const [cur] = await q(`SELECT id, kind, name, hint, partner_id, archived_at FROM social_labels WHERE id = $1`, [id]);
    if (!cur) return res.status(404).json({ message: "Not found" });
    if (typeof req.body?.archived === "boolean") {
      // Removing a label archives it: the posts it was on keep their history.
      const [row] = await q(
        `UPDATE social_labels SET archived_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1
         RETURNING id, kind, name, hint, partner_id, archived_at`,
        [id, req.body.archived],
      );
      return res.json(toLabel(row));
    }
    const v = parseLabelInput({ kind: cur.kind, name: req.body?.name ?? cur.name, hint: req.body?.hint ?? cur.hint, partnerId: cur.partner_id });
    if ("error" in v) throw new InputError(v.error);
    const [dupe] = await q(`SELECT id FROM social_labels WHERE kind = $1 AND lower(name) = lower($2) AND archived_at IS NULL AND id <> $3`, [v.kind, v.name, id]);
    if (dupe) throw new InputError(`There is already a label called "${v.name}".`);
    const [row] = await q(`UPDATE social_labels SET name = $2, hint = $3 WHERE id = $1 RETURNING id, kind, name, hint, partner_id, archived_at`, [id, v.name, v.hint]);
    res.json(toLabel(row));
  }));

  // ── The feed: posts with their labels ─────────────────────────────────────
  app.get(`${BASE}/feed`, ...gate, handle(async (req, res) => {
    const s = parseScope(req);
    const filter = String(req.query.label ?? "all");
    const labelId = /^\d+$/.test(filter) ? Number(filter) : null;
    if (!labelId && !["all", "none", "check"].includes(filter)) throw new InputError("Unknown label.");
    const only = String(req.query.status ?? "");
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    // A year (and month) wins over the page's period: a label's own report links here by year.
    const explicit = req.query.year ? windowOf(req).window : null;
    const from = explicit ? explicit.from : req.query.period ? s.from : null;
    const to = explicit ? explicit.to : null;
    const labelClause =
      labelId != null
        ? `AND EXISTS (SELECT 1 FROM social_post_labels pl WHERE pl.post_id = p.id AND pl.label_id = $6 AND pl.rejected_at IS NULL
             ${only === "suggested" ? "AND pl.confirmed_at IS NULL" : only === "confirmed" ? "AND pl.confirmed_at IS NOT NULL" : ""})`
        : filter === "none"
          ? `AND $6::int IS NULL AND NOT EXISTS (SELECT 1 FROM social_post_labels pl WHERE pl.post_id = p.id AND pl.rejected_at IS NULL)`
          : filter === "check"
            ? `AND $6::int IS NULL AND EXISTS (SELECT 1 FROM social_post_labels pl WHERE pl.post_id = p.id AND pl.rejected_at IS NULL AND pl.confirmed_at IS NULL)`
            : `AND $6::int IS NULL`;
    const where = `${ACCOUNT_SCOPE}
      AND ($4::date IS NULL OR ${DAY} >= $4::date)
      AND ($5::date IS NULL OR ${DAY} <= $5::date)
      ${labelClause}`;
    const params = [...scopeParams(s), from, to, labelId];
    const [[count], rows] = await Promise.all([
      q<{ total: number }>(`SELECT count(*)::int AS total FROM social_posts p JOIN social_accounts a ON a.id = p.account_id WHERE ${where}`, params),
      q(
        `SELECT ${POST_COLUMNS} FROM social_posts p JOIN social_accounts a ON a.id = p.account_id
         WHERE ${where} ORDER BY p.posted_at DESC LIMIT $7 OFFSET $8`,
        [...params, limit, offset],
      ),
    ]);
    const posts = rows.map(toPost);
    const labels = await labelsFor(posts.map((p) => p.id));
    const body: FeedResponse = {
      total: count.total,
      posts: posts.map((p): FeedPost => ({ ...p, labels: labels.get(p.id) ?? [], large: p.thumb && p.thumb.startsWith(BASE) ? `${p.thumb}?size=l` : p.thumb })),
    };
    res.json(body);
  }));

  // ── Put a label on a post, or take it off ─────────────────────────────────
  app.post(`${BASE}/posts/:id/labels`, ...gate, handle(async (req, res) => {
    const postId = intParam(req.params.id);
    const labelId = intParam(req.body?.labelId);
    const me = req.session.userId ?? null;
    const [[post], [label]] = await Promise.all([
      q(`SELECT id FROM social_posts WHERE id = $1`, [postId]),
      q(`SELECT id FROM social_labels WHERE id = $1 AND archived_at IS NULL`, [labelId]),
    ]);
    if (!post || !label) return res.status(404).json({ message: "Not found" });
    // A suggestion Rambo made (or one somebody rejected earlier) becomes confirmed; otherwise a new row.
    await q(
      `INSERT INTO social_post_labels (post_id, label_id, source, confirmed_at, confirmed_by, created_by)
       VALUES ($1, $2, 'person', now(), $3, $3)
       ON CONFLICT (post_id, label_id) DO UPDATE
         SET confirmed_at = COALESCE(social_post_labels.confirmed_at, now()),
             confirmed_by = COALESCE(social_post_labels.confirmed_by, $3),
             rejected_at = NULL, rejected_by = NULL`,
      [postId, labelId, me],
    );
    res.json({ labels: (await labelsFor([postId])).get(postId) ?? [] });
  }));

  app.delete(`${BASE}/posts/:id/labels/:labelId`, ...gate, handle(async (req, res) => {
    const postId = intParam(req.params.id);
    const labelId = intParam(req.params.labelId);
    const me = req.session.userId ?? null;
    // Rambo's row is kept as "rejected" so the same suggestion is never made again.
    await q(
      `UPDATE social_post_labels SET rejected_at = now(), rejected_by = $3, confirmed_at = NULL, confirmed_by = NULL
       WHERE post_id = $1 AND label_id = $2 AND source = 'rambo'`,
      [postId, labelId, me],
    );
    await q(`DELETE FROM social_post_labels WHERE post_id = $1 AND label_id = $2 AND source = 'person'`, [postId, labelId]);
    res.json({ labels: (await labelsFor([postId])).get(postId) ?? [] });
  }));

  /** Put one label on many posts at once, or take it off them (the grid's bulk bar). */
  app.post(`${BASE}/posts/bulk-labels`, ...gate, handle(async (req, res) => {
    const labelId = intParam(req.body?.labelId);
    const remove = req.body?.remove === true;
    const ids: number[] = Array.isArray(req.body?.postIds)
      ? Array.from(new Set<number>(req.body.postIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))).slice(0, 1000)
      : [];
    if (!ids.length) throw new InputError("No posts chosen.");
    const me = req.session.userId ?? null;
    if (remove) {
      // Same rule as one post: Rambo's row is kept as rejected, a person's row goes.
      await q(
        `UPDATE social_post_labels SET rejected_at = now(), rejected_by = $3, confirmed_at = NULL, confirmed_by = NULL
         WHERE post_id = ANY($1::bigint[]) AND label_id = $2 AND source = 'rambo'`,
        [ids, labelId, me],
      );
      await q(`DELETE FROM social_post_labels WHERE post_id = ANY($1::bigint[]) AND label_id = $2 AND source = 'person'`, [ids, labelId]);
    } else {
      const [label] = await q(`SELECT id FROM social_labels WHERE id = $1 AND archived_at IS NULL`, [labelId]);
      if (!label) return res.status(404).json({ message: "Not found" });
      await q(
        `INSERT INTO social_post_labels (post_id, label_id, source, confirmed_at, confirmed_by, created_by)
         SELECT p.id, $2, 'person', now(), $3, $3 FROM social_posts p WHERE p.id = ANY($1::bigint[])
         ON CONFLICT (post_id, label_id) DO UPDATE
           SET confirmed_at = COALESCE(social_post_labels.confirmed_at, now()),
               confirmed_by = COALESCE(social_post_labels.confirmed_by, $3),
               rejected_at = NULL, rejected_by = NULL`,
        [ids, labelId, me],
      );
    }
    const map = await labelsFor(ids);
    const labels: Record<number, PostLabel[]> = {};
    for (const id of ids) labels[id] = map.get(id) ?? [];
    res.json({ labels });
  }));

  /** Confirm Rambo's suggestions for one label on the posts a person has just looked through. */
  app.post(`${BASE}/labels/:id/confirm`, ...gate, handle(async (req, res) => {
    const labelId = intParam(req.params.id);
    const ids = Array.isArray(req.body?.postIds) ? req.body.postIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 500) : [];
    if (!ids.length) throw new InputError("No posts chosen.");
    const rows = await q(
      `UPDATE social_post_labels SET confirmed_at = now(), confirmed_by = $3
       WHERE label_id = $1 AND post_id = ANY($2::bigint[]) AND confirmed_at IS NULL AND rejected_at IS NULL
       RETURNING post_id`,
      [labelId, ids, req.session.userId ?? null],
    );
    res.json({ confirmed: rows.length });
  }));

  // ── Reports ───────────────────────────────────────────────────────────────
  app.get(`${BASE}/labels/summary`, ...gate, handle(async (req, res) => {
    const s = { ...parseScope(req), from: null };
    const { window, year, month } = windowOf(req);
    const kind = String(req.query.kind ?? "");
    const labels = (await liveLabels()).filter((l) => !isLabelKind(kind) || l.kind === kind);
    const [rows, cost] = await Promise.all([summaryRows(s, window, previousWindow(year, month), labels, null), adCost()]);
    const body: LabelSummaryResponse = {
      window,
      brand: s.brand,
      rows: rows.sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || b.posts - a.posts || a.label.name.localeCompare(b.label.name)),
      adCost: cost,
    };
    res.json(body);
  }));

  app.get(`${BASE}/labels/:id/report`, ...gate, handle(async (req, res) => {
    const id = intParam(req.params.id);
    const s = { ...parseScope(req), from: null };
    const { window, year, month } = windowOf(req);
    const [raw] = await q(`SELECT id, kind, name, hint, partner_id, archived_at FROM social_labels WHERE id = $1`, [id]);
    if (!raw) return res.status(404).json({ message: "Not found" });
    const label = toLabel(raw);
    const params = [...scopeParams(s), window.from, window.to, id];
    const scoped = `FROM social_post_labels pl
       JOIN social_posts p ON p.id = pl.post_id
       JOIN social_accounts a ON a.id = p.account_id
       WHERE ${ACCOUNT_SCOPE} AND pl.label_id = $6 AND pl.confirmed_at IS NOT NULL
         AND ($4::date IS NULL OR ${DAY} >= $4::date)
         AND ($5::date IS NULL OR ${DAY} <= $5::date)`;
    const [[row], byMonth, byAccount, top, cost] = await Promise.all([
      summaryRows(s, window, previousWindow(year, month), [label], id),
      q<{ month: string; posts: number; views: string }>(
        `SELECT to_char(${DAY}, 'YYYY-MM') AS month, count(*)::int AS posts, COALESCE(sum(p.views), 0) AS views ${scoped} GROUP BY 1 ORDER BY 1`,
        params,
      ),
      q(
        `SELECT a.id AS account_id, a.platform, a.handle, a.brand, count(*)::int AS posts, sum(p.views) AS views ${scoped}
         GROUP BY a.id, a.platform, a.handle, a.brand ORDER BY sum(p.views) DESC NULLS LAST`,
        params,
      ),
      q(`SELECT ${POST_COLUMNS} ${scoped} ORDER BY p.views DESC NULLS LAST, p.posted_at DESC LIMIT 1000`, params),
      adCost(),
    ]);
    const body: LabelReportResponse = {
      window,
      brand: s.brand,
      row,
      byMonth: byMonth.map((m) => ({ month: m.month, posts: m.posts, views: Number(m.views) })),
      byAccount: byAccount.map((a: any) => ({ accountId: a.account_id, platform: a.platform, handle: a.handle, brand: a.brand, posts: a.posts, views: num(a.views) })),
      topPosts: top.slice(0, 12).map(toPost),
      posts: top.map(toPost),
      adCost: cost,
    };
    res.json(body);
  }));

  // ── Rambo's search ────────────────────────────────────────────────────────
  const findScope = (src: any) => {
    const brandRaw = String(src?.brand ?? "all");
    const year = String(src?.year ?? "all");
    if (year !== "all" && !/^\d{4}$/.test(year)) throw new InputError("Unknown year.");
    const platforms = (Array.isArray(src?.platforms) ? src.platforms : String(src?.platforms ?? "instagram,facebook").split(",")).filter(isSocialPlatform);
    if (!platforms.length) throw new InputError("Choose at least one platform.");
    return { brand: brandRaw === "all" ? null : brandRaw, year, platforms: platforms as string[] };
  };

  app.get(`${BASE}/labels/find`, ...gate, handle(async (req, res) => {
    const body: LabelFindState = await labelFindState(findScope(req.query));
    res.json(body);
  }));

  app.post(`${BASE}/labels/find`, ...gate, handle(async (req, res) => {
    const scope = findScope(req.body);
    const started = await startLabelRun(scope, req.session.userId ?? null, Math.min(LABEL_RUN_MAX, Number(req.body?.limit) || LABEL_RUN_MAX));
    if ("error" in started) return res.status(409).json({ message: started.error });
    res.status(202).json(await labelFindState(scope));
  }));

  app.post(`${BASE}/labels/find/stop`, ...gate, handle(async (_req, res) => {
    await stopLabelRun();
    res.json({ ok: true });
  }));
}

/**
 * Keeps web_events_slim — the narrow copy the Website analytics page reads —
 * in step with analytics_events. See migrations/2026-11-11_web_events_slim.sql.
 *
 * 🔴 analytics_events is the record. This table only ever follows it: new rows
 *    are copied by id, and a visitor later found to be a bot (the maintenance
 *    job flags a visitor's recent rows after the fact) is removed here too.
 * 🔴 Every write is idempotent (ON CONFLICT DO NOTHING / a plain DELETE), so
 *    two servers topping it up at once can only do the same work twice.
 */
import { pool } from "../db";
import { nzBounds } from "./common";

// Host from the page's own URL, lower-cased, with port, trailing dot and "www."
// removed — the same normalisation as normaliseHost() in shared/marketing-hub.ts.
// Only used when a row is COPIED: three regexes a row is too slow to run on read.
export const HOST = `lower(regexp_replace(regexp_replace(regexp_replace(substring(t.landing_url from '^https?://([^/?#]+)'), ':[0-9]+$', ''), '[.]$', ''), '^www[.]', ''))`;
export const DAY = `(t."timestamp" AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific/Auckland')::date`;

const KINDS = `('page_view', 'time_on_page', 'scroll_depth', 'bounce', 'session_start', 'cta_click')`;
const REF_HOST = `lower(regexp_replace(substring(t.referrer from '^https?://([^/?#]+)'), '^www[.]', ''))`;
/** Ids are handed out before a row is committed, so a slightly older id can land late: look back a little. */
const OVERLAP = 3000;
/** Ids covered per step (about a third of them are rows this table wants). */
const BATCH = 60_000;
/** The maintenance job re-flags bots across this many days. */
const BOT_WINDOW_DAYS = 14;

const WANTED = `(t.event_type IN ${KINDS}
        OR (t.event_type = 'click' AND (t.metadata->>'href' ILIKE '%wa.me/%' OR t.metadata->>'href' ILIKE '%whatsapp.com%')))`;

const INSERT_FROM = `
  INSERT INTO web_events_slim (id, ts, day, kind, host, path, visitor_id, session_id, channel, device, ref_host,
                               utm_source, utm_medium, utm_campaign, s, m, n, txt, href)
  SELECT t.id, t."timestamp", ${DAY}, t.event_type,
         CASE WHEN t.event_type = 'page_view' THEN ${HOST} END,
         split_part(COALESCE(t.page, ''), '?', 1), t.visitor_id, t.session_id, t.channel, t.device,
         CASE WHEN t.event_type = 'page_view' THEN ${REF_HOST} END,
         NULLIF(t.utm_source, ''), NULLIF(t.utm_medium, ''), NULLIF(t.utm_campaign, ''),
         t.metadata->>'seconds', t.metadata->>'maxPercent', t.metadata->>'isNewVisitor',
         left(btrim(t.metadata->>'text'), 80), left(t.metadata->>'href', 300)
  FROM analytics_events t`;

/**
 * Copy the tracker rows in one id range. 🔴 The range is given as plain
 * numbers: with the starting id worked out inside the same statement the
 * planner could not use the id index and each batch took ~16 seconds.
 */
export async function copyRange(fromId: number, toId: number): Promise<number> {
  const r = await pool.query(
    `${INSERT_FROM}
     WHERE t.id > $1 AND t.id <= $2 AND ${WANTED} AND COALESCE(t.is_bot, false) = false
     ON CONFLICT (id) DO NOTHING`,
    [fromId, toId],
  );
  return r.rowCount ?? 0;
}

/** Copy up to one batch of new tracker rows. Returns how many were written and whether more remain. */
export async function copyBatch(): Promise<{ copied: number; more: boolean }> {
  const edge = await pool.query(
    `SELECT (SELECT COALESCE(max(id), 0) FROM web_events_slim)::bigint AS top, (SELECT COALESCE(max(id), 0) FROM analytics_events)::bigint AS src`,
  );
  const top = Number(edge.rows[0].top);
  const src = Number(edge.rows[0].src);
  const from = Math.max(0, top - OVERLAP);
  const to = Math.min(src, from + BATCH);
  const copied = await copyRange(from, to);
  return { copied, more: to < src };
}

/** Remove rows of visitors since found to be bots. */
export async function dropBots(): Promise<number> {
  const r = await pool.query(
    `DELETE FROM web_events_slim s
     WHERE s.ts > (now() AT TIME ZONE 'UTC') - make_interval(days => $1)
       AND s.visitor_id IN (
         SELECT DISTINCT e.visitor_id FROM analytics_events e
         WHERE e.is_bot = true AND e."timestamp" > (now() AT TIME ZONE 'UTC') - make_interval(days => $1)
       )`,
    [BOT_WINDOW_DAYS],
  );
  return r.rowCount ?? 0;
}

let running = false;
let lastBotSweep = 0;

/** Bring the copy up to date: new rows, and every 30 minutes the bot sweep. Never throws. */
export async function topUpSlim(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let i = 0; i < 40; i++) {
      const { more } = await copyBatch();
      if (!more) break;
    }
    if (Date.now() - lastBotSweep > 30 * 60_000) {
      lastBotSweep = Date.now();
      await dropBots();
    }
  } catch (e: any) {
    console.error("[WebAnalytics] Could not top up web_events_slim:", e?.message ?? e);
  } finally {
    running = false;
  }
}

let started = false;
/** Every minute on each server. Two servers doing the same step only write the same rows once. */
export function startWebSlimCron(): void {
  if (started) return;
  started = true;
  setTimeout(() => void topUpSlim(), 10_000);
  setInterval(() => void topUpSlim(), 60_000);
  console.log("[WebAnalytics] web_events_slim is topped up every minute.");
}

// ── Reading ─────────────────────────────────────────────────────────────────
// The database only hands the rows over; distinct visitors are counted in the
// app, where sixty thousand rows is nothing (counting them seven ways in
// Postgres took 10–50 seconds).

export type PvRow = {
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

const rawCache = new Map<string, { at: number; p: Promise<unknown[]> }>();
/** Rows for a date range, kept three minutes so every report on a page shares one read. */
export function rawRows<T>(key: string, fn: () => Promise<T[]>): Promise<T[]> {
  const hit = rawCache.get(key);
  if (hit && Date.now() - hit.at < 3 * 60_000) return hit.p as Promise<T[]>;
  const p = fn();
  rawCache.delete(key);
  rawCache.set(key, { at: Date.now(), p });
  p.then((rows) => {
    // A year of rows is not worth holding in memory on two machines.
    if (rows.length > 150_000) rawCache.delete(key);
  }).catch(() => rawCache.delete(key));
  if (rawCache.size > 6) rawCache.delete(rawCache.keys().next().value as string);
  return p;
}

/** Every non-bot page view between two New Zealand days (inclusive). */
export const slimPageViews = (from: string, to: string) =>
  rawRows<PvRow>(`pv|${from}|${to}`, async () => {
    const r = await pool.query(
      `SELECT t.host, t.visitor_id, t.session_id, t.channel, t.path, t.day::text AS day, t.device, t.ref_host AS ref,
              t.utm_source, t.utm_medium, t.utm_campaign
       FROM web_events_slim t
       WHERE t.kind = 'page_view' AND ${nzBounds("t.ts", "timestamp", "$1", "$2")}`,
      [from, to],
    );
    return r.rows as PvRow[];
  });

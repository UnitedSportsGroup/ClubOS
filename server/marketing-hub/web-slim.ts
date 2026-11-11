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
import { DAY, HOST } from "./traffic";

const KINDS = `('page_view', 'time_on_page', 'scroll_depth', 'bounce', 'session_start', 'cta_click')`;
const REF_HOST = `lower(regexp_replace(substring(t.referrer from '^https?://([^/?#]+)'), '^www[.]', ''))`;
/** Ids are handed out before a row is committed, so a slightly older id can land late: look back a little. */
const OVERLAP = 3000;
const BATCH = 20_000;
/** The maintenance job re-flags bots across this many days. */
const BOT_WINDOW_DAYS = 14;

/** Copy up to one batch of new tracker rows. Returns how many were written and whether more remain. */
export async function copyBatch(): Promise<{ copied: number; more: boolean }> {
  const r = await pool.query(
    `WITH edge AS (SELECT COALESCE(max(id), 0) AS top FROM web_events_slim),
     src AS (
       SELECT t.* FROM analytics_events t, edge
       WHERE t.id > edge.top - $1 AND t.event_type IN ${KINDS} AND COALESCE(t.is_bot, false) = false
       ORDER BY t.id LIMIT $2
     ),
     ins AS (
       INSERT INTO web_events_slim (id, ts, day, kind, host, path, visitor_id, session_id, channel, device, ref_host,
                                    utm_source, utm_medium, utm_campaign, s, m, n, txt, href)
       SELECT t.id, t."timestamp", ${DAY}, t.event_type,
              CASE WHEN t.event_type = 'page_view' THEN ${HOST} END,
              split_part(COALESCE(t.page, ''), '?', 1), t.visitor_id, t.session_id, t.channel, t.device,
              CASE WHEN t.event_type = 'page_view' THEN ${REF_HOST} END,
              NULLIF(t.utm_source, ''), NULLIF(t.utm_medium, ''), NULLIF(t.utm_campaign, ''),
              t.metadata->>'seconds', t.metadata->>'maxPercent', t.metadata->>'isNewVisitor',
              left(btrim(t.metadata->>'text'), 80), left(t.metadata->>'href', 300)
       FROM src t
       ON CONFLICT (id) DO NOTHING
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM ins)::int AS copied, (SELECT count(*) FROM src)::int AS seen`,
    [OVERLAP, BATCH],
  );
  const { copied, seen } = r.rows[0] as { copied: number; seen: number };
  // A full batch that wrote something may have more behind it.
  return { copied, more: seen >= BATCH && copied > 0 };
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

let running: Promise<void> | null = null;
let lastTopUp = 0;
let lastBotSweep = 0;

/**
 * Bring the copy up to date. Called before each report: at most once a minute,
 * one at a time, and the bot sweep at most every 30 minutes. A failure is
 * logged and the report still runs on what is already copied.
 */
export function topUpSlim(): Promise<void> {
  if (running) return running;
  if (Date.now() - lastTopUp < 60_000) return Promise.resolve();
  running = (async () => {
    try {
      for (let i = 0; i < 40; i++) {
        const { more } = await copyBatch();
        if (!more) break;
      }
      if (Date.now() - lastBotSweep > 30 * 60_000) {
        await dropBots();
        lastBotSweep = Date.now();
      }
      lastTopUp = Date.now();
    } catch (e: any) {
      console.error("[WebAnalytics] Could not top up web_events_slim:", e?.message ?? e);
    } finally {
      running = null;
    }
  })();
  return running;
}

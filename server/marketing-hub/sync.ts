/**
 * The puller: for each connected account, fetch a date window from its
 * platform and upsert it into marketing_daily — recording every attempt.
 *
 * 🔴 The Mac collectors this replaces swallowed every error (`except: pass`),
 * which is how Facebook page numbers stopped in May 2026 and nobody knew for
 * four months. Here a failure is a row in marketing_sync_runs with the
 * platform's own message, and the Data sources section shows it.
 *
 * 🔴 Two Fly machines start the schedule. marketing_sync_lease lets exactly
 * one pull at a time; every write is also an upsert on the natural key, so even
 * an overlap could only rewrite the same numbers, never double them.
 */
import { hostname } from "os";
import { randomBytes } from "crypto";
import { addDaysIso, nzTodayIso } from "@shared/dashboard";
import {
  DIM_TYPES,
  isHubMetric,
  type DimType,
  type HubMetricKey,
  type PlatformKey,
} from "@shared/marketing-hub";
import { NotConfiguredError, clearHubCache, q } from "./common";
import { pullGa4 } from "./ga4";
import { pullFacebookPage, pullInstagram, pullMetaAds } from "./meta";

export type DailyRow = {
  day: string;
  dimType: DimType;
  dimKey: string;
  dimLabel: string | null;
  metric: HubMetricKey;
  value: number;
};

export type SyncSource = {
  id: number;
  platform: PlatformKey;
  external_id: string;
  label: string;
  organization_id: number | null;
  site: string | null;
  currency: string | null;
};

export type PullContext = {
  source: SyncSource;
  from: string;
  to: string;
  write: (rows: DailyRow[]) => Promise<number>;
  /** Shared across one run, e.g. Facebook page tokens fetched once for six pages. */
  cache: Map<string, unknown>;
};

type Puller = (ctx: PullContext) => Promise<void>;

const PULLERS: Partial<Record<PlatformKey, Puller>> = {
  ga4: pullGa4,
  meta_ads: pullMetaAds,
  facebook_page: pullFacebookPage,
  instagram: pullInstagram,
};

/**
 * How far back the first pull goes, and how much a later pull re-reads.
 * Re-reading is deliberate: GA4 finalises a day over ~48 hours and Meta
 * re-attributes ad results for up to 7 days, so yesterday's number moves.
 * Instagram's follower_count only exists for the last 30 days.
 */
const BACKFILL_DAYS: Partial<Record<PlatformKey, number>> = { ga4: 400, meta_ads: 400, facebook_page: 89, instagram: 28 };
const REREAD_DAYS: Partial<Record<PlatformKey, number>> = { ga4: 4, meta_ads: 7, facebook_page: 3, instagram: 3 };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Upsert rows onto the natural key. Returns rows written. */
export async function upsertDaily(sourceId: number, rows: DailyRow[]): Promise<{ written: number; rejected: number }> {
  // One statement cannot update the same key twice, so the last value for a key wins.
  const byKey = new Map<string, DailyRow>();
  let rejected = 0;
  for (const r of rows) {
    const value = Math.round(Number(r.value));
    if (
      !ISO_DAY.test(r.day) ||
      !isHubMetric(r.metric) ||
      !(DIM_TYPES as readonly string[]).includes(r.dimType) ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      rejected++;
      continue;
    }
    byKey.set(`${r.day}|${r.dimType}|${r.dimKey}|${r.metric}`, { ...r, value });
  }
  const clean = Array.from(byKey.values());
  for (let i = 0; i < clean.length; i += 500) {
    const chunk = clean.slice(i, i + 500);
    await q(
      `INSERT INTO marketing_daily (source_id, day, dim_type, dim_key, dim_label, metric, value, fetched_at)
       SELECT $1, u.day::date, u.dim_type, u.dim_key, u.dim_label, u.metric, u.value, now()
       FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::bigint[])
            AS u(day, dim_type, dim_key, dim_label, metric, value)
       ON CONFLICT (source_id, day, dim_type, dim_key, metric) DO UPDATE
         SET value = EXCLUDED.value,
             dim_label = COALESCE(EXCLUDED.dim_label, marketing_daily.dim_label),
             fetched_at = now()`,
      [
        sourceId,
        chunk.map((r) => r.day),
        chunk.map((r) => r.dimType),
        chunk.map((r) => r.dimKey),
        chunk.map((r) => r.dimLabel),
        chunk.map((r) => r.metric),
        chunk.map((r) => r.value),
      ],
    );
  }
  return { written: clean.length, rejected };
}

// ── The lease ───────────────────────────────────────────────────────────────

const LEASE_MINUTES = 45;

async function claimLease(holder: string): Promise<boolean> {
  const rows = await q(
    `UPDATE marketing_sync_lease
     SET holder = $1, expires_at = now() + make_interval(mins => $2)
     WHERE id = 1 AND (expires_at < now() OR holder = $1)
     RETURNING id`,
    [holder, LEASE_MINUTES],
  );
  return rows.length === 1;
}

async function releaseLease(holder: string) {
  await q(`UPDATE marketing_sync_lease SET expires_at = now() WHERE id = 1 AND holder = $1`, [holder]).catch(() => {});
}

// ── Running ─────────────────────────────────────────────────────────────────

export type SourceResult = { sourceId: number; label: string; status: string; rows: number; error: string | null };

async function rangeFor(source: SyncSource): Promise<{ from: string; to: string }> {
  const today = nzTodayIso();
  const [row] = await q<{ last: string | null }>(
    `SELECT max(day)::text AS last FROM marketing_daily WHERE source_id = $1`,
    [source.id],
  );
  if (!row?.last) return { from: addDaysIso(today, -((BACKFILL_DAYS[source.platform] ?? 30) - 1)), to: today };
  const last = row.last < today ? row.last : today;
  return { from: addDaysIso(last, -(REREAD_DAYS[source.platform] ?? 3)), to: today };
}

async function runOne(source: SyncSource, trigger: string, cache: Map<string, unknown>): Promise<SourceResult> {
  const puller = PULLERS[source.platform];
  const range = puller ? await rangeFor(source) : null;
  const [run] = await q<{ id: number }>(
    `INSERT INTO marketing_sync_runs (source_id, platform, trigger, status, range_from, range_to)
     VALUES ($1, $2, $3, 'running', $4, $5) RETURNING id`,
    [source.id, source.platform, trigger, range?.from ?? null, range?.to ?? null],
  );

  let written = 0;
  let rejected = 0;
  let status = "ok";
  let error: string | null = null;
  try {
    if (!puller || !range) {
      status = "skipped";
      error = `No collector for ${source.platform} yet.`;
    } else {
      await puller({
        source,
        from: range.from,
        to: range.to,
        cache,
        write: async (rows) => {
          const r = await upsertDaily(source.id, rows);
          written += r.written;
          rejected += r.rejected;
          return r.written;
        },
      });
      if (rejected) error = `${rejected} values were not stored because they were malformed or negative.`;
    }
  } catch (e: any) {
    status = e instanceof NotConfiguredError ? "skipped" : "error";
    error = String(e?.message ?? e).slice(0, 1000);
  }
  await q(
    `UPDATE marketing_sync_runs SET status = $1, rows_written = $2, error = $3, finished_at = now() WHERE id = $4`,
    [status, written, error, run.id],
  );
  if (status === "error") console.error(`[MarketingHub] ${source.platform} "${source.label}": ${error}`);
  return { sourceId: source.id, label: source.label, status, rows: written, error };
}

export async function runMarketingSync(
  trigger: "schedule" | "manual" | "script",
  only?: { platform?: PlatformKey; sourceId?: number },
): Promise<{ ran: boolean; reason?: string; results: SourceResult[] }> {
  const holder = `${process.env.FLY_MACHINE_ID || hostname()}:${process.pid}:${randomBytes(4).toString("hex")}`;
  if (!(await claimLease(holder))) {
    return { ran: false, reason: "Another server is already pulling marketing data.", results: [] };
  }
  const results: SourceResult[] = [];
  try {
    const sources = await q<SyncSource>(
      `SELECT id, platform, external_id, label, organization_id, site, currency
       FROM marketing_sources WHERE active ORDER BY platform, id`,
    );
    const cache = new Map<string, unknown>();
    for (const source of sources) {
      if (only?.platform && source.platform !== only.platform) continue;
      if (only?.sourceId && source.id !== only.sourceId) continue;
      await claimLease(holder); // renew — a long backfill must not let the lease lapse
      results.push(await runOne(source, trigger, cache));
    }
  } finally {
    await releaseLease(holder);
    clearHubCache();
  }
  return { ran: true, results };
}

/** When a person may press "Sync now" again, or null if they may now. */
export async function nextManualSyncAt(): Promise<string | null> {
  const [row] = await q<{ next: Date | null }>(
    `SELECT max(started_at) + interval '10 minutes' AS next FROM marketing_sync_runs WHERE trigger = 'manual'`,
  );
  if (!row?.next) return null;
  const next = new Date(row.next);
  return next.getTime() > Date.now() ? next.toISOString() : null;
}

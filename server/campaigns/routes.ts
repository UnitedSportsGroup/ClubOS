/**
 * Campaigns — United Sports Group → Marketing → Campaigns.
 *
 * Every route: requireAuth → requireTab("campaign-planner") → group workspace
 * only (the Marketing hub's 404-from-anywhere-else gate).
 *
 * 🔴 The PLAN is stored (cmp_* tables). The RESULT never is: bookings and
 *    revenue come from `registrations` through the one decider
 *    (REAL_REGISTRATION_STATUS_SQL — unpaid is not registered), spend from
 *    `marketing_daily`, email numbers from `email_campaign_recipients`,
 *    visitors from `analytics_events`.
 * 🔴 A booking's day is the day the money landed: coalesce(paid_at,
 *    registered_at) read in NZ time. `registered_at` is a naive UTC timestamp.
 * 🔴 Revenue is what was paid less what went back (refunded_amount_cents).
 * 🔴 Aggregates only: no name, email or phone leaves these routes.
 */
import type { Express, Request, Response } from "express";
import { nzTodayIso } from "@shared/dashboard";
import {
  CAMPAIGNS_TAB,
  CAMPAIGN_STATUSES,
  CHANNEL_KINDS,
  CHANNEL_STATUSES,
  SUGGESTED_TIMELINE,
  TASK_KINDS,
  TEST_STATUSES,
  addDays,
  isIsoDay,
  type CampaignDetail,
  type CampaignListItem,
  type CampaignOptions,
  type CampaignResult,
  type CampaignRow,
  type ChannelRow,
  type TaskRow,
  type TestRow,
} from "@shared/campaigns";
import { channelLabel, hubWorkspace } from "@shared/marketing-hub";
import { REAL_REGISTRATION_STATUS_SQL } from "@shared/registrations";
import { socialBrand } from "@shared/social";
import { requireAuth, requireTab } from "../auth";
import { pool } from "../db";
import { requireHubWorkspace } from "../marketing-hub/common";

const BASE = "/api/admin/campaigns";

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(text, params as any[]);
  return r.rows as T[];
}

export class InputError extends Error {}
export class NotFound extends Error {}

// ── Reading input ───────────────────────────────────────────────────────────

export const has = (b: any, k: string) => b != null && Object.prototype.hasOwnProperty.call(b, k);
export const text = (v: unknown, max = 2000): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
export function day(v: unknown, label: string): string | null {
  if (v == null || v === "") return null;
  if (!isIsoDay(v)) throw new InputError(`${label} must be a date.`);
  return v;
}
/** Money arrives in cents (the page converts from dollars). */
function cents(v: unknown, label: string): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100_000_000_00) throw new InputError(`${label} must be an amount of zero or more.`);
  return n;
}
function whole(v: unknown, label: string): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new InputError(`${label} must be a whole number of zero or more.`);
  return n;
}
function oneOf<T extends string>(v: unknown, list: readonly T[], label: string): T {
  if (typeof v !== "string" || !(list as readonly string[]).includes(v)) throw new InputError(`Unknown ${label}.`);
  return v as T;
}
export function intList(v: unknown, label: string): number[] {
  if (v == null) return [];
  if (!Array.isArray(v) || v.some((x) => !Number.isInteger(Number(x)) || Number(x) <= 0)) throw new InputError(`${label} is not a valid list.`);
  return Array.from(new Set(v.map(Number))).slice(0, 200);
}
function textList(v: unknown, label: string): string[] {
  if (v == null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !/^[A-Za-z0-9_.:-]{1,80}$/.test(x))) throw new InputError(`${label} is not a valid list.`);
  return Array.from(new Set(v as string[])).slice(0, 100);
}
export const id = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new NotFound();
  return n;
};
export function ordered(a: string | null, b: string | null, label: string) {
  if (a && b && b < a) throw new InputError(`${label} cannot end before it starts.`);
}

/** Build "col = $n" pairs for the keys present in the body. */
export function patch(body: any, fields: Record<string, (v: unknown) => unknown>) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, read] of Object.entries(fields)) {
    if (!has(body, key)) continue;
    params.push(read(body[key]));
    sets.push(`${key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)} = $${params.length}`);
  }
  return { sets, params };
}

// ── Results, read live ──────────────────────────────────────────────────────

export const NZ_DAY = `(COALESCE(r.paid_at, r.registered_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Auckland')::date`;
export const NET = `(COALESCE(r.total_cents, 0) - COALESCE(r.refunded_amount_cents, 0))`;
export const REAL = `r.status IN ${REAL_REGISTRATION_STATUS_SQL}`;
/** A sale that came from a paid click. */
const PAID_META = `(r.meta_campaign_id IS NOT NULL OR r.fbclid IS NOT NULL)`;
const PAID_GOOGLE = `(r.gclid IS NOT NULL)`;
const PAID_OTHER = `(lower(COALESCE(r.utm_medium, '')) IN ('paid', 'cpc', 'ppc', 'paid_social', 'paidsocial'))`;

type Raw = {
  id: number;
  name: string;
  brand: string | null;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  event_starts_on: string | null;
  event_ends_on: string | null;
  goal_revenue_cents: string | null;
  goal_signups: number | null;
  budget_cents: string | null;
  program_ids: number[];
  manual_signups: number | null;
  manual_revenue_cents: string | null;
  summary: string | null;
  owner_user_id: number | null;
  owner_name: string | null;
  archived_at: Date | null;
};

const CAMPAIGN_COLUMNS = `c.id, c.name, c.brand, c.status, c.starts_on::text, c.ends_on::text, c.event_starts_on::text, c.event_ends_on::text,
  c.goal_revenue_cents, c.goal_signups, c.budget_cents, c.program_ids, c.manual_signups, c.manual_revenue_cents, c.summary,
  c.owner_user_id, c.archived_at,
  (SELECT btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) FROM public.users u WHERE u.id = c.owner_user_id) AS owner_name`;

const n = (v: unknown): number | null => (v == null ? null : Number(v));

function toCampaign(r: Raw): CampaignRow {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    status: (CAMPAIGN_STATUSES as readonly string[]).includes(r.status) ? (r.status as CampaignRow["status"]) : "planning",
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    eventStartsOn: r.event_starts_on,
    eventEndsOn: r.event_ends_on,
    goalRevenueCents: n(r.goal_revenue_cents),
    goalSignups: r.goal_signups,
    budgetCents: n(r.budget_cents),
    programIds: r.program_ids ?? [],
    manualSignups: r.manual_signups,
    manualRevenueCents: n(r.manual_revenue_cents),
    summary: r.summary,
    ownerUserId: r.owner_user_id,
    ownerName: r.owner_name || null,
    archived: Boolean(r.archived_at),
  };
}

/** The WHERE that says "a real booking of this campaign's programmes inside its selling window". $1 ids, $2 from, $3 to. */
const IN_CAMPAIGN = `${REAL} AND r.program_id = ANY($1::int[])
  AND ($2::date IS NULL OR ${NZ_DAY} >= $2::date) AND ($3::date IS NULL OR ${NZ_DAY} <= $3::date)`;
const scopeOf = (c: CampaignRow) => [c.programIds, c.startsOn, c.endsOn];

async function resultFor(c: CampaignRow): Promise<CampaignResult> {
  if (!c.programIds.length) {
    return { live: false, signups: c.manualSignups, revenueCents: c.manualRevenueCents, refundedCents: 0, daily: [] };
  }
  const rows = await q<{ day: string; signups: number; revenue: string; refunded: string }>(
    `SELECT ${NZ_DAY}::text AS day, count(*)::int AS signups, sum(${NET})::bigint AS revenue,
            sum(COALESCE(r.refunded_amount_cents, 0))::bigint AS refunded
     FROM registrations r WHERE ${IN_CAMPAIGN} GROUP BY 1 ORDER BY 1`,
    scopeOf(c),
  );
  return {
    live: true,
    signups: rows.reduce((s, r) => s + r.signups, 0),
    revenueCents: rows.reduce((s, r) => s + Number(r.revenue), 0),
    refundedCents: rows.reduce((s, r) => s + Number(r.refunded), 0),
    daily: rows.map((r) => ({ day: r.day, signups: r.signups, revenueCents: Number(r.revenue) })),
  };
}

/** Meta spend for a set of ad campaigns, inside the selling window when there is one. */
export async function metaStats(ids: string[], from: string | null, to: string | null) {
  if (!ids.length) return null;
  const rows = await q<{ metric: string; value: string }>(
    `SELECT d.metric, sum(d.value)::bigint AS value
     FROM marketing_daily d JOIN marketing_sources s ON s.id = d.source_id
     WHERE s.platform = 'meta_ads' AND d.dim_type = 'campaign' AND d.dim_key = ANY($1::text[])
       AND ($2::date IS NULL OR d.day >= $2::date) AND ($3::date IS NULL OR d.day <= $3::date)
     GROUP BY 1`,
    [ids, from, to],
  );
  const get = (m: string) => Number(rows.find((r) => r.metric === m)?.value ?? 0);
  return { spendCents: get("spend_cents"), impressions: get("impressions"), clicks: get("link_clicks"), purchases: get("purchases") };
}

async function channelsFor(c: CampaignRow): Promise<{ channels: ChannelRow[]; spendCents: number }> {
  const rows = await q<any>(
    `SELECT id, kind, name, status, starts_on::text, ends_on::text, budget_cents, meta_campaign_ids, email_campaign_ids,
            utm_campaign, discount_code, manual_spend_cents, notes
     FROM cmp_channels WHERE campaign_id = $1 ORDER BY position, id`,
    [c.id],
  );
  const scope = scopeOf(c);
  const linked = c.programIds.length > 0;
  let total = 0;
  const channels: ChannelRow[] = [];
  for (const r of rows) {
    const metaIds: string[] = r.meta_campaign_ids ?? [];
    const emailIds: number[] = r.email_campaign_ids ?? [];
    const utm: string | null = r.utm_campaign;
    const code: string | null = r.discount_code;
    const stats: ChannelRow["stats"] = {
      spendCents: null, spendSource: null, impressions: null, clicks: null, platformPurchases: null, visitors: null,
      emailsDelivered: null, emailsOpened: null, emailsClicked: null, signups: null, revenueCents: null, discountGivenCents: null,
    };

    const meta = await metaStats(metaIds, c.startsOn, c.endsOn);
    if (meta) {
      stats.spendCents = meta.spendCents;
      stats.spendSource = "meta";
      stats.impressions = meta.impressions;
      stats.clicks = meta.clicks;
      stats.platformPurchases = meta.purchases;
    } else if (r.manual_spend_cents != null) {
      stats.spendCents = Number(r.manual_spend_cents);
      stats.spendSource = "typed";
    }
    total += stats.spendCents ?? 0;

    if (emailIds.length) {
      const [e] = await q<{ delivered: number; opened: number; clicked: number }>(
        `SELECT count(*) FILTER (WHERE status = 'sent')::int AS delivered,
                count(*) FILTER (WHERE first_opened_at IS NOT NULL)::int AS opened,
                count(*) FILTER (WHERE first_clicked_at IS NOT NULL)::int AS clicked
         FROM email_campaign_recipients WHERE campaign_id = ANY($1::int[])`,
        [emailIds],
      );
      stats.emailsDelivered = e.delivered;
      stats.emailsOpened = e.opened;
      stats.emailsClicked = e.clicked;
    }

    if (utm) {
      const [v] = await q<{ visitors: number }>(
        `SELECT count(DISTINCT t.visitor_id)::int AS visitors FROM web_events_slim t
         WHERE t.kind = 'page_view' AND lower(t.utm_campaign) = lower($1)
           AND ($2::date IS NULL OR t.day >= $2::date)`,
        [utm, c.startsOn],
      );
      stats.visitors = v.visitors;
    }

    // Bookings ClubOS can tie to this channel: its ads, its link, or its code.
    const ties: string[] = [];
    const params: unknown[] = [...scope];
    if (metaIds.length) {
      params.push(metaIds);
      ties.push(`r.meta_campaign_id = ANY($${params.length}::text[])`);
    }
    if (utm) {
      params.push(utm);
      ties.push(`lower(r.utm_campaign) = lower($${params.length})`);
    }
    if (code) {
      params.push(code);
      ties.push(`lower(r.discount_code) = lower($${params.length})`);
    }
    if (linked && ties.length) {
      const [b] = await q<{ signups: number; revenue: string | null; discount: string | null }>(
        `SELECT count(*)::int AS signups, sum(${NET})::bigint AS revenue, sum(COALESCE(r.discount_cents, 0))::bigint AS discount
         FROM registrations r WHERE ${IN_CAMPAIGN} AND (${ties.join(" OR ")})`,
        params,
      );
      stats.signups = b.signups;
      stats.revenueCents = Number(b.revenue ?? 0);
      if (code) stats.discountGivenCents = Number(b.discount ?? 0);
    }

    channels.push({
      id: r.id,
      kind: r.kind,
      name: r.name,
      status: (CHANNEL_STATUSES as readonly string[]).includes(r.status) ? r.status : "planned",
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      budgetCents: n(r.budget_cents),
      metaCampaignIds: metaIds,
      emailCampaignIds: emailIds,
      utmCampaign: utm,
      discountCode: code,
      manualSpendCents: n(r.manual_spend_cents),
      notes: r.notes,
      stats,
    });
  }
  return { channels, spendCents: total };
}

async function tasksFor(campaignId: number): Promise<TaskRow[]> {
  const rows = await q<any>(
    `SELECT t.id, t.channel_id, t.title, t.kind, t.due_on::text, t.done_at, t.owner_user_id, t.notes,
            (SELECT btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) FROM public.users u WHERE u.id = t.owner_user_id) AS owner_name,
            (SELECT btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) FROM public.users u WHERE u.id = t.done_by) AS done_by_name
     FROM cmp_tasks t WHERE t.campaign_id = $1 ORDER BY t.due_on NULLS LAST, t.position, t.id`,
    [campaignId],
  );
  return rows.map((t) => ({
    id: t.id,
    channelId: t.channel_id,
    title: t.title,
    kind: (TASK_KINDS as readonly string[]).includes(t.kind) ? t.kind : "task",
    dueOn: t.due_on,
    doneAt: t.done_at ? new Date(t.done_at).toISOString() : null,
    doneByName: t.done_by_name || null,
    ownerUserId: t.owner_user_id,
    ownerName: t.owner_name || null,
    notes: t.notes,
  }));
}

async function testsFor(c: CampaignRow): Promise<TestRow[]> {
  const tests = await q<any>(
    `SELECT id, channel_id, name, variable, hypothesis, status, starts_on::text, ends_on::text, winner_variant_id, conclusion
     FROM cmp_tests WHERE campaign_id = $1 ORDER BY id`,
    [c.id],
  );
  if (!tests.length) return [];
  const variants = await q<any>(
    `SELECT id, test_id, label, description, utm_content, landing_path, manual_visitors, manual_conversions
     FROM cmp_test_variants WHERE test_id = ANY($1::int[]) ORDER BY position, id`,
    [tests.map((t) => t.id)],
  );
  const out: TestRow[] = [];
  for (const t of tests) {
    const from = t.starts_on ?? c.startsOn;
    const to = t.ends_on ?? c.endsOn;
    const rows: TestRow["variants"] = [];
    for (const v of variants.filter((x) => x.test_id === t.id)) {
      const tag: string | null = v.utm_content;
      const path: string | null = v.landing_path;
      let visitors: number | null = v.manual_visitors;
      let conversions: number | null = v.manual_conversions;
      let revenue: number | null = null;
      let counted: "live" | "typed" | "none" = v.manual_visitors != null || v.manual_conversions != null ? "typed" : "none";
      if (tag || path) {
        // Visitors: page views carrying this version's link tag, or landing on its page.
        const [vis] = await q<{ visitors: number }>(
          `SELECT count(DISTINCT t.visitor_id)::int AS visitors FROM analytics_events t
           WHERE t.event_type = 'page_view' AND COALESCE(t.is_bot, false) = false
             AND (($1::text IS NOT NULL AND t.metadata->>'utmContent' = $1)
               OR ($2::text IS NOT NULL AND split_part(COALESCE(t.page, ''), '?', 1) = $2))
             AND ($3::date IS NULL OR t."timestamp" >= ($3::date::timestamp AT TIME ZONE 'Pacific/Auckland' AT TIME ZONE 'UTC'))
             AND ($4::date IS NULL OR t."timestamp" < (($4::date + 1)::timestamp AT TIME ZONE 'Pacific/Auckland' AT TIME ZONE 'UTC'))`,
          [tag, path, from, to],
        );
        visitors = vis.visitors;
        counted = "live";
        // Bookings: only a link tag travels with the sale. A page-only version
        // keeps whatever was typed in for its bookings.
        if (tag) {
          const [b] = await q<{ signups: number; revenue: string | null }>(
            `SELECT count(*)::int AS signups, sum(${NET})::bigint AS revenue FROM registrations r
             WHERE ${REAL} AND r.utm_content = $1
               AND (cardinality($2::int[]) = 0 OR r.program_id = ANY($2::int[]))
               AND ($3::date IS NULL OR ${NZ_DAY} >= $3::date) AND ($4::date IS NULL OR ${NZ_DAY} <= $4::date)`,
            [tag, c.programIds, from, to],
          );
          conversions = b.signups;
          revenue = Number(b.revenue ?? 0);
        }
      }
      rows.push({
        id: v.id,
        label: v.label,
        description: v.description,
        utmContent: tag,
        landingPath: path,
        manualVisitors: v.manual_visitors,
        manualConversions: v.manual_conversions,
        visitors,
        conversions,
        revenueCents: revenue,
        counted,
      });
    }
    out.push({
      id: t.id,
      channelId: t.channel_id,
      name: t.name,
      variable: t.variable,
      hypothesis: t.hypothesis,
      status: (TEST_STATUSES as readonly string[]).includes(t.status) ? t.status : "planned",
      startsOn: t.starts_on,
      endsOn: t.ends_on,
      winnerVariantId: t.winner_variant_id,
      conclusion: t.conclusion,
      variants: rows,
    });
  }
  return out;
}

export async function loadCampaign(campaignId: number): Promise<CampaignRow> {
  const [row] = await q<Raw>(`SELECT ${CAMPAIGN_COLUMNS} FROM cmp_campaigns c WHERE c.id = $1`, [campaignId]);
  if (!row) throw new NotFound();
  return toCampaign(row);
}

async function detail(campaignId: number): Promise<CampaignDetail> {
  const c = await loadCampaign(campaignId);
  const linked = c.programIds.length > 0;
  const [result, ch, tasks, tests, sources, programmes] = await Promise.all([
    resultFor(c),
    channelsFor(c),
    tasksFor(c.id),
    testsFor(c),
    linked
      ? q<{ key: string; signups: number; revenue: string }>(
          `SELECT CASE
                    WHEN r.served_by_user_id IS NOT NULL THEN 'office'
                    WHEN ${PAID_META} THEN 'paid_meta'
                    WHEN ${PAID_GOOGLE} THEN 'paid_google'
                    WHEN ${PAID_OTHER} THEN 'paid_other'
                    ELSE COALESCE(r.attribution_channel, '')
                  END AS key,
                  count(*)::int AS signups, sum(${NET})::bigint AS revenue
           FROM registrations r WHERE ${IN_CAMPAIGN} GROUP BY 1 ORDER BY 2 DESC`,
          scopeOf(c),
        )
      : Promise.resolve([]),
    linked
      ? q<{ id: number; name: string; slug: string | null; signups: number; revenue: string | null }>(
          `SELECT p.id, p.name, o.slug,
                  count(r.id)::int AS signups, sum(${NET})::bigint AS revenue
           FROM programs p
           LEFT JOIN organizations o ON o.id = p.organization_id
           LEFT JOIN registrations r ON r.program_id = p.id AND ${REAL}
                AND ($2::date IS NULL OR ${NZ_DAY} >= $2::date) AND ($3::date IS NULL OR ${NZ_DAY} <= $3::date)
           WHERE p.id = ANY($1::int[]) GROUP BY p.id, p.name, o.slug ORDER BY p.name`,
          scopeOf(c),
        )
      : Promise.resolve([]),
  ]);
  const SOURCE: Record<string, { label: string; paid: boolean }> = {
    office: { label: "At the office", paid: false },
    paid_meta: { label: "Paid ads: Facebook & Instagram", paid: true },
    paid_google: { label: "Paid ads: Google", paid: true },
    paid_other: { label: "Paid ads: other", paid: true },
    "": { label: "Couldn't tell", paid: false },
  };
  return {
    today: nzTodayIso(),
    campaign: c,
    result,
    sources: sources.map((s) => ({
      key: s.key || "unknown",
      label: SOURCE[s.key]?.label ?? `Not paid: ${channelLabel(s.key)}`,
      signups: s.signups,
      revenueCents: Number(s.revenue),
      paid: SOURCE[s.key]?.paid ?? false,
    })),
    programmes: programmes.map((p) => ({
      id: p.id,
      name: p.name,
      workspace: hubWorkspace(p.slug)?.short ?? null,
      signups: p.signups,
      revenueCents: Number(p.revenue ?? 0),
    })),
    spendCents: ch.spendCents,
    channels: ch.channels,
    tasks,
    tests,
  };
}

// ── Writing ─────────────────────────────────────────────────────────────────

export async function checkProgrammes(ids: number[]) {
  if (!ids.length) return;
  const rows = await q<{ id: number }>(`SELECT id FROM programs WHERE id = ANY($1::int[])`, [ids]);
  if (rows.length !== ids.length) throw new InputError("One of those programmes does not exist.");
}

function campaignFields(body: any) {
  const brand = (v: unknown) => {
    const b = text(v, 40);
    if (b && !socialBrand(b)) throw new InputError("Pick a brand.");
    return b;
  };
  const p = patch(body, {
    name: (v) => {
      const s = text(v, 160);
      if (!s) throw new InputError("Give the campaign a name.");
      return s;
    },
    brand,
    status: (v) => oneOf(v, CAMPAIGN_STATUSES, "status"),
    startsOn: (v) => day(v, "Selling starts"),
    endsOn: (v) => day(v, "Selling ends"),
    eventStartsOn: (v) => day(v, "The first day"),
    eventEndsOn: (v) => day(v, "The last day"),
    goalRevenueCents: (v) => cents(v, "The revenue goal"),
    goalSignups: (v) => whole(v, "The sign-up goal"),
    budgetCents: (v) => cents(v, "The budget"),
    programIds: (v) => intList(v, "Programmes"),
    manualSignups: (v) => whole(v, "Sign-ups so far"),
    manualRevenueCents: (v) => cents(v, "Revenue so far"),
    summary: (v) => text(v, 4000),
    ownerUserId: (v) => (v == null || v === "" ? null : id(v)),
  });
  return p;
}

function channelFields(body: any) {
  return patch(body, {
    kind: (v) => oneOf(v, CHANNEL_KINDS.map((k) => k.key), "kind of channel"),
    name: (v) => {
      const s = text(v, 160);
      if (!s) throw new InputError("Give the channel a name.");
      return s;
    },
    status: (v) => oneOf(v, CHANNEL_STATUSES, "status"),
    startsOn: (v) => day(v, "Starts"),
    endsOn: (v) => day(v, "Ends"),
    budgetCents: (v) => cents(v, "The budget"),
    metaCampaignIds: (v) => textList(v, "Ad campaigns"),
    emailCampaignIds: (v) => intList(v, "Emails"),
    utmCampaign: (v) => text(v, 120),
    discountCode: (v) => text(v, 60),
    manualSpendCents: (v) => cents(v, "Spend"),
    notes: (v) => text(v, 4000),
  });
}

function taskFields(body: any) {
  return patch(body, {
    title: (v) => {
      const s = text(v, 240);
      if (!s) throw new InputError("Say what the task is.");
      return s;
    },
    kind: (v) => oneOf(v, TASK_KINDS, "kind of task"),
    dueOn: (v) => day(v, "The due date"),
    channelId: (v) => (v == null || v === "" ? null : id(v)),
    ownerUserId: (v) => (v == null || v === "" ? null : id(v)),
    notes: (v) => text(v, 2000),
  });
}

function testFields(body: any) {
  return patch(body, {
    name: (v) => {
      const s = text(v, 160);
      if (!s) throw new InputError("Give the test a name.");
      return s;
    },
    variable: (v) => text(v, 160),
    hypothesis: (v) => text(v, 2000),
    status: (v) => oneOf(v, TEST_STATUSES, "status"),
    startsOn: (v) => day(v, "Starts"),
    endsOn: (v) => day(v, "Ends"),
    channelId: (v) => (v == null || v === "" ? null : id(v)),
    conclusion: (v) => text(v, 2000),
  });
}

function variantFields(body: any) {
  return patch(body, {
    label: (v) => {
      const s = text(v, 60);
      if (!s) throw new InputError("Give the version a label, like A or B.");
      return s;
    },
    description: (v) => text(v, 1000),
    utmContent: (v) => text(v, 120),
    landingPath: (v) => {
      const s = text(v, 300);
      if (s && !s.startsWith("/")) throw new InputError("The page should start with a slash, like /lp/juniors.");
      return s;
    },
    manualVisitors: (v) => whole(v, "Visitors"),
    manualConversions: (v) => whole(v, "Bookings"),
  });
}

export async function insertRow(table: string, p: { sets: string[]; params: unknown[] }, extra: Record<string, unknown>): Promise<number> {
  const cols = p.sets.map((s) => s.split(" = ")[0]).concat(Object.keys(extra));
  const params = [...p.params, ...Object.values(extra)];
  const [row] = await q<{ id: number }>(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${params.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    params,
  );
  return row.id;
}

export async function updateRow(table: string, p: { sets: string[]; params: unknown[] }, where: string, whereParams: unknown[], touch = false) {
  if (!p.sets.length) throw new InputError("Nothing to change.");
  const sets = touch ? [...p.sets, "updated_at = now()"] : p.sets;
  const shifted = where.replace(/\$(\d+)/g, (_, i) => `$${Number(i) + p.params.length}`);
  const rows = await q(`UPDATE ${table} SET ${sets.join(", ")} WHERE ${shifted} RETURNING id`, [...p.params, ...whereParams]);
  if (!rows.length) throw new NotFound();
}

/** A child row must belong to the campaign in the URL. */
export async function ownedBy(table: string, rowId: number, campaignId: number) {
  const rows = await q(`SELECT 1 FROM ${table} WHERE id = $1 AND campaign_id = $2`, [rowId, campaignId]);
  if (!rows.length) throw new NotFound();
}

export function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      if (e instanceof InputError) return res.status(400).json({ message: e.message });
      if (e instanceof NotFound) return res.status(404).json({ message: "Not found" });
      if (e?.code === "23505") return res.status(400).json({ message: "That label is already used in this test." });
      if (e?.code === "23514") return res.status(400).json({ message: "Those dates or amounts are not valid." });
      console.error(`[Campaigns] ${req.method} ${req.path}:`, e?.message ?? e);
      res.status(500).json({ message: "That did not work. Try again." });
    }
  };
}

export function registerCampaignRoutes(app: Express) {
  const gate = [requireAuth, requireTab(CAMPAIGNS_TAB), requireHubWorkspace] as const;

  // ── What can be linked ────────────────────────────────────────────────────
  app.get(`${BASE}/options`, ...gate, handle(async (_req, res) => {
    const [programmes, meta, emails, codes, people] = await Promise.all([
      q<any>(
        `SELECT p.id, p.name, o.slug, p.is_active, p.start_date::text AS starts_on
         FROM programs p LEFT JOIN organizations o ON o.id = p.organization_id
         ORDER BY p.is_active DESC, p.start_date DESC NULLS LAST, p.name LIMIT 400`,
      ),
      q<any>(
        `SELECT d.dim_key AS id, max(d.dim_label) AS name, max(d.day)::text AS last_day,
                COALESCE(sum(d.value) FILTER (WHERE d.metric = 'spend_cents'), 0)::bigint AS spend
         FROM marketing_daily d JOIN marketing_sources s ON s.id = d.source_id
         WHERE s.platform = 'meta_ads' AND d.dim_type = 'campaign' AND d.day > now() - interval '400 days'
         GROUP BY 1 ORDER BY max(d.day) DESC, 4 DESC LIMIT 150`,
      ),
      q<any>(
        `SELECT c.id, c.subject, ((COALESCE(c.sent_at, c.created_at)) AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific/Auckland')::date::text AS day,
                COALESCE(c.sent_count, 0) AS sent
         FROM email_campaigns c
         WHERE COALESCE(c.recipient_count, 0) >= 10 AND c.status <> 'draft'
         ORDER BY COALESCE(c.sent_at, c.created_at) DESC LIMIT 150`,
      ),
      q<{ code: string }>(`SELECT DISTINCT code FROM discounts WHERE code IS NOT NULL AND btrim(code) <> '' ORDER BY 1 LIMIT 300`),
      q<any>(
        `SELECT DISTINCT u.id, btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS name
         FROM public.users u JOIN user_organizations uo ON uo.user_id = u.id
         JOIN organizations o ON o.id = uo.organization_id
         WHERE o.slug = 'united-sports-group' AND u.active AND u.email NOT LIKE '\\_%' ORDER BY 2`,
      ),
    ]);
    const body: CampaignOptions = {
      programmes: programmes.map((p) => ({ id: p.id, name: p.name, workspace: hubWorkspace(p.slug)?.short ?? null, active: Boolean(p.is_active), startsOn: p.starts_on })),
      metaCampaigns: meta.map((m) => ({ id: String(m.id), name: m.name ?? String(m.id), lastDay: m.last_day, spendCents: Number(m.spend) })),
      emailCampaigns: emails.map((e) => ({ id: e.id, subject: e.subject, day: e.day, sent: Number(e.sent) })),
      discountCodes: codes.map((c) => c.code),
      people: people.filter((p) => p.name).map((p) => ({ id: p.id, name: p.name })),
    };
    res.json(body);
  }));

  // ── Every campaign, with where it stands ──────────────────────────────────
  app.get(BASE, ...gate, handle(async (req, res) => {
    const archived = req.query.archived === "1";
    const rows = await q<Raw>(
      `SELECT ${CAMPAIGN_COLUMNS} FROM cmp_campaigns c WHERE (c.archived_at IS NOT NULL) = $1
       ORDER BY (c.status = 'live') DESC, COALESCE(c.event_starts_on, c.ends_on, c.starts_on) NULLS LAST, c.id DESC`,
      [archived],
    );
    const today = nzTodayIso();
    const items: CampaignListItem[] = [];
    for (const raw of rows) {
      const c = toCampaign(raw);
      const [result, spend, tasks, channels] = await Promise.all([
        resultFor(c),
        q<{ meta_ids: string[]; manual: string | null }>(
          `SELECT COALESCE(array_agg(DISTINCT m) FILTER (WHERE m IS NOT NULL), '{}') AS meta_ids,
                  (SELECT sum(manual_spend_cents) FROM cmp_channels WHERE campaign_id = $1 AND cardinality(meta_campaign_ids) = 0)::bigint AS manual
           FROM cmp_channels ch LEFT JOIN LATERAL unnest(ch.meta_campaign_ids) AS m ON true WHERE ch.campaign_id = $1`,
          [c.id],
        ),
        q<{ title: string; due_on: string | null; done: boolean }>(
          `SELECT title, due_on::text, (done_at IS NOT NULL) AS done FROM cmp_tasks WHERE campaign_id = $1 ORDER BY due_on NULLS LAST, id`,
          [c.id],
        ),
        q<{ total: number; live: number }>(
          `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'live')::int AS live FROM cmp_channels WHERE campaign_id = $1`,
          [c.id],
        ),
      ]);
      const meta = await metaStats(spend[0]?.meta_ids ?? [], c.startsOn, c.endsOn);
      const open = tasks.filter((t) => !t.done);
      const next = open.find((t) => t.due_on);
      items.push({
        ...c,
        result: { ...result, daily: result.daily.slice(-14) },
        spendCents: (meta?.spendCents ?? 0) + Number(spend[0]?.manual ?? 0),
        tasksOpen: open.length,
        tasksOverdue: open.filter((t) => t.due_on && t.due_on < today).length,
        nextTask: next ? { title: next.title, dueOn: next.due_on! } : null,
        channels: channels[0]?.total ?? 0,
        channelsLive: channels[0]?.live ?? 0,
      });
    }
    res.json({ today, campaigns: items });
  }));

  app.post(BASE, ...gate, handle(async (req, res) => {
    const p = campaignFields(req.body);
    if (!has(req.body, "name")) throw new InputError("Give the campaign a name.");
    ordered(req.body.startsOn ?? null, req.body.endsOn ?? null, "Selling");
    ordered(req.body.eventStartsOn ?? null, req.body.eventEndsOn ?? null, "The event");
    await checkProgrammes(intList(req.body.programIds, "Programmes"));
    const newId = await insertRow("cmp_campaigns", p, { created_by: req.session.userId ?? null });
    res.status(201).json({ id: newId });
  }));

  app.get(`${BASE}/:id`, ...gate, handle(async (req, res) => {
    res.json(await detail(id(req.params.id)));
  }));

  app.patch(`${BASE}/:id`, ...gate, handle(async (req, res) => {
    const campaignId = id(req.params.id);
    const current = await loadCampaign(campaignId);
    const p = campaignFields(req.body);
    const b = req.body ?? {};
    ordered(has(b, "startsOn") ? b.startsOn : current.startsOn, has(b, "endsOn") ? b.endsOn : current.endsOn, "Selling");
    ordered(has(b, "eventStartsOn") ? b.eventStartsOn : current.eventStartsOn, has(b, "eventEndsOn") ? b.eventEndsOn : current.eventEndsOn, "The event");
    if (has(b, "programIds")) await checkProgrammes(intList(b.programIds, "Programmes"));
    if (has(b, "archived")) {
      await q(`UPDATE cmp_campaigns SET archived_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1`, [campaignId, b.archived === true]);
      if (!p.sets.length) return res.json({ ok: true });
    }
    await updateRow("cmp_campaigns", p, "id = $1", [campaignId], true);
    res.json({ ok: true });
  }));

  // ── Channels ──────────────────────────────────────────────────────────────
  app.post(`${BASE}/:id/channels`, ...gate, handle(async (req, res) => {
    const campaignId = id(req.params.id);
    await loadCampaign(campaignId);
    if (!has(req.body, "kind") || !has(req.body, "name")) throw new InputError("Pick the kind of channel and give it a name.");
    ordered(req.body.startsOn ?? null, req.body.endsOn ?? null, "The channel");
    const newId = await insertRow("cmp_channels", channelFields(req.body), { campaign_id: campaignId });
    res.status(201).json({ id: newId });
  }));
  app.patch(`${BASE}/:id/channels/:childId`, ...gate, handle(async (req, res) => {
    const [campaignId, childId] = [id(req.params.id), id(req.params.childId)];
    await ownedBy("cmp_channels", childId, campaignId);
    await updateRow("cmp_channels", channelFields(req.body), "id = $1", [childId]);
    res.json({ ok: true });
  }));
  app.delete(`${BASE}/:id/channels/:childId`, ...gate, handle(async (req, res) => {
    const [campaignId, childId] = [id(req.params.id), id(req.params.childId)];
    await ownedBy("cmp_channels", childId, campaignId);
    await q(`DELETE FROM cmp_channels WHERE id = $1`, [childId]);
    res.json({ ok: true });
  }));

  // ── Tasks ─────────────────────────────────────────────────────────────────
  app.post(`${BASE}/:id/tasks`, ...gate, handle(async (req, res) => {
    const campaignId = id(req.params.id);
    await loadCampaign(campaignId);
    if (!has(req.body, "title")) throw new InputError("Say what the task is.");
    if (req.body.channelId) await ownedBy("cmp_channels", id(req.body.channelId), campaignId);
    const newId = await insertRow("cmp_tasks", taskFields(req.body), { campaign_id: campaignId, created_by: req.session.userId ?? null });
    res.status(201).json({ id: newId });
  }));
  app.patch(`${BASE}/:id/tasks/:childId`, ...gate, handle(async (req, res) => {
    const [campaignId, childId] = [id(req.params.id), id(req.params.childId)];
    await ownedBy("cmp_tasks", childId, campaignId);
    const b = req.body ?? {};
    if (b.channelId) await ownedBy("cmp_channels", id(b.channelId), campaignId);
    if (has(b, "done")) {
      // Who ticked it and when come from the session and the clock, never the body.
      await q(
        `UPDATE cmp_tasks SET done_at = CASE WHEN $2 THEN now() ELSE NULL END, done_by = CASE WHEN $2 THEN $3::int ELSE NULL END WHERE id = $1`,
        [childId, b.done === true, req.session.userId ?? null],
      );
    }
    const p = taskFields(b);
    if (p.sets.length) await updateRow("cmp_tasks", p, "id = $1", [childId]);
    else if (!has(b, "done")) throw new InputError("Nothing to change.");
    res.json({ ok: true });
  }));
  app.delete(`${BASE}/:id/tasks/:childId`, ...gate, handle(async (req, res) => {
    const [campaignId, childId] = [id(req.params.id), id(req.params.childId)];
    await ownedBy("cmp_tasks", childId, campaignId);
    await q(`DELETE FROM cmp_tasks WHERE id = $1`, [childId]);
    res.json({ ok: true });
  }));

  // A draft work-back plan from the event's first day. Dates already gone are left out.
  app.post(`${BASE}/:id/suggest-timeline`, ...gate, handle(async (req, res) => {
    const campaignId = id(req.params.id);
    const c = await loadCampaign(campaignId);
    const anchor = c.eventStartsOn ?? c.endsOn;
    if (!anchor) throw new InputError("Set the first day of the event (or the day selling ends) first, so the plan has a date to count back from.");
    const today = nzTodayIso();
    const existing = new Set((await q<{ title: string }>(`SELECT title FROM cmp_tasks WHERE campaign_id = $1`, [campaignId])).map((t) => t.title));
    let added = 0;
    let skipped = 0;
    for (const t of SUGGESTED_TIMELINE) {
      const due = addDays(anchor, -t.daysBefore);
      if (due < today || existing.has(t.title)) {
        skipped++;
        continue;
      }
      await q(`INSERT INTO cmp_tasks (campaign_id, title, kind, due_on, created_by) VALUES ($1, $2, $3, $4, $5)`, [
        campaignId, t.title, t.kind, due, req.session.userId ?? null,
      ]);
      added++;
    }
    res.json({ added, skipped });
  }));

  // ── Split tests ───────────────────────────────────────────────────────────
  app.post(`${BASE}/:id/tests`, ...gate, handle(async (req, res) => {
    const campaignId = id(req.params.id);
    await loadCampaign(campaignId);
    if (!has(req.body, "name")) throw new InputError("Give the test a name.");
    ordered(req.body.startsOn ?? null, req.body.endsOn ?? null, "The test");
    const newId = await insertRow("cmp_tests", testFields(req.body), { campaign_id: campaignId });
    // A test is a comparison, so it starts with two versions to fill in.
    await q(`INSERT INTO cmp_test_variants (test_id, label, position) VALUES ($1, 'A', 0), ($1, 'B', 1)`, [newId]);
    res.status(201).json({ id: newId });
  }));
  app.patch(`${BASE}/:id/tests/:childId`, ...gate, handle(async (req, res) => {
    const [campaignId, childId] = [id(req.params.id), id(req.params.childId)];
    await ownedBy("cmp_tests", childId, campaignId);
    const b = req.body ?? {};
    if (has(b, "winnerVariantId")) {
      const winner = b.winnerVariantId == null ? null : id(b.winnerVariantId);
      if (winner != null) {
        const ok = await q(`SELECT 1 FROM cmp_test_variants WHERE id = $1 AND test_id = $2`, [winner, childId]);
        if (!ok.length) throw new InputError("That version is not part of this test.");
      }
      await q(`UPDATE cmp_tests SET winner_variant_id = $2 WHERE id = $1`, [childId, winner]);
    }
    const p = testFields(b);
    if (p.sets.length) await updateRow("cmp_tests", p, "id = $1", [childId]);
    else if (!has(b, "winnerVariantId")) throw new InputError("Nothing to change.");
    res.json({ ok: true });
  }));
  app.delete(`${BASE}/:id/tests/:childId`, ...gate, handle(async (req, res) => {
    const [campaignId, childId] = [id(req.params.id), id(req.params.childId)];
    await ownedBy("cmp_tests", childId, campaignId);
    await q(`DELETE FROM cmp_tests WHERE id = $1`, [childId]);
    res.json({ ok: true });
  }));

  const variantOwned = async (variantId: number, testId: number, campaignId: number) => {
    await ownedBy("cmp_tests", testId, campaignId);
    const rows = await q(`SELECT 1 FROM cmp_test_variants WHERE id = $1 AND test_id = $2`, [variantId, testId]);
    if (!rows.length) throw new NotFound();
  };
  app.post(`${BASE}/:id/tests/:testId/variants`, ...gate, handle(async (req, res) => {
    const [campaignId, testId] = [id(req.params.id), id(req.params.testId)];
    await ownedBy("cmp_tests", testId, campaignId);
    if (!has(req.body, "label")) throw new InputError("Give the version a label, like C.");
    const newId = await insertRow("cmp_test_variants", variantFields(req.body), { test_id: testId, position: 99 });
    res.status(201).json({ id: newId });
  }));
  app.patch(`${BASE}/:id/tests/:testId/variants/:variantId`, ...gate, handle(async (req, res) => {
    const [campaignId, testId, variantId] = [id(req.params.id), id(req.params.testId), id(req.params.variantId)];
    await variantOwned(variantId, testId, campaignId);
    await updateRow("cmp_test_variants", variantFields(req.body), "id = $1", [variantId]);
    res.json({ ok: true });
  }));
  app.delete(`${BASE}/:id/tests/:testId/variants/:variantId`, ...gate, handle(async (req, res) => {
    const [campaignId, testId, variantId] = [id(req.params.id), id(req.params.testId), id(req.params.variantId)];
    await variantOwned(variantId, testId, campaignId);
    const left = await q<{ n: number }>(`SELECT count(*)::int AS n FROM cmp_test_variants WHERE test_id = $1`, [testId]);
    if ((left[0]?.n ?? 0) <= 2) throw new InputError("A test needs at least two versions.");
    await q(`UPDATE cmp_tests SET winner_variant_id = NULL WHERE id = $1 AND winner_variant_id = $2`, [testId, variantId]);
    await q(`DELETE FROM cmp_test_variants WHERE id = $1`, [variantId]);
    res.json({ ok: true });
  }));
}

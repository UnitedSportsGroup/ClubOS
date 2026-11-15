/**
 * Marketing → Word of Mouth · Offers & Codes · Mobile Apps · Product Quality.
 * See shared/marketing-more.ts. Read-only; every figure is a count or a sum,
 * never a person. Group workspace only (requireHubWorkspace).
 *
 * 🔴 Bookings are counted through REAL_REGISTRATION_STATUS_SQL: unpaid is not registered.
 */
import type { Express, Request, Response } from "express";
import { hdyhauLabel } from "@shared/hdyhau";
import {
  HEARD_GROUPS, MOBILE_APPS_TAB, OFFERS_TAB, PRODUCT_QUALITY_TAB, WORD_OF_MOUTH_TAB,
  heardGroup, morePeriod, type AppsReport, type HeardGroup, type OfferCodeRow, type OffersReport, type WordOfMouthReport,
} from "@shared/marketing-more";
import { REAL_REGISTRATION_STATUS_SQL } from "@shared/registrations";
import { requireAuth, requireTab } from "../auth";
import { cached, q, requireHubWorkspace } from "./common";

/** "since" as a parameter: NULL means all time. registered_at is a naive UTC timestamp. */
const sinceOf = (days: number | null): string | null => (days == null ? null : new Date(Date.now() - days * 86_400_000).toISOString());

export async function wordOfMouth(periodKey: unknown): Promise<WordOfMouthReport> {
  const period = morePeriod(periodKey);
  const rows = await q<{ org: string; source: string | null; n: string }>(
    `SELECT o.name AS org, NULLIF(btrim(r.referral_source), '') AS source, count(*) AS n
     FROM registrations r
     JOIN programs p ON p.id = r.program_id
     JOIN organizations o ON o.id = p.organization_id
     WHERE r.status IN ${REAL_REGISTRATION_STATUS_SQL}
       AND ($1::timestamptz IS NULL OR (r.registered_at AT TIME ZONE 'UTC') >= $1::timestamptz)
     GROUP BY 1, 2`,
    [sinceOf(period.days)],
  );
  const groups = new Map<HeardGroup, number>();
  const answers = new Map<string, number>();
  const ws = new Map<string, { name: string; bookings: number; answered: number; people: number; before: number }>();
  let bookings = 0;
  let answered = 0;
  for (const r of rows) {
    const n = Number(r.n);
    bookings += n;
    const w = ws.get(r.org) ?? { name: r.org, bookings: 0, answered: 0, people: 0, before: 0 };
    w.bookings += n;
    if (r.source) {
      answered += n;
      w.answered += n;
      const g = heardGroup(r.source);
      groups.set(g, (groups.get(g) ?? 0) + n);
      if (g === "people") w.people += n;
      if (g === "before") w.before += n;
      // Free-text "Other: …" answers can name a child, so they are counted as one line, never listed.
      const label = /^other/i.test(r.source) ? "Other (typed in)" : hdyhauLabel(r.source) ?? r.source;
      answers.set(label, (answers.get(label) ?? 0) + n);
    }
    ws.set(r.org, w);
  }
  return {
    period: period.key,
    bookings,
    answered,
    groups: HEARD_GROUPS.map((g) => ({ key: g.key, label: g.label, count: groups.get(g.key) ?? 0 })).filter((g) => g.count > 0).sort((a, b) => b.count - a.count),
    answers: Array.from(answers.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    byWorkspace: Array.from(ws.values()).filter((w) => w.bookings > 0).sort((a, b) => b.bookings - a.bookings),
  };
}

export async function offers(periodKey: unknown): Promise<OffersReport> {
  const period = morePeriod(periodKey);
  const since = sinceOf(period.days);
  const [used, defs, shopUsed, shopDefs] = await Promise.all([
    q<{ code: string; org_id: number; org: string; uses: string; paid: string; off: string; last: string | null }>(
      `SELECT upper(btrim(c.code)) AS code, o.id AS org_id, o.name AS org, count(*) AS uses,
              COALESCE(sum(r.total_cents), 0) AS paid, COALESCE(sum(r.discount_cents), 0) AS off,
              max((r.registered_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Auckland')::date::text AS last
       FROM registrations r
       JOIN programs p ON p.id = r.program_id
       JOIN organizations o ON o.id = p.organization_id
       CROSS JOIN LATERAL unnest(string_to_array(r.discount_code, ',')) AS c(code)
       WHERE r.status IN ${REAL_REGISTRATION_STATUS_SQL} AND btrim(c.code) <> ''
         AND ($1::timestamptz IS NULL OR (r.registered_at AT TIME ZONE 'UTC') >= $1::timestamptz)
       GROUP BY 1, 2, 3`,
      [since],
    ),
    q<{ code: string; org_id: number; org: string; title: string; active: boolean }>(
      `SELECT upper(btrim(d.code)) AS code, o.id AS org_id, o.name AS org, d.title,
              (d.status = 'active' AND (d.end_date IS NULL OR d.end_date > now())) AS active
       FROM discounts d JOIN organizations o ON o.id = d.organization_id WHERE d.code IS NOT NULL AND btrim(d.code) <> ''`,
    ),
    q<{ code: string; org_id: number; org: string; uses: string; paid: string; off: string; last: string | null }>(
      `SELECT upper(btrim(s.discount_code)) AS code, o.id AS org_id, o.name AS org, count(*) AS uses,
              COALESCE(sum(s.total_cents), 0) AS paid, COALESCE(sum(s.discount_cents), 0) AS off,
              max(s.created_at AT TIME ZONE 'Pacific/Auckland')::date::text AS last
       FROM shop_orders s JOIN organizations o ON o.id = s.organization_id
       WHERE s.discount_code IS NOT NULL AND btrim(s.discount_code) <> '' AND s.paid_at IS NOT NULL
         AND ($1::timestamptz IS NULL OR s.created_at >= $1::timestamptz)
       GROUP BY 1, 2, 3`,
      [since],
    ),
    q<{ code: string; org_id: number; org: string; active: boolean }>(
      `SELECT upper(btrim(c.code)) AS code, o.id AS org_id, o.name AS org,
              (c.active AND (c.ends_at IS NULL OR c.ends_at > now())) AS active
       FROM shop_discount_codes c JOIN organizations o ON o.id = c.organization_id`,
    ),
  ]);
  const defKey = (org: number, code: string) => `${org}:${code}`;
  const defMap = new Map(defs.map((d) => [defKey(d.org_id, d.code), d]));
  const shopDefMap = new Map(shopDefs.map((d) => [defKey(d.org_id, d.code), d]));
  const rows: OfferCodeRow[] = [
    ...used.map((u): OfferCodeRow => {
      const d = defMap.get(defKey(u.org_id, u.code));
      return { code: u.code, workspace: u.org, title: d?.title?.trim() || null, where: "bookings", active: d ? d.active : null, uses: Number(u.uses), paidCents: Number(u.paid), discountCents: Number(u.off), lastUsed: u.last };
    }),
    ...shopUsed.map((u): OfferCodeRow => {
      const d = shopDefMap.get(defKey(u.org_id, u.code));
      return { code: u.code, workspace: u.org, title: null, where: "shop", active: d ? d.active : null, uses: Number(u.uses), paidCents: Number(u.paid), discountCents: Number(u.off), lastUsed: u.last };
    }),
  ].sort((a, b) => b.uses - a.uses || b.paidCents - a.paidCents);
  const usedKeys = new Set(used.map((u) => defKey(u.org_id, u.code)));
  const shopUsedKeys = new Set(shopUsed.map((u) => defKey(u.org_id, u.code)));
  const unused = [
    ...defs.filter((d) => d.active && !usedKeys.has(defKey(d.org_id, d.code))).map((d) => ({ code: d.code, workspace: d.org, title: d.title?.trim() || null, where: "bookings" as const })),
    ...shopDefs.filter((d) => d.active && !shopUsedKeys.has(defKey(d.org_id, d.code))).map((d) => ({ code: d.code, workspace: d.org, title: null, where: "shop" as const })),
  ].sort((a, b) => a.workspace.localeCompare(b.workspace) || a.code.localeCompare(b.code));
  // A booking that used two codes appears on both rows, so the totals are counted from the bookings themselves.
  const [t] = await q<{ uses: string; paid: string; off: string }>(
    `SELECT count(*) AS uses, COALESCE(sum(total_cents), 0) AS paid, COALESCE(sum(discount_cents), 0) AS off FROM (
       SELECT r.total_cents, r.discount_cents FROM registrations r
       WHERE r.status IN ${REAL_REGISTRATION_STATUS_SQL} AND NULLIF(btrim(r.discount_code), '') IS NOT NULL
         AND ($1::timestamptz IS NULL OR (r.registered_at AT TIME ZONE 'UTC') >= $1::timestamptz)
       UNION ALL
       SELECT s.total_cents, s.discount_cents FROM shop_orders s
       WHERE NULLIF(btrim(s.discount_code), '') IS NOT NULL AND s.paid_at IS NOT NULL
         AND ($1::timestamptz IS NULL OR s.created_at >= $1::timestamptz)
     ) x`,
    [since],
  );
  return { period: period.key, rows, unused, totals: { uses: Number(t?.uses ?? 0), paidCents: Number(t?.paid ?? 0), discountCents: Number(t?.off ?? 0) } };
}

const APP_NAMES: Record<string, string> = {
  "clubos-staff": "ClubOS staff app",
  "cic-youth": "CIC Youth app",
  "siu-app": "South Island United app",
  "mfl": "Mini Football app",
};

export async function apps(): Promise<AppsReport> {
  const [tokens, users, pushes] = await Promise.all([
    q<{ app: string; platform: string; n: string }>(`SELECT app, platform, count(*) AS n FROM device_push_tokens WHERE NOT disabled GROUP BY 1, 2`),
    q<{ app: string; n: string }>(`SELECT app, count(*) AS n FROM app_users GROUP BY 1`),
    q<{ app: string; n: string; last: string | null }>(
      `SELECT app, count(*) AS n, max(sent_at AT TIME ZONE 'Pacific/Auckland')::date::text AS last FROM push_campaigns WHERE status = 'sent' GROUP BY 1`,
    ),
  ]);
  const by = new Map<string, AppsReport["apps"][number]>();
  const row = (app: string) => {
    let r = by.get(app);
    if (!r) by.set(app, (r = { app, name: APP_NAMES[app] ?? app, pushDevices: 0, ios: 0, android: 0, signUps: 0, pushesSent: 0, lastPush: null }));
    return r;
  };
  for (const t of tokens) {
    const r = row(t.app);
    const n = Number(t.n);
    r.pushDevices += n;
    if (t.platform === "ios") r.ios += n;
    if (t.platform === "android") r.android += n;
  }
  for (const u of users) row(u.app).signUps = Number(u.n);
  for (const p of pushes) {
    const r = row(p.app);
    r.pushesSent = Number(p.n);
    r.lastPush = p.last;
  }
  return { apps: Array.from(by.values()).sort((a, b) => b.pushDevices + b.signUps - (a.pushDevices + a.signUps)) };
}

function send<T>(name: string, fn: (req: Request) => Promise<T>, key: (req: Request) => string) {
  return async (req: Request, res: Response) => {
    try {
      res.json(await cached(`${name}:${key(req)}`, 2 * 60_000, () => fn(req)));
    } catch (e: any) {
      console.error(`[Marketing] ${name} failed:`, e?.message ?? e);
      res.status(500).json({ message: "This report could not be loaded. Try again." });
    }
  };
}

export function registerMarketingMoreRoutes(app: Express) {
  const gate = (tab: string) => [requireAuth, requireTab(tab), requireHubWorkspace] as const;
  const period = (req: Request) => morePeriod(req.query.period).key;
  app.get("/api/admin/word-of-mouth/report", ...gate(WORD_OF_MOUTH_TAB), send("more-wom", (req) => wordOfMouth(req.query.period), period));
  // Product Quality reads the SAME report behind its own tab: "did they come back, did they tell someone".
  app.get("/api/admin/product-quality/signals", ...gate(PRODUCT_QUALITY_TAB), send("more-wom", () => wordOfMouth("year"), () => "year"));
  app.get("/api/admin/offers-codes/report", ...gate(OFFERS_TAB), send("more-offers", (req) => offers(req.query.period), period));
  app.get("/api/admin/mobile-apps/report", ...gate(MOBILE_APPS_TAB), send("more-apps", () => apps(), () => "all"));
}

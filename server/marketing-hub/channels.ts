/**
 * Marketing channels — Email, SMS, Paid ads and WhatsApp reports.
 * United Sports Group → Marketing → each its own tab and its own permission.
 *
 * Every route: requireAuth → requireTab(<its tab>) → group workspace only.
 * Read-only. Nothing here sends anything.
 *
 * 🔴 Aggregates and subjects only. The SMS list shows a number with its middle
 *    hidden; no email address is returned by the email report.
 * 🔴 Naive `timestamp` columns hold UTC in this database (see nzBounds).
 */
import type { Express, Request, Response } from "express";
import { eachDay } from "@shared/dashboard";
import {
  EMAIL_BRAND_BY_DOMAIN,
  EMAIL_TAB,
  PAID_ADS_TAB,
  SMS_TAB,
  WHATSAPP_TAB,
  emailDomain,
  type EmailCampaignRow,
  type EmailReport,
  type SmsReport,
  type WhatsAppReport,
} from "@shared/marketing-channels";
import { requireAuth, requireTab } from "../auth";
import { HubInputError, cached, nzBounds, parseScope, q, requireHubWorkspace, scopeKey, type HubScope } from "./common";
import { ads, tracked } from "./routes";

const NZ_DAY_NAIVE = (col: string) => `(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific/Auckland')::date::text`;
const NZ_DAY_TZ = (col: string) => `(${col} AT TIME ZONE 'Pacific/Auckland')::date::text`;

// ── Email ───────────────────────────────────────────────────────────────────

async function emailReport(scope: HubScope): Promise<EmailReport> {
  const r = [scope.range.from, scope.range.to];
  const when = `COALESCE(c.sent_at, c.created_at)`;
  const [campaigns, perDay, other, unsub, bounces, automations] = await Promise.all([
    q<any>(
      `SELECT c.id, c.subject, c.from_email, c.status, ${NZ_DAY_NAIVE(when)} AS day,
              COALESCE(c.recipient_count, 0) AS recipients, COALESCE(c.sent_count, 0) AS sent, COALESCE(c.failed_count, 0) AS failed,
              (c.status = 'sending' AND c.created_at < (now() AT TIME ZONE 'UTC') - interval '3 hours') AS stalled,
              x.tracked, x.opened, x.clicked
       FROM email_campaigns c
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE rc.status = 'sent')::int AS tracked,
                count(*) FILTER (WHERE rc.first_opened_at IS NOT NULL)::int AS opened,
                count(*) FILTER (WHERE rc.first_clicked_at IS NOT NULL)::int AS clicked,
                count(*)::int AS rows
         FROM email_campaign_recipients rc WHERE rc.campaign_id = c.id) x ON true
       WHERE ${nzBounds(when, "timestamp", "$1", "$2")} AND c.status <> 'draft'
       ORDER BY ${when} DESC`,
      r,
    ),
    q<{ day: string; sent: number }>(
      `SELECT ${NZ_DAY_TZ("rc.sent_at")} AS day, count(*)::int AS sent
       FROM email_campaign_recipients rc
       WHERE rc.status = 'sent' AND ${nzBounds("rc.sent_at", "timestamptz", "$1", "$2")} GROUP BY 1`,
      r,
    ),
    q<{ n: number }>(`SELECT count(*)::int AS n FROM email_logs l WHERE ${nzBounds("l.sent_at", "timestamp", "$1", "$2")}`, r),
    q<{ n: number }>(`SELECT count(*)::int AS n FROM email_unsubscribes u WHERE ${nzBounds("u.created_at", "timestamp", "$1", "$2")}`, r),
    q<{ kind: string; n: number }>(
      `SELECT b.kind, count(*)::int AS n FROM email_bounces b WHERE ${nzBounds("b.last_at", "timestamptz", "$1", "$2")} GROUP BY 1`,
      r,
    ),
    q<any>(
      `SELECT a.id, a.name, a.status,
              (SELECT count(*)::int FROM mailer_automation_sends s
                JOIN mailer_automation_steps st ON st.id = s.step_id WHERE st.automation_id = a.id AND s.status = 'sent') AS sends
       FROM mailer_automations a WHERE a.archived_at IS NULL ORDER BY a.id`,
    ).catch(() => [] as any[]),
  ]);

  // 🔴 A send to a handful of people is a one-to-one email written in the Mailer
  // (an overdue-account notice, a note to one family), and its subject usually
  // carries a name. Those are counted, never listed.
  const ONE_TO_ONE = 10;
  const direct = campaigns.filter((c) => Number(c.recipients) < ONE_TO_ONE);
  const rows: EmailCampaignRow[] = campaigns.filter((c) => Number(c.recipients) >= ONE_TO_ONE).map((c) => {
    const domain = emailDomain(c.from_email);
    // No per-person rows = sent before opens were recorded (Aug 2026).
    const hasTracking = Number(c.tracked ?? 0) > 0 || Number(c.opened ?? 0) > 0;
    return {
      id: c.id,
      subject: c.subject,
      from: String(c.from_email ?? "").replace(/[<>]/g, " ").trim(),
      brand: EMAIL_BRAND_BY_DOMAIN[domain] ?? (domain || "Unknown"),
      status: c.status,
      day: c.day,
      recipients: Number(c.recipients),
      sent: Number(c.sent),
      failed: Number(c.failed),
      tracked: hasTracking ? Number(c.tracked) : null,
      opened: hasTracking ? Number(c.opened) : null,
      clicked: hasTracking ? Number(c.clicked) : null,
      stalled: Boolean(c.stalled),
    };
  });

  const brand = new Map<string, { campaigns: number; sent: number; opened: number; tracked: number }>();
  const totals = { campaigns: rows.length, sent: 0, failed: 0, tracked: 0, opened: 0, clicked: 0 };
  for (const c of rows) {
    totals.sent += c.sent;
    totals.failed += c.failed;
    totals.tracked += c.tracked ?? 0;
    totals.opened += c.opened ?? 0;
    totals.clicked += c.clicked ?? 0;
    const b = brand.get(c.brand) ?? { campaigns: 0, sent: 0, opened: 0, tracked: 0 };
    b.campaigns++;
    b.sent += c.sent;
    b.opened += c.opened ?? 0;
    b.tracked += c.tracked ?? 0;
    brand.set(c.brand, b);
  }
  const days = new Map(perDay.map((d) => [d.day, d.sent]));
  const bounce = (kind: string) => bounces.find((b) => b.kind === kind)?.n ?? 0;

  return {
    range: scope.range,
    totals: {
      ...totals,
      oneToOne: direct.length,
      otherEmails: other[0]?.n ?? 0,
      unsubscribes: unsub[0]?.n ?? 0,
      bouncesPermanent: bounce("permanent"),
      bouncesTemporary: bounce("transient"),
      complaints: bounce("complaint"),
    },
    series: eachDay(scope.range).map((date) => ({ date, sent: days.get(date) ?? 0 })),
    byBrand: Array.from(brand.entries()).map(([b, v]) => ({ brand: b, ...v })).sort((a, b) => b.sent - a.sent),
    campaigns: rows.slice(0, 200),
    stalled: rows.filter((c) => c.stalled),
    automations: automations.map((a: any) => ({ id: a.id, name: a.name, status: a.status, sends: Number(a.sends ?? 0) })),
  };
}

// ── SMS ─────────────────────────────────────────────────────────────────────

const maskPhone = (p: string) => (p.length > 6 ? `${p.slice(0, 5)}…${p.slice(-3)}` : "…");

async function smsReport(scope: HubScope): Promise<SmsReport> {
  const r = [scope.range.from, scope.range.to];
  const provider = (process.env.SMS_PROVIDER || "dryrun").trim().toLowerCase();
  const [messages, replies, consent] = await Promise.all([
    q<any>(
      `SELECT m.id, ${NZ_DAY_TZ("COALESCE(m.sent_at, m.created_at)")} AS day, m.phone_e164, left(m.body, 200) AS body,
              m.status, m.is_marketing, m.cost_cents, m.provider, (m.delivered_at IS NOT NULL) AS delivered
       FROM mkt_sms_messages m
       WHERE ${nzBounds("COALESCE(m.sent_at, m.created_at)", "timestamptz", "$1", "$2")}
       ORDER BY m.id DESC LIMIT 500`,
      r,
    ),
    q<{ n: number }>(`SELECT count(*)::int AS n FROM mkt_sms_inbound`).catch(() => [{ n: 0 }]),
    q<{ can_text: number; profiles: number; with_mobile: number }>(
      `SELECT (SELECT count(*)::int FROM mkt_consent WHERE channel = 'sms' AND can_receive) AS can_text,
              (SELECT count(*)::int FROM mkt_profiles) AS profiles,
              (SELECT count(DISTINCT profile_id)::int FROM mkt_consent WHERE channel = 'sms') AS with_mobile`,
    ),
  ]);
  const real = messages.filter((m) => m.provider !== "dryrun");
  const days = new Map<string, number>();
  for (const m of real) days.set(m.day, (days.get(m.day) ?? 0) + 1);
  return {
    range: scope.range,
    provider,
    live: provider !== "dryrun",
    totals: {
      sent: real.filter((m) => m.status !== "failed" && m.status !== "queued").length,
      delivered: real.filter((m) => m.delivered || m.status === "delivered").length,
      failed: real.filter((m) => m.status === "failed").length,
      costCents: real.reduce((s, m) => s + Number(m.cost_cents ?? 0), 0),
      tests: messages.length - real.length,
      replies: replies[0]?.n ?? 0,
    },
    consent: { canText: consent[0]?.can_text ?? 0, profiles: consent[0]?.profiles ?? 0, withMobile: consent[0]?.with_mobile ?? 0 },
    series: eachDay(scope.range).map((date) => ({ date, sent: days.get(date) ?? 0 })),
    messages: messages.slice(0, 100).map((m) => ({
      id: Number(m.id),
      day: m.day,
      to: maskPhone(String(m.phone_e164 ?? "")),
      body: m.body,
      status: m.status,
      marketing: Boolean(m.is_marketing),
      costCents: m.cost_cents == null ? null : Number(m.cost_cents),
      test: m.provider === "dryrun",
    })),
  };
}

// ── WhatsApp ────────────────────────────────────────────────────────────────

async function whatsappReport(scope: HubScope): Promise<WhatsAppReport> {
  const rows = await q<{ day: string; href: string; visitor_id: string | null }>(
    `SELECT ${NZ_DAY_NAIVE('t."timestamp"')} AS day, left(t.metadata->>'href', 200) AS href, t.visitor_id
     FROM analytics_events t
     WHERE t.event_type IN ('click', 'cta_click') AND COALESCE(t.is_bot, false) = false
       AND ${nzBounds('t."timestamp"', "timestamp", "$1", "$2")}
       AND (t.metadata->>'href' ILIKE '%wa.me/%' OR t.metadata->>'href' ILIKE '%whatsapp.com%')`,
    [scope.range.from, scope.range.to],
  );
  const days = new Map<string, number>();
  const links = new Map<string, number>();
  const visitors = new Set<string>();
  for (const r of rows) {
    days.set(r.day, (days.get(r.day) ?? 0) + 1);
    links.set(r.href, (links.get(r.href) ?? 0) + 1);
    if (r.visitor_id) visitors.add(r.visitor_id);
  }
  return {
    range: scope.range,
    linkClicks: rows.length,
    linkVisitors: visitors.size,
    links: Array.from(links.entries()).map(([href, clicks]) => ({ href, clicks })).sort((a, b) => b.clicks - a.clicks).slice(0, 20),
    series: eachDay(scope.range).map((date) => ({ date, clicks: days.get(date) ?? 0 })),
    connected: Boolean(process.env.WHATSAPP_BUSINESS_TOKEN),
  };
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function report<T>(name: string, fn: (s: HubScope) => Promise<T>) {
  return async (req: Request, res: Response) => {
    try {
      const scope = await parseScope(req);
      res.json(await cached(scopeKey(name, scope), 2 * 60_000, () => fn(scope)));
    } catch (e: any) {
      if (e instanceof HubInputError) return res.status(400).json({ message: e.message });
      console.error(`[Marketing] ${name} failed:`, e?.message ?? e);
      res.status(500).json({ message: "This report could not be loaded. Try again." });
    }
  };
}

export function registerMarketingChannelRoutes(app: Express) {
  const gate = (tab: string) => [requireAuth, requireTab(tab), requireHubWorkspace] as const;
  app.get("/api/admin/email-stats/report", ...gate(EMAIL_TAB), report("ch-email", emailReport));
  app.get("/api/admin/sms-stats/report", ...gate(SMS_TAB), report("ch-sms", smsReport));
  app.get("/api/admin/whatsapp-stats/report", ...gate(WHATSAPP_TAB), report("ch-whatsapp", whatsappReport));
  // Paid ads reads the SAME two reports as Marketing → Ads, behind its own tab,
  // so the two pages can never show different spend.
  app.get("/api/admin/paid-ads/ads", ...gate(PAID_ADS_TAB), report("ads", ads));
  app.get("/api/admin/paid-ads/tracked", ...gate(PAID_ADS_TAB), report("tracked", tracked));
}

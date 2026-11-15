/**
 * Funnels — the steps between "saw the ad" and "paid", inside a campaign.
 * Rules and wording: shared/funnels.ts. Same gate as Campaigns.
 *
 * 🔴 Only the plan is stored (cmp_funnels). Every count is read here, live:
 *    ad shown / clicked      marketing_daily, as Meta reports it
 *    email delivered/opened  email_campaign_recipients
 *    reached the page        web_events_slim — distinct visitors on the funnel's
 *                            landing pages who came in the funnel's way
 *    opened the booking form the SAME visitors, seen on a checkout page
 *    payment step / paid     registrations made by the SAME visitors
 *                            (registrations.visitor_id), paid = the one decider
 * 🔴 The page steps and the money steps are one group of people followed
 *    through, so the ad tag being dropped before checkout does not matter here.
 * 🔴 Aggregates only: no name, email, phone or visitor id leaves these routes.
 */
import type { Express } from "express";
import { nzTodayIso } from "@shared/dashboard";
import { CAMPAIGNS_TAB, addDays, type CampaignRow } from "@shared/campaigns";
import { looksLikeCheckout, normalisePage, splitPage, type FunnelPageSuggestion, type FunnelStage, type FunnelView } from "@shared/funnels";
import { requireAuth, requireTab } from "../auth";
import { requireHubWorkspace } from "../marketing-hub/common";
import {
  InputError,
  NET,
  NZ_DAY,
  NotFound,
  REAL,
  checkProgrammes,
  day,
  handle,
  has,
  id,
  insertRow,
  intList,
  loadCampaign,
  metaStats,
  ordered,
  ownedBy,
  patch,
  q,
  text,
  updateRow,
} from "./routes";

const BASE = "/api/admin/campaigns";
/** With no dates anywhere, this many days back are counted. */
const DEFAULT_DAYS = 90;
const META_WEB_CHANNELS = new Set(["facebook", "instagram", "meta_unattributed"]);

export type RawFunnel = {
  id: number;
  campaign_id: number;
  name: string;
  channel_id: number | null;
  program_ids: number[];
  landing_pages: string[];
  checkout_pages: string[];
  starts_on: string | null;
  ends_on: string | null;
  notes: string | null;
};
export type RawChannel = {
  id: number;
  kind: string;
  name: string;
  meta_campaign_ids: string[];
  email_campaign_ids: number[];
  utm_campaign: string | null;
  manual_spend_cents: string | null;
};

const FUNNEL_COLUMNS = `f.id, f.campaign_id, f.name, f.channel_id, f.program_ids, f.landing_pages, f.checkout_pages, f.starts_on::text, f.ends_on::text, f.notes`;

type EntryRule = { kind: "all" } | { kind: "utm"; value: string } | { kind: "meta" } | { kind: "email" };

function entryRule(ch: RawChannel | null): { rule: EntryRule; label: string; caveat: string | null } {
  if (!ch) return { rule: { kind: "all" }, label: "Everyone", caveat: null };
  if (ch.utm_campaign) return { rule: { kind: "utm", value: ch.utm_campaign.toLowerCase() }, label: `People who came through the "${ch.utm_campaign}" link`, caveat: null };
  if (ch.kind === "meta_ads" || ch.meta_campaign_ids.length) return { rule: { kind: "meta" }, label: "People from Facebook and Instagram", caveat: null };
  if (ch.kind === "email" || ch.email_campaign_ids.length) return { rule: { kind: "email" }, label: "People who came from an email", caveat: null };
  return {
    rule: { kind: "all" },
    label: "Everyone",
    caveat: `"${ch.name}" has no link name set, so ClubOS cannot tell its visitors from anyone else's. Everyone who reached the page is counted. Add a campaign name on the link (edit the channel) to separate them.`,
  };
}

const pageList = (pages: string[]) => (pages.length === 1 ? pages[0] : `${pages[0]} and ${pages.length - 1} more`);

export async function viewOf(c: CampaignRow, f: RawFunnel, ch: RawChannel | null, today: string): Promise<FunnelView> {
  const caveats: string[] = [];
  let from = f.starts_on ?? c.startsOn;
  const to = f.ends_on ?? c.endsOn ?? today;
  if (!from) {
    from = addDays(to < today ? to : today, -(DEFAULT_DAYS - 1));
    caveats.push(`No start date is set, so the ${DEFAULT_DAYS} days up to ${to < today ? "the end date" : "today"} are counted.`);
  }
  const programIds = f.program_ids.length ? f.program_ids : c.programIds;
  const { rule, label: entryLabel, caveat } = entryRule(ch);
  if (caveat) caveats.push(caveat);

  const stages: FunnelStage[] = [];
  let spendCents: number | null = null;
  let spendSource: FunnelView["spendSource"] = null;

  // ── The top: what the ad platform or the Mailer reports ──────────────────
  if (ch) {
    const meta = await metaStats(ch.meta_campaign_ids, from, to);
    if (meta) {
      stages.push({ key: "impressions", label: "Saw the ad", detail: "Times an ad was shown, as Meta reports it", count: meta.impressions, unit: "times", source: "meta" });
      stages.push({ key: "clicks", label: "Clicked the ad", detail: "Clicks on the ad's link, as Meta reports it", count: meta.clicks, unit: "clicks", source: "meta" });
      spendCents = meta.spendCents;
      spendSource = "meta";
      caveats.push("The ad steps are Meta's own count. From the page onward it is ClubOS counting people, so the two never line up exactly.");
    } else if (ch.manual_spend_cents != null) {
      spendCents = Number(ch.manual_spend_cents);
      spendSource = "typed";
    }
    if (ch.email_campaign_ids.length) {
      const [e] = await q<{ delivered: number; opened: number; clicked: number }>(
        `SELECT count(*) FILTER (WHERE status = 'sent')::int AS delivered,
                count(*) FILTER (WHERE first_opened_at IS NOT NULL)::int AS opened,
                count(*) FILTER (WHERE first_clicked_at IS NOT NULL)::int AS clicked
         FROM email_campaign_recipients WHERE campaign_id = ANY($1::int[])`,
        [ch.email_campaign_ids],
      );
      stages.push({ key: "delivered", label: "Email delivered", detail: "Emails the Mailer handed over for delivery", count: e.delivered, unit: "emails", source: "email" });
      stages.push({ key: "opened", label: "Opened it", detail: "Apple Mail opens emails by itself, so this runs high", count: e.opened, unit: "emails", source: "email" });
      stages.push({ key: "email_clicks", label: "Clicked a link", detail: "People who clicked a link in the email", count: e.clicked, unit: "people", source: "email" });
    }
  }

  // ── The middle: the same visitors, page by page ──────────────────────────
  const landing = new Set(f.landing_pages);
  const checkout = new Set(f.checkout_pages);
  const paths = Array.from(new Set([...f.landing_pages, ...f.checkout_pages].map((p) => splitPage(p).path)));
  const cohort = new Set<string>();
  const sawCheckout = new Set<string>();
  if (paths.length) {
    const views = await q<{ visitor_id: string; host: string | null; path: string; channel: string | null; utm: string | null }>(
      `SELECT t.visitor_id, t.host, t.path, t.channel, lower(t.utm_campaign) AS utm
       FROM web_events_slim t
       WHERE t.kind = 'page_view' AND t.path = ANY($1::text[]) AND t.visitor_id IS NOT NULL
         AND t.ts >= (($2::date::timestamp AT TIME ZONE 'Pacific/Auckland') AT TIME ZONE 'UTC')
         AND t.ts < ((($3::date + 1)::timestamp AT TIME ZONE 'Pacific/Auckland') AT TIME ZONE 'UTC')`,
      [paths, from, to],
    );
    for (const v of views) {
      const page = `${v.host ?? ""}${v.path}`;
      if (landing.has(page)) {
        const inWay =
          rule.kind === "all" ? true : rule.kind === "utm" ? v.utm === rule.value : rule.kind === "meta" ? META_WEB_CHANNELS.has(v.channel ?? "") : v.channel === "email";
        if (inWay) cohort.add(v.visitor_id);
      }
      if (checkout.has(page)) sawCheckout.add(v.visitor_id);
    }
  }

  // ── The bottom: the same visitors' bookings ──────────────────────────────
  const reachedPayment = new Set<string>();
  const paid = new Set<string>();
  let bookings: number | null = null;
  let revenueCents: number | null = null;
  let allBookings: number | null = null;
  if (programIds.length) {
    const rows = await q<{ visitor_id: string | null; real: boolean; net: string }>(
      `SELECT r.visitor_id, (${REAL}) AS real, ${NET}::bigint AS net
       FROM registrations r
       WHERE r.program_id = ANY($1::int[]) AND ${NZ_DAY} >= $2::date AND ${NZ_DAY} <= $3::date`,
      [programIds, from, to],
    );
    bookings = 0;
    revenueCents = 0;
    allBookings = 0;
    for (const r of rows) {
      if (r.real) allBookings++;
      if (!r.visitor_id || !cohort.has(r.visitor_id)) continue;
      reachedPayment.add(r.visitor_id);
      if (r.real) {
        paid.add(r.visitor_id);
        bookings++;
        revenueCents += Number(r.net);
      }
    }
  } else {
    caveats.push("Nothing is linked as being sold, so the payment and paid steps cannot be counted. Pick what is sold on the campaign or on this funnel.");
  }

  if (f.landing_pages.length) {
    stages.push({
      key: "landed",
      label: "Reached the page",
      detail: `${entryLabel === "Everyone" ? "People" : entryLabel} who opened ${pageList(f.landing_pages)}`,
      count: cohort.size,
      unit: "people",
      source: "web",
    });
  }
  if (f.checkout_pages.length) {
    // Somebody who reached payment certainly had the form open, whether or not the page view was caught.
    let n = 0;
    cohort.forEach((v) => {
      if (sawCheckout.has(v) || reachedPayment.has(v)) n++;
    });
    stages.push({ key: "checkout", label: "Opened the booking form", detail: `Of those people, the ones who opened ${pageList(f.checkout_pages)}`, count: n, unit: "people", source: "web" });
  }
  if (programIds.length) {
    stages.push({ key: "payment", label: "Got to the payment step", detail: "Filled the form in and reached the card details", count: reachedPayment.size, unit: "people", source: "sales" });
    stages.push({
      key: "paid",
      label: "Paid",
      detail: bookings === paid.size ? "People who paid" : `People who paid (${bookings} bookings between them)`,
      count: paid.size,
      unit: "people",
      source: "sales",
    });
  }

  return {
    id: f.id,
    campaignId: f.campaign_id,
    name: f.name,
    channelId: f.channel_id,
    programIds: f.program_ids,
    landingPages: f.landing_pages,
    checkoutPages: f.checkout_pages,
    startsOn: f.starts_on,
    endsOn: f.ends_on,
    notes: f.notes,
    campaignName: c.name,
    channelName: ch?.name ?? null,
    channelKind: ch?.kind ?? null,
    entry: ch ? "channel" : "all",
    entryLabel,
    from,
    to,
    stages,
    bookings,
    revenueCents,
    spendCents,
    spendSource,
    allBookings,
    caveats,
  };
}

async function channelsOf(campaignIds: number[]): Promise<Map<number, RawChannel>> {
  if (!campaignIds.length) return new Map();
  const rows = await q<RawChannel>(
    `SELECT id, kind, name, meta_campaign_ids, email_campaign_ids, utm_campaign, manual_spend_cents FROM cmp_channels WHERE campaign_id = ANY($1::int[])`,
    [campaignIds],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

async function funnelsFor(c: CampaignRow): Promise<FunnelView[]> {
  const rows = await q<RawFunnel>(`SELECT ${FUNNEL_COLUMNS} FROM cmp_funnels f WHERE f.campaign_id = $1 AND f.archived_at IS NULL ORDER BY f.position, f.id`, [c.id]);
  if (!rows.length) return [];
  const channels = await channelsOf([c.id]);
  const today = nzTodayIso();
  return Promise.all(rows.map((f) => viewOf(c, f, f.channel_id != null ? channels.get(f.channel_id) ?? null : null, today)));
}

function pages(v: unknown, label: string): string[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new InputError(`${label} is not a valid list.`);
  const out: string[] = [];
  for (const raw of v) {
    const p = normalisePage(raw);
    if (!p) throw new InputError(`"${String(raw).slice(0, 60)}" does not look like a page. Write the site and the page, like join.cufc.co.nz/fundamentals.`);
    if (!out.includes(p)) out.push(p);
  }
  if (out.length > 20) throw new InputError(`${label}: 20 pages at most.`);
  return out;
}

function funnelFields(body: any) {
  return patch(body, {
    name: (v) => {
      const s = text(v, 160);
      if (!s) throw new InputError("Give the funnel a name.");
      return s;
    },
    channelId: (v) => (v == null || v === "" ? null : id(v)),
    programIds: (v) => intList(v, "What is sold"),
    landingPages: (v) => pages(v, "Landing pages"),
    checkoutPages: (v) => pages(v, "Booking form pages"),
    startsOn: (v) => day(v, "The start date"),
    endsOn: (v) => day(v, "The end date"),
    notes: (v) => text(v),
  });
}

async function checkFunnelBody(body: any, campaignId: number) {
  if (has(body, "channelId") && body.channelId != null && body.channelId !== "") {
    try {
      await ownedBy("cmp_channels", id(body.channelId), campaignId);
    } catch {
      throw new InputError("That channel is not part of this campaign.");
    }
  }
  if (has(body, "programIds")) await checkProgrammes(intList(body.programIds, "What is sold"));
  if (has(body, "startsOn") && has(body, "endsOn")) ordered(day(body.startsOn, "The start date"), day(body.endsOn, "The end date"), "The funnel");
}

/** 🔴 Call BEFORE registerCampaignRoutes: "/funnels" and "/funnel-pages" must be matched ahead of "/:id". */
export function registerFunnelRoutes(app: Express) {
  const gate = [requireAuth, requireTab(CAMPAIGNS_TAB), requireHubWorkspace] as const;

  // Every funnel of every campaign that is not archived.
  app.get(`${BASE}/funnels`, ...gate, handle(async (_req, res) => {
    const rows = await q<RawFunnel>(
      `SELECT ${FUNNEL_COLUMNS} FROM cmp_funnels f JOIN cmp_campaigns c ON c.id = f.campaign_id
       WHERE f.archived_at IS NULL AND c.archived_at IS NULL ORDER BY c.id DESC, f.position, f.id LIMIT 60`,
    );
    const campaignIds = Array.from(new Set(rows.map((r) => r.campaign_id)));
    const [campaigns, channels] = await Promise.all([Promise.all(campaignIds.map((cid) => loadCampaign(cid))), channelsOf(campaignIds)]);
    const byId = new Map(campaigns.map((c) => [c.id, c]));
    const today = nzTodayIso();
    const funnels = await Promise.all(rows.map((f) => viewOf(byId.get(f.campaign_id)!, f, f.channel_id != null ? channels.get(f.channel_id) ?? null : null, today)));
    res.json({ today, funnels, campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status })) });
  }));

  // Pages people actually visit for these programmes, to pick from.
  app.get(`${BASE}/funnel-pages`, ...gate, handle(async (req, res) => {
    const ids = String(req.query.programIds ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);
    if (!ids.length) return res.json({ pages: [] });
    const progs = await q<{ slug: string | null }>(`SELECT slug FROM programs WHERE id = ANY($1::int[])`, [ids]);
    const slugs = progs.map((p) => (p.slug ?? "").toLowerCase()).filter((s) => /^[a-z0-9-]{2,80}$/.test(s));
    if (!slugs.length) return res.json({ pages: [] });
    const exact = slugs.flatMap((s) => [`/${s}`, `/academy/${s}`]);
    const likes = slugs.flatMap((s) => [`/${s}/%`, `/academy/${s}/%`]);
    const rows = await q<{ host: string; path: string; visitors: number }>(
      `SELECT t.host, t.path, count(DISTINCT t.visitor_id)::int AS visitors
       FROM web_events_slim t
       WHERE t.kind = 'page_view' AND t.host IS NOT NULL AND t.ts > (now() AT TIME ZONE 'UTC') - interval '180 days'
         AND (t.path = ANY($1::text[]) OR t.path LIKE ANY($2::text[]))
       GROUP BY 1, 2 HAVING count(DISTINCT t.visitor_id) >= 3 ORDER BY 3 DESC LIMIT 60`,
      [exact, likes],
    );
    const out: FunnelPageSuggestion[] = [];
    for (const r of rows) {
      const page = normalisePage(`${r.host}${r.path}`);
      if (!page) continue;
      if (exact.includes(r.path)) out.push({ page, visitors: r.visitors, kind: "landing" });
      else if (looksLikeCheckout(r.path)) out.push({ page, visitors: r.visitors, kind: "checkout" });
    }
    res.json({ pages: out });
  }));

  app.get(`${BASE}/:id/funnels`, ...gate, handle(async (req, res) => {
    const c = await loadCampaign(id(req.params.id));
    res.json({ today: nzTodayIso(), funnels: await funnelsFor(c) });
  }));

  app.post(`${BASE}/:id/funnels`, ...gate, handle(async (req, res) => {
    const campaignId = id(req.params.id);
    await loadCampaign(campaignId);
    if (!has(req.body, "name")) throw new InputError("Give the funnel a name.");
    const p = funnelFields(req.body);
    if (!pages(req.body.landingPages, "Landing pages").length) throw new InputError("Add the page people land on, so there is something to count.");
    await checkFunnelBody(req.body, campaignId);
    const [{ next }] = await q<{ next: number }>(`SELECT COALESCE(max(position), 0) + 1 AS next FROM cmp_funnels WHERE campaign_id = $1`, [campaignId]);
    const newId = await insertRow("cmp_funnels", p, { campaign_id: campaignId, position: next, created_by: req.session.userId ?? null });
    res.status(201).json({ id: newId });
  }));

  app.patch(`${BASE}/:id/funnels/:childId`, ...gate, handle(async (req, res) => {
    const campaignId = id(req.params.id);
    const funnelId = id(req.params.childId);
    await ownedBy("cmp_funnels", funnelId, campaignId);
    const p = funnelFields(req.body);
    if (has(req.body, "landingPages") && !pages(req.body.landingPages, "Landing pages").length) throw new InputError("A funnel needs at least one landing page.");
    await checkFunnelBody(req.body, campaignId);
    await updateRow("cmp_funnels", p, "id = $1", [funnelId]);
    res.json({ ok: true });
  }));

  // Removed = archived. The plan is kept.
  app.delete(`${BASE}/:id/funnels/:childId`, ...gate, handle(async (req, res) => {
    const campaignId = id(req.params.id);
    const funnelId = id(req.params.childId);
    await ownedBy("cmp_funnels", funnelId, campaignId);
    const rows = await q(`UPDATE cmp_funnels SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id`, [funnelId]);
    if (!rows.length) throw new NotFound();
    res.json({ ok: true });
  }));
}

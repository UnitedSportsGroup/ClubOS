/**
 * Funnels — the steps between "saw the ad" and "paid", inside a campaign.
 * United Sports Group → Marketing → Campaigns → a campaign → Funnels, and
 * every funnel on one page at /admin/funnels.
 *
 * Daniel, 2026-11-14: "they see our ads … go to our landing page … how many
 * clicked through to the checkout flow … how many finished and purchased.
 * That's a funnel, and at each of those there are percentages … Once we have
 * those numbers, it becomes a math game. What would happen if we got 6,000
 * clicks, and how much would we have to spend?"
 *
 * 🔴 Only the PLAN is stored (cmp_funnels: where people come in, which pages,
 *    what is sold). Every count is read live:
 *      ad shown / ad clicked        marketing_daily (what Meta reports)
 *      delivered / opened / clicked email_campaign_recipients
 *      landed / opened the form     web_events_slim, by visitor
 *      reached payment / paid       registrations, tied by the SAME visitor
 *    A booking carries the visitor who made it (registrations.visitor_id), so
 *    the page steps and the money steps are the same people, not two guesses.
 * 🔴 A step ClubOS cannot count is null and drawn "—", never 0.
 * 🔴 The "what if" numbers are arithmetic on this funnel's own rates. They are
 *    labelled as a projection everywhere, and the page says how few bookings
 *    they rest on when that number is small.
 */

export type FunnelStageKey = "impressions" | "clicks" | "delivered" | "opened" | "email_clicks" | "landed" | "checkout" | "payment" | "paid";

export type FunnelStage = {
  key: FunnelStageKey;
  /** What happened, in a person's words. */
  label: string;
  /** What exactly is counted and where it comes from. */
  detail: string;
  count: number | null;
  /** What one of the count is. */
  unit: "times" | "clicks" | "emails" | "people";
  source: "meta" | "email" | "web" | "sales";
};

/** How people come into a funnel: everyone who reached the pages, or one channel's people. */
export type FunnelEntry = "all" | "channel";

export type FunnelRow = {
  id: number;
  campaignId: number;
  name: string;
  channelId: number | null;
  /** Empty = everything the campaign sells. */
  programIds: number[];
  /** "site/page" strings, e.g. "join.cufc.co.nz/fundamentals". */
  landingPages: string[];
  checkoutPages: string[];
  /** null = the campaign's own selling window. */
  startsOn: string | null;
  endsOn: string | null;
  notes: string | null;
};

export type FunnelView = FunnelRow & {
  campaignName: string;
  channelName: string | null;
  channelKind: string | null;
  entry: FunnelEntry;
  /** A short phrase for who is counted: "People from Facebook and Instagram". */
  entryLabel: string;
  /** The days actually counted. */
  from: string | null;
  to: string | null;
  stages: FunnelStage[];
  /** Paid bookings made by this funnel's people, and what they paid less refunds. */
  bookings: number | null;
  revenueCents: number | null;
  spendCents: number | null;
  spendSource: "meta" | "typed" | null;
  /** Every paid booking of the same things in the same days, whoever made it (office sales included). */
  allBookings: number | null;
  /** Things the reader should know before trusting a number. */
  caveats: string[];
};

export type FunnelPageSuggestion = { page: string; visitors: number; kind: "landing" | "checkout" };

// ── Pages ───────────────────────────────────────────────────────────────────

/**
 * "https://Join.cufc.co.nz/fundamentals/?x=1" → "join.cufc.co.nz/fundamentals".
 * Returns null when it is not a site and a page.
 */
export function normalisePage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split(/[?#]/)[0];
  const slash = s.indexOf("/");
  const host = slash === -1 ? s : s.slice(0, slash);
  let path = slash === -1 ? "/" : s.slice(slash);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (!/^\/[a-z0-9/_.~%-]*$/.test(path) || path.length > 200) return null;
  return `${host}${path}`;
}

export function splitPage(page: string): { host: string; path: string } {
  const i = page.indexOf("/");
  return i === -1 ? { host: page, path: "/" } : { host: page.slice(0, i), path: page.slice(i) };
}

/** Is this page path where somebody fills in the booking form. */
export function looksLikeCheckout(path: string): boolean {
  return /\/(book|class-book|register|checkout|enrol|enroll)$/.test(path);
}

// ── Reading a funnel ────────────────────────────────────────────────────────

export type FunnelStep = {
  from: FunnelStageKey;
  to: FunnelStageKey;
  /** to ÷ from. null when either side is not counted or the first is zero. */
  rate: number | null;
  /** How many did not go on. null when not known, or when more arrived than left (different things counted). */
  lost: number | null;
};

/** The step between each stage and the next one that has a count. */
export function funnelSteps(stages: FunnelStage[]): FunnelStep[] {
  const counted = stages.filter((s) => s.count != null);
  const out: FunnelStep[] = [];
  for (let i = 0; i + 1 < counted.length; i++) {
    const a = counted[i];
    const b = counted[i + 1];
    const rate = a.count! > 0 ? b.count! / a.count! : null;
    out.push({ from: a.key, to: b.key, rate, lost: a.count! >= b.count! ? a.count! - b.count! : null });
  }
  return out;
}

export type FunnelSummary = {
  /** First counted stage to paid. */
  overallRate: number | null;
  costPerClickCents: number | null;
  costPerVisitorCents: number | null;
  costPerBookingCents: number | null;
  /** What one paid booking brought, on average. */
  bookingValueCents: number | null;
  /** Revenue ÷ spend. 3.2 = $3.20 back for every $1. */
  returnPerDollar: number | null;
  /**
   * The step that loses the largest share of the people who reach it, from the
   * click (or the page) onward. "Saw the ad → clicked" and "delivered → opened"
   * are left out: nearly everyone who is shown an ad scrolls past, on every
   * campaign, so naming it as the leak says nothing.
   */
  biggestLeak: FunnelStep | null;
};

const stageCount = (stages: FunnelStage[], key: FunnelStageKey) => stages.find((s) => s.key === key)?.count ?? null;
const per = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? a / b : null);

export function funnelSummary(f: Pick<FunnelView, "stages" | "bookings" | "revenueCents" | "spendCents">): FunnelSummary {
  const counted = f.stages.filter((s) => s.count != null);
  const paid = stageCount(f.stages, "paid");
  const first = counted[0]?.count ?? null;
  const steps = funnelSteps(f.stages);
  const leaks = steps.filter((s) => s.from !== "impressions" && s.from !== "delivered" && s.rate != null && s.rate <= 1 && s.lost != null && s.lost > 0);
  const spend = f.spendCents != null && f.spendCents > 0 ? f.spendCents : null;
  return {
    overallRate: counted.length > 1 && counted[counted.length - 1].key === "paid" ? per(paid, first) : null,
    costPerClickCents: per(spend, stageCount(f.stages, "clicks")),
    costPerVisitorCents: per(spend, stageCount(f.stages, "landed")),
    costPerBookingCents: per(spend, f.bookings),
    bookingValueCents: per(f.revenueCents, f.bookings),
    returnPerDollar: per(f.revenueCents, spend),
    biggestLeak: leaks.length ? leaks.reduce((worst, s) => (s.rate! < worst.rate! ? s : worst)) : null,
  };
}

// ── What if ─────────────────────────────────────────────────────────────────

/** Below this many paid bookings the rates are mostly luck, and the page says so. */
export const WHAT_IF_MIN_BOOKINGS = 10;
/** The default guess for how much dearer a click gets each time the volume doubles. */
export const DEFAULT_COST_RISE = 0.2;

export type WhatIfInput = {
  /** Times as many people at the top of the funnel. 2 = twice the clicks. */
  volume: number;
  /** Per step (keyed by the stage it leads INTO): times the current rate. 1.25 = a quarter better. */
  lifts: Partial<Record<FunnelStageKey, number>>;
  /** How much dearer each click gets every time volume doubles. 0.2 = 20%. */
  costRise: number;
};

export type WhatIfResult = {
  stages: { key: FunnelStageKey; count: number | null }[];
  bookings: number | null;
  revenueCents: number | null;
  spendCents: number | null;
  /** Revenue less spend. */
  afterSpendCents: number | null;
};

/** What a bigger top of funnel costs: more of it, and dearer per click as the cheap audience runs out. */
export function scaledSpend(spendCents: number | null, volume: number, costRise: number): number | null {
  if (spendCents == null) return null;
  if (volume <= 1) return spendCents * Math.max(0, volume);
  return spendCents * volume * Math.pow(1 + Math.max(0, costRise), Math.log2(volume));
}

/**
 * The same funnel with more people in the top, or a step working better.
 * A rate can never be pushed past 100% of the stage before it.
 */
export function whatIf(f: Pick<FunnelView, "stages" | "bookings" | "revenueCents" | "spendCents">, input: WhatIfInput): WhatIfResult {
  const volume = Math.max(0, input.volume);
  const out: { key: FunnelStageKey; count: number | null }[] = [];
  let prevBase: number | null = null;
  let prevNew: number | null = null;
  for (const s of f.stages) {
    if (s.count == null) {
      out.push({ key: s.key, count: null });
      continue;
    }
    let next: number;
    if (prevBase == null || prevNew == null) next = s.count * volume;
    else {
      const rate = prevBase > 0 ? s.count / prevBase : 0;
      const lifted = rate * Math.max(0, input.lifts[s.key] ?? 1);
      // A real rate above 1 (ad clicks → visitors can be) is kept; a lift cannot create one.
      next = prevNew * (rate > 1 ? lifted : Math.min(1, lifted));
    }
    out.push({ key: s.key, count: next });
    prevBase = s.count;
    prevNew = next;
  }
  const paidBase = stageCount(f.stages, "paid");
  const paidNew = out.find((s) => s.key === "paid")?.count ?? null;
  const factor = paidBase != null && paidBase > 0 && paidNew != null ? paidNew / paidBase : null;
  const bookings = factor != null && f.bookings != null ? f.bookings * factor : null;
  const revenueCents = factor != null && f.revenueCents != null ? f.revenueCents * factor : null;
  const spendCents = scaledSpend(f.spendCents, volume, input.costRise);
  return { stages: out, bookings, revenueCents, spendCents, afterSpendCents: revenueCents != null ? revenueCents - (spendCents ?? 0) : null };
}

/**
 * How many times the current top of funnel a revenue target needs, with the
 * steps working as they are (or lifted). null when there is no revenue to scale from.
 */
export function volumeForRevenue(f: Pick<FunnelView, "stages" | "bookings" | "revenueCents" | "spendCents">, targetCents: number, lifts: WhatIfInput["lifts"] = {}): number | null {
  const one = whatIf(f, { volume: 1, lifts, costRise: 0 });
  if (one.revenueCents == null || one.revenueCents <= 0 || targetCents <= 0) return null;
  return targetCents / one.revenueCents;
}

// ── Words ───────────────────────────────────────────────────────────────────

export function ratePct(rate: number | null, digits = 1): string {
  if (rate == null) return "—";
  const pct = rate * 100;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct >= 100 || Number.isInteger(Number(pct.toFixed(digits))) ? Math.round(pct) : pct.toFixed(digits)}%`;
}

/** "1 in 14" for a rate, when that reads better than a small percentage. */
export function oneIn(rate: number | null): string | null {
  if (rate == null || rate <= 0 || rate >= 1) return null;
  return `1 in ${Math.round(1 / rate).toLocaleString("en-NZ")}`;
}

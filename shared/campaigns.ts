/**
 * Campaigns — plan a campaign, set its goal, and watch it move from ClubOS's
 * own sales. United Sports Group → Marketing → Campaigns (/admin/campaigns).
 *
 * Daniel, 2026-11-10: "create a campaign … set the targets … see that updating
 * and tracking live … map out the tasks and the timeline … add channels … an
 * A/B split test into this flow."
 *
 * One rule per question, each read by the server, the page and the checks:
 *   CHANNEL_KINDS      what a channel can be, and what it can be linked to
 *   paceOf()           is the campaign on track for its goal
 *   testVerdict()      can a split test be called yet
 *   suggestedTimeline  a draft work-back plan from the event's first day
 *
 * 🔴 Nothing here is stored as a result. Bookings, revenue, spend and visitors
 * are read live; "late", "on pace" and "winner so far" are worked out on read.
 */

export const CAMPAIGNS_TAB = "campaign-planner";

export const CAMPAIGN_STATUSES = ["planning", "live", "paused", "done"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = { planning: "Planning", live: "Live", paused: "Paused", done: "Finished" };

export const CHANNEL_STATUSES = ["planned", "live", "done", "dropped"] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];
export const CHANNEL_STATUS_LABEL: Record<ChannelStatus, string> = { planned: "Planned", live: "Live", done: "Finished", dropped: "Dropped" };

export const TEST_STATUSES = ["planned", "running", "done"] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];
export const TEST_STATUS_LABEL: Record<TestStatus, string> = { planned: "Planned", running: "Running", done: "Finished" };

export type ChannelLink = "meta" | "email" | "utm" | "discount" | "spend";

export type ChannelKindDef = {
  key: string;
  label: string;
  /** What this kind can be linked to, which decides what ClubOS can measure for it. */
  links: ChannelLink[];
  hint: string;
};

export const CHANNEL_KINDS: readonly ChannelKindDef[] = [
  { key: "meta_ads", label: "Facebook & Instagram ads", links: ["meta", "utm"], hint: "Pick the ad campaigns. Spend, clicks and bookings come through on their own." },
  { key: "google_ads", label: "Google ads", links: ["utm", "spend"], hint: "Google Ads is not connected yet, so type the spend in. Bookings are counted from the link's campaign name." },
  { key: "tiktok_ads", label: "TikTok ads", links: ["utm", "spend"], hint: "Not connected yet. Type the spend in; bookings are counted from the link's campaign name." },
  { key: "email", label: "Email", links: ["email", "utm"], hint: "Pick the emails sent from the Mailer. Delivered, opened and clicked come through." },
  { key: "sms", label: "SMS", links: ["utm", "spend"], hint: "Texts need each person's yes first. Bookings are counted from the link's campaign name." },
  { key: "whatsapp", label: "WhatsApp", links: ["utm"], hint: "Not connected to ClubOS. Use a tagged link so bookings can be counted." },
  { key: "social", label: "Social posts (not paid)", links: ["utm"], hint: "Use a tagged link in the bio or story so bookings can be counted." },
  { key: "offer", label: "Offer or discount", links: ["discount"], hint: "Early bird, returning families. Pick the discount code and its bookings are counted." },
  { key: "website", label: "Website or landing page", links: ["utm"], hint: "A page built or changed for this campaign." },
  { key: "print", label: "Flyers, posters, signage", links: ["utm", "spend"], hint: "Put a QR code with a tagged link on it so bookings can be counted. Type the print cost in." },
  { key: "partner", label: "Schools and partners", links: ["utm", "discount"], hint: "A school newsletter, a sponsor's mailing list." },
  { key: "creative", label: "Photos and video", links: ["spend"], hint: "A shoot day, editing, new graphics. Plan it here; put the dates in the timeline." },
  { key: "other", label: "Something else", links: ["utm", "spend"], hint: "" },
];

export function channelKind(key: string | null | undefined): ChannelKindDef {
  return CHANNEL_KINDS.find((k) => k.key === key) ?? CHANNEL_KINDS[CHANNEL_KINDS.length - 1];
}

export const TASK_KINDS = ["task", "milestone", "shoot", "edit", "launch", "review"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const TASK_KIND_LABEL: Record<TaskKind, string> = { task: "Task", milestone: "Key date", shoot: "Shoot", edit: "Edit", launch: "Launch", review: "Review" };

// ── Dates (ISO strings only; never through a local Date) ────────────────────

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  const p = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(b) - p(a)) / 86_400_000);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDay = (v: unknown): v is string => typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

// ── Pace ────────────────────────────────────────────────────────────────────

export type Pace = {
  /** 0–1+, or null when there is no goal. */
  progress: number | null;
  remaining: number | null;
  /** Days of selling left, counting today. null = no end date. */
  daysLeft: number | null;
  /** What a day has to bring from now on. null when there is no goal or no end date. */
  neededPerDay: number | null;
  /** What a day actually brought over the last 7 days of selling. */
  recentPerDay: number | null;
  /**
   * ahead · on_track · behind · reached · over (window closed short) · none
   * (no goal, or no dates to judge against).
   */
  state: "reached" | "ahead" | "on_track" | "behind" | "missed" | "not_started" | "none";
};

/**
 * Is a goal on track. `daily` is the campaign's own results per NZ day.
 *
 * Judged on what the last seven days brought against what the days left need —
 * NOT on a straight line from the start, because camp bookings bunch up at the
 * end and a straight line calls every campaign "behind" for three weeks.
 */
export function paceOf(args: {
  goal: number | null;
  actual: number;
  startsOn: string | null;
  endsOn: string | null;
  today: string;
  daily: { day: string; value: number }[];
}): Pace {
  const { goal, actual, startsOn, endsOn, today, daily } = args;
  if (goal == null || goal <= 0) return { progress: null, remaining: null, daysLeft: null, neededPerDay: null, recentPerDay: null, state: "none" };
  const progress = actual / goal;
  const remaining = Math.max(0, goal - actual);
  const from = addDays(today, -6);
  const recent = daily.filter((d) => d.day >= from && d.day <= today).reduce((s, d) => s + d.value, 0);
  const sellingDays = startsOn && startsOn > from ? Math.max(1, daysBetween(startsOn, today) + 1) : 7;
  const recentPerDay = recent / sellingDays;
  if (remaining === 0) return { progress, remaining, daysLeft: endsOn ? Math.max(0, daysBetween(today, endsOn) + 1) : null, neededPerDay: 0, recentPerDay, state: "reached" };
  if (startsOn && today < startsOn) return { progress, remaining, daysLeft: endsOn ? daysBetween(startsOn, endsOn) + 1 : null, neededPerDay: null, recentPerDay: null, state: "not_started" };
  if (!endsOn) return { progress, remaining, daysLeft: null, neededPerDay: null, recentPerDay, state: "none" };
  if (today > endsOn) return { progress, remaining, daysLeft: 0, neededPerDay: null, recentPerDay, state: "missed" };
  const daysLeft = daysBetween(today, endsOn) + 1;
  const neededPerDay = remaining / daysLeft;
  const state = recentPerDay >= neededPerDay * 1.15 ? "ahead" : recentPerDay >= neededPerDay * 0.85 ? "on_track" : "behind";
  return { progress, remaining, daysLeft, neededPerDay, recentPerDay, state };
}

export const PACE_LABEL: Record<Pace["state"], string> = {
  reached: "Goal reached",
  ahead: "Ahead of pace",
  on_track: "On pace",
  behind: "Behind pace",
  missed: "Finished short",
  not_started: "Not started",
  none: "",
};

// ── Split tests ─────────────────────────────────────────────────────────────

export const TEST_MIN_VISITORS = 100;
export const TEST_MIN_CONVERSIONS = 10;

export type VariantNumbers = { id: number; label: string; visitors: number | null; conversions: number | null };

export type TestVerdict = {
  /** too_early = not enough people yet · no_data = nothing to count · leading = one version is ahead, with the usual caution */
  state: "no_data" | "too_early" | "leading" | "level";
  leaderId: number | null;
  /** A sentence a person can read out. */
  sentence: string;
};

/**
 * Can a split test be called yet. It refuses to name a leader until EVERY
 * version has at least 100 visitors and 10 bookings: under that, the gap
 * between two versions is mostly luck (the rule the ad split report uses).
 * It never declares a winner — that is a person's call, recorded with a reason.
 */
export function testVerdict(variants: VariantNumbers[]): TestVerdict {
  const counted = variants.filter((v) => v.visitors != null);
  if (counted.length < 2) {
    return { state: "no_data", leaderId: null, sentence: "Nothing to compare yet. Each version needs its own link or page so its visitors can be counted." };
  }
  const short = counted.filter((v) => (v.visitors ?? 0) < TEST_MIN_VISITORS || (v.conversions ?? 0) < TEST_MIN_CONVERSIONS);
  if (short.length) {
    return {
      state: "too_early",
      leaderId: null,
      sentence: `Too early to call. Each version needs at least ${TEST_MIN_VISITORS} visitors and ${TEST_MIN_CONVERSIONS} bookings before the difference means anything.`,
    };
  }
  const rated = counted.map((v) => ({ v, rate: (v.conversions ?? 0) / Math.max(1, v.visitors ?? 0) })).sort((a, b) => b.rate - a.rate);
  const [best, next] = rated;
  if (next.rate > 0 && best.rate / next.rate < 1.1) {
    return { state: "level", leaderId: null, sentence: "The versions are within 10% of each other. No clear difference." };
  }
  return {
    state: "leading",
    leaderId: best.v.id,
    sentence: `${best.v.label} is ahead: ${(best.rate * 100).toFixed(1)}% of its visitors booked, against ${(next.rate * 100).toFixed(1)}%.`,
  };
}

// ── A suggested work-back plan ──────────────────────────────────────────────

export type SuggestedTask = { title: string; kind: TaskKind; daysBefore: number };

/**
 * A draft plan counted back from the event's first day. A starting point to
 * edit, not a rule: every line is an ordinary task once it is added.
 */
export const SUGGESTED_TIMELINE: readonly SuggestedTask[] = [
  { title: "Agree the offer, the price and the goal", kind: "milestone", daysBefore: 56 },
  { title: "Write the creative brief: what to shoot and why", kind: "task", daysBefore: 49 },
  { title: "Shoot day", kind: "shoot", daysBefore: 42 },
  { title: "Edit and approve the video and graphics", kind: "edit", daysBefore: 35 },
  { title: "Check the booking page on a phone, start to finish", kind: "task", daysBefore: 35 },
  { title: "Paid ads go live", kind: "launch", daysBefore: 28 },
  { title: "Announcement email to past families", kind: "launch", daysBefore: 28 },
  { title: "Early bird ends: reminder email", kind: "launch", daysBefore: 21 },
  { title: "Check the numbers: swap in the second creative if the first is tired", kind: "review", daysBefore: 14 },
  { title: "Last chance email", kind: "launch", daysBefore: 7 },
  { title: "Final reminder and social stories", kind: "launch", daysBefore: 3 },
  { title: "Review: what worked, cost per booking, what to repeat", kind: "review", daysBefore: -3 },
];

// ── What the API returns ────────────────────────────────────────────────────

export type CampaignRow = {
  id: number;
  name: string;
  brand: string | null;
  status: CampaignStatus;
  startsOn: string | null;
  endsOn: string | null;
  eventStartsOn: string | null;
  eventEndsOn: string | null;
  goalRevenueCents: number | null;
  goalSignups: number | null;
  budgetCents: number | null;
  programIds: number[];
  manualSignups: number | null;
  manualRevenueCents: number | null;
  summary: string | null;
  ownerUserId: number | null;
  ownerName: string | null;
  archived: boolean;
};

export type CampaignResult = {
  /** true = read from ClubOS sales; false = typed in (nothing linked). */
  live: boolean;
  signups: number | null;
  revenueCents: number | null;
  refundedCents: number;
  daily: { day: string; signups: number; revenueCents: number }[];
};

export type CampaignListItem = CampaignRow & {
  result: CampaignResult;
  spendCents: number;
  tasksOpen: number;
  tasksOverdue: number;
  nextTask: { title: string; dueOn: string } | null;
  channels: number;
  channelsLive: number;
};

export type ChannelRow = {
  id: number;
  kind: string;
  name: string;
  status: ChannelStatus;
  startsOn: string | null;
  endsOn: string | null;
  budgetCents: number | null;
  metaCampaignIds: string[];
  emailCampaignIds: number[];
  utmCampaign: string | null;
  discountCode: string | null;
  manualSpendCents: number | null;
  notes: string | null;
  /** Live numbers. Every one is null when nothing is linked that could give it. */
  stats: {
    spendCents: number | null;
    spendSource: "meta" | "typed" | null;
    impressions: number | null;
    clicks: number | null;
    /** Purchases the ad platform itself counts. Shown beside ClubOS's own count, never added to it. */
    platformPurchases: number | null;
    visitors: number | null;
    emailsDelivered: number | null;
    emailsOpened: number | null;
    emailsClicked: number | null;
    /** Bookings ClubOS can tie to this channel (its ads, its link or its code). */
    signups: number | null;
    revenueCents: number | null;
    discountGivenCents: number | null;
  };
};

export type TaskRow = {
  id: number;
  channelId: number | null;
  title: string;
  kind: TaskKind;
  dueOn: string | null;
  doneAt: string | null;
  doneByName: string | null;
  ownerUserId: number | null;
  ownerName: string | null;
  notes: string | null;
};

export type TestRow = {
  id: number;
  channelId: number | null;
  name: string;
  variable: string | null;
  hypothesis: string | null;
  status: TestStatus;
  startsOn: string | null;
  endsOn: string | null;
  winnerVariantId: number | null;
  conclusion: string | null;
  variants: {
    id: number;
    label: string;
    description: string | null;
    utmContent: string | null;
    landingPath: string | null;
    manualVisitors: number | null;
    manualConversions: number | null;
    /** What is shown: counted live when the version has a link or page, else what was typed. */
    visitors: number | null;
    conversions: number | null;
    revenueCents: number | null;
    counted: "live" | "typed" | "none";
  }[];
};

export type CampaignDetail = {
  today: string;
  campaign: CampaignRow;
  result: CampaignResult;
  /** Where the bookings came from, from each sale's own record. */
  sources: { key: string; label: string; signups: number; revenueCents: number; paid: boolean }[];
  programmes: { id: number; name: string; workspace: string | null; signups: number; revenueCents: number }[];
  spendCents: number;
  channels: ChannelRow[];
  tasks: TaskRow[];
  tests: TestRow[];
};

export type CampaignOptions = {
  programmes: { id: number; name: string; workspace: string | null; active: boolean; startsOn: string | null }[];
  metaCampaigns: { id: string; name: string; lastDay: string; spendCents: number }[];
  emailCampaigns: { id: number; subject: string; day: string; sent: number }[];
  discountCodes: string[];
  people: { id: number; name: string }[];
};

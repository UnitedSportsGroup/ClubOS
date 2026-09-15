/**
 * Marketing hub — every marketing number the group has, in one place.
 *
 * Daniel, 2026-09-15: "the one-stop dashboard I'm going to look at for
 * everything … as a whole organisation … broken down by each workspace and each
 * program … Google Analytics, how our websites are performing, form
 * submissions, ads, organics."
 *
 * Lives in the United Sports Group workspace → Marketing (/admin/marketing-hub).
 *
 * One registry per question, so a new platform, website or form is a line here
 * and not a page change:
 *
 *   HUB_WORKSPACES       which workspaces are measured, and their fixed colour order
 *   PLATFORMS            what can be connected, and what a human must do first
 *   HUB_METRICS          what each stored number IS — money or count; summed,
 *                        averaged or read as the latest value
 *   SITES                which workspace a website belongs to
 *   FORM_SOURCES         every public form that stores a submission
 *   workspaceForCampaign which workspace an ad campaign is for
 *
 * Dependency-free on purpose: the server, the page and the verify scripts all
 * read these, and a rule read in more than one place lives in exactly one.
 */
import type { DateRange } from "./dashboard";

export const MARKETING_HUB_TAB = "marketing-hub";
/** The hub reads every workspace, so it lives in exactly one: the group's. */
export const MARKETING_HUB_WORKSPACE = "united-sports-group";

// ── Workspaces ──────────────────────────────────────────────────────────────

export type HubWorkspace = { slug: string; name: string; short: string };

/**
 * The workspaces the hub measures, in display order.
 *
 * 🔴 A workspace's chart colour is its POSITION here (slot n of the validated
 * palette), never its rank in a table. Filtering a table must not repaint the
 * rows that survive — a reader who learned "MFL is aqua" is misled otherwise.
 */
export const HUB_WORKSPACES: readonly HubWorkspace[] = [
  { slug: "christchurch-united", name: "Christchurch United", short: "CUFC" },
  { slug: "south-island-united", name: "South Island United", short: "SIU" },
  { slug: "mini-football-leagues", name: "Mini Football Leagues", short: "MFL" },
  { slug: "christchurch-international-cup", name: "Christchurch International Cup", short: "CIC" },
  { slug: "united-gymnastics", name: "United Gymnastics", short: "CUGC" },
  { slug: "united-sports-centre", name: "United Sports Centre", short: "USC" },
  { slug: "united-prints", name: "United Prints", short: "Prints" },
  { slug: "united-sports-group", name: "United Sports Group", short: "USG" },
];

export function hubWorkspace(slug: string | null | undefined): HubWorkspace | null {
  return HUB_WORKSPACES.find((w) => w.slug === slug) ?? null;
}

// ── Platforms ───────────────────────────────────────────────────────────────

export const PLATFORM_KEYS = [
  "ga4",
  "meta_ads",
  "google_ads",
  "tiktok_ads",
  "linkedin_ads",
  "facebook_page",
  "instagram",
] as const;
export type PlatformKey = (typeof PLATFORM_KEYS)[number];

export function isPlatformKey(k: unknown): k is PlatformKey {
  return typeof k === "string" && (PLATFORM_KEYS as readonly string[]).includes(k);
}

export type PlatformDef = {
  key: PlatformKey;
  label: string;
  group: "web" | "ads" | "organic";
  /** false = no collector exists yet. Shown as "Not connected", never as zero. */
  built: boolean;
  /** Plain-English steps a human has to take before this can be switched on. */
  setup?: string[];
};

export const PLATFORMS: readonly PlatformDef[] = [
  { key: "ga4", label: "Google Analytics", group: "web", built: true },
  { key: "meta_ads", label: "Meta ads (Facebook & Instagram)", group: "ads", built: true },
  {
    key: "google_ads",
    label: "Google Ads (incl. YouTube)",
    group: "ads",
    built: false,
    setup: [
      "Open the Google Ads manager (MCC) account → Admin → API Center, and apply for a developer token. Approval takes about a business day.",
      "In the cufc-aios Google Cloud project, turn on the Google Ads API and create a Desktop OAuth client.",
      "Send the client ID and secret to Claude, who connects it and switches this on.",
    ],
  },
  {
    key: "tiktok_ads",
    label: "TikTok ads",
    group: "ads",
    built: false,
    setup: [
      "Create a TikTok for Business account at business.tiktok.com (this gives the advertiser ID).",
      "At business-api.tiktok.com, create a developer app and request Marketing API access (a short review).",
      "Send the app ID, secret and advertiser ID to Claude.",
    ],
  },
  {
    key: "linkedin_ads",
    label: "LinkedIn ads",
    group: "ads",
    built: false,
    setup: [
      "At linkedin.com/developers, create an app linked to the club's Company Page.",
      "Request the Advertising API (Marketing Developer Platform) product — review takes a few days.",
      "Send the client ID and secret to Claude.",
    ],
  },
  { key: "facebook_page", label: "Facebook pages", group: "organic", built: true },
  { key: "instagram", label: "Instagram", group: "organic", built: true },
];

export function platformDef(key: PlatformKey): PlatformDef {
  return PLATFORMS.find((p) => p.key === key)!;
}

// ── Stored metrics ──────────────────────────────────────────────────────────

export type HubMetricKind = "count" | "money";
/**
 * How a metric combines across days.
 *
 * 🔴 `sum` only where adding two days is true. Followers is a stock — Monday's
 * 8,600 plus Tuesday's 8,600 is not 17,200 followers, so it is read as the
 * latest value. Daily reach counts unique people per day and the same person
 * reached twice is two, so it is averaged, never summed.
 */
export type HubAggregation = "sum" | "last" | "avg";

export type HubMetricDef = { label: string; kind: HubMetricKind; agg: HubAggregation };

export const HUB_METRICS = {
  // Google Analytics
  sessions: { label: "Sessions", kind: "count", agg: "sum" },
  engaged_sessions: { label: "Engaged sessions", kind: "count", agg: "sum" },
  page_views: { label: "Page views", kind: "count", agg: "sum" },
  key_events: { label: "Key events", kind: "count", agg: "sum" },
  // Ads (any platform)
  spend_cents: { label: "Spend", kind: "money", agg: "sum" },
  impressions: { label: "Impressions", kind: "count", agg: "sum" },
  link_clicks: { label: "Link clicks", kind: "count", agg: "sum" },
  landing_page_views: { label: "Landing page views", kind: "count", agg: "sum" },
  leads: { label: "Leads (platform-reported)", kind: "count", agg: "sum" },
  purchases: { label: "Purchases (platform-reported)", kind: "count", agg: "sum" },
  // Organic social
  followers: { label: "Followers", kind: "count", agg: "last" },
  new_follows: { label: "New follows", kind: "count", agg: "sum" },
  views: { label: "Views", kind: "count", agg: "sum" },
  interactions: { label: "Interactions", kind: "count", agg: "sum" },
  profile_views: { label: "Profile / page views", kind: "count", agg: "sum" },
  website_clicks: { label: "Website clicks", kind: "count", agg: "sum" },
  reach: { label: "Accounts reached per day", kind: "count", agg: "avg" },
  accounts_engaged: { label: "Accounts engaged per day", kind: "count", agg: "avg" },
} as const satisfies Record<string, HubMetricDef>;

export type HubMetricKey = keyof typeof HUB_METRICS;

export function isHubMetric(k: unknown): k is HubMetricKey {
  return typeof k === "string" && Object.prototype.hasOwnProperty.call(HUB_METRICS, k);
}

export const DIM_TYPES = ["total", "campaign", "channel"] as const;
export type DimType = (typeof DIM_TYPES)[number];

// ── Ad campaign → workspace ─────────────────────────────────────────────────

/**
 * Which workspace an ad campaign belongs to.
 *
 * The CUFC ad account runs Mini Football, the Cup and Academy campaigns as well
 * as the club's own, so the ACCOUNT cannot say whose money it is. The campaign
 * name can: every campaign is named brand-first ("CIC 2027 | Australia | Leads",
 * "Ballers Youth League Term 4 | CHCH | 2026").
 *
 * The rules below were written against the 40 real campaign names on the three
 * ad accounts (pulled 2026-09-15), not guessed. First match wins, so the more
 * specific brands come first — "CIC 7's | Jan 2027 | South Island" is the Cup's,
 * not South Island United's.
 *
 * A campaign that matches nothing falls back to its account's workspace, and the
 * page says which of the two decided it. An account with no workspace and a name
 * that matches nothing is "unassigned" — shown as such, never guessed.
 */
const CAMPAIGN_RULES: { workspace: string; pattern: RegExp }[] = [
  { workspace: "mini-football-leagues", pattern: /\bmini\s*football\b|\bmfl\b|\byouth\s+leagues?\b|\bballers\b/i },
  { workspace: "christchurch-international-cup", pattern: /\bcic\b|international\s+cup|summer\s*7'?s|ethnic\s+cup/i },
  { workspace: "united-gymnastics", pattern: /gymnastic|\bcugc\b/i },
  { workspace: "south-island-united", pattern: /\bsiu\b|south\s+island\s+united/i },
  { workspace: "united-prints", pattern: /\bunited\s+prints?\b/i },
  { workspace: "united-sports-centre", pattern: /\busc\b|sports\s+centre/i },
];

export type CampaignBasis = "name" | "account" | "unassigned";

export function workspaceForCampaign(
  name: string | null | undefined,
  accountWorkspace: string | null | undefined,
): { workspace: string | null; basis: CampaignBasis } {
  const n = String(name ?? "");
  for (const rule of CAMPAIGN_RULES) {
    if (rule.pattern.test(n)) return { workspace: rule.workspace, basis: "name" };
  }
  if (accountWorkspace) return { workspace: accountWorkspace, basis: "account" };
  return { workspace: null, basis: "unassigned" };
}

// ── Websites ────────────────────────────────────────────────────────────────

/** `alias` = another domain for a listed site. Counted, never reported as "no tracking seen". */
export type SiteKind = "site" | "checkout" | "shop" | "alias";
export type SiteDef = { workspace: string; label: string; kind: SiteKind };

/**
 * Every public website, keyed by host (no "www.").
 *
 * 🔴 A host that is not listed is NOT dropped: it is counted under "other
 * sites" and the page says how many visits that was, so a new site that nobody
 * added here shows up as a question rather than vanishing.
 */
export const SITES: Record<string, SiteDef> = {
  "cufc.co.nz": { workspace: "christchurch-united", label: "cufc.co.nz", kind: "site" },
  "join.cufc.co.nz": { workspace: "christchurch-united", label: "join.cufc.co.nz", kind: "checkout" },
  "cufcshop.com": { workspace: "christchurch-united", label: "cufcshop.com", kind: "shop" },
  "footballinstitute.co.nz": { workspace: "christchurch-united", label: "footballinstitute.co.nz", kind: "site" },
  "join.footballinstitute.co.nz": { workspace: "christchurch-united", label: "join.footballinstitute.co.nz", kind: "checkout" },
  "southislandunited.com": { workspace: "south-island-united", label: "southislandunited.com", kind: "site" },
  "join.southislandunited.com": { workspace: "south-island-united", label: "join.southislandunited.com", kind: "checkout" },
  "shop.southislandunited.com": { workspace: "south-island-united", label: "shop.southislandunited.com", kind: "shop" },
  "minifootball.co.nz": { workspace: "mini-football-leagues", label: "minifootball.co.nz", kind: "site" },
  // Seen in the tracker with real visits (2026-09-15): the hyphenated domain.
  "mini-football.co.nz": { workspace: "mini-football-leagues", label: "mini-football.co.nz", kind: "alias" },
  "join.minifootball.co.nz": { workspace: "mini-football-leagues", label: "join.minifootball.co.nz", kind: "checkout" },
  "shop.minifootball.co.nz": { workspace: "mini-football-leagues", label: "shop.minifootball.co.nz", kind: "shop" },
  "cicyouth.com": { workspace: "christchurch-international-cup", label: "cicyouth.com", kind: "site" },
  "shop.cicyouth.com": { workspace: "christchurch-international-cup", label: "shop.cicyouth.com", kind: "shop" },
  "cic7s.com": { workspace: "christchurch-international-cup", label: "cic7s.com", kind: "site" },
  "ethniccup.com": { workspace: "christchurch-international-cup", label: "ethniccup.com", kind: "site" },
  "cugc.co.nz": { workspace: "united-gymnastics", label: "cugc.co.nz", kind: "site" },
  "join.cugc.co.nz": { workspace: "united-gymnastics", label: "join.cugc.co.nz", kind: "checkout" },
  "unitedsportscentre.com": { workspace: "united-sports-centre", label: "unitedsportscentre.com", kind: "site" },
  "book.unitedsportscentre.com": { workspace: "united-sports-centre", label: "book.unitedsportscentre.com", kind: "checkout" },
  "unitedprints.co.nz": { workspace: "united-prints", label: "unitedprints.co.nz", kind: "site" },
  "shop.unitedprints.co.nz": { workspace: "united-prints", label: "shop.unitedprints.co.nz", kind: "shop" },
  "join.unitedprints.co.nz": { workspace: "united-prints", label: "join.unitedprints.co.nz", kind: "checkout" },
};

/**
 * Hosts that are staff or build traffic, never a customer: ClubOS itself, Fly
 * and Vercel preview hosts, a developer's machine. Counting them would put
 * Daniel's own admin clicks into "website visitors".
 */
const STAFF_HOST_PATTERNS: RegExp[] = [
  /^app\.usg\.co\.nz$/,
  /\.fly\.dev$/,
  /\.vercel\.app$/,
  /^localhost$/,
  /^127\.0\.0\.1$/,
  /^ref\./,
];

/** The same patterns as POSIX regex text, so SQL excludes exactly what isStaffHost()
 *  excludes rather than keeping a second copy of the list. */
export const STAFF_HOST_PATTERN_SOURCES: string[] = STAFF_HOST_PATTERNS.map((p) => p.source);

export function normaliseHost(host: string | null | undefined): string {
  return String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    // "cufc.co.nz." is a legal fully-qualified host and it reached the tracker
    // as its own site; the trailing dot names the same place.
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

export function isStaffHost(host: string | null | undefined): boolean {
  const h = normaliseHost(host);
  return !h || STAFF_HOST_PATTERNS.some((p) => p.test(h));
}

export function siteForHost(host: string | null | undefined): SiteDef | null {
  return SITES[normaliseHost(host)] ?? null;
}

/** First-party channel keys (shared/attribution.ts classifier) → plain words. */
export const CHANNEL_LABELS: Record<string, string> = {
  direct: "Direct",
  facebook: "Facebook",
  instagram: "Instagram",
  meta_unattributed: "Meta (unclear which)",
  google: "Google",
  organic: "Organic search",
  referral: "Other websites",
  email: "Email",
  qr: "QR code",
  other: "Other",
};

export function channelLabel(key: string | null | undefined): string {
  if (!key) return "Not classified";
  return CHANNEL_LABELS[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

// ── Forms ───────────────────────────────────────────────────────────────────

/**
 * Every public form that stores a submission.
 *
 * All seventeen tables carry `organization_id` and `created_at` (verified
 * against production 2026-09-15; script/_verify-marketing-hub-live.ts
 * re-checks it), so those two columns are the contract and not repeated per row.
 *
 * `where` is a static SQL fragment written here, never user input.
 *
 * 🔴 Deliberately NOT here: paid checkouts (they are registrations and revenue,
 * counted separately), referee and print-portal sign-ups (account creation for
 * a known role, not a lead), and the generic newsletter block on programme
 * pages — which stores nothing at all, so it cannot be counted.
 */
export type FormSource = {
  key: string;
  label: string;
  table: string;
  where?: string;
  /** Column holding programs.id, when the form knows its programme. */
  programIdColumn?: string;
  /** Column holding programs.slug, when the form knows its programme by slug. */
  programSlugColumn?: string;
  /** `public_form_submissions.form` when this form runs the spam guard. */
  guardForm?: string;
};

export const FORM_SOURCES: readonly FormSource[] = [
  { key: "contact", label: "Contact form", table: "inbox_messages",
    where: "t.channel = 'web_form' AND COALESCE(t.subject, '') NOT ILIKE 'newsletter signup'" },
  // Only cugc.co.nz uses this convention: its newsletter block posts through the
  // contact endpoint with this exact subject.
  { key: "newsletter", label: "Newsletter sign-up", table: "inbox_messages",
    where: "t.channel = 'web_form' AND t.subject ILIKE 'newsletter signup'" },
  { key: "chat", label: "Live chat started", table: "chat_conversations" },
  { key: "cic_interest", label: "CIC Youth — register interest", table: "cic_interest_registrations" },
  { key: "cic7s_interest", label: "CIC 7's — register interest", table: "cic7s_registrations" },
  { key: "ethnic_cup_interest", label: "Ethnic Cup — register interest", table: "ethnic_cup_registrations",
    guardForm: "ethnic_cup_register" },
  { key: "team_entry", label: "Team entry started", table: "teampay_entries" },
  { key: "fill_in", label: "Fill-in player sign-up", table: "teampay_fillins" },
  { key: "skills_challenge", label: "Skills Challenge entry", table: "skills_challenge_entries" },
  { key: "open_training", label: "Open training request", table: "cufc_open_trainings" },
  { key: "free_session", label: "Free trial session", table: "cugc_free_sessions",
    programSlugColumn: "program_slug", guardForm: "cugc_free_session" },
  { key: "academy_waitlist", label: "Academy waitlist", table: "academy_waitlist", programIdColumn: "program_id" },
  { key: "league_waitlist", label: "League waitlist", table: "league_waitlist",
    programSlugColumn: "program_slug", guardForm: "mfl_waitlist" },
  { key: "football_institute", label: "Football Institute application", table: "football_institute_applications" },
  { key: "booking_request", label: "Venue booking request", table: "booking_requests" },
  { key: "print_quote", label: "Print quote request", table: "print_quotes", guardForm: "print_quote" },
  { key: "job_application", label: "Job application", table: "hiring_applications" },
  { key: "volunteer", label: "Volunteer sign-up", table: "volunteers" },
];

// ── API query + response shapes ─────────────────────────────────────────────

/**
 * Query string every hub endpoint takes:
 *   period=today|7d|30d|ytd|year|custom  (&from=&to= for custom)
 *   workspace=<slug>   — omit for the whole organisation
 *   program=<id>       — only with a workspace
 */
export type HubFilter = { workspace: string | null; programId: number | null };

/** A number now and the same-length period before it. */
export type Comparable = { current: number; previous: number };

/**
 * Why a number might not be there.
 *   ok             — a real number, possibly zero
 *   not_connected  — nothing is pulling this yet
 *   no_data        — connected, but the source returned nothing in this range
 *   not_split      — exists, but cannot be broken down by the chosen programme
 */
export type Availability = "ok" | "not_connected" | "no_data" | "not_split";

export type HubRangeInfo = { range: DateRange; previousRange: DateRange; filter: HubFilter };

export type OverviewResponse = HubRangeInfo & {
  tiles: {
    /** Distinct visitors seen by ClubOS's own tracker on customer websites. */
    visitors: Comparable & { status: Availability };
    submissions: Comparable & { status: Availability };
    paidRegistrations: Comparable & { status: Availability };
    /** Cents. The same number each workspace's own dashboard shows. */
    revenueCents: Comparable & { status: Availability; workspacesWithRevenue: number };
    adSpendCents: Comparable & { status: Availability };
    /** Latest follower total across every connected page and account. */
    followers: { current: number | null; previous: number | null; status: Availability };
  };
  series: {
    date: string;
    visitors: number;
    submissions: number;
    paidRegistrations: number;
    adSpendCents: number;
  }[];
  byWorkspace: OverviewWorkspaceRow[];
  /** Plain-English caveats the page must show beside the numbers. */
  notes: string[];
};

export type OverviewWorkspaceRow = {
  slug: string;
  name: string;
  short: string;
  visitors: number;
  submissions: number;
  paidRegistrations: number;
  /** null = this workspace's revenue is not recorded in ClubOS. */
  revenueCents: number | null;
  revenueLabel: string | null;
  adSpendCents: number;
  /** null = no connected social account for this workspace. */
  followers: number | null;
};

export type WebsitesResponse = HubRangeInfo & {
  firstParty: {
    status: Availability;
    sites: {
      host: string;
      label: string;
      workspace: string | null;
      kind: SiteKind | "other";
      visitors: number;
      visitorsPrevious: number;
      pageViews: number;
      sessions: number;
    }[];
    channels: { channel: string; label: string; visitors: number }[];
    topPages: { host: string; path: string; views: number }[];
    series: { date: string; visitors: number; pageViews: number }[];
    /** Listed websites the tracker has not seen in this range. */
    untrackedSites: { host: string; label: string; workspace: string }[];
  };
  ga4: {
    status: Availability;
    properties: {
      sourceId: number;
      label: string;
      site: string | null;
      workspace: string | null;
      sessions: number;
      sessionsPrevious: number;
      engagedSessions: number;
      pageViews: number;
      keyEvents: number;
      lastDay: string | null;
    }[];
    channels: { channel: string; sessions: number }[];
    series: { date: string; sessions: number }[];
  };
};

export type FormsResponse = HubRangeInfo & {
  total: Comparable;
  /** One row per form × workspace that had a submission in either period. */
  forms: {
    key: string;
    label: string;
    workspace: string | null;
    current: number;
    previous: number;
    programmeAware: boolean;
  }[];
  series: { date: string; submissions: number }[];
  byProgramme: { programId: number; name: string; workspace: string | null; current: number; previous: number }[];
  /** Spam guard verdicts for the forms that run it. */
  guard: { form: string; label: string; accepted: number; held: number }[];
  notes: string[];
};

export type AdsPlatformStatus = "connected" | "not_connected" | "not_built" | "error";

export type AdsResponse = HubRangeInfo & {
  platforms: {
    key: PlatformKey;
    label: string;
    status: AdsPlatformStatus;
    lastSyncAt: string | null;
    lastError: string | null;
    setup: string[] | null;
  }[];
  totals: {
    spendCents: Comparable;
    impressions: Comparable;
    linkClicks: Comparable;
    landingPageViews: Comparable;
    leads: Comparable;
    purchases: Comparable;
  };
  campaigns: {
    sourceId: number;
    account: string;
    platform: PlatformKey;
    campaignId: string;
    name: string;
    workspace: string | null;
    basis: CampaignBasis;
    spendCents: number;
    impressions: number;
    linkClicks: number;
    leads: number;
    purchases: number;
    firstDay: string;
    lastDay: string;
  }[];
  byWorkspace: { workspace: string | null; spendCents: number; leads: number; purchases: number }[];
  series: { date: string; spendCents: number }[];
  /** Ads can't be split by programme yet; set when a programme filter is on. */
  notSplitByProgramme: boolean;
};

/** ClubOS's own view of where sign-ups came from (AttributionOS, first-party). */
export type TrackedResponse = HubRangeInfo & {
  status: Availability;
  model: string;
  stats: {
    totalConversions: number;
    totalLeads: number;
    totalSales: number;
    trackedRevenueCents: number;
    pctUnattributed: number;
  } | null;
  channels: { key: string; label: string; conversions: number; leads: number; sales: number; revenueCents: number }[];
};

export type OrganicResponse = HubRangeInfo & {
  status: Availability;
  accounts: {
    sourceId: number;
    platform: "facebook_page" | "instagram";
    label: string;
    workspace: string | null;
    followers: number | null;
    /** The first follower total recorded inside the range — null until a second day exists. */
    followersAtStart: number | null;
    newFollows: number;
    views: number;
    interactions: number;
    profileViews: number;
    websiteClicks: number;
    avgReach: number | null;
    lastDay: string | null;
  }[];
  /** Follower totals per day, summed across the accounts that reported that day. */
  series: { date: string; followers: number }[];
  notSplitByProgramme: boolean;
};

export type SourcesResponse = {
  syncEnabled: boolean;
  /** When a person may press "Sync now" again (ISO), or null now. */
  nextManualSyncAt: string | null;
  sources: {
    id: number;
    platform: PlatformKey;
    label: string;
    externalId: string;
    workspace: string | null;
    site: string | null;
    active: boolean;
    firstDay: string | null;
    lastDay: string | null;
    lastRunAt: string | null;
    lastStatus: string | null;
    lastOkAt: string | null;
    lastError: string | null;
  }[];
  platforms: (PlatformDef & { sourceCount: number })[];
  recentRuns: {
    id: number;
    label: string;
    platform: string;
    trigger: string;
    status: string;
    rowsWritten: number;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  }[];
};

export type ProgrammesResponse = {
  programmes: { id: number; name: string; workspace: string | null; active: boolean }[];
};

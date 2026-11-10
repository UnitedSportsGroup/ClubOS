/**
 * Social media — every brand's accounts, posts and follower history.
 *
 * Daniel, 2026-11-10: "a social media tab … select the brand … see the
 * Instagram, Facebook, TikTok, YouTube, X, LinkedIn … see stats, see the posts,
 * see the calendar of all time … an easy way to connect all of those accounts."
 *
 * United Sports Group → Marketing → Social media (/admin/social-media).
 *
 * Registries, so a new brand or platform is a line here and not a page change:
 *   SOCIAL_BRANDS     the brands a person can pick
 *   SOCIAL_PLATFORMS  what each platform can do today, and what a human must
 *                     do before ClubOS can read it
 *   META_BRAND_BY_ID  which brand each known Facebook page / Instagram account is
 *
 * Dependency-free: the server, the page and the verify scripts all read it.
 */

export const SOCIAL_TAB = "social-media";

// ── Brands ──────────────────────────────────────────────────────────────────

export type SocialBrand = { key: string; name: string; short: string; orgId: number };

/** Display order. A brand's colour is its position here, never its rank. */
export const SOCIAL_BRANDS: readonly SocialBrand[] = [
  { key: "cufc", name: "Christchurch United", short: "CUFC", orgId: 1 },
  { key: "siu", name: "South Island United", short: "SIU", orgId: 2 },
  { key: "academy", name: "CUFC Academy", short: "Academy", orgId: 1 },
  { key: "mfl", name: "Mini Football Leagues", short: "MFL", orgId: 3 },
  { key: "cic", name: "Christchurch International Cup", short: "CIC", orgId: 5 },
  { key: "cic7s", name: "CIC 7's", short: "CIC 7's", orgId: 5 },
  { key: "cugc", name: "United Gymnastics", short: "CUGC", orgId: 6 },
  { key: "prints", name: "United Prints", short: "Prints", orgId: 8 },
  { key: "usc", name: "United Sports Centre", short: "USC", orgId: 4 },
];

export function socialBrand(key: string | null | undefined): SocialBrand | null {
  return SOCIAL_BRANDS.find((b) => b.key === key) ?? null;
}

// ── Platforms ───────────────────────────────────────────────────────────────

export const SOCIAL_PLATFORM_KEYS = ["instagram", "facebook", "tiktok", "youtube", "x", "linkedin"] as const;
export type SocialPlatformKey = (typeof SOCIAL_PLATFORM_KEYS)[number];

export function isSocialPlatform(k: unknown): k is SocialPlatformKey {
  return typeof k === "string" && (SOCIAL_PLATFORM_KEYS as readonly string[]).includes(k);
}

export type SocialPlatformDef = {
  key: SocialPlatformKey;
  label: string;
  /**
   * auto = ClubOS finds every account itself (Meta business login).
   * api  = paste a link and ClubOS reads it.
   * link = the link is saved and followers are typed in; the platform gives no
   *        read access until the steps in `setup` are done.
   */
  mode: "auto" | "api" | "link";
  /** The word this platform uses for followers. */
  audience: string;
  setup?: string[];
};

export const SOCIAL_PLATFORMS: readonly SocialPlatformDef[] = [
  { key: "instagram", label: "Instagram", mode: "auto", audience: "followers" },
  { key: "facebook", label: "Facebook", mode: "auto", audience: "followers" },
  {
    key: "tiktok",
    label: "TikTok",
    mode: "link",
    audience: "followers",
    setup: [
      "TikTok only shares an account's posts and stats with an approved developer app.",
      "At developers.tiktok.com, create an app for the club and request the Display API (a review of a few days).",
      "Then each TikTok account signs in once to approve it. Until then, the link is saved here and followers can be typed in.",
    ],
  },
  {
    key: "youtube",
    label: "YouTube",
    mode: "api",
    audience: "subscribers",
    setup: [
      "One click: open the cufc-aios Google Cloud project and switch on 'YouTube Data API v3'.",
      "After that, paste a channel link here and ClubOS reads its videos and stats itself.",
    ],
  },
  {
    key: "x",
    label: "X",
    mode: "link",
    audience: "followers",
    setup: [
      "X charges for read access (the Basic tier, about US$200 a month).",
      "Until that is bought, the link is saved here and followers can be typed in.",
    ],
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    mode: "link",
    audience: "followers",
    setup: [
      "At linkedin.com/developers, create an app linked to the Company Page and request the Community Management API (a review of a few days).",
      "Until then, the link is saved here and followers can be typed in.",
    ],
  },
];

export function socialPlatform(key: SocialPlatformKey): SocialPlatformDef {
  return SOCIAL_PLATFORMS.find((p) => p.key === key)!;
}

/**
 * Which brand each known Facebook page and Instagram account belongs to.
 * These ids are public, not secrets. An account found automatically that is
 * not listed here is filed under NO brand until a person picks one.
 */
export const META_BRAND_BY_ID: Readonly<Record<string, string>> = {
  // Facebook pages
  "628369870533437": "cufc",
  "862050420321303": "siu",
  "925104854025263": "academy",
  "394808607055485": "mfl",
  "1739186766319115": "cic",
  "760799280454675": "cic7s",
  "107733607830034": "cugc",
  "1317365314797276": "prints",
  // Instagram accounts
  "17841408330461472": "cufc",
  "17841477314715773": "siu",
  "17841479611227352": "academy",
  "17841469460080448": "mfl",
  "17841448748238822": "cic",
  "17841476847536777": "cic7s",
  "17841451169458594": "cugc",
  "17841476855871389": "prints",
};

// ── Reading what a person pasted ────────────────────────────────────────────

const HOSTS: Record<SocialPlatformKey, RegExp> = {
  instagram: /(^|\.)instagram\.com$/i,
  facebook: /(^|\.)(facebook|fb)\.com$/i,
  tiktok: /(^|\.)tiktok\.com$/i,
  youtube: /(^|\.)(youtube\.com|youtu\.be)$/i,
  x: /(^|\.)(x|twitter)\.com$/i,
  linkedin: /(^|\.)linkedin\.com$/i,
};

const HANDLE = /^[A-Za-z0-9._-]{1,100}$/;

export type ParsedProfile = { handle: string; profileUrl: string; channelId?: string };

/**
 * Turn "@name", "name" or a profile link into a handle and a clean link.
 * Returns an error sentence a person can act on, never a guess.
 */
export function parseProfileInput(platform: SocialPlatformKey, raw: string): ParsedProfile | { error: string } {
  const input = String(raw ?? "").trim();
  if (!input) return { error: "Paste the profile link or type the @name." };
  const label = socialPlatform(platform).label;

  let handle = input;
  let channelId: string | undefined;
  if (/^https?:\/\//i.test(input) || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(input)) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
      return { error: "That doesn't look like a link." };
    }
    if (!HOSTS[platform].test(url.hostname)) return { error: `That isn't a ${label} link.` };
    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length) return { error: `That link has no ${label} account in it.` };
    if (platform === "youtube") {
      if (parts[0] === "channel" && parts[1]) {
        channelId = parts[1];
        handle = parts[1];
      } else if (parts[0].startsWith("@")) handle = parts[0];
      else if ((parts[0] === "c" || parts[0] === "user") && parts[1]) handle = parts[1];
      else handle = parts[0];
    } else if (platform === "linkedin") {
      if ((parts[0] === "company" || parts[0] === "school" || parts[0] === "showcase") && parts[1]) handle = parts[1];
      else return { error: "Use the Company Page link (linkedin.com/company/…)." };
    } else {
      handle = parts[0];
    }
  }
  handle = decodeURIComponent(handle).replace(/^@/, "").trim();
  if (!HANDLE.test(handle)) return { error: `"${handle}" isn't a valid ${label} name.` };

  const profileUrl =
    platform === "instagram" ? `https://www.instagram.com/${handle}/`
    : platform === "facebook" ? `https://www.facebook.com/${handle}`
    : platform === "tiktok" ? `https://www.tiktok.com/@${handle}`
    : platform === "youtube" ? (channelId ? `https://www.youtube.com/channel/${channelId}` : `https://www.youtube.com/@${handle}`)
    : platform === "x" ? `https://x.com/${handle}`
    : `https://www.linkedin.com/company/${handle}`;
  return { handle, profileUrl, channelId };
}

// ── Periods ─────────────────────────────────────────────────────────────────

export const SOCIAL_PERIODS = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "12m", label: "Last 12 months", days: 365 },
  { key: "all", label: "All time", days: null },
] as const;
export type SocialPeriodKey = (typeof SOCIAL_PERIODS)[number]["key"];

export function socialPeriod(key: unknown) {
  return SOCIAL_PERIODS.find((p) => p.key === key) ?? SOCIAL_PERIODS[1];
}

// ── What the API returns ────────────────────────────────────────────────────

export type SocialAccount = {
  id: number;
  platform: SocialPlatformKey;
  brand: string | null;
  handle: string;
  displayName: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
  connection: "api" | "link";
  /** Latest reading; null = never read. */
  followers: number | null;
  followersAt: string | null;
  followersSource: "api" | "manual" | null;
  /** Followers at the start of the period; null = no reading that far back. */
  followersAtStart: number | null;
  postsStored: number;
  postsInPeriod: number;
  firstPostAt: string | null;
  historyComplete: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type SocialPost = {
  id: number;
  accountId: number;
  platform: SocialPlatformKey;
  brand: string | null;
  handle: string;
  postedAt: string;
  /** The NZ calendar day it was posted. */
  day: string;
  kind: string;
  caption: string | null;
  permalink: string | null;
  thumb: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  views: number | null;
  reach: number | null;
  clicks: number | null;
  /** likes + comments + shares + saves, of those the platform gave. */
  interactions: number;
};

export type SocialAccountsResponse = {
  today: string;
  period: SocialPeriodKey;
  accounts: SocialAccount[];
  /** When a person may press Sync again, or null if they may now. */
  nextSyncAt: string | null;
  syncing: boolean;
};

export type SocialSeriesPoint = { day: string; value: number };

export type SocialOverviewResponse = {
  period: SocialPeriodKey;
  range: { from: string | null; to: string };
  followers: { total: number | null; atStart: number | null; accountsCounted: number; accountsMissing: number };
  posts: number;
  interactions: number;
  /** Views of posts made in the period (Instagram, Facebook, YouTube). */
  postViews: number | null;
  /** Daily account-level series from the Marketing hub, where a platform gives one. */
  daily: { views: SocialSeriesPoint[]; interactions: SocialSeriesPoint[]; reach: SocialSeriesPoint[] } | null;
  followerSeries: SocialSeriesPoint[];
  postsOverTime: { bucket: "day" | "week" | "month"; points: SocialSeriesPoint[] };
  byKind: { kind: string; posts: number; interactions: number; views: number | null }[];
  topPosts: SocialPost[];
};

export type SocialPostsResponse = { total: number; posts: SocialPost[] };

export type SocialCalendarResponse = {
  /** Posts per NZ day across the whole history in scope. */
  days: { day: string; posts: number }[];
  firstDay: string | null;
  lastDay: string | null;
};

export const POST_KIND_LABEL: Record<string, string> = {
  image: "Photo",
  video: "Video",
  reel: "Reel",
  carousel: "Carousel",
  story: "Story",
  short: "Short",
  text: "Text",
  link: "Link",
};

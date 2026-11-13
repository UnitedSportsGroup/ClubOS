/**
 * Social media labels — what a post IS (a content type, e.g. "Starting line-up")
 * and which SPONSORS are seen in it.
 *
 * Daniel, 2026-11-13: "find all the starting lineup graphics for Christchurch
 * United for the whole year … 'you've got an asset here with 1 million views
 * per year, what is that worth to you to get your logo on it?' … tag a video
 * and say Fusion5 was here … at the end of the month: these are the views we
 * got for you."
 *
 * United Sports Group → Marketing → Social media → Feed · Labels.
 *
 * 🔴 Only CONFIRMED labels are counted. Rambo's finds are suggestions until a
 *    person ticks them; a rejected suggestion is kept so it is never offered
 *    again.
 * 🔴 Views add up across posts and platforms. "People reached" does NOT (one
 *    person seeing five posts is one person), so no report here totals reach.
 * 🔴 A post the platform gave no view count for is counted as a post and left
 *    out of the views, and the report says how many.
 *
 * Dependency-free: the server, the page and the verify scripts all read it.
 */
import type { SocialPlatformKey, SocialPost } from "./social";

export const LABEL_KINDS = [
  { key: "asset", label: "Content types", one: "Content type" },
  { key: "sponsor", label: "Sponsors", one: "Sponsor" },
] as const;
export type LabelKind = (typeof LABEL_KINDS)[number]["key"];
export function isLabelKind(k: unknown): k is LabelKind {
  return k === "asset" || k === "sponsor";
}

/** Derived from the two stamps, never stored. */
export type LabelStatus = "confirmed" | "suggested" | "rejected";
export function labelStatus(row: { confirmedAt: string | null; rejectedAt: string | null }): LabelStatus {
  return row.rejectedAt ? "rejected" : row.confirmedAt ? "confirmed" : "suggested";
}

export type SocialLabel = {
  id: number;
  kind: LabelKind;
  name: string;
  /** What to look for, in plain words. Rambo reads this. */
  hint: string | null;
  partnerId: number | null;
  archived: boolean;
};

export type PostLabel = {
  labelId: number;
  kind: LabelKind;
  name: string;
  status: "confirmed" | "suggested";
  source: "person" | "rambo";
  /** Rambo's one line on why, when it made the suggestion. */
  reason: string | null;
};

export type FeedPost = SocialPost & { labels: PostLabel[]; large: string | null };
export type FeedResponse = { total: number; posts: FeedPost[] };

export type LabelsResponse = { labels: SocialLabel[] };

export function parseLabelInput(raw: any): { kind: LabelKind; name: string; hint: string | null; partnerId: number | null } | { error: string } {
  if (!isLabelKind(raw?.kind)) return { error: "Choose content type or sponsor." };
  const name = String(raw?.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "Give the label a name." };
  if (name.length > 60) return { error: "Keep the name under 60 characters." };
  const hint = String(raw?.hint ?? "").trim();
  if (hint.length > 400) return { error: "Keep the description under 400 characters." };
  const partnerId = raw?.partnerId == null || raw.partnerId === "" ? null : Number(raw.partnerId);
  if (partnerId != null && (!Number.isInteger(partnerId) || partnerId <= 0)) return { error: "Unknown partner." };
  if (partnerId != null && raw.kind !== "sponsor") return { error: "Only a sponsor label can be tied to a partner." };
  return { kind: raw.kind, name, hint: hint || null, partnerId };
}

// ── The window a report covers ──────────────────────────────────────────────

export type LabelWindow = { from: string | null; to: string | null; label: string };
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `year` = "2026" or "all"; `month` = "01".."12" or null for the whole year. */
export function labelWindow(year: string, month: string | null): LabelWindow {
  if (!/^\d{4}$/.test(year)) return { from: null, to: null, label: "All time" };
  if (month && /^(0[1-9]|1[0-2])$/.test(month)) {
    const y = Number(year);
    const m = Number(month);
    // Day 0 of the next month is the last day of this one; UTC so no clock can shift it.
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${year}-${month}-01`, to: `${year}-${month}-${String(last).padStart(2, "0")}`, label: `${MONTH_NAMES[m - 1]} ${year}` };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31`, label: year };
}

/** The same window one year earlier. */
export function previousWindow(year: string, month: string | null): LabelWindow | null {
  if (!/^\d{4}$/.test(year)) return null;
  return labelWindow(String(Number(year) - 1), month);
}

// ── Reports ─────────────────────────────────────────────────────────────────

export type LabelPlatformRow = {
  platform: SocialPlatformKey;
  posts: number;
  /** null = no post on this platform carried a view count. */
  views: number | null;
  postsWithoutViews: number;
  interactions: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  /** People reached, added over the posts that carry a figure. Only ever shown as an average a post. */
  reachSum: number;
  reachPosts: number;
};

export type LabelSummaryRow = {
  label: SocialLabel;
  posts: number;
  views: number | null;
  postsWithoutViews: number;
  interactions: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  reachSum: number;
  reachPosts: number;
  byPlatform: LabelPlatformRow[];
  /** Same window a year earlier; null when the window is "all time". */
  previous: { posts: number; views: number | null } | null;
  /** Rambo's suggestions in this window that nobody has checked. Not counted above. */
  toCheck: number;
};

/** What the club's own Meta ads cost per 1,000 views over the last 12 months. */
export type AdCost = { spendCents: number; impressions: number; from: string; to: string } | null;

export type LabelSummaryResponse = {
  window: LabelWindow;
  brand: string | null;
  rows: LabelSummaryRow[];
  adCost: AdCost;
};

export type LabelReportResponse = {
  window: LabelWindow;
  brand: string | null;
  row: LabelSummaryRow;
  byMonth: { month: string; posts: number; views: number }[];
  byAccount: { accountId: number; platform: SocialPlatformKey; handle: string; brand: string | null; posts: number; views: number | null }[];
  topPosts: SocialPost[];
  /** Every confirmed post in the window, most viewed first (at most 1,000). */
  posts: SocialPost[];
  adCost: AdCost;
};

/** Average people reached a post, or null when no post carried a figure. Reach is never added up. */
export function averageReach(r: { reachSum: number; reachPosts: number }): number | null {
  return r.reachPosts > 0 ? Math.round(r.reachSum / r.reachPosts) : null;
}

/** Cents to buy `views` at the club's own ad rate; null when there is no rate. */
export function adEquivalentCents(views: number | null, cost: AdCost): number | null {
  if (views == null || !cost || cost.impressions <= 0 || cost.spendCents <= 0) return null;
  return Math.round((views * cost.spendCents) / cost.impressions);
}

export function cpmCents(cost: AdCost): number | null {
  if (!cost || cost.impressions <= 0 || cost.spendCents <= 0) return null;
  return Math.round((cost.spendCents * 1000) / cost.impressions);
}

const PLATFORM_NAME: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", x: "X", linkedin: "LinkedIn" };
const num = (v: number) => v.toLocaleString("en-NZ");
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

/**
 * The plain-text update for a sponsor's WhatsApp group. Only confirmed labels
 * are in `row`, so nothing here is a guess.
 */
export function sponsorMessage(row: LabelSummaryRow, window: LabelWindow, brandName: string | null): string {
  const who = brandName ? `${brandName}'s social media` : "our social media";
  const lines: string[] = [`${row.label.name} on ${who}: ${window.label}`, ""];
  if (row.posts === 0) {
    lines.push(`No posts featured ${row.label.name} in this period.`);
    return lines.join("\n");
  }
  lines.push(`${plural(row.posts, "post")} featured ${row.label.name}.`);
  if (row.views != null) lines.push(`Total views: ${num(row.views)}`);
  for (const p of row.byPlatform) {
    const name = PLATFORM_NAME[p.platform] ?? p.platform;
    lines.push(`${name}: ${plural(p.posts, "post")}${p.views != null ? `, ${num(p.views)} views` : ""}`);
  }
  if (row.interactions > 0) lines.push(`Likes, comments, shares and saves: ${num(row.interactions)}`);
  if (row.postsWithoutViews > 0) {
    lines.push("", `${plural(row.postsWithoutViews, "post")} had no view count from the platform, so the real total is higher.`);
  }
  return lines.join("\n");
}

// ── Rambo's search ──────────────────────────────────────────────────────────

export type LabelRun = {
  id: number;
  status: "running" | "done" | "failed" | "stopped";
  total: number;
  done: number;
  suggested: number;
  cents: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  scope: { brand: string | null; year: string; platforms: string[] };
};

export type LabelFindState = {
  enabled: boolean;
  /** Posts in the chosen scope Rambo has not looked at yet. */
  unchecked: number;
  /** The most a single press will look at. */
  perRun: number;
  /** Rough US cents for this press, from what past runs cost per post. */
  estimateCents: number;
  run: LabelRun | null;
};

export const LABEL_RUN_MAX = 400;
/** A running search that has not reported for this long has stopped (a restart, a crash). */
export const LABEL_RUN_STALE_MS = 3 * 60_000;

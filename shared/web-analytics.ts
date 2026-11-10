/**
 * Website analytics — one website (or all of them) in depth.
 *
 * Daniel, 2026-11-10: "now add websites tab to see analytics".
 * United Sports Group → Marketing → Website analytics (/admin/web-analytics).
 *
 * Everything comes from ClubOS's own tracker (/t.js → analytics_events), so
 * every site is counted the same way. The list of sites, and which workspace
 * each belongs to, is SITES in shared/marketing-hub.ts — one registry.
 */
import type { DateRange } from "./dashboard";

export const WEB_ANALYTICS_TAB = "web-analytics";

export type WebCount = { visitors: number; pageViews: number; sessions: number };

export type WebAnalyticsResponse = {
  range: DateRange;
  previousRange: DateRange;
  /** The site or workspace asked for; both null = every website. */
  site: string | null;
  workspace: string | null;
  status: "ok" | "no_data";
  totals: WebCount;
  previous: WebCount;
  /** Distinct visitors with a page view in the last 30 minutes. */
  liveNow: number;
  /**
   * From the tracker's own events. Each is null when the tracker recorded
   * none for this scope — never shown as zero.
   */
  behaviour: {
    /** Sessions that left after one page, out of sessions started. */
    bounces: number | null;
    sessionsStarted: number | null;
    /** Sessions started by someone never seen before. */
    newVisitorSessions: number | null;
    /** The middle visit's seconds on a page (the average is dragged up by tabs left open). */
    medianSeconds: number | null;
    /** Average of how far down the page people got, 0–100. */
    avgScrollPercent: number | null;
  };
  series: { date: string; visitors: number; pageViews: number }[];
  sites: { host: string; label: string; workspace: string | null; kind: string; visitors: number; visitorsPrevious: number; pageViews: number; sessions: number }[];
  /** Listed sites in scope that sent nothing in either period. */
  untrackedSites: { host: string; workspace: string }[];
  pages: { host: string; path: string; views: number; visitors: number; medianSeconds: number | null; avgScrollPercent: number | null }[];
  entryPages: { host: string; path: string; sessions: number }[];
  channels: { key: string; label: string; visitors: number; sessions: number }[];
  referrers: { host: string; visitors: number; sessions: number }[];
  campaigns: { source: string; medium: string | null; campaign: string | null; visitors: number; sessions: number }[];
  devices: { key: string; visitors: number }[];
  /** Buttons people pressed, by the words on them. */
  buttons: { text: string; href: string | null; clicks: number }[];
};

export function formatSeconds(s: number | null | undefined): string {
  if (s == null) return "—";
  const v = Math.round(s);
  if (v < 60) return `${v}s`;
  return `${Math.floor(v / 60)}m ${String(v % 60).padStart(2, "0")}s`;
}

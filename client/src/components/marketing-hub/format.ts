import { formatCurrency, formatCompact } from "@/lib/format";
import { percentChange } from "@shared/dashboard";

/** Cents from the API, formatted as dollars. */
export function money(cents: number): string {
  return formatCurrency(cents, { fromCents: true });
}

/** A whole-number count, compacted for a tile (1.2K, 3.4M). */
export function compact(n: number): string {
  return formatCompact(n);
}

export { percentChange as pct };

/**
 * A bare `YYYY-MM-DD` → a short label, by splitting the string.
 *
 * 🔴 Never `new Date(iso)` for a calendar date — `new Date("2026-09-02")` is
 * UTC midnight, which prints as 1 September in NZ.
 */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

/** An ISO timestamp (has a time component, unlike the calendar dates above) →
 *  "3 hours ago" / "just now" / "2 days ago". Safe to pass through `Date`
 *  because this carries real time-of-day information, not a bare date. */
export function relativeTime(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return "never";
  const then = new Date(isoTimestamp).getTime();
  if (Number.isNaN(then)) return "never";
  const diffMs = Date.now() - then;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 45) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  const diffMonth = Math.round(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth} month${diffMonth === 1 ? "" : "s"} ago`;
  const diffYear = Math.round(diffMonth / 12);
  return `${diffYear} year${diffYear === 1 ? "" : "s"} ago`;
}

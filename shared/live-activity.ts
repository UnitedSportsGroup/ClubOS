/**
 * Who is on our sites RIGHT NOW, and how far down the funnel they have got.
 *
 * Daniel, 2026-09-20 (a Sunday, with ad spend just raised on holiday camps,
 * academy and MFL): "a live feature which can show the number of people on our
 * site right now, how many have started sign up... and how many are checking
 * out... so we can see especially at peak times what this all looks like."
 *
 * 🔴 ONE DECIDER for what a page MEANS. The same path has to classify the same
 * way on the CUFC page, the MFL page and anything added next; a second copy of
 * these rules is how two screens end up disagreeing about how many people are
 * at the card step.
 *
 * 🔴 IT IS DERIVED FROM THE PAGE, NOT FROM A NEW EVENT. `analytics_events`
 * already records every page view with a visitor id and a bot flag, going back
 * 341k events. Shipping a counter tonight means reading what is already there.
 *
 * 🔴 THE TWO SHAPES ARE DIFFERENT AND THE LABELS MUST NOT PRETEND OTHERWISE.
 * MFL is three real pages — browse `/league/term-4`, form
 * `/league/term-4/register`, card `/league/term-4/checkout`. A holiday camp is
 * TWO: `/fundamentals` then `/fundamentals/book`, which carries the form AND
 * the card element on one page. So a camp visitor can never be counted "at the
 * card step" separately, and the panel says so rather than inventing a split.
 *
 * 🔴 STAFF ARE NOT CUSTOMERS. Every `/admin` page is excluded, or Daniel
 * watching the counter would appear in it.
 */

/** How recent an event has to be to count as "right now". Shown on screen —
 *  a live number with an undisclosed window is not interpretable. */
export const LIVE_WINDOW_MINUTES = 5;

export type LiveStage = "checkout" | "form" | "browsing" | "staff";

export type LiveBrand = "cufc" | "mfl" | "cic" | "other";

/**
 * How far down the funnel this page is.
 *
 * `form` means they have opened a booking or registration page — NOT that they
 * have typed anything. There is no field-level event in this dataset, so
 * claiming "started filling it in" would be a guess; the panel says "on a
 * booking page".
 */
export function liveStageFor(page: string | null | undefined): LiveStage {
  const p = String(page ?? "").split("?")[0].replace(/\/+$/, "") || "/";
  if (/^\/admin(\/|$)/.test(p)) return "staff";

  // A dedicated card page — only MFL has one today.
  if (/\/checkout$/.test(p)) return "checkout";
  // Success pages are past the money and are not "checking out".
  if (/\/(success|thank-you|thanks)$/.test(p)) return "browsing";

  // Booking / registration forms across every brand.
  if (/\/book$/.test(p)) return "form";
  if (/\/register$/.test(p)) return "form";
  if (/^\/academy\/[^/]+$/.test(p)) return "form";     // academy sells on one page
  if (/^\/enter\/[^/]+$/.test(p)) return "form";       // team entry
  if (/^\/pay\//.test(p)) return "checkout";           // a player paying their share
  if (/^\/league\/split\//.test(p)) return "form";     // split-pay hub

  return "browsing";
}

/** Which brand's funnel a page belongs to, so the MFL workspace sees MFL only. */
export function liveBrandFor(page: string | null | undefined): LiveBrand {
  const p = String(page ?? "").split("?")[0];
  if (/^\/league(\/|$)/.test(p)) return "mfl";
  if (/^\/(enter|marketplace)\//.test(p)) return "cic";
  if (/^\/cic-/.test(p)) return "cic";
  if (/^\/(academy|fundamentals|worldcup|u4-u8|technification|lp)(\/|$)/.test(p)) return "cufc";
  return "other";
}

/**
 * Which brands a workspace's panel should count.
 *
 * 🔴 A workspace that HAS a funnel of its own is narrowed to it — Daniel asked
 * for MFL's page to be "relevant just for MFL", and showing an MFL staffer the
 * whole organisation's traffic would misreport their night.
 *
 * 🔴 Everything else sees everything, deliberately. United Sports Group is the
 * group view, and a workspace with no public funnel of its own (Prints, the
 * Centre) has nothing to narrow TO — showing it an empty panel would read as a
 * fault rather than as an answer. These are aggregate visitor counts with no
 * personal data in them, so the open default costs nothing.
 *
 * 🔴 Slugs are the real ones from `organizations`, checked against production
 * rather than typed from memory: a slug that does not exist falls silently to
 * "all", which is exactly how the MFL panel would quietly show CUFC's numbers.
 */
export function liveBrandsForWorkspace(slug: string | null | undefined): LiveBrand[] | "all" {
  switch (String(slug ?? "")) {
    case "mini-football-leagues": return ["mfl"];
    case "christchurch-united":   return ["cufc"];
    case "christchurch-international-cup": return ["cic"];
    case "united-sports-group":   return "all";
    default:                      return "all";
  }
}

export interface LiveActivity {
  /** Distinct non-bot visitors seen in the window, excluding staff pages. */
  onSite: number;
  /** Of those, whose latest page is a booking or registration form. */
  onForm: number;
  /** Of those, whose latest page is a dedicated card/checkout page. */
  atCheckout: number;
  windowMinutes: number;
  /** Busiest pages right now, so a spike has a cause. */
  pages: { page: string; visitors: number; stage: LiveStage }[];
  /** True when the brands in view include a shape that sells the form and the
   *  card on ONE page, so `atCheckout` cannot see them. */
  formAndCardShareAPage: boolean;
  asOf: string;
}

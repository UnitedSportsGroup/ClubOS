/**
 * Marketing → Word of Mouth · Offers & Codes · Mobile Apps (the live parts).
 * Daniel, 2026-11-12. Read from what ClubOS already records; nothing is stored.
 * A number ClubOS cannot see is null and drawn "—".
 */
export const WORD_OF_MOUTH_TAB = "word-of-mouth";
export const OFFERS_TAB = "offers-codes";
export const MOBILE_APPS_TAB = "mobile-apps";
export const PRODUCT_QUALITY_TAB = "product-quality";

export const MORE_PERIODS = [
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "year", label: "Last 12 months", days: 365 },
  { key: "all", label: "All time", days: null },
] as const;
export type MorePeriod = (typeof MORE_PERIODS)[number]["key"];
export function morePeriod(v: unknown): (typeof MORE_PERIODS)[number] {
  return MORE_PERIODS.find((p) => p.key === v) ?? MORE_PERIODS[1];
}

/** How each stored answer to "How did you hear about us?" is grouped. */
export const HEARD_GROUPS = [
  { key: "people", label: "Someone told them" },
  { key: "before", label: "Been with us before" },
  { key: "social", label: "Social media" },
  { key: "ads", label: "An advert" },
  { key: "search", label: "Google search" },
  { key: "email", label: "Email or newsletter" },
  { key: "school", label: "School or club" },
  { key: "seen", label: "Flyer, sign or the venue" },
  { key: "website", label: "Club website" },
  { key: "other", label: "Something else" },
] as const;
export type HeardGroup = (typeof HEARD_GROUPS)[number]["key"];

const GROUP_OF: Record<string, HeardGroup> = {
  friend_teammate: "people", word_of_mouth: "people", friend_family: "people",
  returning: "before",
  facebook: "social", instagram: "social", tiktok: "social", youtube: "social", whatsapp: "social",
  facebook_ad: "ads",
  google: "search",
  email: "email", email_newsletter: "email",
  school_elc: "school", school_club: "school",
  flyer_poster: "seen", venue: "seen", billboard_sign: "seen", poster_qr: "seen",
  website: "website",
};

/** Which group a stored answer belongs to. "Other: been before" style answers count as returning. */
export function heardGroup(source: string): HeardGroup {
  const s = source.trim();
  if (GROUP_OF[s]) return GROUP_OF[s];
  if (/^other:/i.test(s)) {
    if (/\b(before|previous|previously|past|attended|member|player|participant)\b/i.test(s)) return "before";
    if (/\b(friend|friends|team ?mate|team member|family|cousin|brother|sister|joined)\b/i.test(s)) return "people";
  }
  return "other";
}

export type WordOfMouthReport = {
  period: MorePeriod;
  /** Paid bookings in the period. */
  bookings: number;
  answered: number;
  groups: { key: HeardGroup; label: string; count: number }[];
  answers: { label: string; count: number }[];
  byWorkspace: { name: string; bookings: number; answered: number; people: number; before: number }[];
};

export type OfferCodeRow = {
  code: string;
  workspace: string;
  /** What staff called it, when it is a code set up in ClubOS. */
  title: string | null;
  where: "bookings" | "shop";
  active: boolean | null;
  uses: number;
  /** What those customers paid, after the discount. */
  paidCents: number;
  /** What came off. On a booking that used two codes this is the whole discount, counted on each. */
  discountCents: number;
  lastUsed: string | null;
};
export type OffersReport = {
  period: MorePeriod;
  rows: OfferCodeRow[];
  unused: { code: string; workspace: string; title: string | null; where: "bookings" | "shop" }[];
  totals: { uses: number; paidCents: number; discountCents: number };
};

export type AppsReport = {
  apps: { app: string; name: string; pushDevices: number; ios: number; android: number; signUps: number; pushesSent: number; lastPush: string | null }[];
};

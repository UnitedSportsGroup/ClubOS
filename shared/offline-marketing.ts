/**
 * Marketing → Signage · Billboards · Traditional Media.
 *
 * Daniel, 2026-11-11: "signage manages signage we put up/print ourselves,
 * billboards is things like Go Media campaigns and others, and traditional
 * media is TV and news outlets we can distribute through" (+ radio).
 *
 * These are REGISTERS people keep, not reports: every row is typed in by staff.
 * One table, one page shape; what each channel calls things lives here.
 * Dependency-free: the server and the page both read it.
 */
import { socialBrand } from "./social";

export type OfflineOption = { key: string; label: string };
export type OfflineChannelKey =
  | "signage" | "billboards" | "media-outlets" | "media-coverage"
  // 2026-11-12 (Daniel): the rest of the marketing map, each a list staff keep.
  | "flyers-print" | "events-activations" | "product-quality" | "listings" | "partners-ambassadors"
  | "newsletter-placements" | "review-profiles" | "search-checks" | "search-fixes" | "mobile-apps";

export type OfflineChannelDef = {
  key: OfflineChannelKey;
  /** The tab that grants it. Traditional Media holds two lists under one tab. */
  tab: string;
  /** One of them, in words: "sign", "booking". */
  noun: string;
  addLabel: string;
  kinds: OfflineOption[];
  statuses: OfflineOption[];
  /** Statuses that mean "happening now". */
  liveStatuses: string[];
  labels: { title: string; supplier: string; location: string; starts: string; ends: string; link: string; audience: string | null; cost: string | null; size?: string; sizeHint?: string; quantity?: string };
  /** False where the end date is not "when it stops" (a listing's last check, an app's last update). */
  endsMeansOver?: boolean;
  /** Which optional fields this channel uses. */
  fields: { size: boolean; quantity: boolean; dates: boolean; contact: boolean; brand: boolean };
  empty: string;
};

const MEDIA_KINDS: OfflineOption[] = [
  { key: "tv", label: "TV" },
  { key: "radio", label: "Radio" },
  { key: "newspaper", label: "Newspaper" },
  { key: "online", label: "Online news" },
  { key: "magazine", label: "Magazine" },
  { key: "other", label: "Other" },
];

export const OFFLINE_CHANNELS: Record<OfflineChannelKey, OfflineChannelDef> = {
  signage: {
    key: "signage",
    tab: "signage",
    noun: "sign",
    addLabel: "Add signage",
    kinds: [
      { key: "banner", label: "Banner" },
      { key: "corflute", label: "Corflute" },
      { key: "fence", label: "Fence or perimeter board" },
      { key: "acm", label: "Fixed sign (ACM)" },
      { key: "pullup", label: "Pull-up banner" },
      { key: "flag", label: "Flag" },
      { key: "aframe", label: "A-frame" },
      { key: "vehicle", label: "Vehicle" },
      { key: "poster", label: "Poster" },
      { key: "other", label: "Other" },
    ],
    statuses: [
      { key: "planned", label: "Planned" },
      { key: "design", label: "Being designed" },
      { key: "printing", label: "Being printed" },
      { key: "up", label: "Up" },
      { key: "down", label: "Taken down" },
    ],
    liveStatuses: ["up"],
    labels: { title: "What it is", supplier: "Printed by", location: "Where it is", starts: "Went up", ends: "Comes down", link: "Artwork or photo link", audience: null, cost: "Cost" },
    fields: { size: true, quantity: true, dates: true, contact: false, brand: true },
    empty: "No signage listed yet. Add each banner, board or sign the club has put up or is having made.",
  },
  billboards: {
    key: "billboards",
    tab: "billboards",
    noun: "booking",
    addLabel: "Add booking",
    kinds: [
      { key: "digital", label: "Digital billboard" },
      { key: "static", label: "Static billboard" },
      { key: "bus", label: "Bus or transit" },
      { key: "street", label: "Street poster" },
      { key: "screen", label: "Screen network" },
      { key: "other", label: "Other" },
    ],
    statuses: [
      { key: "planned", label: "Planned" },
      { key: "booked", label: "Booked" },
      { key: "live", label: "Live" },
      { key: "finished", label: "Finished" },
    ],
    liveStatuses: ["live"],
    labels: { title: "Campaign", supplier: "Company", location: "Sites", starts: "Starts", ends: "Ends", link: "Artwork or report link", audience: "Audience they reported", cost: "Cost" },
    fields: { size: true, quantity: true, dates: true, contact: true, brand: true },
    empty: "No billboard bookings yet. Add each campaign booked with a billboard company, such as Go Media.",
  },
  "media-outlets": {
    key: "media-outlets",
    tab: "traditional-media",
    noun: "outlet",
    addLabel: "Add outlet",
    kinds: MEDIA_KINDS,
    statuses: [
      { key: "active", label: "We use them" },
      { key: "new", label: "Not approached yet" },
      { key: "paused", label: "Not at the moment" },
    ],
    liveStatuses: ["active"],
    labels: { title: "Outlet", supplier: "Programme or section", location: "Area it covers", starts: "", ends: "", link: "Website", audience: "Audience they quote", cost: null },
    fields: { size: false, quantity: false, dates: false, contact: true, brand: false },
    empty: "No outlets listed yet. Add each TV channel, radio station and news outlet the club can send stories or adverts to.",
  },
  "media-coverage": {
    key: "media-coverage",
    tab: "traditional-media",
    noun: "item",
    addLabel: "Add coverage or advert",
    kinds: MEDIA_KINDS,
    statuses: [
      { key: "idea", label: "Idea" },
      { key: "sent", label: "Sent to them" },
      { key: "booked", label: "Booked" },
      { key: "out", label: "Published or aired" },
      { key: "declined", label: "Not picked up" },
    ],
    liveStatuses: ["booked", "out"],
    labels: { title: "Story or advert", supplier: "Outlet", location: "Programme or section", starts: "Date", ends: "Runs until", link: "Link to it", audience: "Audience they reported", cost: "Cost (blank if free)" },
    fields: { size: false, quantity: false, dates: true, contact: false, brand: true },
    empty: "Nothing logged yet. Add each press release, interview, story or paid advert, with the outlet it went to.",
  },

  "flyers-print": {
    key: "flyers-print",
    endsMeansOver: false,
    tab: "flyers-print",
    noun: "print run",
    addLabel: "Add flyer or print run",
    kinds: [
      { key: "flyer", label: "Flyer" },
      { key: "schoolbag", label: "School-bag flyer" },
      { key: "letterbox", label: "Letterbox drop" },
      { key: "poster", label: "Poster" },
      { key: "brochure", label: "Brochure or booklet" },
      { key: "programme", label: "Matchday or event programme" },
      { key: "card", label: "Card or voucher" },
      { key: "sticker", label: "Sticker" },
      { key: "other", label: "Other" },
    ],
    statuses: [
      { key: "planned", label: "Planned" },
      { key: "design", label: "Being designed" },
      { key: "printing", label: "Being printed" },
      { key: "out", label: "Handed out" },
      { key: "finished", label: "Finished" },
    ],
    liveStatuses: ["out"],
    labels: { title: "What it is", supplier: "Printed by", location: "Where it went", starts: "Went out", ends: "Offer on it ends", link: "Artwork or QR link", audience: "People it reached", cost: "Cost", quantity: "How many printed" },
    fields: { size: true, quantity: true, dates: true, contact: false, brand: true },
    empty: "No flyers or print runs listed yet. Add each flyer, poster or letterbox drop: how many, where they went and what it cost.",
  },
  "events-activations": {
    key: "events-activations",
    tab: "events-activations",
    noun: "event",
    addLabel: "Add event",
    kinds: [
      { key: "school", label: "School or early learning visit" },
      { key: "open", label: "Open training or free session" },
      { key: "stall", label: "Stall or expo" },
      { key: "matchday", label: "Matchday activation" },
      { key: "community", label: "Community event" },
      { key: "sponsor", label: "Sponsor event" },
      { key: "tournament", label: "Tournament or festival" },
      { key: "other", label: "Other" },
    ],
    statuses: [
      { key: "idea", label: "Idea" },
      { key: "planned", label: "Planned" },
      { key: "done", label: "Done" },
      { key: "cancelled", label: "Did not happen" },
    ],
    liveStatuses: ["planned"],
    labels: { title: "Event", supplier: "Run by", location: "Where", starts: "Date", ends: "Until", link: "Link to photos or page", audience: "People we reached", cost: "Cost", quantity: "Sign-ups or leads from it" },
    fields: { size: false, quantity: true, dates: true, contact: true, brand: true },
    empty: "No events listed yet. Add each school visit, stall, open training or matchday activation, with what it cost and how many people it reached.",
  },
  "product-quality": {
    key: "product-quality",
    tab: "product-quality",
    noun: "improvement",
    addLabel: "Add improvement",
    kinds: [
      { key: "prizes", label: "Prizes and giveaways" },
      { key: "equipment", label: "Equipment" },
      { key: "coaching", label: "Coaches and coaching" },
      { key: "experience", label: "Special guest or experience" },
      { key: "kit", label: "Kit or merchandise included" },
      { key: "food", label: "Food and drink" },
      { key: "facility", label: "Venue and facilities" },
      { key: "comms", label: "Communication with families" },
      { key: "other", label: "Other" },
    ],
    statuses: [
      { key: "idea", label: "Idea" },
      { key: "planned", label: "Planned" },
      { key: "delivered", label: "Delivered" },
      { key: "dropped", label: "Not doing" },
    ],
    liveStatuses: ["delivered"],
    labels: { title: "What we are adding", supplier: "Programme it is for", location: "What it should change", starts: "From", ends: "Until", link: "Link", audience: "People who got it", cost: "Cost" },
    fields: { size: false, quantity: false, dates: true, contact: false, brand: true },
    empty: "Nothing listed yet. Add each thing the club spends on to make a programme better, such as camp prizes: what it cost and which programme it is for.",
  },
  listings: {
    key: "listings",
    tab: "listings",
    noun: "listing",
    addLabel: "Add listing",
    kinds: [
      { key: "directory", label: "Activity or holiday-programme directory" },
      { key: "events", label: "Event listing site" },
      { key: "council", label: "Council or community list" },
      { key: "school", label: "School list" },
      { key: "maps", label: "Maps and business profile" },
      { key: "sport", label: "Sports body" },
      { key: "other", label: "Other" },
    ],
    statuses: [
      { key: "live", label: "Listed" },
      { key: "update", label: "Needs updating" },
      { key: "todo", label: "Not listed yet" },
      { key: "expired", label: "Expired" },
    ],
    liveStatuses: ["live"],
    labels: { title: "Site", supplier: "Login held by", location: "What is listed", starts: "Last checked", ends: "Expires", link: "Link to the listing", audience: null, cost: "Cost (blank if free)" },
    fields: { size: false, quantity: false, dates: true, contact: false, brand: true },
    empty: "No listings yet. Add each outside site that lists the club or its programmes, and when it was last checked.",
  },
  "partners-ambassadors": {
    key: "partners-ambassadors",
    tab: "partners-ambassadors",
    noun: "partner",
    addLabel: "Add partner or ambassador",
    kinds: [
      { key: "school", label: "School or early learning centre" },
      { key: "sponsor", label: "Sponsor" },
      { key: "club", label: "Club or sports body" },
      { key: "ambassador", label: "Player or ambassador" },
      { key: "creator", label: "Creator or influencer" },
      { key: "affiliate", label: "Affiliate (earns on sales)" },
      { key: "community", label: "Community group" },
      { key: "other", label: "Other" },
    ],
    statuses: [
      { key: "active", label: "Promoting us" },
      { key: "talks", label: "In talks" },
      { key: "idea", label: "Idea" },
      { key: "ended", label: "Ended" },
    ],
    liveStatuses: ["active"],
    labels: { title: "Who", supplier: "What they do for us", location: "Where they promote us", starts: "Since", ends: "Until", link: "Link to their page or post", audience: "Their audience", cost: "What we pay or give" },
    fields: { size: false, quantity: false, dates: true, contact: true, brand: true },
    empty: "Nobody listed yet. Add each school, sponsor, player or creator who promotes the club, and what they get for it.",
  },
  "newsletter-placements": {
    key: "newsletter-placements",
    endsMeansOver: false,
    tab: "email-stats",
    noun: "placement",
    addLabel: "Add newsletter",
    kinds: [
      { key: "school", label: "School newsletter" },
      { key: "elc", label: "Early learning centre" },
      { key: "club", label: "Club or sports body" },
      { key: "sponsor", label: "Sponsor or business" },
      { key: "council", label: "Council or community" },
      { key: "media", label: "Media newsletter" },
      { key: "other", label: "Other" },
    ],
    statuses: [
      { key: "idea", label: "Idea" },
      { key: "asked", label: "Asked" },
      { key: "booked", label: "Booked" },
      { key: "sent", label: "Went out" },
      { key: "declined", label: "Said no" },
    ],
    liveStatuses: ["booked", "sent"],
    labels: { title: "What we are promoting", supplier: "Whose newsletter", location: "What we give in return", starts: "Goes out", ends: "Offer ends", link: "Link we gave them", audience: "People on their list", cost: "Cost (blank if free)" },
    fields: { size: false, quantity: false, dates: true, contact: true, brand: true },
    empty: "None listed yet. Add each school, club or business newsletter the club has asked to be in, with the size of their list.",
  },
  "review-profiles": {
    key: "review-profiles",
    endsMeansOver: false,
    tab: "search-reviews",
    noun: "review page",
    addLabel: "Add review page",
    kinds: [
      { key: "google", label: "Google" },
      { key: "facebook", label: "Facebook" },
      { key: "appstore", label: "App Store or Google Play" },
      { key: "other", label: "Other" },
    ],
    statuses: [
      { key: "claimed", label: "Ours and up to date" },
      { key: "update", label: "Needs updating" },
      { key: "unclaimed", label: "Not claimed yet" },
    ],
    liveStatuses: ["claimed"],
    labels: { title: "Page", supplier: "Login held by", location: "Address or venue", starts: "Last checked", ends: "", link: "Link to the reviews", audience: "Number of reviews", cost: null, size: "Star rating", sizeHint: "e.g. 4.8" },
    fields: { size: true, quantity: false, dates: true, contact: false, brand: true },
    empty: "No review pages listed yet. Add each place people can review the club, such as the Google listing for each venue, with its rating and number of reviews.",
  },
  "search-checks": {
    key: "search-checks",
    endsMeansOver: false,
    tab: "search-reviews",
    noun: "check",
    addLabel: "Add search check",
    kinds: [
      { key: "google", label: "Google" },
      { key: "maps", label: "Google Maps" },
      { key: "chatgpt", label: "ChatGPT" },
      { key: "claude", label: "Claude" },
      { key: "gemini", label: "Gemini" },
      { key: "perplexity", label: "Perplexity" },
      { key: "bing", label: "Bing or Copilot" },
      { key: "other", label: "Other" },
    ],
    statuses: [
      { key: "top", label: "We come up first" },
      { key: "shown", label: "We come up, lower down" },
      { key: "missing", label: "We do not come up" },
      { key: "wrong", label: "Wrong details shown" },
    ],
    liveStatuses: ["top", "shown"],
    labels: { title: "What someone would type or ask", supplier: "Who came up instead", location: "What it said about us", starts: "Checked on", ends: "", link: "Link or screenshot", audience: null, cost: null },
    fields: { size: false, quantity: false, dates: true, contact: false, brand: true },
    empty: "No checks logged yet. Type a question a parent would ask, such as \"holiday football camps Christchurch\", into Google or an AI assistant and log whether the club came up.",
  },
  "search-fixes": {
    key: "search-fixes",
    endsMeansOver: false,
    tab: "search-reviews",
    noun: "job",
    addLabel: "Add job",
    kinds: [
      { key: "profile", label: "Google business profile" },
      { key: "page", label: "Website page or wording" },
      { key: "faq", label: "Questions and answers page" },
      { key: "reviews", label: "Ask for reviews" },
      { key: "facts", label: "Facts for search engines and AI" },
      { key: "listing", label: "Outside listing or mention" },
      { key: "other", label: "Other" },
    ],
    statuses: [
      { key: "todo", label: "To do" },
      { key: "doing", label: "Being done" },
      { key: "done", label: "Done" },
    ],
    liveStatuses: ["doing"],
    labels: { title: "What needs doing", supplier: "Who is doing it", location: "Which site or page", starts: "Started", ends: "Due", link: "Link", audience: null, cost: "Cost" },
    fields: { size: false, quantity: false, dates: true, contact: false, brand: true },
    empty: "No jobs listed yet. Add each thing that would help the club come up in Google and in AI answers.",
  },
  "mobile-apps": {
    key: "mobile-apps",
    endsMeansOver: false,
    tab: "mobile-apps",
    noun: "app",
    addLabel: "Add app",
    kinds: [
      { key: "both", label: "iPhone and Android" },
      { key: "ios", label: "iPhone only" },
      { key: "android", label: "Android only" },
    ],
    statuses: [
      { key: "live", label: "In the stores" },
      { key: "review", label: "In review" },
      { key: "testing", label: "Testing only" },
      { key: "planned", label: "Planned" },
      { key: "retired", label: "Retired" },
    ],
    liveStatuses: ["live"],
    labels: { title: "App", supplier: "Who it is for", location: "What it does", starts: "Launched", ends: "Last update", link: "Store link", audience: "Downloads so far", cost: null, size: "Version", sizeHint: "e.g. 1.9.0", quantity: "Store reviews" },
    fields: { size: true, quantity: true, dates: true, contact: false, brand: true },
    empty: "No apps listed yet. Add each club app with its store link, and type in the downloads from the App Store and Google Play.",
  },
};

export const OFFLINE_TABS = Array.from(new Set(Object.values(OFFLINE_CHANNELS).map((c) => c.tab)));

export function offlineChannel(key: unknown): OfflineChannelDef | null {
  return typeof key === "string" && key in OFFLINE_CHANNELS ? OFFLINE_CHANNELS[key as OfflineChannelKey] : null;
}

export type OfflineItem = {
  id: number;
  channel: OfflineChannelKey;
  brand: string | null;
  title: string;
  kind: string | null;
  supplier: string | null;
  location: string | null;
  size: string | null;
  quantity: number | null;
  status: string | null;
  startsOn: string | null;
  endsOn: string | null;
  costCents: number | null;
  audience: number | null;
  linkUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  updatedAt: string;
  updatedByName: string | null;
  archived: boolean;
};

export type OfflineListResponse = { today: string; items: OfflineItem[] };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

export type OfflineInput = Omit<OfflineItem, "id" | "channel" | "updatedAt" | "updatedByName" | "archived">;

/** Check one row before it is saved. The same rules run on the server and in the form. */
export function parseOfflineInput(def: OfflineChannelDef, body: any): { value: OfflineInput } | { error: string } {
  const title = text(body?.title, 200);
  if (!title) return { error: `Give the ${def.noun} a name.` };
  const kind = text(body?.kind, 40);
  if (kind && !def.kinds.some((k) => k.key === kind)) return { error: "Pick a type from the list." };
  const status = text(body?.status, 40);
  if (status && !def.statuses.some((s) => s.key === status)) return { error: "Pick a status from the list." };
  const brand = def.fields.brand ? text(body?.brand, 40) : null;
  if (brand && !socialBrand(brand)) return { error: "Pick a brand from the list." };
  const startsOn = def.fields.dates ? text(body?.startsOn, 10) : null;
  const endsOn = def.fields.dates ? text(body?.endsOn, 10) : null;
  if ((startsOn && !ISO_DAY.test(startsOn)) || (endsOn && !ISO_DAY.test(endsOn))) return { error: "That date is not a real date." };
  if (startsOn && endsOn && endsOn < startsOn) return { error: "The end date is before the start date." };
  const whole = (v: unknown, what: string): number | null | { error: string } => {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 2_000_000_000) return { error: `${what} must be a whole number.` };
    return n;
  };
  const quantity = def.fields.quantity ? whole(body?.quantity, "How many") : null;
  if (quantity && typeof quantity === "object") return quantity;
  const audience = def.labels.audience ? whole(body?.audience, "Audience") : null;
  if (audience && typeof audience === "object") return audience;
  const costCents = def.labels.cost ? whole(body?.costCents, "Cost") : null;
  if (costCents && typeof costCents === "object") return costCents;
  const linkUrl = text(body?.linkUrl, 500);
  if (linkUrl && !/^https?:\/\/[^\s]+$/i.test(linkUrl)) return { error: "A link must start with https://" };
  const contactEmail = def.fields.contact ? text(body?.contactEmail, 200) : null;
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return { error: "That email address does not look right." };
  return {
    value: {
      brand,
      title,
      kind,
      supplier: text(body?.supplier, 200),
      location: text(body?.location, 300),
      size: def.fields.size ? text(body?.size, 100) : null,
      quantity: quantity as number | null,
      status,
      startsOn,
      endsOn,
      costCents: costCents as number | null,
      audience: audience as number | null,
      linkUrl,
      contactName: def.fields.contact ? text(body?.contactName, 200) : null,
      contactEmail,
      contactPhone: def.fields.contact ? text(body?.contactPhone, 60) : null,
      notes: text(body?.notes, 4000),
    },
  };
}

/**
 * What the dates say about a row that is marked as running. Worked out, never
 * stored: "ends in 6 days", "ended 3 days ago, still marked as up".
 */
export function offlineTiming(def: OfflineChannelDef, item: Pick<OfflineItem, "status" | "startsOn" | "endsOn">, today: string): { tone: "ok" | "soon" | "late"; text: string } | null {
  if (!item.endsOn || !item.status || !def.liveStatuses.includes(item.status) || !def.fields.dates || def.endsMeansOver === false) return null;
  const days = Math.round((Date.parse(`${item.endsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return { tone: "late", text: `Ended ${-days} day${days === -1 ? "" : "s"} ago, still marked as running` };
  if (days === 0) return { tone: "soon", text: "Ends today" };
  if (days <= 14) return { tone: "soon", text: `Ends in ${days} day${days === 1 ? "" : "s"}` };
  return null;
}

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
export type OfflineChannelKey = "signage" | "billboards" | "media-outlets" | "media-coverage";

export type OfflineChannelDef = {
  key: OfflineChannelKey;
  /** The tab that grants it. Traditional Media holds two lists under one tab. */
  tab: "signage" | "billboards" | "traditional-media";
  /** One of them, in words: "sign", "booking". */
  noun: string;
  addLabel: string;
  kinds: OfflineOption[];
  statuses: OfflineOption[];
  /** Statuses that mean "happening now". */
  liveStatuses: string[];
  labels: { title: string; supplier: string; location: string; starts: string; ends: string; link: string; audience: string | null; cost: string | null };
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
};

export const OFFLINE_TABS = ["signage", "billboards", "traditional-media"] as const;

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
  if (!item.endsOn || !item.status || !def.liveStatuses.includes(item.status) || !def.fields.dates) return null;
  const days = Math.round((Date.parse(`${item.endsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return { tone: "late", text: `Ended ${-days} day${days === -1 ? "" : "s"} ago, still marked as running` };
  if (days === 0) return { tone: "soon", text: "Ends today" };
  if (days <= 14) return { tone: "soon", text: `Ends in ${days} day${days === 1 ? "" : "s"}` };
  return null;
}

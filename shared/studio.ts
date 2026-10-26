/**
 * Content Studio — the PURE rules. What a piece is, what the model may
 * return, how it is checked, and how a person edits its words without
 * re-prompting. No database, no network: the browser and the server both
 * import this file.
 *
 * Daniel, 2026-10-27: "Our staff can create really nice graphics … one-shot
 * landing pages … one-shot graphics … videos from phone clips … it all comes
 * out on our domains … nobody deleting or overriding other people's content …
 * the person can edit the text themselves easily, especially for small
 * changes, rather than re-prompting and waiting."
 *
 * Three kinds of piece:
 *   graphic — a social-size picture drawn from an HTML artboard (no image
 *             model): a layout + words + at most one real photograph from the
 *             club's own libraries. Rendered to PNG in the browser.
 *   page    — a landing page: a list of blocks, published on the brand's own
 *             host (join.cufc.co.nz/p/<slug>). Rendered to HTML on the server.
 *   video   — a REQUEST: brief + footage links, cut from real footage by the
 *             editing kit and delivered back. Nothing is generated.
 *
 * The model returns a DOCUMENT (JSON), never HTML. The renderer owns the look,
 * so every piece is on brand by construction and every word is a field a
 * person can edit in place.
 */

import { WORKSPACE_DOMAINS } from "./org-domains";

export type StudioKind = "graphic" | "page" | "video";
export const STUDIO_KINDS: readonly StudioKind[] = ["graphic", "page", "video"];

export const STUDIO_DEFAULT_MODEL = "claude-opus-5-5";
export const STUDIO_DEFAULT_EDIT_MODEL = "claude-sonnet-5-5";
export const STUDIO_BRIEF_MAX = 4000;
export const STUDIO_TITLE_MAX = 120;

// ── Brands ──────────────────────────────────────────────────────────────────

export interface StudioBrand {
  key: string;
  name: string;
  orgSlug: string;
  /** The public host a page is served on; the app host when the brand has none. */
  host: string;
}

/** Brand keys match grapes/templates/brand-kit.ts (BRAND_KITS). */
export const STUDIO_BRANDS: readonly StudioBrand[] = [
  { key: "cufc", name: "Christchurch United", orgSlug: "christchurch-united", host: "join.cufc.co.nz" },
  { key: "siu", name: "South Island United", orgSlug: "south-island-united", host: "join.southislandunited.com" },
  { key: "mfl", name: "Mini Football Leagues", orgSlug: "mini-football-leagues", host: "join.minifootball.co.nz" },
  { key: "cic", name: "Christchurch International Cup", orgSlug: "christchurch-international-cup", host: "join.cicyouth.com" },
  { key: "cugc", name: "United Gymnastics", orgSlug: "united-gymnastics", host: "join.cugc.co.nz" },
  { key: "usc", name: "United Sports Centre", orgSlug: "united-sports-centre", host: "book.unitedsportscentre.com" },
  { key: "usg", name: "United Sports Group", orgSlug: "united-sports-group", host: "app.usg.co.nz" },
  { key: "prints", name: "United Prints", orgSlug: "united-prints", host: "join.unitedprints.co.nz" },
];

export function studioBrand(key: string | null | undefined): StudioBrand | undefined {
  return STUDIO_BRANDS.find((b) => b.key === String(key || "").toLowerCase());
}
export function studioBrandForOrgSlug(slug: string | null | undefined): StudioBrand | undefined {
  return STUDIO_BRANDS.find((b) => b.orgSlug === slug);
}
/** The brand a public host serves pages for (the join hosts of org-domains.ts). */
export function studioBrandForHost(host: string | null | undefined): StudioBrand | undefined {
  const h = String(host || "").toLowerCase().split(":")[0];
  if (!h) return undefined;
  const w = WORKSPACE_DOMAINS.find((d) => d.joinHost && d.joinHost.toLowerCase() === h);
  return w ? studioBrandForOrgSlug(w.slug) : undefined;
}
/** Where a published page lives. */
export function studioPageUrl(brandKey: string, slug: string): string {
  const b = studioBrand(brandKey);
  if (!b || b.host === "app.usg.co.nz") return `https://app.usg.co.nz/p/${slug}?b=${encodeURIComponent(brandKey)}`;
  return `https://${b.host}/p/${slug}`;
}

// ── Slugs ───────────────────────────────────────────────────────────────────

export const STUDIO_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/;
export function studioSlug(title: string): string {
  const s = String(title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return STUDIO_SLUG_RE.test(s) ? s : s.length === 1 ? `${s}-page` : "page";
}
/** Slugs that would collide with a real route on the join hosts. */
export const STUDIO_RESERVED_SLUGS = new Set(["api", "admin", "p", "academy", "book", "enter", "team", "pay", "fill-in", "captain", "events", "account", "login", "print", "shop", "r", "s", "e", "mailer", "objects", "assets", "t", "u"]);

// ── Graphics ────────────────────────────────────────────────────────────────

export interface GraphicSize {
  key: string;
  label: string;
  width: number;
  height: number;
  use: string;
}
export const GRAPHIC_SIZES: readonly GraphicSize[] = [
  { key: "square", label: "Square", width: 1080, height: 1080, use: "Instagram or Facebook post, WhatsApp" },
  { key: "portrait", label: "Portrait", width: 1080, height: 1350, use: "Instagram feed (4:5)" },
  { key: "story", label: "Story", width: 1080, height: 1920, use: "Stories, Reels cover, WhatsApp status" },
  { key: "landscape", label: "Landscape", width: 1920, height: 1080, use: "Facebook, a screen, an email header" },
];
export const GRAPHIC_SIZE_DEFAULT = "square";
export function graphicSize(key: string | null | undefined): GraphicSize {
  return GRAPHIC_SIZES.find((s) => s.key === key) ?? GRAPHIC_SIZES[0];
}

export type GraphicLayout = "announcement" | "photo" | "stat" | "list" | "chart" | "event" | "quote";
export const GRAPHIC_LAYOUTS: readonly { key: GraphicLayout; label: string; when: string }[] = [
  { key: "announcement", label: "Announcement", when: "a headline, a line under it, the crest; news, a reminder, a thank-you" },
  { key: "photo", label: "Photo + headline", when: "a photograph fills the frame with the headline over it; the hero moment" },
  { key: "event", label: "Event", when: "a date, a time, a venue, a price — camps, trials, open days, matches" },
  { key: "list", label: "List", when: "three to five short points — what's included, what to bring, the schedule" },
  { key: "stat", label: "Big number", when: "one figure and what it means — 162 players, 23% crossover, $37k" },
  { key: "chart", label: "Chart", when: "two to eight numbers compared as bars — a visual of lifetime value, sign-ups by term" },
  { key: "quote", label: "Quote", when: "a parent's or player's words, with who said it" },
];

export interface GraphicDoc {
  layout: GraphicLayout;
  /** Small label on top: "HOLIDAY CAMPS · OCTOBER". */
  eyebrow?: string;
  /** ≤ 60 characters. The thing the eye lands on. */
  headline: string;
  /** ≤ 140 characters. One line under it. */
  sub?: string;
  /** List layout: 3–5 short points. */
  items?: string[];
  /** A photograph from the club's own libraries (the renderer only draws allowed URLs). */
  photo?: string | null;
  stat?: { value: string; label: string };
  quote?: { text: string; by: string };
  event?: { date: string; time?: string; venue?: string; price?: string };
  chart?: { title?: string; unit?: string; items: { label: string; value: number }[] };
  /** A short pointer, never a link: "cufc.co.nz/camps" or "Book at the office". */
  cta?: string;
  /** Dark = the brand's own ground; light = white with brand accents. */
  theme?: "dark" | "light";
}

// ── Pages ───────────────────────────────────────────────────────────────────

export type PageBlock =
  | { type: "hero"; eyebrow?: string; headline: string; sub?: string; photo?: string | null; cta?: { label: string; href: string } | null }
  | { type: "text"; heading?: string; body: string }
  | { type: "bullets"; heading?: string; items: string[] }
  | { type: "cards"; heading?: string; items: { title: string; body: string; photo?: string | null }[] }
  | { type: "stats"; items: { value: string; label: string }[] }
  | { type: "photo"; src: string; alt?: string; caption?: string }
  | { type: "faq"; heading?: string; items: { q: string; a: string }[] }
  | { type: "cta"; headline: string; sub?: string; button: { label: string; href: string } };

export interface PageDoc {
  title: string;
  /** For search engines and the share card. ≤ 160 characters. */
  description?: string;
  blocks: PageBlock[];
}

// ── Video requests ──────────────────────────────────────────────────────────

export type VideoStatus = "requested" | "in_progress" | "delivered";
export interface VideoDoc {
  brief: string;
  /** Links to the footage — a Club Drive folder, a NAS path, a Google Drive link. */
  footage: string[];
  format: "landscape" | "vertical" | "both";
  lengthSeconds: number;
  status: VideoStatus;
  deliveredUrl?: string | null;
  notes?: string | null;
}

// ── Pictures ────────────────────────────────────────────────────────────────

/** A picture the renderer will draw: the club's own hosts only. */
export function isAllowedPicture(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = String(url).trim();
  if (!/^https:\/\//i.test(u)) return false;
  try {
    const p = new URL(u);
    if (p.hostname !== "app.usg.co.nz") return false;
    return /^\/mailer\/(img|crests|cufc|siu|mfl|cic|cugc|usc|usg|prints|icons)\//.test(p.pathname) || /^\/studio\/r\//.test(p.pathname);
  } catch {
    return false;
  }
}

export function isAllowedHref(href: string | null | undefined): boolean {
  if (!href) return false;
  const h = String(href).trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(h) && !/\s/.test(h) && h.length <= 500;
}

// ── Checking what the model (or a person) hands back ────────────────────────

export interface Checked<T> {
  ok: boolean;
  doc: T;
  problems: string[];
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const clean = (v: unknown, max: number): string | undefined => {
  const s = str(v, max);
  return s ? s : undefined;
};

export function checkGraphicDoc(raw: unknown, pictureOk: (url: string) => boolean = isAllowedPicture): Checked<GraphicDoc> {
  const problems: string[] = [];
  const r = (raw && typeof raw === "object" ? raw : {}) as any;
  const layout = GRAPHIC_LAYOUTS.some((l) => l.key === r.layout) ? (r.layout as GraphicLayout) : "announcement";
  if (!GRAPHIC_LAYOUTS.some((l) => l.key === r.layout)) problems.push(`layout must be one of ${GRAPHIC_LAYOUTS.map((l) => l.key).join(", ")}`);
  const headline = str(r.headline, 90);
  if (!headline) problems.push("headline is required");
  if (headline.length > 60) problems.push("headline is over 60 characters — it will not fit at the size it is drawn");
  const doc: GraphicDoc = {
    layout,
    eyebrow: clean(r.eyebrow, 40),
    headline,
    sub: clean(r.sub, 160),
    cta: clean(r.cta, 60),
    theme: r.theme === "light" ? "light" : "dark",
  };
  if (doc.sub && doc.sub.length > 140) problems.push("sub is over 140 characters");
  if (r.photo != null && r.photo !== "") {
    const p = str(r.photo, 500);
    if (pictureOk(p)) doc.photo = p;
    else problems.push(`photo "${p.slice(0, 80)}" is not one of the club's pictures — use a URL from the picture list, or none`);
  }
  if (Array.isArray(r.items)) {
    const items = r.items.map((i: unknown) => str(i, 80)).filter(Boolean).slice(0, 6);
    if (items.length) doc.items = items;
    if (layout === "list" && (items.length < 2 || items.length > 5)) problems.push("a list has 2 to 5 items");
  } else if (layout === "list") problems.push("a list layout needs items");
  if (r.stat && typeof r.stat === "object") doc.stat = { value: str(r.stat.value, 16), label: str(r.stat.label, 80) };
  if (layout === "stat" && (!doc.stat?.value || !doc.stat?.label)) problems.push("a stat layout needs stat.value and stat.label");
  if (r.quote && typeof r.quote === "object") doc.quote = { text: str(r.quote.text, 220), by: str(r.quote.by, 60) };
  if (layout === "quote" && !doc.quote?.text) problems.push("a quote layout needs quote.text");
  if (r.event && typeof r.event === "object") doc.event = { date: str(r.event.date, 40), time: clean(r.event.time, 40), venue: clean(r.event.venue, 80), price: clean(r.event.price, 40) };
  if (layout === "event" && !doc.event?.date) problems.push("an event layout needs event.date");
  if (r.chart && typeof r.chart === "object" && Array.isArray(r.chart.items)) {
    const items = r.chart.items
      .map((i: any) => ({ label: str(i?.label, 40), value: Number(i?.value) }))
      .filter((i: any) => i.label && Number.isFinite(i.value) && i.value >= 0)
      .slice(0, 8);
    doc.chart = { title: clean(r.chart.title, 60), unit: clean(r.chart.unit, 12), items };
  }
  if (layout === "chart" && (!doc.chart || doc.chart.items.length < 2)) problems.push("a chart layout needs chart.items — two to eight {label, value} pairs with numeric values");
  if (layout === "photo" && !doc.photo) problems.push("a photo layout needs a photo from the picture list");
  return { ok: problems.length === 0, doc, problems };
}

export const PAGE_BLOCK_TYPES = ["hero", "text", "bullets", "cards", "stats", "photo", "faq", "cta"] as const;
export const PAGE_MAX_BLOCKS = 12;

export function checkPageDoc(raw: unknown, pictureOk: (url: string) => boolean = isAllowedPicture): Checked<PageDoc> {
  const problems: string[] = [];
  const r = (raw && typeof raw === "object" ? raw : {}) as any;
  const title = str(r.title, STUDIO_TITLE_MAX);
  if (!title) problems.push("title is required");
  const description = clean(r.description, 160);
  const blocksIn: any[] = Array.isArray(r.blocks) ? r.blocks : [];
  if (blocksIn.length === 0) problems.push("blocks is empty — a page needs at least a hero and one more block");
  if (blocksIn.length > PAGE_MAX_BLOCKS) problems.push(`a page has at most ${PAGE_MAX_BLOCKS} blocks`);
  const blocks: PageBlock[] = [];
  const pic = (v: unknown, where: string): string | null => {
    if (v == null || v === "") return null;
    const p = str(v, 500);
    if (pictureOk(p)) return p;
    problems.push(`${where}: "${p.slice(0, 80)}" is not one of the club's pictures — use a URL from the picture list, or none`);
    return null;
  };
  const link = (v: any, where: string): { label: string; href: string } | null => {
    if (!v || typeof v !== "object") return null;
    const label = str(v.label, 40), href = str(v.href, 500);
    if (!label || !href) return null;
    if (!isAllowedHref(href)) { problems.push(`${where}: link "${href.slice(0, 80)}" must be a full https://, mailto: or tel: address`); return null; }
    return { label, href };
  };
  blocksIn.slice(0, PAGE_MAX_BLOCKS).forEach((b, i) => {
    const where = `block ${i + 1}`;
    const t = String(b?.type ?? "");
    switch (t) {
      case "hero": {
        const headline = str(b.headline, 90);
        if (!headline) problems.push(`${where} (hero): headline is required`);
        blocks.push({ type: "hero", eyebrow: clean(b.eyebrow, 40), headline, sub: clean(b.sub, 220), photo: pic(b.photo, where), cta: link(b.cta, where) });
        break;
      }
      case "text": {
        const body = str(b.body, 4000);
        if (!body) problems.push(`${where} (text): body is required`);
        blocks.push({ type: "text", heading: clean(b.heading, 80), body });
        break;
      }
      case "bullets": {
        const items = (Array.isArray(b.items) ? b.items : []).map((x: unknown) => str(x, 160)).filter(Boolean).slice(0, 8);
        if (items.length < 2) problems.push(`${where} (bullets): needs 2 to 8 items`);
        blocks.push({ type: "bullets", heading: clean(b.heading, 80), items });
        break;
      }
      case "cards": {
        const items = (Array.isArray(b.items) ? b.items : []).map((c: any) => ({ title: str(c?.title, 60), body: str(c?.body, 300), photo: pic(c?.photo, where) })).filter((c: any) => c.title).slice(0, 6);
        if (items.length < 2) problems.push(`${where} (cards): needs 2 to 6 cards with a title`);
        blocks.push({ type: "cards", heading: clean(b.heading, 80), items });
        break;
      }
      case "stats": {
        const items = (Array.isArray(b.items) ? b.items : []).map((s: any) => ({ value: str(s?.value, 16), label: str(s?.label, 60) })).filter((s: any) => s.value && s.label).slice(0, 4);
        if (items.length < 2) problems.push(`${where} (stats): needs 2 to 4 {value, label}`);
        blocks.push({ type: "stats", items });
        break;
      }
      case "photo": {
        const src = pic(b.src, where);
        if (!src) problems.push(`${where} (photo): needs src from the picture list`);
        blocks.push({ type: "photo", src: src ?? "", alt: clean(b.alt, 120), caption: clean(b.caption, 160) });
        break;
      }
      case "faq": {
        const items = (Array.isArray(b.items) ? b.items : []).map((q: any) => ({ q: str(q?.q, 160), a: str(q?.a, 800) })).filter((q: any) => q.q && q.a).slice(0, 8);
        if (items.length < 1) problems.push(`${where} (faq): needs at least one {q, a}`);
        blocks.push({ type: "faq", heading: clean(b.heading, 80), items });
        break;
      }
      case "cta": {
        const headline = str(b.headline, 90);
        const button = link(b.button, where);
        if (!headline) problems.push(`${where} (cta): headline is required`);
        if (!button) problems.push(`${where} (cta): button {label, href} is required`);
        blocks.push({ type: "cta", headline, sub: clean(b.sub, 220), button: button ?? { label: "Find out more", href: "https://cufc.co.nz" } });
        break;
      }
      default:
        problems.push(`${where}: unknown block type "${t}" — use ${PAGE_BLOCK_TYPES.join(", ")}`);
    }
  });
  if (blocks.length && blocks[0].type !== "hero") problems.push("the first block must be a hero");
  return { ok: problems.length === 0, doc: { title, description, blocks }, problems };
}

export function checkVideoDoc(raw: unknown): Checked<VideoDoc> {
  const problems: string[] = [];
  const r = (raw && typeof raw === "object" ? raw : {}) as any;
  const brief = str(r.brief, STUDIO_BRIEF_MAX);
  if (!brief) problems.push("say what the video is for and what it should show");
  const footage = (Array.isArray(r.footage) ? r.footage : []).map((f: unknown) => str(f, 500)).filter(Boolean).slice(0, 20);
  const format = r.format === "vertical" || r.format === "both" ? r.format : "landscape";
  const lengthSeconds = Math.min(600, Math.max(10, Math.round(Number(r.lengthSeconds) || 60)));
  const status: VideoStatus = r.status === "in_progress" || r.status === "delivered" ? r.status : "requested";
  const deliveredUrl = clean(r.deliveredUrl, 500) ?? null;
  if (deliveredUrl && !isAllowedHref(deliveredUrl)) problems.push("the delivered link must be a full https:// address");
  return { ok: problems.length === 0, doc: { brief, footage, format, lengthSeconds, status, deliveredUrl, notes: clean(r.notes, 2000) ?? null }, problems };
}

// ── The words, as fields a person edits in place ────────────────────────────

export interface TextField {
  /** Dotted path into the doc: "headline", "items.2", "blocks.3.items.1.q". */
  path: string;
  label: string;
  value: string;
  multiline?: boolean;
  /** A link's address rather than words. */
  href?: boolean;
}

function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj: any, path: string, value: unknown): void {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (o[k] == null || typeof o[k] !== "object") o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

export function graphicFields(doc: GraphicDoc): TextField[] {
  const f: TextField[] = [];
  f.push({ path: "eyebrow", label: "Small label on top", value: doc.eyebrow ?? "" });
  f.push({ path: "headline", label: "Headline", value: doc.headline ?? "" });
  f.push({ path: "sub", label: "Line under it", value: doc.sub ?? "", multiline: true });
  (doc.items ?? []).forEach((it, i) => f.push({ path: `items.${i}`, label: `Point ${i + 1}`, value: it }));
  if (doc.stat) { f.push({ path: "stat.value", label: "The number", value: doc.stat.value }); f.push({ path: "stat.label", label: "What it means", value: doc.stat.label }); }
  if (doc.quote) { f.push({ path: "quote.text", label: "Quote", value: doc.quote.text, multiline: true }); f.push({ path: "quote.by", label: "Who said it", value: doc.quote.by }); }
  if (doc.event) {
    f.push({ path: "event.date", label: "Date", value: doc.event.date });
    f.push({ path: "event.time", label: "Time", value: doc.event.time ?? "" });
    f.push({ path: "event.venue", label: "Venue", value: doc.event.venue ?? "" });
    f.push({ path: "event.price", label: "Price", value: doc.event.price ?? "" });
  }
  if (doc.chart) {
    f.push({ path: "chart.title", label: "Chart title", value: doc.chart.title ?? "" });
    f.push({ path: "chart.unit", label: "Unit ($, %, players)", value: doc.chart.unit ?? "" });
    doc.chart.items.forEach((it, i) => {
      f.push({ path: `chart.items.${i}.label`, label: `Bar ${i + 1} label`, value: it.label });
      f.push({ path: `chart.items.${i}.value`, label: `Bar ${i + 1} value`, value: String(it.value) });
    });
  }
  f.push({ path: "cta", label: "Pointer at the bottom (a web address or 'book at the office')", value: doc.cta ?? "" });
  return f;
}

export function pageFields(doc: PageDoc): TextField[] {
  const f: TextField[] = [];
  f.push({ path: "title", label: "Page title (the browser tab and the share card)", value: doc.title });
  f.push({ path: "description", label: "One-line description (search engines, the share card)", value: doc.description ?? "", multiline: true });
  doc.blocks.forEach((b, i) => {
    const p = `blocks.${i}`;
    const n = i + 1;
    switch (b.type) {
      case "hero":
        f.push({ path: `${p}.eyebrow`, label: `${n}. Hero — small label`, value: b.eyebrow ?? "" });
        f.push({ path: `${p}.headline`, label: `${n}. Hero — headline`, value: b.headline });
        f.push({ path: `${p}.sub`, label: `${n}. Hero — line under it`, value: b.sub ?? "", multiline: true });
        if (b.cta) { f.push({ path: `${p}.cta.label`, label: `${n}. Hero — button words`, value: b.cta.label }); f.push({ path: `${p}.cta.href`, label: `${n}. Hero — button goes to`, value: b.cta.href, href: true }); }
        break;
      case "text":
        f.push({ path: `${p}.heading`, label: `${n}. Heading`, value: b.heading ?? "" });
        f.push({ path: `${p}.body`, label: `${n}. Text (blank line between paragraphs, **bold**)`, value: b.body, multiline: true });
        break;
      case "bullets":
        f.push({ path: `${p}.heading`, label: `${n}. Heading`, value: b.heading ?? "" });
        b.items.forEach((it, j) => f.push({ path: `${p}.items.${j}`, label: `${n}. Point ${j + 1}`, value: it }));
        break;
      case "cards":
        f.push({ path: `${p}.heading`, label: `${n}. Heading`, value: b.heading ?? "" });
        b.items.forEach((c, j) => { f.push({ path: `${p}.items.${j}.title`, label: `${n}. Card ${j + 1} title`, value: c.title }); f.push({ path: `${p}.items.${j}.body`, label: `${n}. Card ${j + 1} text`, value: c.body, multiline: true }); });
        break;
      case "stats":
        b.items.forEach((s, j) => { f.push({ path: `${p}.items.${j}.value`, label: `${n}. Number ${j + 1}`, value: s.value }); f.push({ path: `${p}.items.${j}.label`, label: `${n}. Number ${j + 1} means`, value: s.label }); });
        break;
      case "photo":
        f.push({ path: `${p}.caption`, label: `${n}. Photo caption`, value: b.caption ?? "" });
        break;
      case "faq":
        f.push({ path: `${p}.heading`, label: `${n}. Heading`, value: b.heading ?? "" });
        b.items.forEach((q, j) => { f.push({ path: `${p}.items.${j}.q`, label: `${n}. Question ${j + 1}`, value: q.q }); f.push({ path: `${p}.items.${j}.a`, label: `${n}. Answer ${j + 1}`, value: q.a, multiline: true }); });
        break;
      case "cta":
        f.push({ path: `${p}.headline`, label: `${n}. Call to action — headline`, value: b.headline });
        f.push({ path: `${p}.sub`, label: `${n}. Call to action — line under it`, value: b.sub ?? "", multiline: true });
        f.push({ path: `${p}.button.label`, label: `${n}. Button words`, value: b.button.label });
        f.push({ path: `${p}.button.href`, label: `${n}. Button goes to`, value: b.button.href, href: true });
        break;
    }
  });
  return f;
}

/** A person's edit: one field, by path. Numbers on a chart stay numbers. The
 *  result is re-checked by the same rules as the model's answer. */
export function applyField<T extends object>(doc: T, path: string, value: string): T {
  const next = JSON.parse(JSON.stringify(doc));
  const isNumber = /^chart\.items\.\d+\.value$/.test(path);
  setPath(next, path, isNumber ? Number(String(value).replace(/[^0-9.-]/g, "")) || 0 : value);
  return next;
}
export function readField(doc: object, path: string): string {
  const v = getPath(doc, path);
  return v == null ? "" : String(v);
}

// ── What the model is asked for (JSON schemas, enforced by the API) ─────────

export const GRAPHIC_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    reply: { type: "string", description: "One or two short sentences in plain NZ English: what you made and why that layout, or the ONE question you need answered." },
    title: { type: "string", description: "A short working name for the piece, e.g. 'October camp — last spots'." },
    graphic: {
      type: "object",
      properties: {
        layout: { type: "string", enum: GRAPHIC_LAYOUTS.map((l) => l.key) },
        eyebrow: { type: ["string", "null"] },
        headline: { type: "string", description: "At most 60 characters. Specific. No exclamation marks." },
        sub: { type: ["string", "null"], description: "At most 140 characters." },
        items: { type: ["array", "null"], items: { type: "string" }, description: "list layout only: 3–5 short points." },
        photo: { type: ["string", "null"], description: "A URL from the picture list, or null." },
        stat: { type: ["object", "null"], properties: { value: { type: "string" }, label: { type: "string" } }, required: ["value", "label"], additionalProperties: false },
        quote: { type: ["object", "null"], properties: { text: { type: "string" }, by: { type: "string" } }, required: ["text", "by"], additionalProperties: false },
        event: { type: ["object", "null"], properties: { date: { type: "string" }, time: { type: ["string", "null"] }, venue: { type: ["string", "null"] }, price: { type: ["string", "null"] } }, required: ["date", "time", "venue", "price"], additionalProperties: false },
        chart: { type: ["object", "null"], properties: { title: { type: ["string", "null"] }, unit: { type: ["string", "null"] }, items: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "number" } }, required: ["label", "value"], additionalProperties: false } } }, required: ["title", "unit", "items"], additionalProperties: false },
        cta: { type: ["string", "null"], description: "A short pointer, never a clickable link: 'cufc.co.nz/camps' or 'Book at the office'." },
        theme: { type: "string", enum: ["dark", "light"] },
      },
      required: ["layout", "eyebrow", "headline", "sub", "items", "photo", "stat", "quote", "event", "chart", "cta", "theme"],
      additionalProperties: false,
    },
  },
  required: ["reply", "title", "graphic"],
  additionalProperties: false,
};

export const PAGE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    reply: { type: "string", description: "One or two short sentences in plain NZ English: what you built, or the ONE question you need answered." },
    page: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: ["string", "null"], description: "At most 160 characters." },
        blocks: {
          type: "array",
          description: "The first block is a hero. 4 to 9 blocks is a good page.",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: [...PAGE_BLOCK_TYPES] },
              eyebrow: { type: ["string", "null"] },
              headline: { type: ["string", "null"] },
              heading: { type: ["string", "null"] },
              sub: { type: ["string", "null"] },
              body: { type: ["string", "null"], description: "text block: paragraphs separated by a blank line; **bold** allowed." },
              photo: { type: ["string", "null"], description: "hero / card: a URL from the picture list, or null." },
              src: { type: ["string", "null"], description: "photo block: a URL from the picture list." },
              alt: { type: ["string", "null"] },
              caption: { type: ["string", "null"] },
              cta: { type: ["object", "null"], properties: { label: { type: "string" }, href: { type: "string" } }, required: ["label", "href"], additionalProperties: false },
              button: { type: ["object", "null"], properties: { label: { type: "string" }, href: { type: "string" } }, required: ["label", "href"], additionalProperties: false },
              items: {
                type: ["array", "null"],
                description: "bullets: strings · cards: {title, body, photo} · stats: {value, label} · faq: {q, a}",
                items: {
                  anyOf: [
                    { type: "string" },
                    { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, photo: { type: ["string", "null"] } }, required: ["title", "body", "photo"], additionalProperties: false },
                    { type: "object", properties: { value: { type: "string" }, label: { type: "string" } }, required: ["value", "label"], additionalProperties: false },
                    { type: "object", properties: { q: { type: "string" }, a: { type: "string" } }, required: ["q", "a"], additionalProperties: false },
                  ],
                },
              },
            },
            required: ["type", "eyebrow", "headline", "heading", "sub", "body", "photo", "src", "alt", "caption", "cta", "button", "items"],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "description", "blocks"],
      additionalProperties: false,
    },
  },
  required: ["reply", "page"],
  additionalProperties: false,
};

// ── Words ───────────────────────────────────────────────────────────────────

export function studioKindLabel(kind: StudioKind): string {
  return kind === "graphic" ? "Graphic" : kind === "page" ? "Landing page" : "Video";
}

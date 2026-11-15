// ─────────────────────────────────────────────────────────────────────────────
// ClubOS Websites — the rules, in one place (pure, both ends).
//
// Daniel, 2026-11-01: "give my people the keys, but be able to have the super
// admin control … revert it to what it was … when I'm sick, the marketing team
// can still do it, or Travis."
//
// Three deciders live here and nowhere else:
//   1. siteBrandFilter()  — which SITES a workspace's Website tab shows
//                            (the Hiring pattern: brand workspaces never widen,
//                            the group workspace shows every site, anything
//                            else shows nothing).
//   2. siteCan()          — what a PERSON may do on ONE site. Only a super admin
//                            or a site_members grant counts.
//   3. articleIsPublic()  — what the public may read.
//
// 🔴 Why a grant and never "admin of the workspace": canAccessTab() returns TRUE
// for every tab once a membership role is admin/manager (it assumes the caller
// is the sidebar, asking about tabs the workspace already has). If being a CUFC
// admin meant being able to publish on cufc.co.nz, every CUFC admin — and
// anyone ever made one for an unrelated reason — would hold the keys to the
// club's public website without anyone deciding they should. The tab gets you
// into the room; a named grant is the only thing that lets you touch a site.
// ─────────────────────────────────────────────────────────────────────────────

// ── Where the tab lives ──────────────────────────────────────────────────────

/** Brand workspace → the one brand its Website tab shows. One line per site. */
export const SITE_WORKSPACE_BRAND: Record<string, string> = {
  "christchurch-united": "cufc",
};

/** The workspace whose Website tab shows every site. */
export const SITE_GROUP_WORKSPACE = "united-sports-group";

/** Brands this workspace's tab may show. `null` = every brand. `[]` = none. */
export function siteBrandFilter(workspaceSlug: string | null | undefined): string[] | null {
  const slug = String(workspaceSlug || "");
  const brand = SITE_WORKSPACE_BRAND[slug];
  if (brand) return [brand];
  if (slug === SITE_GROUP_WORKSPACE) return null;
  return []; // fail closed
}

export const siteBrandAllowed = (scope: string[] | null, brand: string | null | undefined): boolean =>
  scope === null || (!!brand && scope.includes(String(brand).toLowerCase()));

// ── Who may do what ──────────────────────────────────────────────────────────

export const SITE_LEVELS = ["writer", "editor", "manager", "approver"] as const;
export type SiteLevel = (typeof SITE_LEVELS)[number];

export const SITE_LEVEL_LABEL: Record<SiteLevel, string> = {
  writer: "Writer",
  editor: "Editor",
  manager: "Site manager",
  approver: "Approver",
};

export const SITE_LEVEL_HELP: Record<SiteLevel, string> = {
  writer: "Drafts articles and sends them for review. Nothing goes live until an editor publishes it.",
  editor: "Publishes, schedules, backdates and unpublishes articles. Reverts changes.",
  manager: "Everything an editor can. (Asking Rambo for new sections comes in a later phase.)",
  approver: "Everything a site manager can, plus gives and takes away access. Approves structural changes (later phase).",
};

const RANK: Record<SiteLevel, number> = { writer: 1, editor: 2, manager: 3, approver: 4 };

export const isSiteLevel = (v: unknown): v is SiteLevel => typeof v === "string" && (SITE_LEVELS as readonly string[]).includes(v);

export type SiteAction =
  | "view"
  | "write"            // create an article, edit a draft
  | "submit"           // ask for review
  | "publish"          // publish now, schedule, backdate, unpublish, edit a live article
  | "revert"           // restore an older version
  | "delete-draft"     // remove a draft that was never public
  | "rambo"            // Rambo for words
  | "manage-people"    // grant/revoke writer, editor, manager
  | "grant-approver";  // grant/revoke approver — super admin only

const NEEDS: Record<Exclude<SiteAction, "grant-approver">, SiteLevel> = {
  view: "writer",
  write: "writer",
  submit: "writer",
  rambo: "writer",
  publish: "editor",
  revert: "editor",
  "delete-draft": "editor",
  "manage-people": "approver",
};

export interface SiteViewer {
  isSuperAdmin: boolean;
  /** This person's live grant on this site, or null. */
  level: SiteLevel | null;
}

/** The one permission decider. Re-run on every request with a freshly read grant. */
export function siteCan(v: SiteViewer, action: SiteAction): boolean {
  if (v.isSuperAdmin) return true;
  if (action === "grant-approver") return false;
  if (!v.level) return false;
  return RANK[v.level] >= RANK[NEEDS[action]];
}

/** May this viewer change this article in its current state? A writer only ever touches drafts. */
export function siteCanEditArticle(v: SiteViewer, status: ArticleStatus): boolean {
  if (siteCan(v, "publish")) return true;
  return siteCan(v, "write") && status === "draft";
}

/** May this viewer give `level` to someone (or take it away)? */
export function siteCanGrant(v: SiteViewer, level: SiteLevel): boolean {
  if (level === "approver") return siteCan(v, "grant-approver");
  return siteCan(v, "manage-people");
}

// ── Articles ─────────────────────────────────────────────────────────────────

export const ARTICLE_STATUSES = ["draft", "scheduled", "published", "unpublished"] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];
export const ARTICLE_STATUS_LABEL: Record<ArticleStatus, string> = {
  draft: "Draft", scheduled: "Scheduled", published: "Published", unpublished: "Unpublished",
};

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,159}$/;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function slugify(title: string): string {
  return String(title || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 90).replace(/-+$/g, "") || "article";
}

/** Today's date in New Zealand as YYYY-MM-DD — never toISOString() (UTC is a day behind for half the day). */
export function nzToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The NZ calendar date of an instant. */
export const nzDateOf = (instant: Date): string => nzToday(instant);

/** Could the public read this row right now? The one rule the API and the scheduler share. */
export function articleIsPublic(a: { status: string; publish_at?: string | Date | null }, now: Date = new Date()): boolean {
  if (a.status !== "published") return false;
  if (!a.publish_at) return true;
  return new Date(a.publish_at).getTime() <= now.getTime();
}

export type PublishIntent =
  | { kind: "now"; displayDate: string }
  | { kind: "schedule"; publishAt: string; displayDate: string }
  | { kind: "unpublish" };

/**
 * Check a publish/schedule/unpublish request before it is written.
 * - Publishing now: the shown date may be in the past (a backdate) but not in
 *   the future — a future date sorts above everything and claims news that
 *   has not happened.
 * - Scheduling: the time must be in the future; the shown date may not be
 *   later than the day it goes out.
 */
export function checkPublishIntent(i: PublishIntent, now: Date = new Date()): string | null {
  if (i.kind === "unpublish") return null;
  if (!ISO_DATE_RE.test(i.displayDate)) return "Choose the date the article shows.";
  if (i.kind === "now") {
    if (i.displayDate > nzToday(now)) return "The date shown can't be in the future when publishing now. Schedule it instead.";
    return null;
  }
  const at = new Date(i.publishAt);
  if (!Number.isFinite(at.getTime())) return "Choose when it should go out.";
  if (at.getTime() <= now.getTime() + 30_000) return "A scheduled time must be in the future. To put it out now, use Publish now.";
  if (i.displayDate > nzDateOf(at)) return "The date shown can't be after the day it goes out.";
  return null;
}

// ── The body: markdown in ClubOS, blocks on the site ─────────────────────────
//
// cufc.co.nz renders a body as BLOCKS: a paragraph (plain text), a picture
// (with alt and caption), an embedded video, or a document link. The editor
// writes markdown restricted to exactly those, so the preview can be honest
// about what the site will show:
//
//   A paragraph is text separated by a blank line.
//   ![alt text](https://…/photo.jpg "caption")      a picture
//   [video](https://www.youtube.com/embed/…)        an embedded video
//   [file: Annual report](/files/report.pdf)         a document link
//
// Anything else is a paragraph, shown exactly as typed. The round trip
// blocks → markdown → blocks is exact for every article imported from the
// site, an empty alt/caption counting as none (script/_test-sites.ts proves it
// on all of them).

export type BodyBlock =
  | string
  | { image: string; alt?: string; caption?: string }
  | { video: string }
  | { file: string; label: string };

const esc = (s: string, chars: string) => s.replace(/\\/g, "\\\\").replace(new RegExp(`[${chars.replace(/[\]\\^-]/g, "\\$&")}]`, "g"), (c) => `\\${c}`);
const unesc = (s: string) => s.replace(/\\(.)/g, "$1");

// Captured groups allow backslash escapes inside.
const IMG_RE = /^!\[((?:\\.|[^\]\\])*)\]\(((?:\\.|[^\s)\\])+)(?:\s+"((?:\\.|[^"\\])*)")?\)$/;
const VIDEO_RE = /^\[video\]\(((?:\\.|[^\s)\\])+)\)$/;
const FILE_RE = /^\[file:\s((?:\\.|[^\]\\])*)\]\(((?:\\.|[^\s)\\])+)\)$/;

export function blocksToMarkdown(blocks: BodyBlock[]): string {
  return (blocks || []).map((b) => {
    if (typeof b === "string") return b;
    if ("image" in b) {
      const cap = b.caption ? ` "${esc(b.caption, '"')}"` : "";
      return `![${esc(b.alt ?? "", "]")}](${esc(b.image, ") ")}${cap})`;
    }
    if ("video" in b) return `[video](${esc(b.video, ") ")})`;
    return `[file: ${esc(b.label, "]")}](${esc(b.file, ") ")})`;
  }).join("\n\n");
}

export function markdownToBlocks(md: string): BodyBlock[] {
  const text = String(md || "").replace(/\r\n?/g, "\n");
  const chunks = text.split(/\n[ \t]*\n/).map((c) => c.trim()).filter(Boolean);
  return chunks.map((chunk): BodyBlock => {
    let m = chunk.match(IMG_RE);
    if (m) {
      // An empty alt or caption is the same as none — the site reads `alt ?? ""`.
      const block: { image: string; alt?: string; caption?: string } = { image: unesc(m[2]) };
      if (m[1]) block.alt = unesc(m[1]);
      if (m[3]) block.caption = unesc(m[3]);
      return block;
    }
    m = chunk.match(VIDEO_RE);
    if (m) return { video: unesc(m[1]) };
    m = chunk.match(FILE_RE);
    if (m) return { file: unesc(m[2]), label: unesc(m[1]) };
    // A paragraph keeps its own single line breaks as spaces, the way the site shows it.
    return chunk.replace(/\s*\n\s*/g, " ");
  });
}

/** Problems with a body that would be published (pictures and links must be real URLs). */
export function checkBody(md: string): string[] {
  const out: string[] = [];
  for (const b of markdownToBlocks(md)) {
    if (typeof b === "string") continue;
    const url = "image" in b ? b.image : "video" in b ? b.video : b.file;
    if (!/^(https:\/\/|\/)/.test(url)) out.push(`"${url.slice(0, 60)}" must be a full https:// link or a path on the site.`);
    if ("video" in b && !/^https:\/\/(www\.)?(youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/)/.test(b.video)) {
      out.push("A video must be a YouTube or Vimeo EMBED link (youtube.com/embed/…).");
    }
  }
  return out;
}

// ── What a site publishes about an article ───────────────────────────────────

export interface SiteSettings {
  /** The section labels the site knows (cufc.co.nz: Club · First Team · Academy · Programmes). */
  tags?: string[];
}

/** The section shown on the site: the article's first tag if the site knows it, else the site's first. */
export function primaryTag(tags: string[] | null | undefined, settings: SiteSettings | null | undefined): string {
  const known = settings?.tags ?? [];
  const first = (tags ?? []).find((t) => known.includes(t));
  return first ?? known[0] ?? (tags?.[0] || "Club");
}

export const ARTICLE_LIMITS = { title: 300, summary: 1000, seoTitle: 200, seoDescription: 400, author: 120, body: 100_000, rambo: 6_000 } as const;

/**
 * "Sat 8 Nov, 9:00am in New Zealand" → the instant, whatever timezone the
 * browser is in. Two passes settle a daylight-saving boundary.
 */
export function nzLocalToInstant(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date); const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const wall = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  const offsetAt = (ms: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms;
  };
  let ms = wall - offsetAt(wall);
  ms = wall - offsetAt(ms);
  return new Date(ms);
}

/** The NZ wall-clock "HH:MM" of an instant. */
export function nzTimeOf(instant: Date): string {
  return new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(instant);
}

/**
 * ClubOS Websites, phase 1 — the routes, the scheduler and Rambo for words.
 *
 * Daniel, 2026-11-01: "give my people the keys, but be able to have the super
 * admin control … revert it to what it was."
 *
 *   Admin  /api/admin/sites/…        tab "sites" (Website), per-site grants
 *   Public /api/public/site/:key/…   what the club's websites build from
 *
 * Every rule about WHO may do WHAT is in shared/sites.ts (siteCan). Every
 * request re-reads the person and their grant from the database, so a revoke
 * bites on the next click, not the next login.
 *
 * 🔴 The tab is not the permission. requireTab("sites") only lets a person
 * into the room; siteCan() with a site_members grant decides what they can
 * touch. A workspace admin with no grant sees an empty list — see the long
 * comment at the top of shared/sites.ts for why.
 */
import type { Express, NextFunction, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { db, pool } from "./db";
import { requireTab } from "./auth";
import {
  ARTICLE_LIMITS, articleIsPublic, checkBody, checkPublishIntent, isSiteLevel, ISO_DATE_RE, markdownToBlocks, nzDateOf,
  nzToday, primaryTag, SITE_WORKSPACE_BRAND, siteBrandAllowed, siteBrandFilter, siteCan, siteCanEditArticle, siteCanGrant, SLUG_RE, slugify,
  type ArticleStatus, type PublishIntent, type SiteLevel, type SiteSettings, type SiteViewer,
} from "@shared/sites";
import { brandVoice, HOUSE_VOICE } from "@shared/studio-voice";
import { STUDIO_DEFAULT_EDIT_MODEL } from "@shared/studio";
import { mailerAiCostCents, type MailerAiTokenUsage } from "@shared/mailer-ai";
import { ramboDailyLimitFor, ramboUsedToday } from "./rambo-usage";
import { programmeFactsFor } from "./brand-facts";

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];
const one = async (q: any) => rowsOf(await db.execute(q))[0] ?? null;
const all = async (q: any) => rowsOf(await db.execute(q));
// 🔴 A JS array inside a drizzle sql`` template is spread into a parameter
// LIST, not sent as an array — "${tags}::text[]" reaches Postgres as
// "('Club')::text[]" and fails. Send JSON and unpack it in SQL instead.
const textArray = (a: string[]) => sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(a.map(String))}::jsonb))`;

// ── Who is asking ────────────────────────────────────────────────────────────

interface Person { id: number; label: string; isSuperAdmin: boolean; dailyLimit: number | null }

async function personFor(req: Request): Promise<Person | null> {
  const id = req.session?.userId;
  if (!id) return null;
  const u = await one(sql`SELECT id, first_name, last_name, email, role, active, mailer_ai_daily_limit FROM users WHERE id = ${id}`);
  if (!u || u.active === false) return null;
  const label = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email;
  return { id: u.id, label, isSuperAdmin: u.role === "super_admin", dailyLimit: u.mailer_ai_daily_limit ?? null };
}

const workspaceSlugOf = (req: Request) => String(req.headers["x-workspace-slug"] || "").trim();

interface SiteRow {
  id: number; key: string; brand: string; domain: string; name: string; deploy_hook_url: string | null;
  owner_user_id: number | null; owner_note: string | null; settings: SiteSettings; content_changed_at: string | null;
  last_hook_at: string | null; last_hook_status: string | null;
}

/** This person's live grant on this site, read now. */
async function levelOn(siteId: number, userId: number): Promise<SiteLevel | null> {
  const r = await one(sql`SELECT level FROM site_members WHERE site_id = ${siteId} AND user_id = ${userId} AND revoked_at IS NULL`);
  return r && isSiteLevel(r.level) ? r.level : null;
}

interface Ctx { person: Person; site: SiteRow; viewer: SiteViewer }

/**
 * Load the site named in the URL for this person in this workspace, or answer
 * 404. Out of the workspace's brands, or no grant, is the same 404 as "no such
 * site" — a stranger's site id tells them nothing.
 */
async function siteCtx(req: Request, res: Response): Promise<Ctx | null> {
  const person = await personFor(req);
  if (!person) { res.status(401).json({ message: "Sign in again." }); return null; }
  const siteId = Number(req.params.siteId);
  if (!Number.isInteger(siteId)) { res.status(404).json({ message: "No such site." }); return null; }
  const site = await one(sql`SELECT * FROM site_sites WHERE id = ${siteId} AND archived_at IS NULL`) as SiteRow | null;
  const scope = siteBrandFilter(workspaceSlugOf(req));
  if (!site || !siteBrandAllowed(scope, site.brand)) { res.status(404).json({ message: "No such site." }); return null; }
  const level = person.isSuperAdmin ? null : await levelOn(site.id, person.id);
  const viewer: SiteViewer = { isSuperAdmin: person.isSuperAdmin, level };
  if (!siteCan(viewer, "view")) { res.status(404).json({ message: "No such site." }); return null; }
  return { person, site, viewer };
}

function refuse(res: Response, message = "You don't have permission to do that on this site.") {
  res.status(403).json({ message });
}

// ── Articles: reading, snapshots, history ────────────────────────────────────

const ARTICLE_COLS = sql`a.id, a.site_id, a.slug, a.title, a.summary, a.body, a.hero_image, a.author_name, a.tags, a.status,
  to_char(a.display_date, 'YYYY-MM-DD') AS display_date, a.publish_at, a.seo_title, a.seo_description, a.source,
  a.review_requested_at, a.review_requested_by, a.first_published_at, a.version, a.created_by_user_id, a.updated_by_user_id,
  a.created_at, a.updated_at,
  nullif(btrim(coalesce(cu.first_name,'') || ' ' || coalesce(cu.last_name,'')), '') AS created_by_name,
  nullif(btrim(coalesce(uu.first_name,'') || ' ' || coalesce(uu.last_name,'')), '') AS updated_by_name,
  nullif(btrim(coalesce(ru.first_name,'') || ' ' || coalesce(ru.last_name,'')), '') AS review_requested_by_name`;
const ARTICLE_FROM = sql`site_articles a
  LEFT JOIN users cu ON cu.id = a.created_by_user_id
  LEFT JOIN users uu ON uu.id = a.updated_by_user_id
  LEFT JOIN users ru ON ru.id = a.review_requested_by`;

function shapeArticle(a: any) {
  return {
    id: a.id, siteId: a.site_id, slug: a.slug, title: a.title, summary: a.summary, body: a.body, heroImage: a.hero_image,
    authorName: a.author_name, tags: a.tags ?? [], status: a.status as ArticleStatus, displayDate: a.display_date,
    publishAt: a.publish_at, seoTitle: a.seo_title, seoDescription: a.seo_description, source: a.source,
    reviewRequestedAt: a.review_requested_at, reviewRequestedByName: a.review_requested_by_name ?? null,
    firstPublishedAt: a.first_published_at, version: a.version, createdAt: a.created_at, updatedAt: a.updated_at,
    createdByName: a.created_by_name ?? null, updatedByName: a.updated_by_name ?? null,
    isLive: articleIsPublic(a),
  };
}

async function loadArticle(siteId: number, articleId: number) {
  if (!Number.isInteger(articleId)) return null;
  return one(sql`SELECT ${ARTICLE_COLS} FROM ${ARTICLE_FROM} WHERE a.site_id = ${siteId} AND a.id = ${articleId}`);
}

/** The content fields a version holds (status and dates of publishing included, so history reads true). */
function snapshotOf(a: any) {
  return {
    slug: a.slug, title: a.title, summary: a.summary, body: a.body, heroImage: a.hero_image, authorName: a.author_name,
    tags: a.tags ?? [], displayDate: a.display_date, seoTitle: a.seo_title, seoDescription: a.seo_description,
    status: a.status, publishAt: a.publish_at,
  };
}

async function writeVersion(articleId: number, action: string, person: Person | null) {
  const a = await one(sql`SELECT a.*, to_char(a.display_date, 'YYYY-MM-DD') AS display_date FROM site_articles a WHERE a.id = ${articleId}`);
  if (!a) return;
  await db.execute(sql`INSERT INTO site_versions (article_id, version, action, snapshot, saved_by_user_id, saved_by_label)
    VALUES (${articleId}, ${a.version}, ${action}, ${JSON.stringify(snapshotOf(a))}::jsonb, ${person?.id ?? null}, ${person?.label ?? "ClubOS"})`);
}

async function logEvent(siteId: number, articleId: number | null, person: Person | null, action: string, detail: Record<string, unknown> = {}) {
  try {
    await db.execute(sql`INSERT INTO site_events (site_id, article_id, user_id, user_label, action, detail)
      VALUES (${siteId}, ${articleId}, ${person?.id ?? null}, ${person?.label ?? "ClubOS"}, ${action}, ${JSON.stringify(detail)}::jsonb)`);
  } catch (e) { console.error("[sites] event log failed:", e); }
}

// ── When the public side changes ─────────────────────────────────────────────

const publicCache = new Map<string, { at: number; body: any }>();
const PUBLIC_TTL_MS = 30_000;

/**
 * Something the public can see changed: stamp the site (the rebuild watcher
 * and "is it live yet" read the stamp), drop the API cache, and call the
 * site's deploy hook when it has one.
 */
async function siteChanged(siteId: number) {
  const s = await one(sql`UPDATE site_sites SET content_changed_at = now(), updated_at = now() WHERE id = ${siteId} RETURNING key, deploy_hook_url`);
  if (!s) return;
  for (const k of Array.from(publicCache.keys())) if (k.startsWith(`${s.key}:`)) publicCache.delete(k);
  if (s.deploy_hook_url) {
    let status = "";
    try {
      const r = await fetch(s.deploy_hook_url, { method: "POST", signal: AbortSignal.timeout(10_000) });
      status = `${r.status}`;
    } catch (e: any) { status = `failed: ${String(e?.message || e).slice(0, 120)}`; }
    await db.execute(sql`UPDATE site_sites SET last_hook_at = now(), last_hook_status = ${status} WHERE id = ${siteId}`).catch(() => {});
  }
}

// ── Body of an edit ──────────────────────────────────────────────────────────

interface Fields {
  title?: string; slug?: string; summary?: string; body?: string; heroImage?: string | null; authorName?: string | null;
  tags?: string[]; displayDate?: string; seoTitle?: string | null; seoDescription?: string | null;
}

/** Read and check the editable fields from a request body. Unknown keys are ignored. */
function readFields(b: any): { fields: Fields; problems: string[] } {
  const f: Fields = {}; const p: string[] = [];
  const str = (v: any) => (v == null ? "" : String(v));
  if (b.title !== undefined) { f.title = str(b.title).trim(); if (!f.title) p.push("Give the article a title."); if (f.title.length > ARTICLE_LIMITS.title) p.push("The title is too long."); }
  if (b.slug !== undefined) { f.slug = str(b.slug).trim().toLowerCase(); if (!SLUG_RE.test(f.slug)) p.push("The web address may use only lower-case letters, numbers and hyphens."); }
  if (b.summary !== undefined) { f.summary = str(b.summary).trim(); if (f.summary.length > ARTICLE_LIMITS.summary) p.push("The summary is too long."); }
  if (b.body !== undefined) { f.body = str(b.body); if (f.body.length > ARTICLE_LIMITS.body) p.push("The article is too long."); p.push(...checkBody(f.body)); }
  if (b.heroImage !== undefined) {
    const h = str(b.heroImage).trim();
    f.heroImage = h || null;
    if (h && !/^(https:\/\/|\/)/.test(h)) p.push("The main photo must be a full https:// link or a path on the site.");
  }
  if (b.authorName !== undefined) { f.authorName = str(b.authorName).trim() || null; if ((f.authorName ?? "").length > ARTICLE_LIMITS.author) p.push("The author name is too long."); }
  if (b.tags !== undefined) {
    f.tags = (Array.isArray(b.tags) ? b.tags : []).map((t: any) => String(t).trim()).filter(Boolean).slice(0, 8);
  }
  if (b.displayDate !== undefined) { f.displayDate = str(b.displayDate); if (!ISO_DATE_RE.test(f.displayDate)) p.push("Choose the date the article shows."); }
  if (b.seoTitle !== undefined) { f.seoTitle = str(b.seoTitle).trim() || null; if ((f.seoTitle ?? "").length > ARTICLE_LIMITS.seoTitle) p.push("The search title is too long."); }
  if (b.seoDescription !== undefined) { f.seoDescription = str(b.seoDescription).trim() || null; if ((f.seoDescription ?? "").length > ARTICLE_LIMITS.seoDescription) p.push("The search description is too long."); }
  return { fields: f, problems: p };
}

// ── Rambo for words ──────────────────────────────────────────────────────────

export const SITE_AI_MODEL = process.env.SITE_AI_MODEL || STUDIO_DEFAULT_EDIT_MODEL;
let anthropic: Anthropic | null = null;
const ai = () => (anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

const ARTICLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "title", "summary", "body", "seoTitle", "seoDescription"],
  properties: {
    reply: { type: "string", description: "One or two sentences to the staff member: what you wrote or changed, and anything you could not do because a fact was missing." },
    title: { type: "string", description: "The headline. Under 90 characters." },
    summary: { type: "string", description: "One or two sentences that sit under the headline and on the news card." },
    body: { type: "string", description: "The article: paragraphs separated by a blank line. Plain text only — no headings, no bullets, no bold, no links." },
    seoTitle: { type: "string", description: "Title for search results, under 60 characters." },
    seoDescription: { type: "string", description: "Description for search results, under 155 characters." },
  },
} as const;

async function orgIdForBrand(brand: string): Promise<number | null> {
  const slug = Object.entries(SITE_WORKSPACE_BRAND).find(([, b]) => b === brand)?.[0];
  if (!slug) return null;
  const o = await one(sql`SELECT id FROM organizations WHERE slug = ${slug}`);
  return o?.id ?? null;
}

async function ramboWrite(input: {
  site: SiteRow; person: Person; notes: string; instruction: string;
  current: { title?: string; summary?: string; body?: string } | null;
}): Promise<{ ok: boolean; error?: string; out?: any; costCents: number }> {
  const started = Date.now();
  const model = SITE_AI_MODEL;
  const usage: MailerAiTokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const orgId = await orgIdForBrand(input.site.brand);
  let facts = "";
  try { facts = orgId ? await programmeFactsFor(orgId) : ""; } catch { /* facts are a help, not a gate */ }
  const system = [
    `You write news for ${input.site.name} (${input.site.domain}), the club's public website.`,
    HOUSE_VOICE,
    brandVoice(input.site.brand),
    `THE RULES FOR A NEWS ARTICLE
- The staff member's notes are the source. Every name, score, date, place, number and quote must come from the notes or the FACTS below. Never invent one — not a scorer, not a crowd size, not a quote. If something an article would normally have is missing, leave it out and say so in "reply".
- Never put words in a real person's mouth. Use a quote only if the notes give it, word for word.
- Write in the past tense for things that happened, present for what is on now.
- Paragraphs separated by a blank line. No headings, bullets, bold, links, emoji or hashtags — the website shows plain paragraphs.
- Four to eight short paragraphs unless the notes are thin; thin notes make a short article, never padding.
- Reply in the JSON shape given.`,
    facts ? `FACTS (live from ClubOS — prices, dates and booking links you may use):\n${facts}` : "",
  ].filter(Boolean).join("\n\n");
  const userMsg = input.current && (input.current.title || input.current.body)
    ? `<current_article>\nTitle: ${input.current.title ?? ""}\nSummary: ${input.current.summary ?? ""}\n\n${input.current.body ?? ""}\n</current_article>\n\n${input.notes ? `Notes:\n${input.notes}\n\n` : ""}What to do: ${input.instruction || "Tighten and improve this article."}`
    : `Notes:\n${input.notes}\n\n${input.instruction ? `What to do: ${input.instruction}` : "Write the article."}`;
  const record = async (ok: boolean, error: string | null) => {
    try {
      await db.execute(sql`INSERT INTO site_ai_usage (site_id, user_id, user_label, model, instruction, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd_cents, duration_ms, ok, error)
        VALUES (${input.site.id}, ${input.person.id}, ${input.person.label}, ${model}, ${`${input.instruction}\n\n${input.notes}`.slice(0, 4000)},
          ${usage.input}, ${usage.output}, ${usage.cacheRead}, ${usage.cacheWrite}, ${String(mailerAiCostCents(model, usage))}, ${Date.now() - started}, ${ok}, ${error})`);
    } catch (e) { console.error("[sites] usage row failed:", e); }
  };
  try {
    const res = await ai().messages.create({
      model,
      max_tokens: 4000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
      output_config: { format: { type: "json_schema", schema: ARTICLE_SCHEMA as any } },
    } as any);
    usage.input += res.usage.input_tokens ?? 0;
    usage.output += res.usage.output_tokens ?? 0;
    usage.cacheRead += (res.usage as any).cache_read_input_tokens ?? 0;
    usage.cacheWrite += (res.usage as any).cache_creation_input_tokens ?? 0;
    if (res.stop_reason === "refusal") { await record(false, "refused"); return { ok: false, error: "Rambo declined that.", costCents: mailerAiCostCents(model, usage) }; }
    const text = res.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    let out: any = null;
    try { out = JSON.parse(text); } catch { /* below */ }
    if (!out || typeof out.body !== "string" || typeof out.title !== "string") {
      await record(false, "no valid answer");
      return { ok: false, error: "Rambo's answer couldn't be read. Try again.", costCents: mailerAiCostCents(model, usage) };
    }
    out.body = out.body.replace(/\r\n?/g, "\n").trim();
    await record(true, null);
    return { ok: true, out, costCents: mailerAiCostCents(model, usage) };
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    await record(false, msg.slice(0, 500));
    const friendly = e?.status === 401 ? "Rambo's API key was refused. Check ANTHROPIC_API_KEY on the server."
      : e?.status === 429 ? "Rambo is busy right now. Try again in a minute."
      : /credit|balance|billing/i.test(msg) ? "The club's Anthropic account is out of credit."
      : `Rambo hit a snag: ${msg.slice(0, 200)}`;
    return { ok: false, error: friendly, costCents: mailerAiCostCents(model, usage) };
  }
}

// ── The scheduler ────────────────────────────────────────────────────────────

const LOCK_KEY = 74_110_2026; // site scheduler — any constant no other job uses
let ticking = false;

/** Flip every scheduled article whose time has come. One machine at a time. */
export async function runSiteSchedulerOnce(): Promise<number> {
  if (ticking) return 0;
  ticking = true;
  const client = await pool.connect();
  let flipped = 0;
  try {
    const got = await client.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK_KEY]);
    if (!got.rows[0]?.ok) return 0;
    try {
      const due = rowsOf(await db.execute(sql`
        UPDATE site_articles SET status = 'published', first_published_at = coalesce(first_published_at, now()),
               version = version + 1, updated_at = now()
         WHERE status = 'scheduled' AND publish_at <= now()
         RETURNING id, site_id, slug`));
      const sites = new Set<number>();
      for (const a of due) {
        await writeVersion(a.id, "went live (scheduled)", null);
        await logEvent(a.site_id, a.id, null, "published-on-schedule", { slug: a.slug });
        sites.add(a.site_id);
      }
      for (const s of Array.from(sites)) await siteChanged(s);
      flipped = due.length;
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]).catch(() => {});
    }
  } catch (e) {
    console.error("[sites] scheduler tick", e);
  } finally {
    client.release();
    ticking = false;
  }
  return flipped;
}

export function startSiteScheduler() {
  if (process.env.SITE_SCHEDULER === "0") { console.log("[sites] scheduler disabled by SITE_SCHEDULER=0"); return; }
  setTimeout(() => void runSiteSchedulerOnce(), 50_000);
  setInterval(() => void runSiteSchedulerOnce(), 60_000);
}

// ── Live check: is the change on the website yet? ────────────────────────────

const liveCache = new Map<number, { at: number; data: any }>();
async function liveStatus(site: SiteRow) {
  const hit = liveCache.get(site.id);
  if (hit && Date.now() - hit.at < 30_000) return hit.data;
  let data: any;
  try {
    const r = await fetch(`https://${site.domain}/news-api/index.json`, { signal: AbortSignal.timeout(8000), headers: { "cache-control": "no-cache" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const slugs = new Set<string>((j.articles ?? []).map((a: any) => a.slug));
    data = { ok: true, builtAt: j.generated ?? null, total: j.total ?? slugs.size, slugs };
  } catch (e: any) {
    data = { ok: false, error: String(e?.message || e).slice(0, 120) };
  }
  liveCache.set(site.id, { at: Date.now(), data });
  return data;
}

// ── Public CORS: only the site's own domain ──────────────────────────────────

async function publicCors(req: Request, res: Response, next: NextFunction) {
  const origin = String(req.headers.origin || "");
  if (origin) {
    const key = String(req.path.split("/")[1] || "");
    const s = key ? await one(sql`SELECT domain FROM site_sites WHERE key = ${key} AND archived_at IS NULL`).catch(() => null) : null;
    if (s && (origin === `https://${s.domain}` || origin === `https://www.${s.domain}`)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    }
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
}

function publicArticle(a: any, settings: SiteSettings, withBody: boolean) {
  const out: any = {
    slug: a.slug, date: a.display_date, title: a.title, standfirst: a.summary, image: a.hero_image,
    tag: primaryTag(a.tags, settings), tags: a.tags ?? [], author: a.author_name ?? null,
    seoTitle: a.seo_title ?? null, seoDescription: a.seo_description ?? null, updatedAt: a.updated_at,
  };
  if (withBody) { out.body = markdownToBlocks(a.body); out.markdown = a.body; }
  return out;
}

// ── Routes ───────────────────────────────────────────────────────────────────

const TAB = requireTab("sites");

export function registerSiteRoutes(app: Express) {
  // ── The site list ──────────────────────────────────────────────────────────
  app.get("/api/admin/sites", TAB, async (req, res) => {
    try {
      const person = await personFor(req);
      if (!person) return res.status(401).json({ message: "Sign in again." });
      const scope = siteBrandFilter(workspaceSlugOf(req));
      const rows = await all(sql`
        SELECT s.id, s.key, s.brand, s.domain, s.name, s.owner_note, s.content_changed_at, (s.deploy_hook_url IS NOT NULL) AS has_hook,
               s.last_hook_at, s.last_hook_status, s.settings,
               nullif(btrim(coalesce(o.first_name,'') || ' ' || coalesce(o.last_name,'')), '') AS owner_name,
               m.level,
               (SELECT count(*)::int FROM site_articles a WHERE a.site_id = s.id AND a.status = 'draft') AS drafts,
               (SELECT count(*)::int FROM site_articles a WHERE a.site_id = s.id AND a.status = 'scheduled') AS scheduled,
               (SELECT count(*)::int FROM site_articles a WHERE a.site_id = s.id AND a.status = 'published') AS published,
               (SELECT count(*)::int FROM site_articles a WHERE a.site_id = s.id AND a.status = 'unpublished') AS unpublished,
               (SELECT count(*)::int FROM site_articles a WHERE a.site_id = s.id AND a.status = 'draft' AND a.review_requested_at IS NOT NULL) AS for_review
          FROM site_sites s
          LEFT JOIN users o ON o.id = s.owner_user_id
          LEFT JOIN site_members m ON m.site_id = s.id AND m.user_id = ${person.id} AND m.revoked_at IS NULL
         WHERE s.archived_at IS NULL
         ORDER BY s.name`);
      const sites = rows
        .filter((s) => siteBrandAllowed(scope, s.brand))
        .filter((s) => person.isSuperAdmin || isSiteLevel(s.level))
        .map((s) => {
          const viewer: SiteViewer = { isSuperAdmin: person.isSuperAdmin, level: isSiteLevel(s.level) ? s.level : null };
          return {
            id: s.id, key: s.key, brand: s.brand, domain: s.domain, name: s.name, ownerName: s.owner_name, ownerNote: s.owner_note,
            contentChangedAt: s.content_changed_at, hasDeployHook: s.has_hook, lastHookAt: s.last_hook_at, lastHookStatus: s.last_hook_status,
            tags: (s.settings?.tags ?? []) as string[],
            level: viewer.level, counts: { draft: s.drafts, scheduled: s.scheduled, published: s.published, unpublished: s.unpublished, forReview: s.for_review },
            can: { publish: siteCan(viewer, "publish"), revert: siteCan(viewer, "revert"), managePeople: siteCan(viewer, "manage-people"), grantApprover: siteCan(viewer, "grant-approver"), rambo: siteCan(viewer, "rambo") },
          };
        });
      res.json({ viewer: { userId: person.id, name: person.label, isSuperAdmin: person.isSuperAdmin }, sites, today: nzToday() });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── Articles ───────────────────────────────────────────────────────────────
  app.get("/api/admin/sites/:siteId/articles", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      const status = String(req.query.status || "all");
      const q = String(req.query.q || "").trim();
      const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const statusSql = status === "review" ? sql`AND a.status = 'draft' AND a.review_requested_at IS NOT NULL`
        : ["draft", "scheduled", "published", "unpublished"].includes(status) ? sql`AND a.status = ${status}` : sql``;
      const qSql = q ? sql`AND (a.title ILIKE ${"%" + q + "%"} OR a.slug ILIKE ${"%" + q + "%"})` : sql``;
      const rows = await all(sql`SELECT ${ARTICLE_COLS}, count(*) OVER()::int AS total FROM ${ARTICLE_FROM}
        WHERE a.site_id = ${c.site.id} ${statusSql} ${qSql}
        ORDER BY (a.status = 'draft') DESC, (a.status = 'scheduled') DESC, a.display_date DESC, a.id DESC
        LIMIT ${limit} OFFSET ${offset}`);
      res.json({
        total: rows[0]?.total ?? 0,
        articles: rows.map((a) => { const s = shapeArticle(a); delete (s as any).body; return { ...s, canEdit: siteCanEditArticle(c.viewer, s.status) }; }),
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/admin/sites/:siteId/articles/:articleId", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      const a = await loadArticle(c.site.id, Number(req.params.articleId));
      if (!a) return res.status(404).json({ message: "No such article." });
      const s = shapeArticle(a);
      const live = s.isLive ? await liveStatus(c.site) : null;
      res.json({
        article: { ...s, canEdit: siteCanEditArticle(c.viewer, s.status) },
        live: live ? { checked: live.ok, onSite: live.ok ? live.slugs.has(s.slug) : null, builtAt: live.builtAt ?? null } : null,
        url: `https://${c.site.domain}/news/${s.slug}`,
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/admin/sites/:siteId/articles", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      if (!siteCan(c.viewer, "write")) return refuse(res);
      const { fields, problems } = readFields({ displayDate: nzToday(), ...req.body });
      if (!fields.title) problems.push("Give the article a title.");
      if (problems.length) return res.status(400).json({ message: problems[0], problems });
      let slug = fields.slug || slugify(fields.title!);
      // A new article never takes an existing web address — add a number until it is free.
      for (let i = 2; i < 50; i++) {
        const taken = await one(sql`SELECT 1 AS x FROM site_articles WHERE site_id = ${c.site.id} AND slug = ${slug}`);
        if (!taken) break;
        if (fields.slug) return res.status(409).json({ message: "Another article already uses that web address." });
        slug = `${slugify(fields.title!).slice(0, 80)}-${i}`;
      }
      const tags = fields.tags?.length ? fields.tags : [(c.site.settings?.tags ?? [])[0] ?? "Club"];
      const a = await one(sql`INSERT INTO site_articles (site_id, slug, title, summary, body, hero_image, author_name, tags, status, display_date, seo_title, seo_description, source, created_by_user_id, updated_by_user_id)
        VALUES (${c.site.id}, ${slug}, ${fields.title}, ${fields.summary ?? ""}, ${fields.body ?? ""}, ${fields.heroImage ?? null}, ${fields.authorName ?? null},
                ${textArray(tags)}, 'draft', ${fields.displayDate}::date, ${fields.seoTitle ?? null}, ${fields.seoDescription ?? null}, 'clubos', ${c.person.id}, ${c.person.id})
        RETURNING id`);
      await writeVersion(a.id, "created", c.person);
      await logEvent(c.site.id, a.id, c.person, "created", { slug });
      const full = await loadArticle(c.site.id, a.id);
      res.status(201).json({ article: { ...shapeArticle(full), canEdit: true } });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch("/api/admin/sites/:siteId/articles/:articleId", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      const cur = await loadArticle(c.site.id, Number(req.params.articleId));
      if (!cur) return res.status(404).json({ message: "No such article." });
      if (!siteCanEditArticle(c.viewer, cur.status)) return refuse(res, cur.status === "draft" ? undefined : "Only an editor can change an article once it has been published or scheduled.");
      if (Number(req.body?.version) !== cur.version) return res.status(409).json({ message: "Someone else saved this article while you had it open. Reload to see their version.", current: shapeArticle(cur) });
      const { fields, problems } = readFields(req.body || {});
      if (problems.length) return res.status(400).json({ message: problems[0], problems });
      // The web address of anything that has ever been public is permanent: it carries SEO and links.
      if (fields.slug !== undefined && fields.slug !== cur.slug) {
        if (cur.first_published_at) return res.status(400).json({ message: "This article has been public, so its web address can't change." });
        const taken = await one(sql`SELECT 1 AS x FROM site_articles WHERE site_id = ${c.site.id} AND slug = ${fields.slug} AND id <> ${cur.id}`);
        if (taken) return res.status(409).json({ message: "Another article already uses that web address." });
      }
      // A writer can't move a published article's shown date (that is a backdate — an editor's call).
      if (fields.displayDate !== undefined && fields.displayDate !== cur.display_date && cur.status !== "draft" && !siteCan(c.viewer, "publish")) return refuse(res);
      if (fields.displayDate !== undefined && cur.status === "published" && fields.displayDate > nzToday()) return res.status(400).json({ message: "A published article can't be dated in the future." });
      const v = (k: keyof Fields, col: any) => (fields[k] !== undefined ? fields[k] : col);
      const updated = await one(sql`UPDATE site_articles SET
          slug = ${v("slug", cur.slug)}, title = ${v("title", cur.title)}, summary = ${v("summary", cur.summary)}, body = ${v("body", cur.body)},
          hero_image = ${v("heroImage", cur.hero_image)}, author_name = ${v("authorName", cur.author_name)}, tags = ${textArray((v("tags", cur.tags) as string[]) ?? [])},
          display_date = ${v("displayDate", cur.display_date)}::date, seo_title = ${v("seoTitle", cur.seo_title)}, seo_description = ${v("seoDescription", cur.seo_description)},
          version = version + 1, updated_by_user_id = ${c.person.id}, updated_at = now()
        WHERE id = ${cur.id} AND version = ${cur.version} RETURNING id`);
      if (!updated) return res.status(409).json({ message: "Someone else saved this article at the same moment. Reload to see their version." });
      await writeVersion(cur.id, "saved", c.person);
      await logEvent(c.site.id, cur.id, c.person, "saved", { slug: v("slug", cur.slug) });
      if (articleIsPublic(cur)) await siteChanged(c.site.id);
      const full = await loadArticle(c.site.id, cur.id);
      const s = shapeArticle(full);
      res.json({ article: { ...s, canEdit: siteCanEditArticle(c.viewer, s.status) } });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** A writer asks for review. Nothing goes public. */
  app.post("/api/admin/sites/:siteId/articles/:articleId/submit", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      if (!siteCan(c.viewer, "submit")) return refuse(res);
      const cur = await loadArticle(c.site.id, Number(req.params.articleId));
      if (!cur) return res.status(404).json({ message: "No such article." });
      if (cur.status !== "draft") return res.status(400).json({ message: "Only a draft can be sent for review." });
      const withdraw = req.body?.withdraw === true;
      await db.execute(withdraw
        ? sql`UPDATE site_articles SET review_requested_at = NULL, review_requested_by = NULL, updated_at = now() WHERE id = ${cur.id}`
        : sql`UPDATE site_articles SET review_requested_at = now(), review_requested_by = ${c.person.id}, updated_at = now() WHERE id = ${cur.id}`);
      await logEvent(c.site.id, cur.id, c.person, withdraw ? "review-withdrawn" : "review-requested", { slug: cur.slug });
      const s = shapeArticle(await loadArticle(c.site.id, cur.id));
      res.json({ article: { ...s, canEdit: siteCanEditArticle(c.viewer, s.status) } });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** Publish now (optionally backdated), schedule, or unpublish. Editors and up. */
  app.post("/api/admin/sites/:siteId/articles/:articleId/publish", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      if (!siteCan(c.viewer, "publish")) return refuse(res, "Only an editor can publish, schedule or unpublish.");
      const cur = await loadArticle(c.site.id, Number(req.params.articleId));
      if (!cur) return res.status(404).json({ message: "No such article." });
      if (Number(req.body?.version) !== cur.version) return res.status(409).json({ message: "This article changed while you had it open. Reload first.", current: shapeArticle(cur) });
      const kind = String(req.body?.kind || "");
      let intent: PublishIntent;
      if (kind === "now") intent = { kind, displayDate: String(req.body?.displayDate || cur.display_date) };
      else if (kind === "schedule") intent = { kind, publishAt: String(req.body?.publishAt || ""), displayDate: String(req.body?.displayDate || "") || nzDateOf(new Date(String(req.body?.publishAt || ""))) };
      else if (kind === "unpublish") intent = { kind };
      else return res.status(400).json({ message: "Say whether to publish now, schedule or unpublish." });
      const problem = checkPublishIntent(intent);
      if (problem) return res.status(400).json({ message: problem });
      if (intent.kind !== "unpublish") {
        const bodyProblems = checkBody(cur.body);
        if (bodyProblems.length) return res.status(400).json({ message: bodyProblems[0] });
        if (!cur.summary?.trim()) return res.status(400).json({ message: "Add a summary first — it is what shows on the news card." });
        if (!cur.hero_image) return res.status(400).json({ message: "Choose a main photo first — every news card on the site has one." });
      }
      const wasPublic = articleIsPublic(cur);
      let action: string;
      if (intent.kind === "now") {
        await db.execute(sql`UPDATE site_articles SET status = 'published', publish_at = NULL, display_date = ${intent.displayDate}::date,
          first_published_at = coalesce(first_published_at, now()), review_requested_at = NULL, review_requested_by = NULL,
          version = version + 1, updated_by_user_id = ${c.person.id}, updated_at = now() WHERE id = ${cur.id}`);
        action = intent.displayDate < nzToday() ? "published (backdated)" : "published";
      } else if (intent.kind === "schedule") {
        await db.execute(sql`UPDATE site_articles SET status = 'scheduled', publish_at = ${new Date(intent.publishAt).toISOString()}::timestamptz,
          display_date = ${intent.displayDate}::date, review_requested_at = NULL, review_requested_by = NULL,
          version = version + 1, updated_by_user_id = ${c.person.id}, updated_at = now() WHERE id = ${cur.id}`);
        action = "scheduled";
      } else {
        if (cur.status === "draft") return res.status(400).json({ message: "A draft isn't public, so there is nothing to unpublish." });
        // A scheduled article that was never public goes back to draft; one that was public is withdrawn.
        const to = cur.first_published_at ? "unpublished" : "draft";
        await db.execute(sql`UPDATE site_articles SET status = ${to}, publish_at = NULL,
          version = version + 1, updated_by_user_id = ${c.person.id}, updated_at = now() WHERE id = ${cur.id}`);
        action = to === "draft" ? "schedule cancelled" : "unpublished";
      }
      await writeVersion(cur.id, action, c.person);
      await logEvent(c.site.id, cur.id, c.person, action, { slug: cur.slug, ...(intent.kind === "schedule" ? { publishAt: intent.publishAt } : {}), ...(intent.kind === "now" ? { displayDate: intent.displayDate } : {}) });
      const after = await loadArticle(c.site.id, cur.id);
      if (wasPublic || articleIsPublic(after)) await siteChanged(c.site.id);
      const s = shapeArticle(after);
      res.json({ article: { ...s, canEdit: siteCanEditArticle(c.viewer, s.status) }, action });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** Delete a draft that was never public. Anything that was public is unpublished instead, never deleted. */
  app.delete("/api/admin/sites/:siteId/articles/:articleId", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      const cur = await loadArticle(c.site.id, Number(req.params.articleId));
      if (!cur) return res.status(404).json({ message: "No such article." });
      const own = cur.created_by_user_id === c.person.id && cur.status === "draft" && !cur.first_published_at && siteCan(c.viewer, "write");
      if (!siteCan(c.viewer, "delete-draft") && !own) return refuse(res);
      if (cur.status !== "draft" || cur.first_published_at) return res.status(400).json({ message: "Only a draft that has never been public can be deleted. Unpublish it instead." });
      await logEvent(c.site.id, cur.id, c.person, "draft-deleted", { slug: cur.slug, title: cur.title });
      await db.execute(sql`DELETE FROM site_articles WHERE id = ${cur.id}`);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── History ────────────────────────────────────────────────────────────────
  app.get("/api/admin/sites/:siteId/articles/:articleId/versions", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      const cur = await loadArticle(c.site.id, Number(req.params.articleId));
      if (!cur) return res.status(404).json({ message: "No such article." });
      const rows = await all(sql`SELECT id, version, action, snapshot, saved_by_label, created_at FROM site_versions WHERE article_id = ${cur.id} ORDER BY version DESC LIMIT 200`);
      res.json({ versions: rows.map((r) => ({ id: Number(r.id), version: r.version, action: r.action, snapshot: r.snapshot, savedBy: r.saved_by_label, at: r.created_at })) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** Put an older version's words back. The status stays as it is; the revert is itself a new version. */
  app.post("/api/admin/sites/:siteId/articles/:articleId/revert", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      const cur = await loadArticle(c.site.id, Number(req.params.articleId));
      if (!cur) return res.status(404).json({ message: "No such article." });
      if (!siteCan(c.viewer, "revert") && !(cur.status === "draft" && siteCan(c.viewer, "write"))) return refuse(res, "Only an editor can revert a published article.");
      if (Number(req.body?.version) !== cur.version) return res.status(409).json({ message: "This article changed while you had it open. Reload first." });
      const v = await one(sql`SELECT version, snapshot FROM site_versions WHERE id = ${Number(req.body?.versionId)} AND article_id = ${cur.id}`);
      if (!v) return res.status(404).json({ message: "No such version." });
      const s = v.snapshot ?? {};
      // The web address only goes back if the article was never public.
      const slug = cur.first_published_at ? cur.slug : (SLUG_RE.test(s.slug) ? s.slug : cur.slug);
      if (slug !== cur.slug) {
        const taken = await one(sql`SELECT 1 AS x FROM site_articles WHERE site_id = ${c.site.id} AND slug = ${slug} AND id <> ${cur.id}`);
        if (taken) return res.status(409).json({ message: "That version's web address is now used by another article." });
      }
      let displayDate = ISO_DATE_RE.test(s.displayDate) ? s.displayDate : cur.display_date;
      if (cur.status === "published" && displayDate > nzToday()) displayDate = cur.display_date;
      await db.execute(sql`UPDATE site_articles SET slug = ${slug}, title = ${s.title || cur.title}, summary = ${s.summary ?? ""}, body = ${s.body ?? ""},
          hero_image = ${s.heroImage ?? null}, author_name = ${s.authorName ?? null}, tags = ${textArray(Array.isArray(s.tags) ? s.tags : [])},
          display_date = ${displayDate}::date, seo_title = ${s.seoTitle ?? null}, seo_description = ${s.seoDescription ?? null},
          version = version + 1, updated_by_user_id = ${c.person.id}, updated_at = now()
        WHERE id = ${cur.id}`);
      await writeVersion(cur.id, `reverted to version ${v.version}`, c.person);
      await logEvent(c.site.id, cur.id, c.person, "reverted", { slug: cur.slug, toVersion: v.version });
      if (articleIsPublic(cur)) await siteChanged(c.site.id);
      const after = shapeArticle(await loadArticle(c.site.id, cur.id));
      res.json({ article: { ...after, canEdit: siteCanEditArticle(c.viewer, after.status) } });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/admin/sites/:siteId/activity", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      const rows = await all(sql`SELECT e.id, e.action, e.detail, e.user_label, e.created_at, e.article_id, a.title
        FROM site_events e LEFT JOIN site_articles a ON a.id = e.article_id
        WHERE e.site_id = ${c.site.id} ORDER BY e.created_at DESC LIMIT 60`);
      res.json({ events: rows.map((r) => ({ id: Number(r.id), action: r.action, detail: r.detail, by: r.user_label, at: r.created_at, articleId: r.article_id, title: r.title ?? r.detail?.title ?? null })) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** Is the website showing what ClubOS says it should? Reads the LIVE site, not a flag. */
  app.get("/api/admin/sites/:siteId/live", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      liveCache.delete(c.site.id);
      const live = await liveStatus(c.site);
      const site = await one(sql`SELECT content_changed_at FROM site_sites WHERE id = ${c.site.id}`);
      const changedAt = site?.content_changed_at ? new Date(site.content_changed_at).getTime() : null;
      const builtAt = live.ok && live.builtAt ? new Date(live.builtAt).getTime() : null;
      res.json({
        checked: live.ok, error: live.ok ? null : live.error, builtAt: live.ok ? live.builtAt : null, articlesOnSite: live.ok ? live.total : null,
        contentChangedAt: site?.content_changed_at ?? null,
        upToDate: changedAt == null ? true : builtAt == null ? null : builtAt >= changedAt,
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── People ─────────────────────────────────────────────────────────────────
  app.get("/api/admin/sites/:siteId/people", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      if (!siteCan(c.viewer, "manage-people")) return refuse(res);
      const rows = await all(sql`SELECT m.user_id, m.level, m.granted_at, u.first_name, u.last_name, u.email,
          nullif(btrim(coalesce(g.first_name,'') || ' ' || coalesce(g.last_name,'')), '') AS granted_by
        FROM site_members m JOIN users u ON u.id = m.user_id LEFT JOIN users g ON g.id = m.granted_by_user_id
        WHERE m.site_id = ${c.site.id} AND m.revoked_at IS NULL ORDER BY m.level DESC, u.first_name`);
      const supers = await all(sql`SELECT id, first_name, last_name, email FROM users WHERE role = 'super_admin' AND active IS NOT FALSE ORDER BY id`);
      res.json({
        members: rows.map((r) => ({ userId: r.user_id, name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.email, email: r.email, level: r.level, grantedAt: r.granted_at, grantedBy: r.granted_by })),
        superAdmins: supers.map((r) => ({ userId: r.id, name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.email, email: r.email })),
        canGrantApprover: siteCan(c.viewer, "grant-approver"),
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** Staff accounts to choose from when giving access. Staff only — a member of any workspace. */
  app.get("/api/admin/sites/:siteId/people/candidates", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      if (!siteCan(c.viewer, "manage-people")) return refuse(res);
      const q = String(req.query.q || "").trim();
      if (q.length < 2) return res.json({ people: [] });
      const like = `%${q}%`;
      const rows = await all(sql`SELECT DISTINCT u.id, u.first_name, u.last_name, u.email FROM users u
        WHERE u.active IS NOT FALSE AND u.role <> 'super_admin'
          AND EXISTS (SELECT 1 FROM user_organizations uo WHERE uo.user_id = u.id)
          AND (u.first_name ILIKE ${like} OR u.last_name ILIKE ${like} OR u.email ILIKE ${like} OR (u.first_name || ' ' || coalesce(u.last_name,'')) ILIKE ${like})
        ORDER BY u.first_name LIMIT 12`);
      res.json({ people: rows.map((r) => ({ userId: r.id, name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.email, email: r.email })) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** Give someone a level (or change it). */
  app.post("/api/admin/sites/:siteId/people", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      const level = String(req.body?.level || "");
      const userId = Number(req.body?.userId);
      if (!isSiteLevel(level)) return res.status(400).json({ message: "Choose a level." });
      if (!siteCanGrant(c.viewer, level)) return refuse(res, level === "approver" ? "Only a super admin can make someone an approver." : undefined);
      const u = await one(sql`SELECT id, role, active, first_name, last_name, email FROM users WHERE id = ${userId}`);
      if (!u || u.active === false) return res.status(404).json({ message: "No such person." });
      if (u.role === "super_admin") return res.status(400).json({ message: "A super admin already has every level on every site." });
      const staff = await one(sql`SELECT 1 AS x FROM user_organizations WHERE user_id = ${userId} LIMIT 1`);
      if (!staff) return res.status(400).json({ message: "Only a member of ClubOS staff can be given access." });
      const existing = await one(sql`SELECT id, level FROM site_members WHERE site_id = ${c.site.id} AND user_id = ${userId} AND revoked_at IS NULL`);
      // Changing someone's level also needs the right to grant the level they already hold.
      if (existing && isSiteLevel(existing.level) && !siteCanGrant(c.viewer, existing.level)) return refuse(res, "Only a super admin can change an approver.");
      if (existing) {
        if (existing.level === level) return res.json({ ok: true });
        await db.execute(sql`UPDATE site_members SET revoked_at = now(), revoked_by_user_id = ${c.person.id} WHERE id = ${existing.id}`);
      }
      await db.execute(sql`INSERT INTO site_members (site_id, user_id, level, granted_by_user_id) VALUES (${c.site.id}, ${userId}, ${level}, ${c.person.id})`);
      await logEvent(c.site.id, null, c.person, existing ? "level-changed" : "access-given", { userId, name: `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email, level, from: existing?.level ?? null });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** Take someone's access away. The grant is kept as history. */
  app.delete("/api/admin/sites/:siteId/people/:userId", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      const userId = Number(req.params.userId);
      const existing = await one(sql`SELECT m.id, m.level, u.first_name, u.last_name, u.email FROM site_members m JOIN users u ON u.id = m.user_id
        WHERE m.site_id = ${c.site.id} AND m.user_id = ${userId} AND m.revoked_at IS NULL`);
      if (!existing) return res.status(404).json({ message: "That person has no access to this site." });
      if (!siteCanGrant(c.viewer, existing.level)) return refuse(res, existing.level === "approver" ? "Only a super admin can remove an approver." : undefined);
      await db.execute(sql`UPDATE site_members SET revoked_at = now(), revoked_by_user_id = ${c.person.id} WHERE id = ${existing.id}`);
      await logEvent(c.site.id, null, c.person, "access-removed", { userId, name: `${existing.first_name ?? ""} ${existing.last_name ?? ""}`.trim() || existing.email, level: existing.level });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── Rambo for words ────────────────────────────────────────────────────────
  app.post("/api/admin/sites/:siteId/rambo", TAB, async (req, res) => {
    try {
      const c = await siteCtx(req, res); if (!c) return;
      if (!siteCan(c.viewer, "rambo")) return refuse(res);
      const notes = String(req.body?.notes ?? "").trim();
      const instruction = String(req.body?.instruction ?? "").trim();
      const current = req.body?.current && typeof req.body.current === "object"
        ? { title: String(req.body.current.title ?? ""), summary: String(req.body.current.summary ?? ""), body: String(req.body.current.body ?? "") } : null;
      if (!notes && !(current && current.body.trim())) return res.status(400).json({ message: "Give Rambo some notes — what happened, who, when, where." });
      if (notes.length + instruction.length > ARTICLE_LIMITS.rambo) return res.status(400).json({ message: `Keep the notes under ${ARTICLE_LIMITS.rambo} characters.` });
      const limit = ramboDailyLimitFor(c.person.dailyLimit as any);
      const used = await ramboUsedToday(c.person.id);
      if (used >= limit) return res.status(429).json({ message: limit === 0 ? "Rambo is switched off for your account. A super admin can turn it on in Team." : `You've used today's ${limit} prompts. It resets at midnight NZ time.`, usage: { used, limit } });
      // Writing takes a while; keep the line open with whitespace (JSON ignores it).
      res.status(200); res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.flushHeaders?.();
      const beat = setInterval(() => { try { res.write(" "); } catch { /* gone */ } }, 15_000);
      try {
        const r = await ramboWrite({ site: c.site, person: c.person, notes, instruction, current });
        await logEvent(c.site.id, Number(req.body?.articleId) || null, c.person, "rambo", { ok: r.ok });
        res.end(JSON.stringify(r.ok
          ? { ok: true, ...r.out, problems: checkBody(r.out.body), usage: { used: used + 1, limit }, costCents: r.costCents }
          : { ok: false, message: r.error, usage: { used: used + 1, limit } }));
      } finally { clearInterval(beat); }
    } catch (e: any) {
      if (!res.headersSent) res.status(500).json({ message: e.message });
      else res.end(JSON.stringify({ ok: false, message: e.message }));
    }
  });

  // ── Public: what the websites build from ───────────────────────────────────
  app.use("/api/public/site", publicCors);

  async function publicSite(key: string): Promise<SiteRow | null> {
    if (!/^[a-z0-9-]{2,40}$/.test(key)) return null;
    return one(sql`SELECT * FROM site_sites WHERE key = ${key} AND archived_at IS NULL`);
  }

  /**
   * Every article the public may read now, newest first. `withdrawn` lists the
   * web addresses of articles that WERE public and are not now — a site that
   * still carries an in-code copy of one drops it. `?include=body` adds the
   * bodies (the build wants them in one request).
   */
  app.get("/api/public/site/:siteKey/articles", async (req, res) => {
    try {
      const site = await publicSite(String(req.params.siteKey));
      if (!site) return res.status(404).json({ message: "No such site." });
      const withBody = req.query.include === "body";
      const cacheKey = `${site.key}:list:${withBody ? 1 : 0}`;
      const hit = publicCache.get(cacheKey);
      if (hit && Date.now() - hit.at < PUBLIC_TTL_MS) { res.setHeader("Cache-Control", "public, max-age=30"); return res.json(hit.body); }
      const rows = await all(sql`SELECT a.slug, a.title, a.summary, a.body, a.hero_image, a.author_name, a.tags, a.status, a.publish_at,
          to_char(a.display_date, 'YYYY-MM-DD') AS display_date, a.seo_title, a.seo_description, a.updated_at, a.first_published_at
        FROM site_articles a WHERE a.site_id = ${site.id} AND a.status IN ('published','unpublished','scheduled')
        ORDER BY a.display_date DESC, a.id DESC`);
      const now = new Date();
      const live = rows.filter((a) => articleIsPublic(a, now));
      const withdrawn = rows.filter((a) => !articleIsPublic(a, now) && a.first_published_at).map((a) => a.slug);
      const body = {
        site: { key: site.key, name: site.name, domain: site.domain },
        generated: now.toISOString(), contentChangedAt: site.content_changed_at,
        total: live.length,
        articles: live.map((a) => publicArticle(a, site.settings ?? {}, withBody)),
        withdrawn,
      };
      publicCache.set(cacheKey, { at: Date.now(), body });
      res.setHeader("Cache-Control", "public, max-age=30");
      res.json(body);
    } catch (e: any) { res.status(500).json({ message: "Something went wrong." }); console.error("[sites] public list", e); }
  });

  app.get("/api/public/site/:siteKey/articles/:slug", async (req, res) => {
    try {
      const site = await publicSite(String(req.params.siteKey));
      if (!site) return res.status(404).json({ message: "No such site." });
      const a = await one(sql`SELECT a.slug, a.title, a.summary, a.body, a.hero_image, a.author_name, a.tags, a.status, a.publish_at,
          to_char(a.display_date, 'YYYY-MM-DD') AS display_date, a.seo_title, a.seo_description, a.updated_at
        FROM site_articles a WHERE a.site_id = ${site.id} AND a.slug = ${String(req.params.slug)}`);
      if (!a || !articleIsPublic(a)) return res.status(404).json({ message: "No such article." });
      res.setHeader("Cache-Control", "public, max-age=30");
      res.json({ article: publicArticle(a, site.settings ?? {}, true) });
    } catch (e: any) { res.status(500).json({ message: "Something went wrong." }); console.error("[sites] public one", e); }
  });

  /** When did the public side last change? The rebuild watcher polls this. */
  app.get("/api/public/site/:siteKey/status", async (req, res) => {
    try {
      const site = await publicSite(String(req.params.siteKey));
      if (!site) return res.status(404).json({ message: "No such site." });
      res.setHeader("Cache-Control", "no-store");
      res.json({ key: site.key, contentChangedAt: site.content_changed_at });
    } catch (e: any) { res.status(500).json({ message: "Something went wrong." }); }
  });
}

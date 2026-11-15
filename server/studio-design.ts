/**
 * Content Studio — the DESIGNER engine. Rambo lays the piece out itself in
 * HTML and CSS (to the club's design craft and the brand's pack), the server
 * checks it, a real browser renders it on a phone and a laptop, Rambo LOOKS at
 * the screenshots and fixes what is wrong, and the result is stored.
 *
 * Daniel, 2026-11-01: "I want that level of output through our content studio
 * for all the stuff … I just want those tools to be really, really good."
 *
 * Safety is three walls, each enough on its own for its job:
 *   1. The model's HTML holds no words, pictures or links — only tokens
 *      (shared/studio-designed.ts). Pictures are checked against the club's
 *      own library, links in one place.
 *   2. sanitiseDesignHtml(): an allowlist of tags and attributes, no script,
 *      no handlers, no forms, no frames; CSS scrubbed of imports and outside
 *      urls.
 *   3. Every designed page is served with a Content-Security-Policy that runs
 *      no script and loads nothing but our pictures and Google Fonts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Parser } from "htmlparser2";
import sharp from "sharp";

import { db } from "./db";
import { studioGenerations } from "@shared/schema";
import { mailerAiCostCents, type MailerAiTokenUsage } from "@shared/mailer-ai";
import { artboardFor, graphicSize, isAllowedHref, isAllowedPicture, studioBrand, STUDIO_DEFAULT_EDIT_MODEL, STUDIO_DEFAULT_MODEL, type Checked } from "@shared/studio";
import {
  countSlides,
  DESIGNED_LIMITS, FONT_PARAM_RE, renderDesignedGraphic, renderDesignedPage, TOKEN_RE,
  type DesignedDoc, type DesignedImage, type DesignedLink, type DesignedText,
} from "@shared/studio-designed";
import { brandPack } from "@shared/studio-brand-packs";
import { brandVoice, HOUSE_VOICE } from "@shared/studio-voice";
import { CLUB_LOGOS } from "../client/src/components/marketing/grapes/templates/brand-kit";
import { DESIGN_CRAFT } from "./studio-craft";
import { programmeFactsFor } from "./brand-facts";
import { pictureLibrary, promptPictures } from "./studio-ai";
import { findLogo } from "./studio-logo";
import { storeMailerImage } from "./mailer-images";
import { shrinkForEmail } from "./mailer-image-shrink";

export const DESIGN_MODEL = process.env.STUDIO_DESIGN_MODEL || process.env.STUDIO_MODEL || STUDIO_DEFAULT_MODEL;
export const DESIGN_EDIT_MODEL = process.env.STUDIO_EDIT_MODEL || STUDIO_DEFAULT_EDIT_MODEL;
const EFFORT = (process.env.STUDIO_DESIGN_EFFORT || "medium") as "low" | "medium" | "high";
const LOOK_ROUNDS = Math.max(0, Math.min(2, parseInt(process.env.STUDIO_LOOK_ROUNDS || "1", 10) || 0));
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Wall 2: the HTML and CSS allowlist ──────────────────────────────────────

const ALLOWED_TAGS = new Set([
  "div", "span", "section", "header", "footer", "main", "article", "aside", "nav", "figure", "figcaption",
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "strong", "em", "b", "i", "small", "mark", "s", "sup", "sub", "br", "hr",
  "ul", "ol", "li", "dl", "dt", "dd", "a", "img", "blockquote", "cite", "time", "details", "summary",
  "table", "thead", "tbody", "tr", "th", "td",
  "svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern",
]);
const VOID_TAGS = new Set(["br", "hr", "img"]);
/** Dropped with everything inside them. */
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "textarea", "select", "title", "head", "video", "audio", "canvas", "foreignobject", "math", "frame", "frameset", "applet"]);
const COMMON_ATTRS = new Set(["class", "id", "style", "role", "aria-hidden", "aria-label", "title"]);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href"]),
  img: new Set(["src", "width", "height", "loading", "decoding"]),
  time: new Set(["datetime"]),
  details: new Set(["open"]),
  td: new Set(["colspan", "rowspan"]), th: new Set(["colspan", "rowspan", "scope"]),
  ol: new Set(["start", "reversed"]),
};
const SVG_ATTRS = new Set([
  "viewbox", "xmlns", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit",
  "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "width", "height", "points", "transform", "opacity", "fill-opacity", "stroke-opacity",
  "fill-rule", "clip-rule", "clip-path", "mask", "offset", "stop-color", "stop-opacity", "gradientunits", "gradienttransform", "patternunits", "preserveaspectratio", "vector-effect",
]);
const SVG_TAGS = new Set(["svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern"]);

const attrEsc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textEsc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** CSS: no imports, no outside urls (a token picture, an in-document #id or a
 *  small inline image only), no legacy script hooks, nothing that closes the
 *  <style> it lives in. */
export function scrubCss(css: string): string {
  let s = String(css ?? "").slice(0, DESIGNED_LIMITS.cssChars);
  s = s.replace(/</g, "").replace(/@import[^;]*;?/gi, "").replace(/@charset[^;]*;?/gi, "");
  s = s.replace(/expression\s*\(/gi, "(").replace(/javascript\s*:/gi, "").replace(/-moz-binding|behavior\s*:/gi, "");
  s = s.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_m, _q, inner: string) => {
    const u = inner.trim();
    if (/^\{\{img:[a-z0-9_-]{1,40}\}\}$/.test(u)) return `url("${u}")`;
    if (/^#[A-Za-z][\w-]{0,60}$/.test(u)) return `url(${u})`;
    if (/^data:image\/(svg\+xml|png|jpeg|webp)[;,]/i.test(u) && u.length < 6000 && !/["'\\]/.test(u.replace(/^data:image\/svg\+xml[^,]*,/i, ""))) return `url("${u}")`;
    return "none";
  });
  return s;
}

export interface Sanitised { html: string; css: string; literalWords: string[]; dropped: string[] }

/** The model's body HTML through the allowlist. A stray <style> block is moved
 *  into the CSS; words written straight into the HTML are reported (they must
 *  be tokens, or nobody could edit them). */
export function sanitiseDesignHtml(input: string): Sanitised {
  const out: string[] = [];
  const stack: string[] = [];
  const literalWords: string[] = [];
  const dropped = new Set<string>();
  let skipDepth = 0;
  let skipTag = "";
  let styleText = "";
  let inStyle = false;
  const parser = new Parser({
    onopentag(name, attribs) {
      if (skipDepth) { if (name === skipTag) skipDepth++; return; }
      if (name === "style") { inStyle = true; return; }
      if (DROP_WITH_CONTENT.has(name)) { skipDepth = 1; skipTag = name; dropped.add(name); return; }
      if (!ALLOWED_TAGS.has(name)) { if (!["html", "body"].includes(name)) dropped.add(name); return; }
      const isSvg = SVG_TAGS.has(name);
      const allowed = TAG_ATTRS[name];
      const parts: string[] = [];
      for (const [kRaw, vRaw] of Object.entries(attribs)) {
        const k = kRaw.toLowerCase();
        let v = String(vRaw ?? "");
        if (/^on/.test(k) || /javascript\s*:|vbscript\s*:/i.test(v)) continue;
        const ok = COMMON_ATTRS.has(k) || (allowed?.has(k) ?? false) || (isSvg && SVG_ATTRS.has(k));
        if (!ok) continue;
        if (k === "href") {
          if (!/^\{\{href:[a-z0-9_-]{1,40}\}\}$/.test(v) && !/^#[A-Za-z][\w-]{0,60}$/.test(v)) continue;
        }
        if (k === "src") { if (!/^\{\{img:[a-z0-9_-]{1,40}\}\}$/.test(v)) continue; }
        if (k === "style") v = scrubCss(v).replace(/"/g, "'");
        if (isSvg && /url\(/i.test(v) && !/^url\(#[A-Za-z][\w-]{0,60}\)$/.test(v.trim())) continue;
        if (k === "id" && !/^[A-Za-z][\w-]{0,60}$/.test(v)) continue;
        parts.push(`${k}="${attrEsc(v)}"`);
      }
      if (name === "a") parts.push(`rel="noopener"`);
      out.push(`<${name}${parts.length ? " " + parts.join(" ") : ""}>`);
      if (!VOID_TAGS.has(name)) stack.push(name);
    },
    ontext(text) {
      if (inStyle) { styleText += text; return; }
      if (skipDepth) return;
      const bare = text.replace(TOKEN_RE, " ").replace(/\{\{form\}\}/g, " ");
      const words = bare.match(/[A-Za-z][A-Za-z'’]+/g);
      if (words && words.length) literalWords.push(bare.trim().slice(0, 60));
      out.push(textEsc(text));
    },
    onclosetag(name) {
      if (name === "style" && inStyle) { inStyle = false; return; }
      if (skipDepth) { if (name === skipTag) skipDepth--; return; }
      if (VOID_TAGS.has(name) || !ALLOWED_TAGS.has(name)) return;
      const at = stack.lastIndexOf(name);
      if (at === -1) return;
      while (stack.length > at) out.push(`</${stack.pop()}>`);
    },
  }, { decodeEntities: true, recognizeSelfClosing: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.write(String(input ?? "").slice(0, DESIGNED_LIMITS.htmlChars * 2));
  parser.end();
  while (stack.length) out.push(`</${stack.pop()}>`);
  return { html: out.join(""), css: styleText ? scrubCss(styleText) : "", literalWords, dropped: Array.from(dropped) };
}

// ── The document check (model answers and human edits alike) ───────────────

const KEY_RE = /^[a-z0-9_-]{1,40}$/;
const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);

export function checkDesignedDoc(raw: unknown, pictureOk: (url: string) => boolean = isAllowedPicture): Checked<DesignedDoc> {
  const problems: string[] = [];
  const r = (raw ?? {}) as any;
  const texts: DesignedText[] = [];
  const images: DesignedImage[] = [];
  const links: DesignedLink[] = [];
  const seen = new Set<string>();
  const key = (k: unknown, list: string) => {
    const s = String(k ?? "").trim().toLowerCase();
    if (!KEY_RE.test(s)) { problems.push(`a ${list} key "${String(k).slice(0, 30)}" is not a-z, 0-9, _ or -`); return null; }
    if (seen.has(`${list}:${s}`)) { problems.push(`the ${list} key "${s}" is used twice`); return null; }
    seen.add(`${list}:${s}`);
    return s;
  };
  for (const t of (Array.isArray(r.texts) ? r.texts : []).slice(0, DESIGNED_LIMITS.texts)) {
    const k = key(t?.key, "text"); if (!k) continue;
    texts.push({ key: k, label: str(t?.label, 80) || k, value: str(t?.value, DESIGNED_LIMITS.textChars), ...(t?.multiline ? { multiline: true } : {}) });
  }
  for (const im of (Array.isArray(r.images) ? r.images : []).slice(0, DESIGNED_LIMITS.images)) {
    const k = key(im?.key, "img"); if (!k) continue;
    const src = String(im?.src ?? "").trim();
    if (src && !pictureOk(src)) problems.push(`picture "${k}" is not one of the club's pictures: ${src.slice(0, 120)}`);
    images.push({ key: k, label: str(im?.label, 80) || k, src: src && pictureOk(src) ? src : "", alt: str(im?.alt, 300) });
  }
  for (const l of (Array.isArray(r.links) ? r.links : []).slice(0, DESIGNED_LIMITS.links)) {
    const k = key(l?.key, "href"); if (!k) continue;
    const href = String(l?.href ?? "").trim();
    if (!isAllowedHref(href)) problems.push(`link "${k}" is not a full https://, mailto: or tel: address: ${href.slice(0, 120)}`);
    links.push({ key: k, label: str(l?.label, 80) || k, href: isAllowedHref(href) ? href : "" });
  }
  const html = String(r.html ?? "");
  if (!html.trim()) problems.push("the html is empty");
  if (html.length > DESIGNED_LIMITS.htmlChars) problems.push(`the html is ${html.length} characters — keep it under ${DESIGNED_LIMITS.htmlChars}`);
  const s = sanitiseDesignHtml(html);
  const css = scrubCss(String(r.css ?? "")) + (s.css ? `\n${s.css}` : "");
  if (s.literalWords.length) problems.push(`words are written straight into the html (${s.literalWords.slice(0, 3).map((w) => `"${w}"`).join(", ")}) — every visible word must be a {{t:key}} token with its value in texts`);
  if (s.dropped.length) problems.push(`these tags are not allowed and were removed: ${s.dropped.join(", ")}`);
  // Every token must point at something; unused entries are dropped quietly.
  const used = { t: new Set<string>(), img: new Set<string>(), href: new Set<string>() };
  for (const m of Array.from((s.html + css).matchAll(TOKEN_RE))) used[m[1] as "t" | "img" | "href"].add(m[2]);
  const missing = [
    ...Array.from(used.t).filter((k) => !texts.some((x) => x.key === k)).map((k) => `{{t:${k}}}`),
    ...Array.from(used.img).filter((k) => !images.some((x) => x.key === k)).map((k) => `{{img:${k}}}`),
    ...Array.from(used.href).filter((k) => !links.some((x) => x.key === k)).map((k) => `{{href:${k}}}`),
  ];
  if (missing.length) problems.push(`these tokens have no entry in texts/images/links: ${missing.slice(0, 8).join(", ")}`);
  if (s.html.includes("{{form}}")) {
    for (const k of ["form_button", "form_sent"]) if (!texts.some((x) => x.key === k)) problems.push(`the page has a {{form}} but no "${k}" text box — add it`);
    used.t.add("form_button"); used.t.add("form_sent");
  }
  const fonts = (Array.isArray(r.fonts) ? r.fonts : []).map((f: unknown) => String(f).trim()).filter((f: string) => FONT_PARAM_RE.test(f)).slice(0, DESIGNED_LIMITS.fonts);
  const title = str(r.title, 120).trim();
  if (!title) problems.push("the title is empty");
  const doc: DesignedDoc = {
    engine: "designed",
    title,
    ...(r.description ? { description: str(r.description, 300) } : {}),
    fonts,
    css,
    html: s.html,
    texts: texts.filter((x) => used.t.has(x.key)),
    images: images.filter((x) => used.img.has(x.key)),
    links: links.filter((x) => used.href.has(x.key)),
  };
  return { ok: problems.length === 0, doc, problems };
}

// ── The browser that looks at it (usg-render on Vercel) ─────────────────────

export function renderAvailable(): boolean {
  return !!(process.env.STUDIO_RENDER_URL && process.env.STUDIO_RENDER_KEY);
}

export async function renderShot(opts: { html: string; width: number; height: number; fullPage?: boolean; maxHeight?: number; format?: "png" | "jpeg"; quality?: number; scale?: 1 | 2 }): Promise<{ buffer: Buffer; pageHeight: number } | null> {
  if (!renderAvailable()) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 55_000);
  try {
    const r = await fetch(process.env.STUDIO_RENDER_URL!, {
      method: "POST",
      headers: { "content-type": "application/json", "x-render-key": process.env.STUDIO_RENDER_KEY! },
      body: JSON.stringify(opts),
      signal: ctl.signal,
    });
    if (!r.ok) { console.error("[studio-render]", r.status, (await r.text()).slice(0, 200)); return null; }
    return { buffer: Buffer.from(await r.arrayBuffer()), pageHeight: parseInt(r.headers.get("x-page-height") || "0", 10) || 0 };
  } catch (e: any) {
    console.error("[studio-render] failed:", e?.message);
    return null;
  } finally { clearTimeout(timer); }
}

/** Cut a tall screenshot into pieces the model can actually read. */
async function slices(buf: Buffer, sliceHeight: number, max: number): Promise<Buffer[]> {
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0, h = meta.height ?? 0;
  if (!w || !h) return [];
  const out: Buffer[] = [];
  for (let top = 0; top < h && out.length < max; top += sliceHeight) {
    out.push(await sharp(buf).extract({ left: 0, top, width: w, height: Math.min(sliceHeight, h - top) }).jpeg({ quality: 70 }).toBuffer());
  }
  return out;
}

type ImageBlock = Anthropic.ImageBlockParam;
const img = (b: Buffer, mime: "image/jpeg" | "image/png" = "image/jpeg"): ImageBlock => ({ type: "image", source: { type: "base64", media_type: mime, data: b.toString("base64") } });

/** Screenshots of the piece as it renders, as content blocks for the model. */
export type DesignKind = "page" | "graphic" | "carousel";
export interface DrawnSlide { buffer: Buffer; width: number; height: number; slide: number }

/** One artboard (or one slide of a carousel) at its REAL pixel size, drawn
 *  inside the render service's limits and scaled back (artboardFor). */
export async function drawArtboard(doc: DesignedDoc, brandKey: string, sizeKey: string | null | undefined, slide?: number): Promise<DrawnSlide | null> {
  const size = graphicSize(sizeKey);
  const a = artboardFor(size);
  const shot = await renderShot({ html: renderDesignedGraphic(doc, brandKey, a.width, a.height, slide), width: a.width, height: a.height, format: "png", scale: a.scale });
  if (!shot) return null;
  let buffer = shot.buffer;
  const meta = await sharp(buffer).metadata();
  if (meta.width !== a.outWidth || meta.height !== a.outHeight) buffer = await sharp(buffer).resize(a.outWidth, a.outHeight, { fit: "fill" }).png().toBuffer();
  return { buffer, width: a.outWidth, height: a.outHeight, slide: slide ?? 0 };
}

/** Every slide of a carousel (or the one artboard of a graphic). */
export async function drawAll(doc: DesignedDoc, kind: "graphic" | "carousel", brandKey: string, sizeKey: string | null | undefined): Promise<DrawnSlide[]> {
  if (kind === "graphic") { const one = await drawArtboard(doc, brandKey, sizeKey); return one ? [one] : []; }
  const n = Math.min(countSlides(doc), 12);
  const out = await Promise.all(Array.from({ length: n }, (_, i) => drawArtboard(doc, brandKey, sizeKey, i)));
  return out.filter(Boolean) as DrawnSlide[];
}

async function lookAt(doc: DesignedDoc, kind: DesignKind, brandKey: string, sizeKey?: string): Promise<{ blocks: Anthropic.ContentBlockParam[]; pngs?: DrawnSlide[] } | null> {
  if (kind !== "page") {
    const size = graphicSize(sizeKey);
    const pngs = await drawAll(doc, kind, brandKey, sizeKey);
    if (!pngs.length) return null;
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const p of pngs) {
      // The model reads a JPEG at most 1200px on its long side; the PNG is kept for export.
      const view = await sharp(p.buffer).resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      blocks.push({ type: "text", text: kind === "carousel" ? `Slide ${p.slide + 1} of ${pngs.length}, rendered at ${size.width}×${size.height}:` : `Your graphic, rendered at its real size ${size.width}×${size.height}:` }, img(view));
    }
    return { blocks, pngs };
  }
  const page = renderDesignedPage(doc, brandKey, { noindex: true });
  const [phone, desk] = await Promise.all([
    renderShot({ html: page, width: 390, height: 844, fullPage: true, maxHeight: 7000, format: "jpeg", quality: 72 }),
    renderShot({ html: page, width: 1440, height: 900, fullPage: true, maxHeight: 7200, format: "jpeg", quality: 70 }),
  ]);
  if (!phone || !desk) return null;
  const phoneParts = await slices(phone.buffer, 1400, 5);
  const deskParts = await slices(desk.buffer, 1800, 4);
  return {
    blocks: [
      { type: "text", text: `PHONE, 390px wide, top to bottom (page height ${phone.pageHeight}px${phone.pageHeight > 7000 ? ", cut at 7000" : ""}):` },
      ...phoneParts.map((b) => img(b)),
      { type: "text", text: `DESKTOP, 1440px wide, top to bottom (page height ${desk.pageHeight}px${desk.pageHeight > 7200 ? ", cut at 7200" : ""}):` },
      ...deskParts.map((b) => img(b)),
    ],
  };
}

// ── What the model is told ──────────────────────────────────────────────────

export const DESIGN_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    critique: { type: "string", description: "Only when you were shown screenshots: the problems you saw, one short line each, worst first. Otherwise an empty string." },
    reply: { type: "string", description: "One or two plain sentences to the staff member: what you made and the one thing to check (a price, a date) — or the ONE question you need answered." },
    title: { type: "string", description: "Pages: the browser-tab and share-card title. Graphics: a short working name." },
    description: { type: "string", description: "Pages: one sentence for search engines and the share card. Graphics: empty string." },
    fonts: { type: "array", items: { type: "string" }, description: "1–3 Google Fonts css2 family parameters, e.g. \"Anton\" or \"Inter:wght@400;600;800\"." },
    css: { type: "string", description: "All the CSS. Uses the brand variables. No @import, no url() except url(\"{{img:key}}\")." },
    html: { type: "string", description: "The body content. Every visible word is {{t:key}}, every <img src> is {{img:key}}, every <a href> is {{href:key}} (or #id). No script, no forms." },
    texts: { type: "array", items: { type: "object", properties: { key: { type: "string" }, label: { type: "string" }, value: { type: "string" }, multiline: { type: "boolean" } }, required: ["key", "label", "value", "multiline"], additionalProperties: false } },
    images: { type: "array", items: { type: "object", properties: { key: { type: "string" }, label: { type: "string" }, src: { type: "string" }, alt: { type: "string" } }, required: ["key", "label", "src", "alt"], additionalProperties: false } },
    links: { type: "array", items: { type: "object", properties: { key: { type: "string" }, label: { type: "string" }, href: { type: "string" } }, required: ["key", "label", "href"], additionalProperties: false } },
  },
  required: ["critique", "reply", "title", "description", "fonts", "css", "html", "texts", "images", "links"],
  additionalProperties: false,
};

const promptCache = new Map<string, { at: number; text: string }>();

async function designSystemPrompt(kind: DesignKind, brandKey: string, orgId: number): Promise<string> {
  const cacheKey = `${kind}:${brandKey}:${orgId}`;
  const hit = promptCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.text;
  const brand = studioBrand(brandKey) ?? studioBrand("cufc")!;
  const pack = brandPack(brandKey);
  const facts = await programmeFactsFor(orgId);
  const pictures = promptPictures(await pictureLibrary(orgId, brandKey), brandKey);
  const own = pictures.filter((p) => p.brand === brandKey);
  const other = pictures.filter((p) => p.brand !== brandKey);
  const crests = CLUB_LOGOS.map((l) => `- ${l.src}  (${l.key} crest)`).join("\n");

  const job = kind === "carousel"
    ? `YOUR JOB: design ONE social CAROUSEL — several slides that swipe left to right, one fixed artboard size (in the brief), one design system. Think like an editor first: turn the brief into ONE idea told across the slides — slide 1 is the hook (a bold promise or question that makes them swipe), the middle slides each carry ONE point with the proof, the last slide is the call to action with the crest and the pointer. The html is EXACTLY one top-level <section class="slide"> per slide, in order, nothing else at the top level; each slide is exactly the artboard size (width:100%;height:100vh or the px size) and must stand alone. Cohesive: the same grid, type scale, colours, rules and motif on every slide, with a running device (slide number "02/06", a line or shape that continues across the slide edge, the same photo treatment). Keep 64–96px clear of every edge for words. Word keys per slide: s1_headline, s2_body, … One real photograph on at least the first slide where the list has a fitting one.`
    : kind === "page"
    ? `YOUR JOB: design ONE landing page for this brand from scratch, as a top studio would — distinctive, on brand, built for a phone first. Responsive with @media (min-width: 768px) and (min-width: 1100px). Real photographs from the list carry it. Four to nine sections.`
    : `YOUR JOB: design ONE social graphic on a fixed artboard (the size is in the brief). The body IS the artboard: design to exactly that width and height, nothing may spill or scroll, keep 64–96px clear of every edge for the words (platform UI covers the edges — on a 1080×1920 story keep the top 250px and bottom 300px free of words). One idea, read in two seconds on a phone: a big headline, at most one supporting line, the crest, and a short pointer (a web address or "book at the office" — not a clickable link). A real photograph almost always beats a flat background.`;

  const text = `You are Rambo, the club's own designer inside ClubOS, making content for the club's staff. You design AND write: the layout, the type, the CSS and the words.

OUTPUT CONTRACT — follow exactly or the piece is rejected
- "html" is the inside of <body>. Every visible word is a token {{t:key}} whose words live in "texts" (one entry per token; label = what a staff member would call that box, e.g. "Hero headline", "Camp price"). Write NO words directly in the html — not even "Book now", a heading or a footer line.
- Every <img> has src="{{img:key}}" with the picture in "images" (src = a URL from the lists below, exactly; alt = what the photo shows). A CSS background photo is url("{{img:key}}").
- Every <a> has href="{{href:key}}" with the address in "links" (full https:// from the facts or the brand site, or mailto:/tel:), or href="#section-id" to jump within the page.
- A word box may use *emphasis* (rendered <em>, style it as your highlight) and **bold**; a line break is a new line in the value. Keep each box to one idea so a person can edit it.
- Allowed: semantic tags, <svg> drawings (no <text> in svg — words are tokens), <details>/<summary>, tables. Not allowed: script, style attributes with url() to anything else, forms, inputs, buttons (a button is a styled <a>), iframes, video, @import, external images or fonts other than Google Fonts and the brand's own hosted faces named below.
- No JavaScript runs. CSS only. Never hide content waiting for an animation.
- ENQUIRY FORM: when the brief asks for a form, lead capture, "get in touch" or "enquire", put the token {{form}} (alone, inside an element of yours) where the form goes. ClubOS draws it: <form class="sf"> containing .sf-grid of .sf-field labels (.sf-label text, .sf-input inputs), a .sf-textarea message, and a <button class="sf-submit">; after sending, a .sf-sent message replaces it. Style those classes to the brand (the defaults are plain). Add texts "form_button" (the button words, e.g. "Start the conversation") and "form_sent" (the thank-you line). One form per page.
- A PARTNER'S or SPONSOR'S LOGO: if the request carries a PARTNER LOGOS list, those are the partner's real logo files read from their own website — use the version that reads on your ground (white for dark grounds), as an images entry with key "partner_logo" and alt "<Partner> logo", sized like a co-brand lockup equal in weight to the club crest, never recoloured or stretched; and say in your reply that the logo was found on their website and should be checked. Otherwise a partner's logo is never in your picture lists: if the brief needs one, add an images entry with key "partner_logo", label "Partner logo — upload it in Pictures", src "" and alt naming the partner, and place its <img> where the logo belongs (it stays empty until a staff member uploads the file). Never draw the partner's name as a fake logo.
- "fonts": the brand's display and body faces as Google Fonts css2 parameters.
- Use the brand colour variables (var(--…)) below rather than retyping hexes.

${DESIGN_CRAFT}

BRAND: ${brand.name} (${brand.key}). Site ${brand.host}.
Palette (CSS variables already defined on :root):
${pack.palette.map((c) => `- ${c.token}: ${c.hex} — ${c.use}`).join("\n")}
Fonts: display "${pack.fonts.display}" (${pack.fonts.displayWeights}), body "${pack.fonts.body}" (${pack.fonts.bodyWeights}). ${pack.fonts.note}${pack.houseFonts?.length ? `\nAlready loaded on the page for you (use these family names in your CSS, never in "fonts"): ${Array.from(new Set(pack.houseFonts.map((f) => `'${f.family}'`))).join(", ")}.` : ""}
Brand rules:
${pack.rules}

VOICE: ${brandVoice(brandKey)}

${HOUSE_VOICE}

${job}

${facts}

THIS BRAND'S PHOTOGRAPHS (URL — what it shows). Use a URL exactly as written. Match the people to the audience.
${own.map((p) => `- ${p.src}  (${p.caption})`).join("\n") || "- (none yet — design with colour, type and shape instead)"}

OTHER BRANDS' PHOTOGRAPHS — only when the piece is about that brand:
${other.map((p) => `- ${p.src}  (${p.brand}: ${p.caption})`).join("\n")}

CRESTS (put the brand's crest on every piece as an <img> from "images"; never stretch it):
${crests}`;
  promptCache.set(cacheKey, { at: Date.now(), text });
  return text;
}

// ── One designed piece ──────────────────────────────────────────────────────

export interface DesignInput {
  kind: DesignKind;
  /** Carousels: how many slides to make (new pieces only). */
  slides?: number;
  brandKey: string;
  orgId: number;
  userId: number | null;
  userLabel: string | null;
  brief: string;
  sizeKey?: string;
  current?: DesignedDoc | null;
  history?: { role: "user" | "assistant"; content: string }[];
  pieceId?: number | null;
  onStage?: (stage: string) => void;
}

export interface DesignResult {
  ok: boolean;
  reply: string;
  title: string | null;
  doc: DesignedDoc | null;
  model: string;
  usage: MailerAiTokenUsage;
  costCents: number;
  generationId: number | null;
  /** A graphic's final render (slide 0), ready to store. */
  png?: { buffer: Buffer; width: number; height: number } | null;
  /** Every slide's render (a graphic has one). */
  pngs?: DrawnSlide[];
  looked: number;
  error?: string;
}

function parseOut(res: Anthropic.Message): any | null {
  const text = res.content.filter((c): c is Anthropic.TextBlock => c.type === "text").map((c) => c.text).join("").trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}


// ── A partner's logo, found before designing ────────────────────────────────

const LOGO_HINT = /\blogo|partner|sponsor|\s[x×]\s|co-?brand/i;

/** The partners whose logo the brief wants, their real logo found on their own
 *  website (studio-logo.ts) and hosted here, so the designer can place it.
 *  Best effort: anything that fails leaves the empty slot behind as before. */
export async function partnerLogos(brief: string, brandKey: string, orgId: number, userId: number | null, stage: (s: string) => void): Promise<{ text: string; cents: number }> {
  if (!LOGO_HINT.test(brief) || !process.env.ANTHROPIC_API_KEY) return { text: "", cents: 0 };
  let cents = 0;
  try {
    const res = await client.messages.create({
      model: process.env.STUDIO_EXTRACT_MODEL || "claude-haiku-5-5",
      max_tokens: 200,
      messages: [{ role: "user", content: `Brief for a ${studioBrand(brandKey)?.name ?? brandKey} design:\n"""${brief.slice(0, 3000)}"""\n\nWhich OUTSIDE companies (partners, sponsors — never our own club or brands: Christchurch United, South Island United, Mini Football Leagues, Christchurch International Cup, United Gymnastics, United Sports Centre, United Sports Group, United Prints) does it want a logo of? Give their names or websites as written.` }],
      output_config: { format: { type: "json_schema", schema: { type: "object", additionalProperties: false, properties: { companies: { type: "array", items: { type: "string" } } }, required: ["companies"] } } },
    } as any);
    cents += ((res.usage.input_tokens ?? 0) * 1 + (res.usage.output_tokens ?? 0) * 5) / 10_000;
    const text = res.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    const names: string[] = (JSON.parse(text || "{}").companies ?? []).map((n: unknown) => String(n).trim()).filter((n: string) => n.length > 1).slice(0, 2);
    const lines: string[] = [];
    for (const name of names) {
      stage(`Finding ${name}'s logo`);
      const found = await findLogo(name);
      cents += found.costCents;
      const best = found.candidates.find((c) => !/icon/i.test(c.from)) ?? null;
      if (!best) continue;
      const white = found.candidates.find((c) => c.id === `${best.id}w`) ?? (best.ink === "light" ? best : null);
      const host = async (dataUrl: string, label: string) => {
        const shrunk = await shrinkForEmail(Buffer.from(dataUrl.split(",")[1], "base64"));
        if (!shrunk.ok) return null;
        return (await storeMailerImage({ orgId, userId, originalName: `logo: ${name} (${label})`, originalBytes: null, image: shrunk.image })).url;
      };
      const asIs = await host(best.dataUrl, best.ink);
      const rev = white && white !== best ? await host(white.dataUrl, "white") : null;
      const parts = [asIs && `${best.ink === "light" ? "white artwork (for dark grounds)" : best.ink === "dark" ? "dark artwork (for light grounds)" : "full colour"}: ${asIs}`, rev && `white version for dark grounds: ${rev}`].filter(Boolean);
      if (parts.length) lines.push(`- ${name}${found.site ? ` (from ${found.site}, ${best.from})` : ""} — ${parts.join("; ")}  [${best.width}×${best.height}]`);
    }
    return { text: lines.length ? `\n\nPARTNER LOGOS (their real logo files, read from their own websites; staff will check them):\n${lines.join("\n")}` : "", cents };
  } catch (e) {
    console.error("[studio-design] partner logo lookup failed:", e);
    return { text: "", cents };
  }
}

export async function generateDesigned(input: DesignInput): Promise<DesignResult> {
  const started = Date.now();
  const model = input.current ? DESIGN_EDIT_MODEL : DESIGN_MODEL;
  const usage: MailerAiTokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const stage = (s: string) => { try { input.onStage?.(s); } catch { /* the line may be gone */ } };
  const system = await designSystemPrompt(input.kind, input.brandKey, input.orgId);
  const size = graphicSize(input.sizeKey);
  const board = artboardFor(size);
  const logos = await partnerLogos(input.brief, input.brandKey, input.orgId, input.userId, stage);
  const messages: Anthropic.MessageParam[] = [
    ...(input.history ?? []).slice(-6).map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: input.current
        ? `<current_document>\n${JSON.stringify(input.current)}\n</current_document>\n\n${input.kind !== "page" ? `Artboard: ${board.width}×${board.height} CSS px${board.scale === 2 || board.width !== size.width ? ` (exported at ${size.width}×${size.height})` : ""}.\n` : ""}Change requested: ${input.brief}${logos.text}\n\nReturn the whole document with that change made. Keep everything else as it is unless the change needs it.`
        : `${input.kind !== "page" ? `Artboard: ${size.label} — design at ${board.width}×${board.height} CSS px${board.width !== size.width ? `, exported at ${size.width}×${size.height}` : ""} (${size.use}).\n` : ""}${input.kind === "carousel" ? `Carousel: ${Math.min(10, Math.max(2, input.slides ?? 5))} slides.\n` : ""}Brief: ${input.brief}${logos.text}`,
    },
  ];

  const call = async (): Promise<Anthropic.Message> => {
    const stream = client.messages.stream({
      model,
      max_tokens: 32000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      output_config: { format: { type: "json_schema", schema: DESIGN_SCHEMA }, effort: EFFORT },
    } as any);
    const res = await stream.finalMessage();
    usage.input += res.usage.input_tokens ?? 0;
    usage.output += res.usage.output_tokens ?? 0;
    usage.cacheRead += (res.usage as any).cache_read_input_tokens ?? 0;
    usage.cacheWrite += (res.usage as any).cache_creation_input_tokens ?? 0;
    return res;
  };

  let generationId: number | null = null;
  const record = async (ok: boolean, error: string | null) => {
    try {
      const [row] = await db.insert(studioGenerations).values({
        pieceId: input.pieceId ?? null, userId: input.userId, userLabel: input.userLabel, organizationId: input.orgId, brand: input.brandKey,
        kind: input.kind, model, instruction: input.brief.slice(0, 4000),
        inputTokens: usage.input, outputTokens: usage.output, cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite,
        costUsdCents: String(mailerAiCostCents(model, usage) + logos.cents), durationMs: Date.now() - started, ok, error,
      }).returning({ id: studioGenerations.id });
      generationId = row?.id ?? null;
    } catch (e) { console.error("[studio-design] usage row failed:", e); }
  };
  const fail = async (error: string): Promise<DesignResult> => {
    await record(false, error.slice(0, 500));
    return { ok: false, reply: "", title: null, doc: null, model, usage, costCents: mailerAiCostCents(model, usage) + logos.cents, generationId, looked: 0, error };
  };

  try {
    // 1. Design it (with one chance to fix a document the checks refuse).
    stage(input.current ? "Making the change" : input.kind === "page" ? "Designing the page" : input.kind === "carousel" ? "Planning the slides and designing them" : "Designing the graphic");
    let doc: DesignedDoc | null = null;
    let out: any = null;
    for (let attempt = 0; attempt < 2 && !doc; attempt++) {
      const res = await call();
      if (res.stop_reason === "refusal") return fail("Rambo declined that brief.");
      out = parseOut(res);
      const problems: string[] = [];
      if (res.stop_reason === "max_tokens") problems.push("the answer was cut off — simplify the CSS and keep to fewer sections");
      if (!out) problems.push("the answer was not valid JSON matching the schema");
      const c = out ? checkDesignedDoc(out) : null;
      if (c) problems.push(...c.problems);
      if (c && input.kind === "carousel") {
        const n = countSlides(c.doc), want = input.current ? null : Math.min(10, Math.max(2, input.slides ?? 5));
        if (n < 2) problems.push(`a carousel's html must be one top-level <section class="slide"> per slide — found ${n}`);
        else if (want && n !== want) problems.push(`make exactly ${want} slides (found ${n})`);
      }
      if (!problems.length && c) { doc = c.doc; break; }
      messages.push({ role: "assistant", content: out ? JSON.stringify(out) : "(no valid answer)" });
      messages.push({ role: "user", content: `That document could not be used:\n- ${problems.join("\n- ")}\n\nReturn the whole corrected document.` });
      stage("Fixing what the checks found");
    }
    if (!doc) return fail("Rambo couldn't make a version that passes the checks. Try a shorter or more specific brief.");
    let reply = String(out?.reply ?? "");

    // 2. Look at it in a real browser and fix what is wrong.
    let looked = 0;
    let pngs: DrawnSlide[] = [];
    for (let round = 0; round < LOOK_ROUNDS; round++) {
      stage(input.kind === "page" ? "Looking at it on a phone and a laptop" : input.kind === "carousel" ? "Looking at every slide" : "Looking at it at full size");
      const view = await lookAt(doc, input.kind, input.brandKey, input.sizeKey);
      if (!view) break;
      pngs = view.pngs ?? [];
      looked++;
      messages.push({ role: "assistant", content: JSON.stringify(doc) });
      messages.push({ role: "user", content: [
        ...view.blocks,
        { type: "text", text: `That is your design, rendered in a real browser. Be the art director: run THE CHECK on what you see. Write what is wrong in "critique" (one short line each, worst first), then return the WHOLE corrected document. Keep what already works; change words only where they do not fit their space. If you would ship it as it is, say so in critique and return it unchanged.` },
      ] });
      stage("Fixing what it saw");
      const res = await call();
      const next = parseOut(res);
      const c = next ? checkDesignedDoc(next) : null;
      if (!c?.ok) break; // keep the version that passed
      if (JSON.stringify(c.doc) === JSON.stringify(doc)) break;
      doc = c.doc;
      reply = String(next.reply || reply);
      pngs = [];
    }
    // A graphic always ends with a render of the final version.
    if (input.kind !== "page" && !pngs.length) {
      stage(input.kind === "carousel" ? "Drawing the final slides" : "Drawing the final PNG");
      pngs = await drawAll(doc, input.kind, input.brandKey, input.sizeKey);
    }
    const png = pngs[0] ?? null;
    await record(true, null);
    stage("Done");
    return { ok: true, reply, title: (doc.title || "Untitled").slice(0, 120), doc, model, usage, costCents: mailerAiCostCents(model, usage) + logos.cents, generationId, png, pngs, looked };
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    return fail(e?.status === 429 ? "Rambo is busy right now (rate limited). Try again in a minute."
      : /credit|balance|billing/i.test(msg) ? "The club's Anthropic account is out of credit. Top it up at console.anthropic.com."
      : `Rambo hit a snag: ${msg.slice(0, 200)}`);
  }
}

/** Re-draw a designed graphic after a person edited its words. */
export async function renderDesignedPng(doc: DesignedDoc, brandKey: string, sizeKey: string | null | undefined): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  return drawArtboard(doc, brandKey, sizeKey);
}



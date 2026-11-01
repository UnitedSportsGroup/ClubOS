/**
 * Content Studio — DESIGNED pieces (Daniel, 2026-11-01: "it just looked way
 * worse than what we can produce in here … I want that level of output").
 *
 * The block engine let the model fill words into a fixed template, so every
 * page looked the same. A designed piece is laid out by the model itself, in
 * HTML and CSS, and checked by the server before anything is stored.
 *
 * The contract that keeps it safe AND editable: the model's HTML carries NO
 * words and NO addresses of its own. Every visible word is a token
 * {{t:key}}, every picture {{img:key}}, every link {{href:key}}; the words,
 * pictures and links live in three lists beside it. So:
 *   - a person edits a word in a box and the design does not move;
 *   - a picture can only be one of the club's own (checked per list entry);
 *   - a link is checked once, in one place;
 *   - the HTML itself is sanitised on the server (server/studio-design.ts).
 *
 * Pure string building — shared by the browser (live preview) and the server
 * (the public page, the render for screenshots).
 */
import { brandPack } from "./studio-brand-packs";
import type { TextField } from "./studio";

export interface DesignedText { key: string; label: string; value: string; multiline?: boolean }
export interface DesignedImage { key: string; label: string; src: string; alt: string }
export interface DesignedLink { key: string; label: string; href: string }

export interface DesignedDoc {
  engine: "designed";
  /** The browser tab / share card title (pages) or the piece's name (graphics). */
  title: string;
  description?: string;
  /** Google Fonts css2 family parameters, e.g. "Anton" or "Inter:wght@400;600;800". */
  fonts: string[];
  css: string;
  /** The <body> content, tokens in place of words, pictures and links. */
  html: string;
  texts: DesignedText[];
  images: DesignedImage[];
  links: DesignedLink[];
}

export function isDesignedDoc(doc: unknown): doc is DesignedDoc {
  return !!doc && typeof doc === "object" && (doc as any).engine === "designed";
}

export const TOKEN_RE = /\{\{(t|img|href):([a-z0-9_-]{1,40})\}\}/g;
/** A page's enquiry form: one per page, drawn by us, styled by the design. */
export const FORM_TOKEN = "{{form}}";
export const FONT_PARAM_RE = /^[A-Z][A-Za-z0-9 ]{1,40}(:[a-z]{2,6}(,[a-z]{2,6})?@[0-9;.,]{1,80})?$/;
export const DESIGNED_LIMITS = { texts: 90, images: 16, links: 12, textChars: 1500, htmlChars: 60_000, cssChars: 40_000, fonts: 3 };

/** Where the club's own pictures and the two font hosts are the ONLY outside
 *  requests a designed page may make; no script runs at all. */
export const DESIGNED_CSP = "default-src 'none'; img-src https://app.usg.co.nz data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'self'";

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A word box's value as HTML: escaped, **strong**, *em* (the design styles
 *  em as its highlight), a line break where the person pressed return. */
export function designedWords(v: string): string {
  return esc(v)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\r?\n/g, "<br>");
}

export function designedFontsHref(fonts: string[]): string | null {
  const ok = (fonts ?? []).filter((f) => FONT_PARAM_RE.test(f)).slice(0, DESIGNED_LIMITS.fonts);
  if (!ok.length) return null;
  return `https://fonts.googleapis.com/css2?${ok.map((f) => `family=${f.replace(/ /g, "+")}`).join("&")}&display=swap`;
}

/** The brand's palette as CSS variables the design is told to use. */
export function brandVars(brandKey: string): string {
  const p = brandPack(brandKey);
  return `:root{${p.palette.map((c) => `${c.token}:${c.hex}`).join(";")}}`;
}

/** Swap every token for its value. Pictures and links were checked when the
 *  document was saved; they are attribute-escaped here as well. */
export function fillTokens(src: string, doc: Pick<DesignedDoc, "texts" | "images" | "links">, inCss = false): string {
  const t = new Map(doc.texts.map((x) => [x.key, x]));
  const i = new Map(doc.images.map((x) => [x.key, x]));
  const l = new Map(doc.links.map((x) => [x.key, x]));
  return src.replace(TOKEN_RE, (_m, kind: string, key: string) => {
    if (kind === "t") return inCss ? "" : designedWords(t.get(key)?.value ?? "");
    if (kind === "img") { const s = i.get(key)?.src ?? ""; return inCss ? s.replace(/["'()\\\s]/g, "") : esc(s); }
    return esc(l.get(key)?.href ?? "#");
  });
}

/** Alt text rides with the picture list, not the HTML: after filling, give
 *  every <img> whose src is a listed picture its alt. */
function fillAlts(html: string, doc: DesignedDoc): string {
  const alts = new Map(doc.images.filter((x) => x.src).map((x) => [esc(x.src), esc(x.alt || "")]));
  return html.replace(/<img\b([^>]*?)\ssrc="([^"]*)"([^>]*)>/g, (m, a, src, b) => {
    const alt = alts.get(src);
    if (alt === undefined || /\salt="/.test(a + b)) return m;
    return `<img${a} src="${src}" alt="${alt}"${b}>`;
  });
}

const BASE_CSS = `.sf{display:grid;gap:16px;max-width:640px}.sf-grid{display:grid;gap:16px}@media(min-width:640px){.sf-grid{grid-template-columns:1fr 1fr}}.sf-field{display:grid;gap:6px}.sf-label{font-size:14px;font-weight:600}.sf-optional{font-weight:400;opacity:.6}.sf-input{font:inherit;font-size:16px;min-height:48px;padding:12px 14px;border-radius:10px;border:1px solid currentColor;background:transparent;color:inherit;width:100%}.sf-textarea{min-height:120px;resize:vertical}.sf-submit{font:inherit;font-weight:700;font-size:16px;min-height:52px;padding:0 28px;border:0;border-radius:999px;cursor:pointer;justify-self:start}.sf-note{font-size:13px;opacity:.7}
*,*::before,*::after{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}img,svg{display:block;max-width:100%}img{height:auto}a{color:inherit}h1,h2,h3,h4,p,figure,blockquote{margin:0}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}`;

export interface DesignedPageOpts { noindex?: boolean; url?: string; draftNote?: string; brandName?: string; form?: { action: string; token: string | null; sent?: boolean } }

/** The enquiry form. Plain HTML that posts to ClubOS — no script. The words
 *  come from the "form_button" and "form_sent" boxes when the design has them.
 *  The honeypot ("website") is off-screen and out of the tab order. Without a
 *  live action (a preview) the button says so rather than pretending. */
export function designedForm(doc: DesignedDoc, form: DesignedPageOpts["form"]): string {
  const word = (k: string, d: string) => designedWords(doc.texts.find((t) => t.key === k)?.value || d);
  if (form?.sent) return `<div class="sf-sent" id="enquiry" role="status">${word("form_sent", "Thanks — we've got it and will be in touch.")}</div>`;
  const field = (name: string, label: string, type: string, req: boolean, auto: string) =>
    `<label class="sf-field"><span class="sf-label">${label}${req ? "" : ' <span class="sf-optional">(optional)</span>'}</span><input class="sf-input" name="${name}" type="${type}" autocomplete="${auto}"${req ? " required" : ""}></label>`;
  return `<form class="sf" id="enquiry" method="post" action="${esc(form?.action ?? "#")}">
<div class="sf-grid">${field("name", "Your name", "text", true, "name")}${field("email", "Email", "email", true, "email")}${field("phone", "Phone", "tel", false, "tel")}${field("organisation", "Business or team", "text", false, "organization")}</div>
<label class="sf-field sf-wide"><span class="sf-label">Message</span><textarea class="sf-input sf-textarea" name="message" rows="4" required></textarea></label>
<div aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden"><input name="website" tabindex="-1" autocomplete="off"></div>
${form?.token ? `<input type="hidden" name="formToken" value="${esc(form.token)}">` : ""}
<button class="sf-submit" type="submit"${form ? "" : " disabled"}>${word("form_button", "Send")}</button>
${form ? "" : '<p class="sf-note">Preview — the form works once the page is published.</p>'}
</form>`;
}

/** A whole landing page. */
export function renderDesignedPage(doc: DesignedDoc, brandKey: string, opts: DesignedPageOpts = {}): string {
  const fonts = designedFontsHref(doc.fonts);
  const body = fillAlts(fillTokens(doc.html, doc), doc).replace(FORM_TOKEN, () => designedForm(doc, opts.form));
  const css = fillTokens(doc.css, doc, true);
  const draft = opts.draftNote ? `<div style="position:sticky;top:0;z-index:2147483647;background:#fde68a;color:#1c1917;font:600 13px/1.4 system-ui,sans-serif;padding:8px 16px;text-align:center">${esc(opts.draftNote)}</div>` : "";
  return `<!doctype html><html lang="en-NZ"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${DESIGNED_CSP}">
<title>${esc(doc.title)}</title>${doc.description ? `<meta name="description" content="${esc(doc.description)}">` : ""}
${opts.noindex ? `<meta name="robots" content="noindex,nofollow">` : ""}${opts.url ? `<link rel="canonical" href="${esc(opts.url)}"><meta property="og:url" content="${esc(opts.url)}">` : ""}
<meta property="og:title" content="${esc(doc.title)}">${doc.description ? `<meta property="og:description" content="${esc(doc.description)}">` : ""}${doc.images[0]?.src ? `<meta property="og:image" content="${esc(doc.images[0].src)}">` : ""}
${fonts ? `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${esc(fonts)}">` : ""}
<style>${BASE_CSS}${brandVars(brandKey)}</style><style>${css}</style></head><body>${draft}${body}</body></html>`;
}

/** A graphic: the same document drawn on a fixed artboard. */
export function renderDesignedGraphic(doc: DesignedDoc, brandKey: string, width: number, height: number): string {
  const fonts = designedFontsHref(doc.fonts);
  const body = fillAlts(fillTokens(doc.html, doc), doc);
  const css = fillTokens(doc.css, doc, true);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${width}">
<meta http-equiv="Content-Security-Policy" content="${DESIGNED_CSP}">
${fonts ? `<link rel="stylesheet" href="${esc(fonts)}">` : ""}
<style>${BASE_CSS}${brandVars(brandKey)}html,body{width:${width}px;height:${height}px;overflow:hidden}</style><style>${css}</style></head><body>${body}</body></html>`;
}

/** The boxes a person edits: every word, every link, the page's title. */
export function designedFields(doc: DesignedDoc, kind: "page" | "graphic"): TextField[] {
  const f: TextField[] = [];
  if (kind === "page") {
    f.push({ path: "title", label: "Page title (the browser tab and the share card)", value: doc.title });
    f.push({ path: "description", label: "One-line description (search engines, the share card)", value: doc.description ?? "", multiline: true });
  }
  doc.texts.forEach((t, i) => f.push({ path: `texts.${i}.value`, label: t.label || t.key, value: t.value, multiline: t.multiline || t.value.length > 70 }));
  doc.links.forEach((l, i) => f.push({ path: `links.${i}.href`, label: `${l.label || l.key} — goes to`, value: l.href, href: true }));
  doc.images.forEach((im, i) => f.push({ path: `images.${i}.alt`, label: `${im.label || im.key} — describe the picture`, value: im.alt }));
  return f;
}

/** Where a picture can be swapped. */
export function designedPictureSlots(doc: DesignedDoc): { path: string; label: string; current: string | null }[] {
  return doc.images.map((im, i) => ({ path: `images.${i}.src`, label: im.label || im.key, current: im.src || null }));
}

/** What a list card shows as the headline. */
export function designedHeadline(doc: DesignedDoc): string {
  const h = doc.texts.find((t) => /headline|title|hero/i.test(t.key)) ?? doc.texts[0];
  return (h?.value ?? doc.title ?? "").replace(/\*+/g, "");
}

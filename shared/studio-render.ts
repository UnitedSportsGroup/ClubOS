/**
 * Content Studio — the LOOK. A graphic document becomes an HTML artboard (the
 * browser turns it into a PNG); a page document becomes a complete HTML page
 * (the server publishes it on the brand's own host). The model never writes
 * HTML: it writes words into a document, and this file draws them on brand.
 *
 * Pure string building, no DOM, no network — shared by the client (live
 * preview + PNG capture) and the server (the public page). Every word from a
 * document is escaped on its way in.
 */
import { brandKit, type BrandKit } from "../client/src/components/marketing/grapes/templates/brand-kit";
import { graphicSize, type GraphicDoc, type PageBlock, type PageDoc } from "./studio";

// ── Type ────────────────────────────────────────────────────────────────────

interface DisplayFont {
  family: string;
  /** The css2 "family=" parameter. */
  google: string;
  weight: number;
  upper?: boolean;
  italic?: boolean;
  /** Letter-spacing in em for the headline face. */
  tracking: number;
}

/** One body face (Inter) and one display face per brand. Two fonts, never more. */
export const DISPLAY_FONT: Record<string, DisplayFont> = {
  cufc: { family: "Inter", google: "Inter:wght@400;600;800", weight: 800, tracking: -0.03 },
  siu: { family: "Oswald", google: "Oswald:wght@500;700", weight: 700, upper: true, tracking: 0.01 },
  mfl: { family: "Anton", google: "Anton", weight: 400, upper: true, tracking: 0.01 },
  cic: { family: "Kanit", google: "Kanit:wght@600;800", weight: 800, tracking: -0.02 },
  cugc: { family: "Instrument Serif", google: "Instrument+Serif:ital@0;1", weight: 400, italic: true, tracking: -0.01 },
  usc: { family: "Inter", google: "Inter:wght@400;600;800", weight: 800, tracking: -0.03 },
  usg: { family: "Inter", google: "Inter:wght@400;600;800", weight: 800, tracking: -0.03 },
  prints: { family: "Inter", google: "Inter:wght@400;600;800", weight: 800, tracking: -0.03 },
};
const BODY_GOOGLE = "Inter:wght@400;600;800";

export function displayFont(brandKey: string): DisplayFont {
  return DISPLAY_FONT[brandKey] ?? DISPLAY_FONT.cufc;
}

/** The one stylesheet link a page or an artboard needs. */
export function studioFontsHref(brandKey: string): string {
  const d = displayFont(brandKey);
  const fams = d.google === BODY_GOOGLE ? [BODY_GOOGLE] : [BODY_GOOGLE, d.google];
  return `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f}`).join("&")}&display=swap`;
}

// ── Escaping and the tiny markdown ──────────────────────────────────────────

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const attr = (v: unknown) => esc(v);

/** `**bold**` and line breaks, nothing else. Escaped first. */
export function inlineWords(v: unknown): string {
  return esc(v)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}
/** Paragraphs split on a blank line. */
export function paragraphs(v: unknown, cls = ""): string {
  return String(v ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p${cls ? ` class="${cls}"` : ""}>${inlineWords(p)}</p>`)
    .join("");
}

// ── Colours ─────────────────────────────────────────────────────────────────

interface Palette {
  ground: string;
  ink: string;
  muted: string;
  accent: string;
  accentInk: string;
  rule: string;
}

function hexLum(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function palette(kit: BrandKit, theme: "dark" | "light"): Palette {
  if (theme === "light") {
    return { ground: "#ffffff", ink: "#161616", muted: "#5b5b5b", accent: kit.link, accentInk: kit.onButton, rule: "rgba(22,22,22,0.12)" };
  }
  const ground = kit.footerBg;
  // A brand whose footer is light (none today) still gets readable ink.
  const dark = hexLum(ground) < 0.5;
  return {
    ground,
    ink: dark ? "#ffffff" : "#161616",
    muted: dark ? "rgba(255,255,255,0.72)" : "rgba(22,22,22,0.7)",
    accent: kit.footerAccent,
    accentInk: dark ? ground : "#ffffff",
    rule: dark ? "rgba(255,255,255,0.16)" : "rgba(22,22,22,0.12)",
  };
}

// ── Graphics ────────────────────────────────────────────────────────────────

export interface RenderedGraphic {
  /** A single root element, `width`×`height` px, self-contained. */
  html: string;
  /** Scoped under `.sgx`, safe to inject beside the admin's own styles. */
  css: string;
  fontsHref: string;
  width: number;
  height: number;
}

export function renderGraphic(doc: GraphicDoc, sizeKey: string, brandKey: string): RenderedGraphic {
  const size = graphicSize(sizeKey);
  const kit = brandKit(brandKey);
  const font = displayFont(brandKey);
  const p = palette(kit, doc.theme ?? "dark");
  const W = size.width, H = size.height;
  // Type is scaled by the SHORT side, so a story and a square share a scale
  // and a landscape is not drawn with square-sized type across twice the width.
  const u = Math.min(W, H) / 1080;
  const px = (n: number) => `${Math.round(n * u)}px`;
  const pad = px(84);
  const headlineSize = (() => {
    const len = doc.headline.length;
    const base = doc.layout === "photo" ? 84 : doc.layout === "stat" ? 56 : doc.layout === "chart" ? 60 : 92;
    const scaled = len > 44 ? base * 0.72 : len > 30 ? base * 0.86 : base;
    return px(H > W ? scaled : scaled * 0.9);
  })();
  const dispFamily = `'${font.family}', ${font.family === "Inter" ? "system-ui, sans-serif" : "Georgia, serif"}`;
  const display = `font-family:${dispFamily};font-weight:${font.weight};letter-spacing:${font.tracking}em;line-height:1.02;${font.upper ? "text-transform:uppercase;" : ""}${font.italic ? "font-style:italic;" : ""}`;

  const eyebrow = doc.eyebrow ? `<div class="sgx-eyebrow">${esc(doc.eyebrow)}</div>` : "";
  const sub = doc.sub ? `<div class="sgx-sub">${inlineWords(doc.sub)}</div>` : "";
  const foot = `<div class="sgx-foot"><img class="sgx-crest" src="${attr(kit.crest)}" alt="" />${doc.cta ? `<div class="sgx-cta">${esc(doc.cta)}</div>` : ""}</div>`;

  let body = "";
  switch (doc.layout) {
    case "photo": {
      body = `
        <div class="sgx-photo" style="background-image:url('${attr(doc.photo)}')"></div>
        <div class="sgx-shade"></div>
        <div class="sgx-stack sgx-bottom">${eyebrow}<h1 class="sgx-h">${inlineWords(doc.headline)}</h1>${sub}${foot}</div>`;
      break;
    }
    case "event": {
      const rows = [
        ["When", [doc.event?.date, doc.event?.time].filter(Boolean).join(" · ")],
        ["Where", doc.event?.venue ?? ""],
        ["Cost", doc.event?.price ?? ""],
      ].filter(([, v]) => v);
      body = `<div class="sgx-stack">${eyebrow}<h1 class="sgx-h">${inlineWords(doc.headline)}</h1>${sub}
        <div class="sgx-rows">${rows.map(([k, v]) => `<div class="sgx-row"><div class="sgx-k">${esc(k)}</div><div class="sgx-v">${esc(v)}</div></div>`).join("")}</div>
        <div class="sgx-grow"></div>${foot}</div>`;
      break;
    }
    case "list": {
      body = `<div class="sgx-stack">${eyebrow}<h1 class="sgx-h">${inlineWords(doc.headline)}</h1>${sub}
        <ol class="sgx-list">${(doc.items ?? []).map((it, i) => `<li><span class="sgx-n">${i + 1}</span><span>${inlineWords(it)}</span></li>`).join("")}</ol>
        <div class="sgx-grow"></div>${foot}</div>`;
      break;
    }
    case "stat": {
      body = `<div class="sgx-stack">${eyebrow}<div class="sgx-grow"></div>
        <div class="sgx-stat">${esc(doc.stat?.value ?? "")}</div><div class="sgx-statlabel">${inlineWords(doc.stat?.label ?? "")}</div>
        <h1 class="sgx-h sgx-h-small">${inlineWords(doc.headline)}</h1>${sub}<div class="sgx-grow"></div>${foot}</div>`;
      break;
    }
    case "chart": {
      const items = doc.chart?.items ?? [];
      const max = Math.max(1, ...items.map((i) => i.value));
      const unit = doc.chart?.unit ?? "";
      const fmt = (v: number) => (unit === "$" ? `$${Math.round(v).toLocaleString("en-NZ")}` : `${Math.round(v * 10) / 10}${unit && unit !== "$" ? unit : ""}`);
      body = `<div class="sgx-stack">${eyebrow}<h1 class="sgx-h sgx-h-small">${inlineWords(doc.chart?.title || doc.headline)}</h1>${sub}
        <div class="sgx-bars">${items.map((i) => `<div class="sgx-bar"><div class="sgx-barlabel">${esc(i.label)}</div><div class="sgx-bartrack"><div class="sgx-barfill" style="width:${Math.max(2, Math.round((i.value / max) * 100))}%"></div></div><div class="sgx-barvalue">${esc(fmt(i.value))}</div></div>`).join("")}</div>
        <div class="sgx-grow"></div>${foot}</div>`;
      break;
    }
    case "quote": {
      body = `<div class="sgx-stack">${eyebrow}<div class="sgx-grow"></div><div class="sgx-mark">“</div>
        <div class="sgx-quote">${inlineWords(doc.quote?.text ?? doc.headline)}</div><div class="sgx-by">${esc(doc.quote?.by ?? "")}</div>
        <div class="sgx-grow"></div>${foot}</div>`;
      break;
    }
    default: {
      body = `<div class="sgx-stack">${eyebrow}<div class="sgx-grow"></div><h1 class="sgx-h">${inlineWords(doc.headline)}</h1>${sub}<div class="sgx-grow"></div>${foot}</div>`;
    }
  }

  const css = `
.sgx{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${p.ground};color:${p.ink};font-family:'Inter',system-ui,sans-serif;box-sizing:border-box;-webkit-font-smoothing:antialiased}
.sgx *{box-sizing:border-box;margin:0;padding:0}
.sgx .sgx-stack{position:absolute;inset:0;display:flex;flex-direction:column;padding:${pad};gap:${px(22)}}
.sgx .sgx-bottom{justify-content:flex-end}
.sgx .sgx-grow{flex:1 1 auto}
.sgx .sgx-eyebrow{font-size:${px(26)};font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:${p.accent}}
.sgx .sgx-h{${display}font-size:${headlineSize};color:${p.ink};max-width:${px(930)};overflow-wrap:anywhere}
.sgx .sgx-h-small{font-size:${px(54)}}
.sgx .sgx-sub{font-size:${px(34)};line-height:1.3;color:${p.muted};max-width:${px(880)};font-weight:400}
.sgx .sgx-foot{display:flex;align-items:center;justify-content:space-between;gap:${px(24)};margin-top:${px(12)}}
.sgx .sgx-crest{height:${px(72)};width:auto;display:block}
.sgx .sgx-cta{font-size:${px(26)};font-weight:600;color:${p.ink};background:${p.accent};color:${p.accentInk};padding:${px(16)} ${px(28)};border-radius:${px(999)};white-space:nowrap}
.sgx .sgx-photo{position:absolute;inset:0;background-size:cover;background-position:center}
.sgx .sgx-shade{position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 30%, ${p.ground} 100%)}
.sgx .sgx-rows{display:flex;flex-direction:column;gap:${px(14)};margin-top:${px(18)}}
.sgx .sgx-row{display:flex;gap:${px(24)};align-items:baseline;border-top:1px solid ${p.rule};padding-top:${px(14)}}
.sgx .sgx-k{font-size:${px(22)};font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${p.accent};min-width:${px(150)}}
.sgx .sgx-v{font-size:${px(36)};font-weight:600;color:${p.ink}}
.sgx .sgx-list{list-style:none;display:flex;flex-direction:column;gap:${px(18)};margin-top:${px(10)}}
.sgx .sgx-list li{display:flex;gap:${px(22)};align-items:flex-start;font-size:${px(36)};line-height:1.25;font-weight:600}
.sgx .sgx-n{flex:0 0 ${px(56)};height:${px(56)};border-radius:50%;background:${p.accent};color:${p.accentInk};display:flex;align-items:center;justify-content:center;font-size:${px(26)};font-weight:800}
.sgx .sgx-stat{${display}font-size:${px(220)};line-height:0.95;color:${p.accent}}
.sgx .sgx-statlabel{font-size:${px(38)};font-weight:600;color:${p.ink};margin-top:${px(6)}}
.sgx .sgx-bars{display:flex;flex-direction:column;gap:${px(16)};margin-top:${px(12)}}
.sgx .sgx-bar{display:grid;grid-template-columns:${px(250)} 1fr ${px(170)};align-items:center;gap:${px(18)}}
.sgx .sgx-barlabel{font-size:${px(26)};font-weight:600;color:${p.ink};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sgx .sgx-bartrack{height:${px(34)};background:${p.rule};border-radius:${px(8)};overflow:hidden}
.sgx .sgx-barfill{height:100%;background:${p.accent};border-radius:${px(8)}}
.sgx .sgx-barvalue{font-size:${px(28)};font-weight:800;text-align:right;color:${p.ink};font-variant-numeric:tabular-nums}
.sgx .sgx-mark{${display}font-size:${px(200)};line-height:0.6;color:${p.accent};height:${px(110)}}
.sgx .sgx-quote{${display}font-size:${px(58)};line-height:1.15;color:${p.ink}}
.sgx .sgx-by{font-size:${px(30)};font-weight:600;color:${p.muted};margin-top:${px(10)}}
`.trim();

  return { html: `<div class="sgx" data-layout="${attr(doc.layout)}" data-brand="${attr(brandKey)}">${body}</div>`, css, fontsHref: studioFontsHref(brandKey), width: W, height: H };
}

// ── Pages ───────────────────────────────────────────────────────────────────

export interface PageRenderOptions {
  /** Keeps search engines off a page meant for a link, not a search. */
  noindex?: boolean;
  /** The page's own public address, for the share card. */
  url?: string;
  /** A note drawn under the footer (the admin's draft preview). */
  draftNote?: string;
}

function blockHtml(b: PageBlock, kit: BrandKit): string {
  switch (b.type) {
    case "hero": {
      const photo = b.photo ? ` style="background-image:url('${attr(b.photo)}')"` : "";
      return `<section class="hero${b.photo ? " hero-photo" : ""}"><div class="hero-bg"${photo}></div><div class="wrap hero-in">
        ${b.eyebrow ? `<div class="eyebrow">${esc(b.eyebrow)}</div>` : ""}
        <h1>${inlineWords(b.headline)}</h1>
        ${b.sub ? `<p class="lead">${inlineWords(b.sub)}</p>` : ""}
        ${b.cta ? `<a class="btn" href="${attr(b.cta.href)}">${esc(b.cta.label)}</a>` : ""}
      </div></section>`;
    }
    case "text":
      return `<section class="wrap block"><div class="text">${b.heading ? `<h2>${inlineWords(b.heading)}</h2>` : ""}${paragraphs(b.body)}</div></section>`;
    case "bullets":
      return `<section class="wrap block">${b.heading ? `<h2>${inlineWords(b.heading)}</h2>` : ""}<ul class="bullets">${b.items.map((i) => `<li>${inlineWords(i)}</li>`).join("")}</ul></section>`;
    case "cards":
      return `<section class="wrap block">${b.heading ? `<h2>${inlineWords(b.heading)}</h2>` : ""}<div class="cards">${b.items
        .map((c) => `<div class="card">${c.photo ? `<div class="card-photo" style="background-image:url('${attr(c.photo)}')"></div>` : ""}<div class="card-in"><h3>${inlineWords(c.title)}</h3>${paragraphs(c.body)}</div></div>`)
        .join("")}</div></section>`;
    case "stats":
      return `<section class="wrap block"><div class="stats">${b.items.map((s) => `<div class="stat"><div class="stat-v">${esc(s.value)}</div><div class="stat-l">${esc(s.label)}</div></div>`).join("")}</div></section>`;
    case "photo":
      return `<section class="wrap block"><figure class="photo"><img src="${attr(b.src)}" alt="${attr(b.alt ?? "")}" loading="lazy" />${b.caption ? `<figcaption>${inlineWords(b.caption)}</figcaption>` : ""}</figure></section>`;
    case "faq":
      return `<section class="wrap block">${b.heading ? `<h2>${inlineWords(b.heading)}</h2>` : ""}<div class="faq">${b.items.map((q) => `<details><summary>${inlineWords(q.q)}</summary><div class="faq-a">${paragraphs(q.a)}</div></details>`).join("")}</div></section>`;
    case "cta":
      return `<section class="cta-band"><div class="wrap cta-in"><h2>${inlineWords(b.headline)}</h2>${b.sub ? `<p class="lead">${inlineWords(b.sub)}</p>` : ""}<a class="btn btn-on-brand" href="${attr(b.button.href)}">${esc(b.button.label)}</a></div></section>`;
  }
  return "";
}

export function renderPage(doc: PageDoc, brandKey: string, opts: PageRenderOptions = {}): string {
  const kit = brandKit(brandKey);
  const font = displayFont(brandKey);
  const p = palette(kit, "dark");
  const dispFamily = `'${font.family}', ${font.family === "Inter" ? "system-ui, sans-serif" : "Georgia, serif"}`;
  const hero = doc.blocks.find((b) => b.type === "hero") as Extract<PageBlock, { type: "hero" }> | undefined;
  const ogImage = hero?.photo || (doc.blocks.find((b) => b.type === "photo") as any)?.src || kit.photos[0]?.src || kit.crest;
  const brandName = kit.key === "cugc" ? "United Gymnastics" : kit.key === "cufc" ? "Christchurch United" : kit.key === "siu" ? "South Island United" : kit.key === "mfl" ? "Mini Football Leagues" : kit.key === "cic" ? "Christchurch International Cup" : kit.key === "usc" ? "United Sports Centre" : kit.key === "prints" ? "United Prints" : "United Sports Group";
  const socials = Object.entries(kit.socials).filter(([, v]) => v) as [string, string][];
  const css = `
:root{--brand:${kit.button};--on-brand:${kit.onButton};--link:${kit.link};--ground:#ffffff;--ink:#161616;--muted:#5b5b5b;--rule:rgba(22,22,22,0.12);--foot:${p.ground};--foot-ink:${p.ink};--foot-accent:${p.accent};--ease:cubic-bezier(0.16,1,0.3,1)}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;color:var(--ink);background:var(--ground);line-height:1.55;font-size:17px}
img{max-width:100%;display:block}
a{color:var(--link)}
.wrap{max-width:760px;margin:0 auto;padding:0 20px}
header.top{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--rule)}
header.top .brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink);font-weight:600;font-size:14px}
header.top img{height:40px;width:auto}
header.top nav a{font-size:14px;margin-left:16px;text-decoration:none;color:var(--muted)}
h1{font-family:${dispFamily};font-weight:${font.weight};letter-spacing:${font.tracking}em;line-height:1.05;font-size:clamp(34px,6.2vw,56px);${font.upper ? "text-transform:uppercase;" : ""}${font.italic ? "font-style:italic;" : ""}}
h2{font-family:${dispFamily};font-weight:${font.weight};letter-spacing:${font.tracking}em;line-height:1.1;font-size:clamp(26px,4vw,34px);margin:0 0 14px;${font.upper ? "text-transform:uppercase;" : ""}${font.italic ? "font-style:italic;" : ""}}
h3{font-size:18px;font-weight:700;margin:0 0 6px}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:var(--foot-accent);margin-bottom:14px}
.lead{font-size:19px;color:inherit;opacity:0.85;margin-top:14px;max-width:620px}
.btn{display:inline-block;margin-top:26px;background:var(--brand);color:var(--on-brand);text-decoration:none;font-weight:700;padding:14px 24px;border-radius:999px;font-size:16px;transition:transform .3s var(--ease),opacity .3s var(--ease)}
.btn:hover{transform:translateY(-1px);opacity:.92}
.hero{position:relative;background:var(--foot);color:var(--foot-ink);overflow:hidden}
.hero .hero-bg{position:absolute;inset:0;background-size:cover;background-position:center}
.hero.hero-photo .hero-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.15) 0%,rgba(0,0,0,.65) 100%)}
.hero .hero-in{position:relative;padding-top:72px;padding-bottom:72px}
.hero.hero-photo .hero-in{padding-top:160px}
.hero .eyebrow{color:var(--foot-accent)}
.block{padding:40px 20px}
.block + .block{border-top:1px solid var(--rule)}
.text p{margin:0 0 14px;max-width:640px}
.bullets{list-style:none;display:grid;gap:10px}
.bullets li{position:relative;padding-left:26px}
.bullets li::before{content:"";position:absolute;left:0;top:10px;width:10px;height:10px;border-radius:50%;background:var(--brand)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.card{border:1px solid var(--rule);border-radius:14px;overflow:hidden;background:#fff}
.card-photo{aspect-ratio:3/2;background-size:cover;background-position:center}
.card-in{padding:16px}
.card-in p{font-size:15px;color:var(--muted);margin:0 0 8px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px}
.stat{border-top:2px solid var(--brand);padding-top:12px}
.stat-v{font-family:${dispFamily};font-weight:${font.weight};font-size:40px;line-height:1;color:var(--ink)}
.stat-l{font-size:14px;color:var(--muted);margin-top:6px}
.photo img{border-radius:14px;width:100%}
.photo figcaption{font-size:13px;color:var(--muted);margin-top:8px}
.faq details{border-top:1px solid var(--rule);padding:14px 0}
.faq summary{cursor:pointer;font-weight:600;list-style:none;display:flex;justify-content:space-between;gap:12px}
.faq summary::after{content:"+";color:var(--brand);font-weight:700}
.faq details[open] summary::after{content:"–"}
.faq-a{padding-top:10px;color:var(--muted)}
.faq-a p{margin:0 0 10px}
.cta-band{background:var(--foot);color:var(--foot-ink);margin-top:20px}
.cta-in{padding-top:56px;padding-bottom:56px;text-align:center}
.cta-in .lead{margin-left:auto;margin-right:auto}
.btn-on-brand{background:var(--foot-accent);color:var(--foot)}
footer.foot{background:var(--foot);color:var(--foot-ink);padding:32px 20px;font-size:13px}
footer.foot .wrap{display:flex;flex-direction:column;gap:12px;align-items:flex-start}
footer.foot img{height:44px;width:auto}
footer.foot a{color:var(--foot-ink);opacity:.8;text-decoration:none;margin-right:14px}
footer.foot .addr{opacity:.65}
.draft{background:#fff7e6;color:#7a4a00;border-top:1px solid #ffd58a;text-align:center;padding:10px;font-size:13px}
@media (max-width:480px){header.top nav{display:none}.hero .hero-in{padding-top:48px;padding-bottom:48px}.hero.hero-photo .hero-in{padding-top:120px}.block{padding:32px 20px}}
`.trim();

  return `<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)} — ${esc(brandName)}</title>
${doc.description ? `<meta name="description" content="${attr(doc.description)}">` : ""}
${opts.noindex ? `<meta name="robots" content="noindex, nofollow">` : ""}
<meta property="og:type" content="website">
<meta property="og:title" content="${attr(doc.title)}">
${doc.description ? `<meta property="og:description" content="${attr(doc.description)}">` : ""}
<meta property="og:image" content="${attr(ogImage)}">
${opts.url ? `<meta property="og:url" content="${attr(opts.url)}"><link rel="canonical" href="${attr(opts.url)}">` : ""}
<link rel="icon" href="${attr(kit.crest)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${attr(studioFontsHref(brandKey))}">
<style>${css}</style>
</head>
<body>
<header class="top"><a class="brand" href="${attr(kit.site)}"><img src="${attr(kit.crest)}" alt="${attr(brandName)}"><span>${esc(brandName)}</span></a><nav>${kit.nav.slice(0, 3).map((n) => `<a href="${attr(n.href)}">${esc(n.label)}</a>`).join("")}</nav></header>
<main>
${doc.blocks.map((b) => blockHtml(b, kit)).join("\n")}
</main>
<footer class="foot"><div class="wrap">
<img src="${attr(kit.crest)}" alt="">
<div>${socials.map(([k, v]) => `<a href="${attr(v)}">${esc(k.charAt(0).toUpperCase() + k.slice(1))}</a>`).join("")}<a href="${attr(kit.site)}">${esc(kit.site.replace(/^https?:\/\//, ""))}</a></div>
<div class="addr">${esc(brandName)} · ${esc(kit.address)}</div>
</div></footer>
${opts.draftNote ? `<div class="draft">${esc(opts.draftNote)}</div>` : ""}
</body>
</html>`;
}

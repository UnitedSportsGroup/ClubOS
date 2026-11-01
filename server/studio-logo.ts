// Content Studio — find a partner's real logo.
//
// Daniel, 2026-11-01: "You were saying it can't fetch another partner's logo,
// but my AIOS in here can. What is the mechanism … is it possible to build that
// in?" The mechanism is plain: find the company's official website, read its
// own page for the logo it publishes (the <svg> or <img> in its header, its
// app icon, its share image), and LOOK at the candidates. This file is that,
// with a person doing the looking: it returns every candidate it found, drawn
// on a light and a dark chip, and a person picks one. A logo is a brand's
// signature — the wrong one on a sponsor page is worse than an empty slot, so
// nothing is placed without a human choosing it.
//
// Safety: a person types a company name, so the fetches go to URLs taken from
// the web. Every fetch is https/http only, refuses private and local addresses
// (checked after DNS, and again on every redirect), caps size and time, and
// every picture is re-drawn by sharp into a plain PNG — an SVG's scripts and
// links never survive into what we host.

import dns from "node:dns/promises";
import net from "node:net";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const SITE_MODEL = process.env.STUDIO_LOGO_MODEL || "claude-sonnet-5-5";

export interface LogoCandidate {
  id: string;
  /** Where it came from, in words: "the site's header", "its app icon". */
  from: string;
  sourceUrl: string | null;
  width: number;
  height: number;
  /** "light" = white/pale artwork (for dark grounds), "dark" = for light grounds, "colour" = either. */
  ink: "light" | "dark" | "colour";
  /** The picture itself, as a PNG data URL (max 800px wide). */
  dataUrl: string;
}

export interface LogoSearch { ok: boolean; site: string | null; candidates: LogoCandidate[]; message?: string; costCents: number }

// ── Fetching, safely ────────────────────────────────────────────────────────

function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

async function hostIsPublic(host: string): Promise<boolean> {
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (net.isIP(host)) return !privateIp(host);
  try {
    const addrs = await dns.lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !privateIp(a.address));
  } catch { return false; }
}

/** GET a public URL: redirects followed by hand (each one re-checked), size and time capped. */
export async function safeGet(url: string, maxBytes: number, timeoutMs = 8000): Promise<{ buf: Buffer; type: string; finalUrl: string } | null> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    let u: URL;
    try { u = new URL(current); } catch { return null; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.port && !["80", "443"].includes(u.port)) return null;
    if (!(await hostIsPublic(u.hostname))) return null;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(u, { redirect: "manual", signal: ctl.signal, headers: { "user-agent": UA, accept: "text/html,image/*,*/*;q=0.8" } });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        current = new URL(loc, u).toString();
        continue;
      }
      if (!res.ok || !res.body) return null;
      const len = Number(res.headers.get("content-length") || 0);
      if (len && len > maxBytes) return null;
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of res.body as any) {
        total += chunk.length;
        if (total > maxBytes) { ctl.abort(); return null; }
        chunks.push(Buffer.from(chunk));
      }
      return { buf: Buffer.concat(chunks), type: res.headers.get("content-type") || "", finalUrl: u.toString() };
    } catch { return null; } finally { clearTimeout(t); }
  }
  return null;
}

// ── Finding the official site ───────────────────────────────────────────────

function asSite(q: string): string | null {
  const s = q.trim();
  if (!/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** "Swyftx" → "https://swyftx.com" — the model searches the web and names the official site. */
async function officialSite(company: string): Promise<{ site: string | null; costCents: number }> {
  if (!process.env.ANTHROPIC_API_KEY) return { site: null, costCents: 0 };
  const client = new Anthropic();
  const res = await client.messages.create({
    model: SITE_MODEL,
    max_tokens: 400,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 2 } as any],
    messages: [{ role: "user", content: `What is the official website of the company or organisation "${company}"? (A New Zealand or Australian one if there is any doubt.) Answer with ONLY the homepage URL on one line, or NONE if you cannot be sure.` }],
  } as any);
  const text = res.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
  const m = text.match(/https?:\/\/[^\s)"'<>\]]+/i);
  const searches = (res.usage as any)?.server_tool_use?.web_search_requests ?? 1;
  // Sonnet 5.5 at $3/$15 per million tokens, web search $10 per thousand.
  const cents = ((res.usage.input_tokens ?? 0) * 3 + (res.usage.output_tokens ?? 0) * 15) / 10_000 + searches * 1;
  return { site: m ? m[0].replace(/[.,;]+$/, "") : null, costCents: Math.round(cents * 100) / 100 };
}

/** Ask the render service to open the site and hand back the logo it draws. */
async function browserLogos(site: string): Promise<{ svg?: string; url?: string }[]> {
  const base = process.env.STUDIO_RENDER_URL, key = process.env.STUDIO_RENDER_KEY;
  if (!base || !key) return [];
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 45_000);
  try {
    const res = await fetch(new URL("/api/logos", base), { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", "x-render-key": key }, body: JSON.stringify({ url: site }) });
    if (!res.ok) return [];
    const j: any = await res.json();
    return (Array.isArray(j.logos) ? j.logos : []).slice(0, 6).map((l: any) => l?.kind === "svg" && typeof l.markup === "string" ? { svg: l.markup } : l?.kind === "img" && typeof l.src === "string" ? { url: l.src } : null).filter(Boolean);
  } catch { return []; } finally { clearTimeout(t); }
}

/** Direct links to a company's logo files, found by searching the web. */
async function publishedLogoFiles(company: string): Promise<{ urls: string[]; costCents: number }> {
  if (!process.env.ANTHROPIC_API_KEY) return { urls: [], costCents: 0 };
  const client = new Anthropic();
  const res = await client.messages.create({
    model: SITE_MODEL,
    max_tokens: 600,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 2 } as any],
    messages: [{ role: "user", content: `Find direct URLs of the official logo image files for "${company}" — from the company's own press/media/brand kit page or Wikimedia Commons (upload.wikimedia.org). Prefer SVG, then large PNG. Answer with ONLY the file URLs, one per line (max 4), or NONE.` }],
  } as any);
  const text = res.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  const urls = Array.from(new Set((text.match(/https?:\/\/[^\s)"'<>\]]+\.(svg|png|webp)(\?[^\s)"'<>\]]*)?/gi) ?? []))).slice(0, 4);
  const searches = (res.usage as any)?.server_tool_use?.web_search_requests ?? 1;
  const cents = ((res.usage.input_tokens ?? 0) * 3 + (res.usage.output_tokens ?? 0) * 15) / 10_000 + searches * 1;
  return { urls, costCents: Math.round(cents * 100) / 100 };
}

// ── Reading the page for its logo ───────────────────────────────────────────

interface Raw { from: string; url?: string; svg?: string; rank: number }

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "").trim() : null;
}

function candidatesFrom(html: string, base: string): Raw[] {
  const out: Raw[] = [];
  const abs = (u: string | null) => { if (!u || u.startsWith("data:")) return null; try { return new URL(u, base).toString(); } catch { return null; } };
  const head = html.slice(0, 400_000);
  // <img> and <source> whose name says logo.
  for (const m of Array.from(head.matchAll(/<img\b[^>]*>/gi))) {
    const tag = m[0];
    const hint = `${attr(tag, "src") ?? ""} ${attr(tag, "alt") ?? ""} ${attr(tag, "class") ?? ""} ${attr(tag, "id") ?? ""}`;
    if (!/logo|brand|wordmark/i.test(hint)) continue;
    const u = abs(attr(tag, "src") || attr(tag, "data-src"));
    if (u) out.push({ from: "the logo on its own website", url: u, rank: /\.svg/i.test(u) ? 0 : 1 });
  }
  // Inline <svg> inside something called logo, or the first svg in the header.
  for (const m of Array.from(head.matchAll(/<(a|div|span|header)\b[^>]*(logo|brand)[^>]*>\s*(<svg\b[\s\S]*?<\/svg>)/gi))) {
    out.push({ from: "the logo drawn in its website's header", svg: m[3], rank: 0 });
  }
  const header = head.match(/<header\b[\s\S]*?<\/header>/i)?.[0];
  const firstSvg = header?.match(/<svg\b[\s\S]*?<\/svg>/i)?.[0];
  if (firstSvg && firstSvg.length > 400) out.push({ from: "the first drawing in its website's header", svg: firstSvg, rank: 2 });
  // Any logo file the page mentions anywhere — sites built in JavaScript name
  // their logo in a script or JSON blob rather than an <img>.
  for (const m of Array.from(head.matchAll(/["'(]((?:https?:)?\/\/[^"'()\s]+|\/[^"'()\s]+)\.(svg|png|webp)(\?[^"'()\s]*)?["')]/gi))) {
    const path = m[1] + "." + m[2];
    if (!/logo|wordmark|brandmark/i.test(path) || /favicon|sprite|partner|sponsor|payment|apple-pay|visa|mastercard|appstore|google-?play|badge/i.test(path)) continue;
    const u = abs(path.replace(/\\\//g, "/"));
    if (u) out.push({ from: "a logo file its website uses", url: u, rank: m[2].toLowerCase() === "svg" ? 1 : 2 });
  }
  // Icons the site publishes about itself.
  for (const m of Array.from(head.matchAll(/<link\b[^>]*>/gi))) {
    const tag = m[0];
    const rel = (attr(tag, "rel") || "").toLowerCase();
    if (!/apple-touch-icon|icon|mask-icon/.test(rel)) continue;
    const u = abs(attr(tag, "href"));
    if (u) out.push({ from: rel.includes("apple") ? "its app icon" : "its website icon", url: u, rank: rel.includes("apple") ? 3 : 4 });
  }
  const og = head.match(/<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*>/i)?.[0];
  const ogu = og ? abs(attr(og, "content")) : null;
  if (ogu) out.push({ from: "its share image (often a banner, check it)", url: ogu, rank: 5 });
  // De-duplicate, best first.
  const seen = new Set<string>();
  return out.sort((a, b) => a.rank - b.rank).filter((c) => { const k = c.url ?? c.svg!.slice(0, 300); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
}

/** Wikipedia's infobox image is very often the logo. */
async function wikipediaLogo(company: string): Promise<Raw | null> {
  const q = encodeURIComponent(company);
  const s = await safeGet(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=1&format=json`, 200_000);
  const title = s ? JSON.parse(s.buf.toString("utf8"))?.query?.search?.[0]?.title : null;
  if (!title) return null;
  const p = await safeGet(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&piprop=original&format=json`, 200_000);
  const pages = p ? JSON.parse(p.buf.toString("utf8"))?.query?.pages : null;
  const src = pages ? (Object.values(pages)[0] as any)?.original?.source : null;
  return src && /logo|\.svg/i.test(src) ? { from: `Wikipedia ("${title}")`, url: src, rank: 1 } : null;
}

/** Draw a candidate as a clean, trimmed PNG and say what it looks like. */
async function draw(raw: Raw, i: number): Promise<LogoCandidate | null> {
  let input: Buffer | null = null;
  if (raw.svg) {
    let svg = raw.svg.replace(/<script[\s\S]*?<\/script>/gi, "");
    if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    // A header svg often draws in currentColor; give it the site's likely ink.
    svg = svg.replace(/currentColor/g, "#111111");
    input = Buffer.from(svg);
  } else if (raw.url) {
    const got = await safeGet(raw.url, 4 * 1024 * 1024);
    if (!got) return null;
    input = got.buf;
  }
  if (!input) return null;
  try {
    const isSvg = raw.svg || /<svg[\s>]/i.test(input.subarray(0, 2000).toString("utf8"));
    let img = sharp(input, { density: isSvg ? 300 : 72, limitInputPixels: 40_000_000 }).ensureAlpha();
    img = img.trim({ threshold: 4 });
    const png = await img.resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: !isSvg }).png().toBuffer();
    const meta = await sharp(png).metadata();
    const w = meta.width ?? 0, h = meta.height ?? 0;
    if (w < 48 || h < 24) return null;
    // Ink: the average of the visible pixels.
    const { data, info } = await sharp(png).resize({ width: 120, height: 120, fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let sum = 0, n = 0, sat = 0;
    for (let p = 0; p < data.length; p += info.channels) {
      if (data[p + 3] < 128) continue;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b; n++;
      sat += Math.max(r, g, b) - Math.min(r, g, b);
    }
    if (!n) return null;
    const lum = sum / n, chroma = sat / n;
    const ink = chroma > 60 ? "colour" : lum > 170 ? "light" : lum < 110 ? "dark" : "colour";
    return { id: `c${i}`, from: raw.from, sourceUrl: raw.url ?? null, width: w, height: h, ink, dataUrl: `data:image/png;base64,${png.toString("base64")}` };
  } catch { return null; }
}

export async function findLogo(query: string): Promise<LogoSearch> {
  const q = query.trim().slice(0, 120);
  if (q.length < 2) return { ok: false, site: null, candidates: [], message: "Type the company's name or its website.", costCents: 0 };
  let costCents = 0;
  let site = asSite(q);
  if (!site) { const r = await officialSite(q); site = r.site; costCents += r.costCents; }
  const raws: Raw[] = [];
  if (site) {
    const page = await safeGet(site, 3 * 1024 * 1024);
    if (page && /html/i.test(page.type)) raws.push(...candidatesFrom(page.buf.toString("utf8"), page.finalUrl));
  }
  if (!asSite(q)) { const w = await wikipediaLogo(q).catch(() => null); if (w) raws.push(w); }
  // Only an icon? The site may build its logo in JavaScript (Swyftx does):
  // open it in a real browser (the render service) and take the logo it shows.
  if (site && raws.filter((r) => r.rank <= 2).length === 0) {
    for (const l of await browserLogos(site)) raws.unshift(l.svg ? { from: "the logo on its website (read in a real browser)", svg: l.svg, rank: 0 } : { from: "the logo on its website (read in a real browser)", url: l.url!, rank: 0 });
  }
  // Still only an icon? Ask the web for the company's published logo file
  // (a press kit, a brand page, Wikimedia Commons).
  if (raws.filter((r) => r.rank <= 2).length === 0) {
    const r = await publishedLogoFiles(asSite(q) ? new URL(site!).hostname : q).catch(() => ({ urls: [] as string[], costCents: 0 }));
    costCents += r.costCents;
    r.urls.forEach((u) => raws.push({ from: "a logo file published online (press kit or Wikimedia)", url: u, rank: 1 }));
  }
  const drawn = (await Promise.all(raws.slice(0, 10).map((r, i) => draw(r, i)))).filter(Boolean) as LogoCandidate[];
  // Two copies of the same picture (an svg and its png) — keep the first.
  const seen = new Set<string>();
  const candidates = drawn.filter((c) => { const k = `${c.width}x${c.height}:${c.dataUrl.length >> 6}`; if (seen.has(k)) return false; seen.add(k); return true; });
  // A one-colour dark logo on a dark page needs its reversed (white) version —
  // the standard partner-logo treatment. Made here, labelled as made.
  for (const c of candidates.slice()) {
    if (c.ink !== "dark") continue;
    try {
      const png = Buffer.from(c.dataUrl.split(",")[1], "base64");
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let p = 0; p < data.length; p += 4) { data[p] = 255; data[p + 1] = 255; data[p + 2] = 255; }
      const white = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
      candidates.splice(candidates.indexOf(c) + 1, 0, { ...c, id: `${c.id}w`, from: `${c.from} — reversed to white for dark backgrounds`, ink: "light", dataUrl: `data:image/png;base64,${white.toString("base64")}` });
    } catch { /* keep the original */ }
  }
  if (!candidates.length) return { ok: false, site, candidates, costCents, message: site ? `I read ${site} but found no usable logo on it. Ask the partner for their logo file (SVG or a big PNG) and upload it.` : `I couldn't find ${q}'s website. Type their website address instead.` };
  return { ok: true, site, candidates, costCents };
}

/** A picked candidate back from the browser: re-checked and re-drawn before it is hosted. */
export async function cleanPickedLogo(dataUrl: string): Promise<Buffer | null> {
  const m = String(dataUrl || "").match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 3 * 1024 * 1024) return null;
  try { return await sharp(buf, { limitInputPixels: 4_000_000 }).png().toBuffer(); } catch { return null; }
}

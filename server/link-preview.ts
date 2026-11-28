/**
 * Link previews — what WhatsApp, iMessage, Slack, Facebook and email show when
 * someone pastes a ClubOS link.
 *
 * Daniel, 2026-11-28, with a film link to Scott previewing as "United Sports
 * Group · ClubOS — Sports facility management and online booking": "can we make
 * sure it is suited for each different link not just default for everything
 * because it's just not applicable or correct for everything".
 *
 * Every public page is the same single-page shell, and a link-preview robot
 * reads only the HTML the server sends (it never runs the page). So the server
 * works out, from the HOST and the PATH, what the link is — a film, the film
 * library, a programme, an event, a brand's own domain — and writes that into
 * the shell's <title>, description and Open Graph tags before sending it.
 *
 * Rules:
 *   • Only facts that are already public on the page itself. A film's title,
 *     date and length are shown to anyone holding its link; nothing more is
 *     added (no player, staff or note text).
 *   • Unknown or failing lookups fall back to the brand of the host, never to
 *     an error and never to a slow page: every lookup has a 1.5 s ceiling and the
 *     answer is cached for 5 minutes.
 *   • Staff pages (/admin…) stay "ClubOS".
 */
import { pool } from "./db";
import { WORKSPACE_DOMAINS } from "@shared/org-domains";

export interface LinkPreview {
  title: string;
  description: string;
  siteName: string;
  image: string | null;
  url: string;
  noindex?: boolean;
}

interface Brand { orgId: number | null; name: string; description: string; logo: string }

const BRANDS: Record<number, Omit<Brand, "orgId">> = {
  1: { name: "Christchurch United", description: "Christchurch United Football Club: academy, holiday camps and programmes.", logo: "/logos/christchurch-united.png" },
  2: { name: "South Island United", description: "South Island United, the South Island's club in the OFC Pro League.", logo: "/logos/south-island-united.png" },
  3: { name: "Mini Football Leagues", description: "Social 5-a-side and 7-a-side football leagues in Christchurch.", logo: "/logos/mini-football-leagues-crest.png" },
  4: { name: "United Sports Centre", description: "Book pitches and facilities at United Sports Centre, Christchurch.", logo: "/logos/united-sports-group-royal.png" },
  5: { name: "Christchurch International Cup", description: "The Christchurch International Cup youth football tournament.", logo: "/logos/christchurch-international-cup.png" },
  6: { name: "United Gymnastics", description: "United Gymnastics: classes and holiday camps in Christchurch.", logo: "/logos/united-gymnastics.png" },
  7: { name: "United Sports Group", description: "United Sports Group.", logo: "/logos/united-sports-group-royal.png" },
  8: { name: "United Prints", description: "United Prints: signage, banners and custom printing in Christchurch.", logo: "/logos/united-prints.png" },
};
const CLUBOS: Brand = { orgId: null, name: "ClubOS", description: "ClubOS, United Sports Group's staff system.", logo: "/logos/united-sports-group-royal.png" };
const EXTRA_HOSTS: Record<string, number> = { "shop.unitedprints.co.nz": 8, "ref.minifootball.co.nz": 3 };

function brandForHost(host: string): Brand {
  const h = host.toLowerCase().split(":")[0];
  const w = WORKSPACE_DOMAINS.find((d) => d.joinHost?.toLowerCase() === h);
  const orgId = w?.orgId ?? EXTRA_HOSTS[h] ?? null;
  return orgId && BRANDS[orgId] ? { orgId, ...BRANDS[orgId] } : CLUBOS;
}

const one = async (text: string, params: unknown[]) => (await pool.query(text, params)).rows[0] as Record<string, any> | undefined;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/i;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dayOf(d: unknown): string | null {
  if (d == null) return null;
  let y: number, m: number, day: number;
  if (typeof d === "string") [y, m, day] = d.slice(0, 10).split("-").map(Number);
  else { const x = d as Date; y = x.getFullYear(); m = x.getMonth() + 1; day = x.getDate(); } // pg DATE = local midnight
  return `${DAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]} ${day} ${MONTHS[m - 1]} ${y}`;
}
function clock(s: number): string {
  const t = Math.max(0, Math.floor(s)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
function plain(s: unknown, max = 200): string {
  const t = String(s ?? "").replace(/<[^>]*>/g, " ").replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : t;
}
const KIND: Record<string, string> = { training: "Training", match: "Match", other: "Film" };
const RESERVED = new Set(["login", "signup", "admin", "api", "film", "films", "athlete", "captain", "events", "academy", "league", "book", "share", "members", "membership", "counter", "v", "r", "s", "p", "e"]);

async function resolve(host: string, path: string): Promise<Omit<LinkPreview, "url"> | null> {
  const brand = brandForHost(host);
  const abs = (p: string | null) => (p ? (/^https?:\/\//.test(p) ? p : `https://${host}${p.startsWith("/") ? "" : "/"}${p}`) : null);
  const seg = path.split("?")[0].split("/").filter(Boolean).map((x) => decodeURIComponent(x));
  const orgName = (orgId: number) => BRANDS[orgId]?.name ?? brand.name;

  // One film, by its share link.
  if (seg[0] === "film" && seg[1] && TOKEN.test(seg[1])) {
    const f = await one(`
      select f.title, f.film_date, f.kind, f.organization_id,
        (select coalesce(sum(x.seconds),0)::float from perf_film_files x where x.film_id = f.id and x.archived_at is null and x.role = 'watch') secs,
        (select x.id from perf_film_files x where x.film_id = f.id and x.archived_at is null and x.poster_url is not null order by x.clip, x.role desc limit 1) poster
      from perf_films f where f.share_token = $1 and f.share_enabled and f.archived_at is null`, [seg[1]]);
    if (!f) return { title: `Film · ${brand.name}`, description: "This film link isn't active.", siteName: brand.name, image: abs(brand.logo), noindex: true };
    return {
      title: f.title,
      description: [dayOf(f.film_date), KIND[f.kind] ?? "Film", f.secs ? clock(f.secs) : null].filter(Boolean).join(" · ") + ". Watch and download.",
      siteName: `${orgName(f.organization_id)} · Film`,
      image: f.poster ? abs(`/api/public/film/${seg[1]}/file/${f.poster}/poster`) : abs(BRANDS[f.organization_id]?.logo ?? brand.logo),
      noindex: true,
    };
  }

  // The club's film library, by its one link.
  if (seg[0] === "films" && seg[1] && TOKEN.test(seg[1])) {
    const l = await one(`select organization_id from perf_film_libraries where token = $1 and enabled`, [seg[1]]);
    if (!l) return { title: `Film library · ${brand.name}`, description: "This link isn't active.", siteName: brand.name, image: abs(brand.logo), noindex: true };
    const s = await one(`
      select count(*)::int n, count(*) filter (where f.kind = 'training')::int tr, count(*) filter (where f.kind = 'match')::int ma,
        (select f2.id from perf_films f2 where f2.organization_id = $1 and f2.in_library and f2.archived_at is null
           and exists (select 1 from perf_film_files x where x.film_id = f2.id and x.archived_at is null and x.poster_url is not null)
           order by f2.film_date desc nulls last, f2.id desc limit 1) latest
      from perf_films f where f.organization_id = $1 and f.in_library and f.archived_at is null
        and exists (select 1 from perf_film_files x where x.film_id = f.id and x.archived_at is null)`, [l.organization_id]);
    const poster = s?.latest ? await one(`select id from perf_film_files where film_id = $1 and archived_at is null and poster_url is not null order by clip, role desc limit 1`, [s.latest]) : undefined;
    const parts = [s?.tr ? `${s.tr} training` : null, s?.ma ? `${s.ma} match${s.ma === 1 ? "" : "es"}` : null].filter(Boolean).join(", ");
    return {
      title: `${orgName(l.organization_id)} film library`,
      description: `Training and match film for the coaching staff${parts ? ` (${parts})` : ""}. New film appears here as it is added.`,
      siteName: `${orgName(l.organization_id)} · Film`,
      image: poster && s?.latest ? abs(`/api/public/film-library/${seg[1]}/films/${s.latest}/file/${poster.id}/poster`) : abs(BRANDS[l.organization_id]?.logo ?? brand.logo),
      noindex: true,
    };
  }

  // A ticketed event.
  if (seg[0] === "events" && seg[1] && SLUG.test(seg[1])) {
    const e = await one(`select name, tagline, description, venue_name, starts_at, organization_id from club_events where slug = $1 order by starts_at desc nulls last limit 1`, [seg[1]]);
    if (e) {
      const when = e.starts_at ? dayOf(new Date(new Date(e.starts_at).toLocaleString("en-US", { timeZone: "Pacific/Auckland" }))) : null;
      return {
        title: e.name,
        description: plain(e.tagline || e.description) || [when, e.venue_name].filter(Boolean).join(" · "),
        siteName: brand.orgId ? brand.name : orgName(e.organization_id),
        image: abs(brand.logo),
      };
    }
  }

  // A programme or camp checkout: /academy/:slug · /:slug/class-book · /:slug.
  const progSlug = seg[0] === "academy" && seg[1] ? seg[1] : seg.length === 2 && seg[1] === "class-book" ? seg[0] : seg.length === 1 && !RESERVED.has(seg[0].toLowerCase()) ? seg[0] : null;
  if (progSlug && SLUG.test(progSlug) && brand.orgId) {
    const p = await one(`
      select name, description_short, hero_subheadline, description, hero_image from programs
      where slug = $1 and organization_id = $2 and is_active order by id desc limit 1`, [progSlug, brand.orgId]);
    if (p) {
      return {
        title: `${p.name} · ${brand.name}`,
        description: plain(p.description_short || p.hero_subheadline || p.description) || brand.description,
        siteName: brand.name,
        image: abs(p.hero_image || brand.logo),
      };
    }
  }

  if (seg[0] === "athlete") return { title: "SIU Performance · Daily check-in", description: "South Island United players' daily check-in.", siteName: "South Island United", image: abs(BRANDS[2].logo), noindex: true };
  if (seg[0] === "captain") return { title: `Captain login · ${brand.name}`, description: "Sign in to manage your team, squad and payments.", siteName: brand.name, image: abs(brand.logo) };
  return null;
}

const cache = new Map<string, { at: number; value: LinkPreview }>();
const TTL = 5 * 60_000;

/** The preview for a request. Never throws, never takes longer than ~1.5 s. */
export async function linkPreviewFor(host: string, path: string): Promise<LinkPreview> {
  const h = String(host || "app.usg.co.nz").toLowerCase().split(":")[0];
  const url = `https://${h}${path}`;
  const key = `${h}${path.split("#")[0]}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const brand = brandForHost(h);
  const fallback: LinkPreview = {
    title: brand.orgId ? brand.name : "United Sports Group · ClubOS",
    description: brand.description,
    siteName: brand.name,
    image: `https://${h}${brand.logo}`,
    url,
  };
  let value = fallback;
  if (!path.startsWith("/admin")) {
    try {
      const r = await Promise.race([resolve(h, path), new Promise<null>((ok) => setTimeout(() => ok(null), 1500))]);
      if (r) value = { ...r, url };
    } catch (e) { console.warn("[link-preview]", (e as Error)?.message); }
  }
  if (cache.size > 1000) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Write the preview into the page shell's <head>. */
export function applyLinkPreview(html: string, p: LinkPreview): string {
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(p.siteName)}" />`,
    `<meta property="og:title" content="${esc(p.title)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    `<meta property="og:url" content="${esc(p.url)}" />`,
    p.image ? `<meta property="og:image" content="${esc(p.image)}" />` : "",
    `<meta name="twitter:card" content="${p.image && !/\/logos\//.test(p.image) ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${esc(p.title)}" />`,
    `<meta name="twitter:description" content="${esc(p.description)}" />`,
    p.image ? `<meta name="twitter:image" content="${esc(p.image)}" />` : "",
    p.noindex ? `<meta name="robots" content="noindex, nofollow" />` : "",
  ].filter(Boolean).join("\n    ");
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(p.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(p.description)}" />`)
    .replace("</head>", `    ${tags}\n  </head>`);
}

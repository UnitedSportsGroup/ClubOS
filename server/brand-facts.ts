/**
 * The FACTS a brand's writing may use — read live from ClubOS, never typed
 * into a prompt by hand. What is on sale, when it runs, what it costs, where
 * to book. Rambo in the Mailer and the Studio get this block, so a holiday
 * camp email carries the real dates and the real price, and a landing page's
 * button goes to the real checkout.
 *
 * Daniel, 2026-10-27: "It knows all of our programmes, it knows what we're
 * offering … then it's able to write in our brand voice." It only knows what
 * it is handed; this is the handing.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import { studioBrand, studioBrandForOrgSlug } from "@shared/studio";

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];
const money = (cents: number | null | undefined) => (cents == null ? null : `$${(Number(cents) / 100).toFixed(2).replace(/\.00$/, "")}`);

function niceDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

/** Where a programme sells, on the brand's own join host. */
function checkoutUrl(host: string, type: string, slug: string | null): string | null {
  if (!slug) return null;
  if (type === "academy") return `https://${host}/academy/${slug}`;
  return `https://${host}/${slug}`;
}

const cache = new Map<number, { at: number; text: string }>();
const TTL_MS = 10 * 60_000;

/** A plain-text block of this organisation's live programmes. Cached ten
 *  minutes — a price changed in ClubOS reaches the prompt within that. */
export async function programmeFactsFor(orgId: number): Promise<string> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
  const org = rowsOf(await db.execute(sql`SELECT slug FROM organizations WHERE id = ${orgId}`))[0];
  const brand = studioBrandForOrgSlug(org?.slug) ?? studioBrand("cufc")!;
  const rows = rowsOf(await db.execute(sql`
    SELECT p.id, p.name, p.slug, p.type, p.location, p.start_date::text AS start_date, p.end_date::text AS end_date,
           p.age_min, p.age_max, p.registration_open, p.term_price_cents, p.description_short,
           t.name AS term_name, t.year AS term_year, t.start_date::text AS term_start, t.end_date::text AS term_end,
           (SELECT string_agg(cp.product_type || '=' || cp.price_cents, ',') FROM camp_pricing cp WHERE cp.camp_id = p.id) AS camp_prices,
           (SELECT string_agg(po.name || '=' || coalesce(po.full_price_cents::text, ''), ',') FROM program_options po WHERE po.program_id = p.id AND coalesce(po.is_active, true)) AS options
    FROM programs p
    LEFT JOIN terms t ON t.id = p.term_id
    WHERE p.organization_id = ${orgId} AND p.is_active = true
    ORDER BY p.registration_open DESC, p.type, p.name
    LIMIT 40`));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
  const lines: string[] = [];
  for (const r of rows) {
    // A camp that finished is history, not an offer.
    if (r.type === "holiday_camp" && r.end_date && String(r.end_date).slice(0, 10) < today) continue;
    const bits: string[] = [];
    bits.push(`type ${String(r.type).replace(/_/g, " ")}`);
    if (r.age_min != null || r.age_max != null) bits.push(`ages ${r.age_min ?? "?"}–${r.age_max ?? "?"}`);
    if (r.term_name) bits.push(`${r.term_name} ${r.term_year} (${niceDate(r.term_start)} to ${niceDate(r.term_end)})`);
    else if (r.start_date) bits.push(`${niceDate(r.start_date)}${r.end_date ? ` to ${niceDate(r.end_date)}` : ""}`);
    if (r.location) bits.push(`at ${r.location}`);
    if (r.type === "holiday_camp" && r.camp_prices) {
      const label: Record<string, string> = { FULL_DAY: "full day", MORNING: "morning", AFTERNOON: "afternoon" };
      bits.push("prices " + String(r.camp_prices).split(",").map((kv: string) => { const [k, v] = kv.split("="); return `${label[k] ?? k.toLowerCase()} ${money(Number(v))}`; }).join(", "));
    } else if (r.options) {
      const opts = String(r.options).split(",").map((kv: string) => { const i = kv.lastIndexOf("="); const k = kv.slice(0, i), v = kv.slice(i + 1); return v ? `${k} ${money(Number(v))}` : k; });
      bits.push("options " + opts.join(", "));
    } else if (r.term_price_cents) bits.push(`term price ${money(r.term_price_cents)}`);
    bits.push(r.registration_open ? "registration OPEN" : "registration closed (do not sell it; say 'register your interest' or 'ask the office')");
    const url = checkoutUrl(brand.host, String(r.type), r.slug);
    if (url && r.registration_open) bits.push(`book: ${url}`);
    if (r.description_short) bits.push(`"${String(r.description_short).slice(0, 140)}"`);
    lines.push(`- ${r.name}: ${bits.join(" · ")}`);
  }
  const text = lines.length
    ? `PROGRAMME FACTS (live from ClubOS today, ${today}; the ONLY prices, dates and booking links you may use):\n${lines.join("\n")}`
    : `PROGRAMME FACTS: ClubOS lists no active programmes for this brand today — do not invent any; point people at ${brand.host === "app.usg.co.nz" ? "the club" : brand.host}.`;
  cache.set(orgId, { at: Date.now(), text });
  return text;
}

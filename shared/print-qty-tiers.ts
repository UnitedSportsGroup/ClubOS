/**
 * Quantity pricing — what a product costs as the order gets bigger.
 *
 * Daniel, 2026-09-30: *"we need to be able to set any bulk discounts from
 * clubos backend like 1-10 shirts or hoodies = x price or 10-100 = this price
 * and set it in materials … for some reason they just showing on customer
 * front end."* The engine already applied `qty_tiers_json`, but the Materials
 * tab had no way to see or edit it — so seeded placeholder discounts (up to
 * 28%) were being given away on the website with nobody having set them.
 *
 * Dima, 2026-09-30: *"we can adjust it now but can't SET a price — it still
 * gives $27 at 20 shirts. Let us set the price ourselves per range: one costs
 * this, 2–5 this, 5–10 this, add ranges and adjust prices. Same for banner,
 * mesh, corflute."* So every product takes a SET PRICE per range, and what a
 * "price" means follows how the product is priced:
 *
 *   each  — tees, per-piece, per-unit: $ per item, all-in (replaces blank + print + setup)
 *   m2    — banners, mesh, vinyl, ACM: $ per m² (replaces the base rate; size still counts)
 *   sizes — corflute and other stock-size products: $ per piece FOR EACH SIZE
 *
 * A step applies FROM its quantity upward, until the next step takes over:
 *   { minQty: 1,  unitPriceCents: 3500 }        1–9   → $35 each
 *   { minQty: 10, unitPriceCents: 2900 }        10–99 → $29 each
 *   { minQty: 100, discountPct: 20 }            100+  → 20% off
 *   { minQty: 5, sizePrices: { a3: 1800 } }     5+ A3 corflutes → $18 each
 * Each step is EITHER a % off OR a set price — never both.
 * 🔴 Prices are CENTS and are Dima's to set. Nothing here invents one.
 */

export interface QtyTier {
  minQty: number;
  discountPct?: number;
  /** each → $ per item · m2 → $ per m². Unused on size-priced products. */
  unitPriceCents?: number;
  /** sizes → $ per piece for a stock size (key = the size's id). A size left out pays its normal price. */
  sizePrices?: Record<string, number>;
}

export type QtyPriceKind = "each" | "m2" | "sizes";

/** Pricing methods where a "$ each" step means something. */
export const UNIT_PRICE_METHODS = new Set(["garment_decoration", "per_piece", "per_unit"]);
/** Pricing methods that sell fixed stock sizes, each with its own price. */
export const SIZE_PRICE_METHODS = new Set(["per_piece_tiered", "bundle"]);

/** What a set price means for a product priced this way. */
export function qtyPriceKind(pricingMethod?: string | null): QtyPriceKind {
  if (pricingMethod && SIZE_PRICE_METHODS.has(pricingMethod)) return "sizes";
  if (pricingMethod === "per_m2") return "m2";
  return "each";
}

export const MAX_DISCOUNT_PCT = 90;

const present = (v: unknown) => v !== undefined && v !== null && v !== "";

/** Does this step carry a set price (rather than a % off)? */
export function hasSetPrice(t: QtyTier | null | undefined): boolean {
  if (!t) return false;
  if (present(t.unitPriceCents)) return true;
  return !!t.sizePrices && Object.keys(t.sizePrices).length > 0;
}

/**
 * The one gate between the form and the database.
 * `sizeIds`, when given, are the product's stock-size ids — a per-size price
 * for a size the product doesn't sell is refused rather than stored.
 */
export function normaliseQtyTiers(raw: unknown, pricingMethod?: string | null, sizeIds?: string[] | null): { ok: true; tiers: QtyTier[] } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, tiers: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Quantity pricing must be a list." };
  const kind = qtyPriceKind(pricingMethod);
  const out: QtyTier[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i] as any;
    const row = `Quantity step ${i + 1}`;
    const minQty = Number(t?.minQty);
    if (!Number.isInteger(minQty) || minQty < 1 || minQty > 100000) return { ok: false, error: `${row}: "from" must be a whole number of 1 or more.` };
    if (seen.has(minQty)) return { ok: false, error: `Two steps start at ${minQty} — each step needs its own starting quantity.` };
    seen.add(minQty);
    const hasPct = present(t?.discountPct);
    const hasUnit = present(t?.unitPriceCents);
    const sizeEntries = t?.sizePrices && typeof t.sizePrices === "object" && !Array.isArray(t.sizePrices)
      ? Object.entries(t.sizePrices as Record<string, unknown>).filter(([, v]) => present(v))
      : [];
    const hasPrice = hasUnit || sizeEntries.length > 0;
    if (hasPct === hasPrice) return { ok: false, error: `${row}: set either a % off or a price.` };
    if (hasPct) {
      const pct = Number(t.discountPct);
      if (!Number.isFinite(pct) || pct < 0 || pct > MAX_DISCOUNT_PCT) return { ok: false, error: `${row}: % off must be between 0 and ${MAX_DISCOUNT_PCT}.` };
      out.push({ minQty, discountPct: Math.round(pct * 10) / 10 });
      continue;
    }
    if (kind === "sizes") {
      if (hasUnit) return { ok: false, error: `${row}: this product sells set sizes, so give a price for each size.` };
      const sizePrices: Record<string, number> = {};
      for (const [id, v] of sizeEntries) {
        if (sizeIds && !sizeIds.includes(id)) return { ok: false, error: `${row}: "${id}" isn't one of this product's sizes.` };
        const cents = Number(v);
        if (!Number.isInteger(cents) || cents <= 0) return { ok: false, error: `${row}: every size price must be more than $0.` };
        sizePrices[id] = cents;
      }
      out.push({ minQty, sizePrices });
    } else {
      if (sizeEntries.length) return { ok: false, error: `${row}: this product isn't sold in set sizes.` };
      const cents = Number(t.unitPriceCents);
      if (!Number.isInteger(cents) || cents <= 0) return { ok: false, error: `${row}: the ${kind === "m2" ? "price per m²" : "price each"} must be more than $0.` };
      out.push({ minQty, unitPriceCents: cents });
    }
  }
  out.sort((a, b) => a.minQty - b.minQty);
  return { ok: true, tiers: out };
}

/** The step that applies to this quantity: the highest "from" at or below it. */
export function qtyTierFor(tiers: QtyTier[] | null | undefined, qty: number): QtyTier | null {
  let hit: QtyTier | null = null;
  for (const t of tiers ?? []) if (qty >= t.minQty && (!hit || t.minQty > hit.minQty)) hit = t;
  return hit;
}

/** "1–9", "10–99", "100+" — the range each step covers, for the tab and the site. */
export function qtyTierRanges(tiers: QtyTier[]): string[] {
  const s = [...tiers].sort((a, b) => a.minQty - b.minQty);
  return s.map((t, i) => (s[i + 1] ? (s[i + 1].minQty - 1 === t.minQty ? `${t.minQty}` : `${t.minQty}–${s[i + 1].minQty - 1}`) : `${t.minQty}+`));
}

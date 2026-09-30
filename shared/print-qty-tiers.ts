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
 * A step applies FROM its quantity upward, until the next step takes over:
 *   { minQty: 1,  unitPriceCents: 3500 }   1–9   → $35 each
 *   { minQty: 10, unitPriceCents: 2900 }   10–99 → $29 each
 *   { minQty: 100, discountPct: 20 }       100+  → 20% off
 * Each step is EITHER a % off OR a price each — never both.
 *
 * 🔴 "$ each" only makes sense for things priced per item (shirts, hoodies,
 * a fixed product). A banner priced by the square metre has no single "each"
 * price, so those products take % steps only — the engine refuses the rest.
 * 🔴 Prices are CENTS and are Dima's to set. Nothing here invents one.
 */

export interface QtyTier {
  minQty: number;
  discountPct?: number;
  unitPriceCents?: number;
}

/** Pricing methods where a "$ each" step means something. */
export const UNIT_PRICE_METHODS = new Set(["garment_decoration", "per_piece", "per_unit", "bundle"]);

export const MAX_DISCOUNT_PCT = 90;

/** The one gate between the form and the database. */
export function normaliseQtyTiers(raw: unknown, pricingMethod?: string | null): { ok: true; tiers: QtyTier[] } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, tiers: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Quantity pricing must be a list." };
  const out: QtyTier[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    const row = `Quantity step ${i + 1}`;
    const minQty = Number((t as any)?.minQty);
    if (!Number.isInteger(minQty) || minQty < 1 || minQty > 100000) return { ok: false, error: `${row}: "from" must be a whole number of 1 or more.` };
    if (seen.has(minQty)) return { ok: false, error: `Two steps start at ${minQty} — each step needs its own starting quantity.` };
    seen.add(minQty);
    const hasPct = (t as any)?.discountPct !== undefined && (t as any)?.discountPct !== null && (t as any)?.discountPct !== "";
    const hasUnit = (t as any)?.unitPriceCents !== undefined && (t as any)?.unitPriceCents !== null && (t as any)?.unitPriceCents !== "";
    if (hasPct === hasUnit) return { ok: false, error: `${row}: set either a % off or a price each.` };
    if (hasPct) {
      const pct = Number((t as any).discountPct);
      if (!Number.isFinite(pct) || pct < 0 || pct > MAX_DISCOUNT_PCT) return { ok: false, error: `${row}: % off must be between 0 and ${MAX_DISCOUNT_PCT}.` };
      out.push({ minQty, discountPct: Math.round(pct * 10) / 10 });
    } else {
      if (pricingMethod && !UNIT_PRICE_METHODS.has(pricingMethod)) {
        return { ok: false, error: `${row}: this product is priced by size, so it can only take a % off — not a price each.` };
      }
      const cents = Number((t as any).unitPriceCents);
      if (!Number.isInteger(cents) || cents <= 0) return { ok: false, error: `${row}: the price each must be more than $0.` };
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

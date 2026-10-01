import { normaliseQtyTiers, qtyTierFor, qtyTierRanges } from "../shared/print-qty-tiers";
const ok = (l: string, c: boolean) => console.log(`${c ? "✓" : "✗"} ${l}`);
const g = normaliseQtyTiers([{ minQty: 10, unitPriceCents: 2900 }, { minQty: 1, unitPriceCents: 3500 }, { minQty: 100, discountPct: 20 }], "garment_decoration");
ok("garment: $ each + % steps accepted, sorted", g.ok && g.tiers.map((t) => t.minQty).join() === "1,10,100");
ok("ranges read 1–9, 10–99, 100+", g.ok && qtyTierRanges(g.tiers).join("|") === "1–9|10–99|100+");
ok("qty 9 → $35 step", g.ok && qtyTierFor(g.tiers, 9)?.unitPriceCents === 3500);
ok("qty 10 → $29 step", g.ok && qtyTierFor(g.tiers, 10)?.unitPriceCents === 2900);
ok("qty 150 → 20% off", g.ok && qtyTierFor(g.tiers, 150)?.discountPct === 20);
ok("banner takes a $ per m² price", normaliseQtyTiers([{ minQty: 5, unitPriceCents: 5000 }], "per_m2").ok);
ok("banner takes % off", normaliseQtyTiers([{ minQty: 5, discountPct: 10 }], "per_m2").ok);
ok("both % and $ refused", !normaliseQtyTiers([{ minQty: 5, discountPct: 10, unitPriceCents: 100 }], "per_piece").ok);
ok("duplicate start refused", !normaliseQtyTiers([{ minQty: 5, discountPct: 10 }, { minQty: 5, discountPct: 12 }], "per_m2").ok);
ok("over 90% refused", !normaliseQtyTiers([{ minQty: 5, discountPct: 95 }], "per_m2").ok);
ok("$0 each refused", !normaliseQtyTiers([{ minQty: 1, unitPriceCents: 0 }], "garment_decoration").ok);
ok("empty list = no pricing", (() => { const r = normaliseQtyTiers([], "per_m2"); return r.ok && r.tiers.length === 0; })());
ok("below first step → none", qtyTierFor([{ minQty: 10, discountPct: 5 }], 3) === null);
import { quotePrintItem } from "../server/print-pricing";
const tee: any = { name: "Tee", category: "garment", pricingMethod: "garment_decoration", baseRateCents: 1900, minChargeCents: 6000, markupMultiplier: "1", addonsJson: [], sizeTiersJson: [], turnaroundDays: 5, rushAvailable: false,
  qtyTiersJson: [{ minQty: 1, unitPriceCents: 3500 }, { minQty: 10, unitPriceCents: 2900 }, { minQty: 100, discountPct: 20 }] };
const q = (m: any, qty: number, extra: any = {}) => (quotePrintItem as any)(m, { quantity: qty, ...extra });
const r5: any = q(tee, 5), r10: any = q(tee, 10), r150: any = q(tee, 150);
console.log("5 tees", r5.subtotalCents ?? r5.totalCents, r5.breakdown?.map((b: any) => b.label).join(" | "));
console.log("10 tees", r10.subtotalCents ?? r10.totalCents, r10.breakdown?.map((b: any) => b.label).join(" | "));
console.log("150 tees", r150.subtotalCents ?? r150.totalCents, r150.breakdown?.map((b: any) => b.label).join(" | "));
ok("5 tees = 5 × $35 = $175", (r5.subtotalCents ?? r5.totalCents) === 17500);
ok("10 tees = 10 × $29 = $290", (r10.subtotalCents ?? r10.totalCents) === 29000);
const banner: any = { name: "PVC", category: "banner", pricingMethod: "per_m2", baseRateCents: 5890, minChargeCents: 5890, markupMultiplier: "1", addonsJson: [], sizeTiersJson: [], turnaroundDays: 3, rushAvailable: false, maxRollWidthMm: 1600,
  qtyTiersJson: [{ minQty: 10, discountPct: 15 }] };
const b1: any = q(banner, 1, { widthMm: 1000, heightMm: 1000 }), b10: any = q(banner, 10, { widthMm: 1000, heightMm: 1000 });
console.log("banner 1", b1.subtotalCents, "banner 10", b10.subtotalCents, b10.breakdown?.map((b: any) => b.label).join(" | "));
ok("10 banners get 15% off", b10.subtotalCents === Math.round(58900 * 0.85));
const none: any = q({ ...banner, qtyTiersJson: [] }, 10, { widthMm: 1000, heightMm: 1000 });
ok("no steps = no discount", none.subtotalCents === 58900);

// ── Set prices on size-priced products (Dima, 2026-09-30: "same for banner, mesh, corflute") ──
const bm2: any = { ...banner, qtyTiersJson: [{ minQty: 1, unitPriceCents: 6500 }, { minQty: 5, unitPriceCents: 5000 }] };
const m1: any = q(bm2, 1, { widthMm: 2000, heightMm: 1000 }), m5: any = q(bm2, 5, { widthMm: 2000, heightMm: 1000 }), m5d: any = q(bm2, 5, { widthMm: 2000, heightMm: 1000, sides: 2 });
console.log("banner $/m²: 1 →", m1.subtotalCents, "| 5 →", m5.subtotalCents, m5.breakdown?.map((b: any) => b.label).join(" | "));
ok("1 banner 2 m² @ $65/m² = $130", m1.subtotalCents === 13000);
ok("5 banners 2 m² @ $50/m² = $500", m5.subtotalCents === 50000);
ok("double-sided keeps ×1.7 on the set m² price", m5d.subtotalCents === 85000);
const corf: any = { name: "Corflute", category: "signage", pricingMethod: "per_piece_tiered", baseRateCents: 8490, minChargeCents: 0, markupMultiplier: "1", addonsJson: [], turnaroundDays: 3, rushAvailable: false,
  sizeTiersJson: [{ id: "a3", label: "A3", w: 297, h: 420, priceCents: 2500 }, { id: "a2", label: "A2", w: 420, h: 594, priceCents: 4000 }],
  qtyTiersJson: [{ minQty: 10, sizePrices: { a3: 1800 } }] };
const c3: any = q(corf, 10, { extra: { tierId: "a3" } }), c2: any = q(corf, 10, { extra: { tierId: "a2" } }), c3s: any = q(corf, 9, { extra: { tierId: "a3" } });
console.log("corflute 10×A3", c3.subtotalCents, c3.breakdown?.map((b: any) => b.label).join(" | "), "| 10×A2", c2.subtotalCents);
ok("10 A3 at the set $18 = $180", c3.subtotalCents === 18000);
ok("a size the step leaves blank keeps its normal price (10 A2 = $400)", c2.subtotalCents === 40000);
ok("below the step: 9 A3 at normal $25 = $225", c3s.subtotalCents === 22500);
ok("corflute takes per-size prices", normaliseQtyTiers([{ minQty: 10, sizePrices: { a3: 1800 } }], "per_piece_tiered", ["a3", "a2"]).ok);
ok("corflute refuses a size it doesn't sell", !normaliseQtyTiers([{ minQty: 10, sizePrices: { a0: 1800 } }], "per_piece_tiered", ["a3", "a2"]).ok);
ok("corflute refuses a single $ each", !normaliseQtyTiers([{ minQty: 10, unitPriceCents: 1800 }], "per_piece_tiered", ["a3"]).ok);
ok("a tee refuses per-size prices", !normaliseQtyTiers([{ minQty: 10, sizePrices: { a3: 1800 } }], "garment_decoration").ok);
ok("$0 size price refused", !normaliseQtyTiers([{ minQty: 10, sizePrices: { a3: 0 } }], "per_piece_tiered", ["a3"]).ok);
// Dima: "it still gives $27 at 20 shirts" — a set price must override the screen-print switch at 20.
const tee20: any = { ...tee, qtyTiersJson: [{ minQty: 1, unitPriceCents: 4500 }, { minQty: 20, unitPriceCents: 3500 }] };
const t20: any = q(tee20, 20), t19: any = q(tee20, 19);
ok("20 tees at the set $35 each = $700 (not the $27 screen-print price)", t20.subtotalCents === 70000);
ok("19 tees at the set $45 each = $855", t19.subtotalCents === 85500);

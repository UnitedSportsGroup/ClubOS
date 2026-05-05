// Unit tests for the print pricing engine. Hand-validated quotes against the
// NZ benchmark research so we know the engine produces sensible numbers.
//
// Run: npx tsx script/test-print-pricing.ts

import { quotePrintItem, quoteOrderTotals } from "../server/print-pricing";
import type { PrintMaterial } from "../shared/schema";

let passed = 0, failed = 0;

function assertEq(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}\n    expected: ${expected}\n    actual:   ${actual}`);
    failed++;
  }
}

function assertWithin(label: string, actual: number, expected: number, tolerance = 1) {
  if (Math.abs(actual - expected) <= tolerance) {
    console.log(`  ✓ ${label} (${actual} ≈ ${expected})`);
    passed++;
  } else {
    console.log(`  ✗ ${label}\n    expected: ${expected} (±${tolerance})\n    actual:   ${actual}`);
    failed++;
  }
}

const baseMaterial: Partial<PrintMaterial> = {
  id: 1,
  organizationId: 8,
  isActive: true,
  displayOrder: 0,
  markupMultiplier: "2.5" as unknown as PrintMaterial["markupMultiplier"],
  rushAvailable: true,
  humanQuoteRequired: false,
  turnaroundDays: 3,
  addonsJson: [],
  finishingDefaultJson: [],
  qtyTiersJson: [],
  sizeTiersJson: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Test 1: PVC banner 3m × 1m ────────────────────────────────────────────
console.log("\n[1] PVC banner 3m × 1m, qty 1, $50/m²");
{
  const banner: PrintMaterial = {
    ...baseMaterial,
    slug: "pvc-banner-440",
    name: "PVC Banner 440gsm",
    category: "banner",
    description: null,
    heroImageUrl: null,
    pricingMethod: "per_m2",
    baseRateCents: 5000,
    substrateCostPerM2Cents: 1500,
    minChargeCents: 4500,
    sizeMinWMm: 500,
    sizeMaxWMm: 5000,
    sizeMinHMm: 500,
    sizeMaxHMm: 3000,
    addonsJson: [
      { id: "eyelets", name: "Eyelets", formula: "per_corner", unitPriceCents: 50, default: true },
      { id: "hemming", name: "Hemming", formula: "per_perimeter_m", unitPriceCents: 500, default: true },
    ],
    qtyTiersJson: [
      { minQty: 5, discountPct: 5 },
      { minQty: 10, discountPct: 10 },
    ],
  } as PrintMaterial;

  const result = quotePrintItem(banner, { widthMm: 3000, heightMm: 1000, quantity: 1, sides: 1, selectedAddonIds: ["eyelets", "hemming"] });
  if (!result.ok) { failed++; console.log(`  ✗ Got fallback: ${result.message}`); }
  else {
    // 3 m² × $50 = $150 base
    // + eyelets 4 × $0.50 = $2
    // + hemming 8m × $5/m = $40
    // = $192 subtotal
    assertEq("base unit price", result.unitPriceCents, 15000);
    assertEq("eyelets + hemming", result.addonsTotalCents, 200 + 4000);
    assertEq("subtotal", result.subtotalCents, 19200);
  }
}

// ── Test 2: Double-sided banner ───────────────────────────────────────────
console.log("\n[2] PVC banner 1m × 1m, double-sided");
{
  const banner: PrintMaterial = {
    ...baseMaterial,
    slug: "pvc-banner-440",
    name: "PVC Banner 440gsm",
    category: "banner",
    description: null,
    heroImageUrl: null,
    pricingMethod: "per_m2",
    baseRateCents: 5000,
    substrateCostPerM2Cents: 1500,
    minChargeCents: 4500,
    sizeMinWMm: 500,
    sizeMaxWMm: 5000,
    sizeMinHMm: 500,
    sizeMaxHMm: 3000,
    addonsJson: [],
    qtyTiersJson: [],
  } as PrintMaterial;

  const result = quotePrintItem(banner, { widthMm: 1000, heightMm: 1000, quantity: 1, sides: 2 });
  if (!result.ok) { failed++; console.log(`  ✗ Got fallback: ${result.message}`); }
  else {
    // 1 m² × $50 × 1.7 (double-sided) = $85
    assertEq("double-sided 1.7×", result.unitPriceCents, 8500);
  }
}

// ── Test 3: Quantity discount kicks in ────────────────────────────────────
console.log("\n[3] Quantity discount at qty 10");
{
  const banner: PrintMaterial = {
    ...baseMaterial,
    slug: "pvc-banner-440",
    name: "PVC Banner 440gsm",
    category: "banner",
    description: null,
    heroImageUrl: null,
    pricingMethod: "per_m2",
    baseRateCents: 5000,
    substrateCostPerM2Cents: 1500,
    minChargeCents: 4500,
    sizeMinWMm: 500,
    sizeMaxWMm: 5000,
    sizeMinHMm: 500,
    sizeMaxHMm: 3000,
    addonsJson: [],
    qtyTiersJson: [
      { minQty: 5, discountPct: 5 },
      { minQty: 10, discountPct: 10 },
      { minQty: 25, discountPct: 15 },
    ],
  } as PrintMaterial;

  const result = quotePrintItem(banner, { widthMm: 1000, heightMm: 1000, quantity: 10, sides: 1 });
  if (!result.ok) { failed++; console.log(`  ✗ Got fallback: ${result.message}`); }
  else {
    // 1 m² × $50 × 10 = $500 base
    // - 10% qty discount = $50
    // = $450 subtotal
    assertEq("base × 10", result.unitPriceCents, 50000);
    assertEq("qty discount 10%", result.qtyDiscountCents, 5000);
    assertEq("subtotal", result.subtotalCents, 45000);
  }
}

// ── Test 4: Minimum charge floor ──────────────────────────────────────────
console.log("\n[4] Tiny banner hits minimum charge");
{
  const banner: PrintMaterial = {
    ...baseMaterial,
    slug: "pvc-banner-440",
    name: "PVC Banner 440gsm",
    category: "banner",
    description: null,
    heroImageUrl: null,
    pricingMethod: "per_m2",
    baseRateCents: 5000,
    substrateCostPerM2Cents: 1500,
    minChargeCents: 4500,
    sizeMinWMm: 500,
    sizeMaxWMm: 5000,
    sizeMinHMm: 500,
    sizeMaxHMm: 3000,
    addonsJson: [],
    qtyTiersJson: [],
  } as PrintMaterial;

  // 0.5m × 0.5m = 0.25 m² × $50 = $12.50 — below the $45 minimum
  const result = quotePrintItem(banner, { widthMm: 500, heightMm: 500, quantity: 1, sides: 1 });
  if (!result.ok) { failed++; console.log(`  ✗ Got fallback: ${result.message}`); }
  else {
    assertEq("minimum charge floor", result.subtotalCents, 4500);
  }
}

// ── Test 5: Rush fee adds 30% ─────────────────────────────────────────────
console.log("\n[5] Rush fee +30%");
{
  const banner: PrintMaterial = {
    ...baseMaterial,
    slug: "pvc-banner-440",
    name: "PVC Banner 440gsm",
    category: "banner",
    description: null,
    heroImageUrl: null,
    pricingMethod: "per_m2",
    baseRateCents: 5000,
    substrateCostPerM2Cents: 1500,
    minChargeCents: 4500,
    sizeMinWMm: 500,
    sizeMaxWMm: 5000,
    sizeMinHMm: 500,
    sizeMaxHMm: 3000,
    addonsJson: [],
    qtyTiersJson: [],
  } as PrintMaterial;

  const result = quotePrintItem(banner, { widthMm: 2000, heightMm: 1000, quantity: 1, sides: 1, rush: true });
  if (!result.ok) { failed++; console.log(`  ✗ Got fallback: ${result.message}`); }
  else {
    // 2 m² × $50 = $100 base, +30% rush = $130
    assertEq("base", result.unitPriceCents, 10000);
    assertEq("rush fee", result.rushFeeCents, 3000);
    assertEq("subtotal incl rush", result.subtotalCents, 13000);
    assertEq("turnaround days drops to 2", result.turnaroundDays, 2);
  }
}

// ── Test 6: Falls back on out-of-range size ───────────────────────────────
console.log("\n[6] Size out of range falls back");
{
  const banner: PrintMaterial = {
    ...baseMaterial,
    slug: "pvc-banner-440",
    name: "PVC Banner 440gsm",
    category: "banner",
    description: null,
    heroImageUrl: null,
    pricingMethod: "per_m2",
    baseRateCents: 5000,
    substrateCostPerM2Cents: 1500,
    minChargeCents: 4500,
    sizeMinWMm: 500,
    sizeMaxWMm: 5000,
    sizeMinHMm: 500,
    sizeMaxHMm: 3000,
    addonsJson: [],
    qtyTiersJson: [],
  } as PrintMaterial;

  const result = quotePrintItem(banner, { widthMm: 6000, heightMm: 1000, quantity: 1, sides: 1 });
  assertEq("ok", result.ok, false);
  if (!result.ok) assertEq("reason", result.reason, "size_out_of_range");
}

// ── Test 7: Quantity over cap falls back ──────────────────────────────────
console.log("\n[7] Quantity over cap falls back");
{
  const banner: PrintMaterial = {
    ...baseMaterial,
    slug: "pvc-banner-440",
    name: "PVC Banner 440gsm",
    category: "banner",
    description: null,
    heroImageUrl: null,
    pricingMethod: "per_m2",
    baseRateCents: 5000,
    substrateCostPerM2Cents: 1500,
    minChargeCents: 4500,
    sizeMinWMm: 500,
    sizeMaxWMm: 5000,
    sizeMinHMm: 500,
    sizeMaxHMm: 3000,
    addonsJson: [],
    qtyTiersJson: [],
  } as PrintMaterial;

  const result = quotePrintItem(banner, { widthMm: 1000, heightMm: 1000, quantity: 1000, sides: 1 });
  assertEq("ok", result.ok, false);
  if (!result.ok) assertEq("reason", result.reason, "qty_over_cap");
}

// ── Test 8: Garment decoration auto-picks DTG vs screen print ────────────
console.log("\n[8] Garment decoration method auto-pick");
{
  const tee: PrintMaterial = {
    ...baseMaterial,
    slug: "tee-print",
    name: "AS Colour Tee",
    category: "garment",
    description: null,
    heroImageUrl: null,
    pricingMethod: "garment_decoration",
    baseRateCents: 1800,  // $18 blank
    substrateCostPerM2Cents: 0,
    minChargeCents: 6000,
    sizeMinWMm: null,
    sizeMaxWMm: null,
    sizeMinHMm: null,
    sizeMaxHMm: null,
    addonsJson: [],
    qtyTiersJson: [
      { minQty: 20, discountPct: 5 },
      { minQty: 50, discountPct: 10 },
    ],
    turnaroundDays: 7,
  } as PrintMaterial;

  // 10 tees → DTG (under 20)
  const dtgResult = quotePrintItem(tee, { quantity: 10, extra: { colours: 1 } });
  if (!dtgResult.ok) { failed++; console.log(`  ✗ DTG fallback: ${dtgResult.message}`); }
  else {
    // 10 × ($18 blank + $15 DTG) = $330
    assertEq("DTG total", dtgResult.unitPriceCents, 33000);
  }

  // 30 tees, 1 colour → screen print (20+)
  const screenResult = quotePrintItem(tee, { quantity: 30, extra: { colours: 1 } });
  if (!screenResult.ok) { failed++; console.log(`  ✗ Screen fallback: ${screenResult.message}`); }
  else {
    // 30 × ($18 blank + $8 print) + $45 setup × 1 = $780 + $45 = $825
    assertEq("Screen print total", screenResult.unitPriceCents, 82500);
  }
}

// ── Test 9: Order-level GST math ──────────────────────────────────────────
console.log("\n[9] Order totals + GST 15%");
{
  const totals = quoteOrderTotals([10000, 5000], 1500);  // 2 items + delivery
  // sum = $165, GST = $24.75 (round half-up to 2475 cents), total = $189.75
  assertEq("subtotal", totals.subtotalCents, 16500);
  assertWithin("GST 15%", totals.gstCents, 2475, 1);
  assertWithin("total", totals.totalCents, 18975, 1);
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

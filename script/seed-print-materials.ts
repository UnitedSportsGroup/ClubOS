// Seeds the 5 launch SKUs for United Prints (org_id=8). Idempotent —
// re-running updates existing rows rather than duplicating.
//
// Pricing rationale: launch-aggressive against NZ benchmarks. United Prints
// is a new brand entering an established market. Research (3a.co.nz,
// speedysigns.co.nz, bannersink.co.nz, banneresxpress.co.nz, etc.) shows
// these benchmarks for 2026 — we lean 5-10% under for first 90 days, plan
// to hold once first reviews accumulate.
//
// Run: npx tsx script/seed-print-materials.ts

import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

interface MaterialSeed {
  slug: string;
  name: string;
  category: string;
  description: string;
  pricing_method: string;
  base_rate_cents: number;
  substrate_cost_per_m2_cents: number;
  markup_multiplier: number;
  min_charge_cents: number;
  size_min_w_mm: number | null;
  size_max_w_mm: number | null;
  size_min_h_mm: number | null;
  size_max_h_mm: number | null;
  addons_json: unknown;
  finishing_default_json: unknown;
  qty_tiers_json: unknown;
  size_tiers_json: unknown;
  turnaround_days: number;
  rush_available: boolean;
  human_quote_required: boolean;
  display_order: number;
}

const seeds: MaterialSeed[] = [
  // 1. PVC Banner — workhorse SKU. NZ benchmark: $50/m² for 440gsm hemmed +
  //    eyelets, $35-45/m² for 340gsm cheap-and-cheerful. Launch at $45/m² with
  //    eyelets + hemming included as defaults to undercut Speedy Signs/3a Print
  //    while keeping margin (~50% gross at $14/m² substrate cost).
  {
    slug: "pvc-banner-440",
    name: "PVC Banner 440gsm — Hemmed + Eyelets",
    category: "banner",
    description: "Heavy-duty 440gsm vinyl banner. Hemmed edges and brass eyelets included. Ready for outdoor or indoor use, weatherproof for 12+ months.",
    pricing_method: "per_m2",
    base_rate_cents: 4500,
    substrate_cost_per_m2_cents: 1400,
    markup_multiplier: 3.2,
    min_charge_cents: 4500,
    size_min_w_mm: 500,
    size_max_w_mm: 5000,
    size_min_h_mm: 500,
    size_max_h_mm: 3000,
    addons_json: [
      { id: "extra_eyelets", name: "Extra eyelets (every 500mm)", formula: "per_perimeter_m", unitPriceCents: 200 },
      { id: "pole_pockets", name: "Pole pockets (top + bottom)", formula: "flat", unitPriceCents: 1500 },
      { id: "double_sided", name: "Double-sided print", formula: "flat", unitPriceCents: 0 },
    ],
    finishing_default_json: [
      { id: "hemming", name: "Hemmed edges", included: true },
      { id: "eyelets_corners", name: "Brass eyelets ×4 (corners)", included: true },
    ],
    qty_tiers_json: [
      { minQty: 3, discountPct: 5 },
      { minQty: 5, discountPct: 10 },
      { minQty: 10, discountPct: 15 },
      { minQty: 25, discountPct: 20 },
    ],
    size_tiers_json: [],
    turnaround_days: 3,
    rush_available: true,
    human_quote_required: false,
    display_order: 10,
  },

  // 2. Mesh Fence Banner — same shape as PVC banner but mesh material.
  //    Wind-permeable, perfect for fence wraps + sports grounds (CUFC use!).
  //    NZ benchmark: $55-65/m² with hemming + eyelets. Launch at $55/m².
  {
    slug: "mesh-fence-banner",
    name: "Mesh Fence Banner — Hemmed + Eyelets",
    category: "banner",
    description: "Wind-permeable mesh banner for fences, scaffolding, and sports grounds. Hemmed and eyeleted, made to size.",
    pricing_method: "per_m2",
    base_rate_cents: 5500,
    substrate_cost_per_m2_cents: 1800,
    markup_multiplier: 3.0,
    min_charge_cents: 5500,
    size_min_w_mm: 1000,
    size_max_w_mm: 6000,
    size_min_h_mm: 500,
    size_max_h_mm: 3000,
    addons_json: [
      { id: "extra_eyelets", name: "Extra eyelets (every 500mm)", formula: "per_perimeter_m", unitPriceCents: 200 },
      { id: "ratchet_straps", name: "Ratchet straps for fence install", formula: "flat", unitPriceCents: 4500 },
    ],
    finishing_default_json: [
      { id: "hemming", name: "Hemmed edges", included: true },
      { id: "eyelets_500mm", name: "Brass eyelets every 500mm", included: true },
    ],
    qty_tiers_json: [
      { minQty: 3, discountPct: 8 },
      { minQty: 5, discountPct: 12 },
      { minQty: 10, discountPct: 18 },
    ],
    size_tiers_json: [],
    turnaround_days: 3,
    rush_available: true,
    human_quote_required: false,
    display_order: 20,
  },

  // 3. Corflute 3mm — stock sizes (most orders) + custom-area fallback.
  //    NZ benchmark: Simply Signs $25-65 for stock sizes, ~$90/m² custom.
  //    Launch slightly below at $85/m² custom, with stock-size table shaved 5%.
  {
    slug: "corflute-3mm",
    name: "Corflute Sign 3mm",
    category: "corflute",
    description: "Lightweight corrugated plastic sign. Single or double-sided print. Standard sizes ship in 3 days, custom sizes priced per m².",
    pricing_method: "per_piece_tiered",
    base_rate_cents: 8500,            // Custom-area fallback rate
    substrate_cost_per_m2_cents: 2200,
    markup_multiplier: 3.0,
    min_charge_cents: 2500,
    size_min_w_mm: 300,
    size_max_w_mm: 2400,
    size_min_h_mm: 300,
    size_max_h_mm: 1800,
    addons_json: [
      { id: "h_stake", name: "H-stake (for ground signs)", formula: "per_unit", unitPriceCents: 800 },
      { id: "double_sided", name: "Double-sided print", formula: "flat", unitPriceCents: 0 },
    ],
    finishing_default_json: [],
    qty_tiers_json: [
      { minQty: 5, discountPct: 8 },
      { minQty: 10, discountPct: 15 },
      { minQty: 25, discountPct: 22 },
      { minQty: 50, discountPct: 28 },
    ],
    size_tiers_json: [
      { id: "a3", label: "A3 (297×420mm)", w: 420, h: 297, priceCents: 2500 },
      { id: "a2", label: "A2 (594×420mm)", w: 594, h: 420, priceCents: 3500 },
      { id: "600x900", label: "600×900mm (real estate)", w: 900, h: 600, priceCents: 4500 },
      { id: "900x1200", label: "900×1200mm", w: 1200, h: 900, priceCents: 6500 },
      { id: "1200x1800", label: "1200×1800mm", w: 1800, h: 1200, priceCents: 11500 },
    ],
    turnaround_days: 3,
    rush_available: true,
    human_quote_required: false,
    display_order: 30,
  },

  // 4. ACM Aluminium 3mm — material-cost-driven SKU. NZ benchmark: $150/m²
  //    common, $145/m² aggressive. Substrate alone is $60-95/m² wholesale at
  //    3mm, so margin sensitivity is real — track substrate_cost separately.
  //    Launch at $145/m².
  {
    slug: "acm-aluminium-3mm",
    name: "Aluminium Composite Panel 3mm (printed)",
    category: "aluminium",
    description: "Premium 3mm aluminium composite (Dibond-style). Rigid, weatherproof, suitable for permanent signage. Direct UV-print, ready to mount.",
    pricing_method: "per_m2",
    base_rate_cents: 14500,
    substrate_cost_per_m2_cents: 7500,
    markup_multiplier: 1.95,
    min_charge_cents: 9500,
    size_min_w_mm: 200,
    size_max_w_mm: 2400,
    size_min_h_mm: 200,
    size_max_h_mm: 1500,
    addons_json: [
      { id: "drilled_holes", name: "Drilled mounting holes", formula: "flat", unitPriceCents: 1500 },
      { id: "rounded_corners", name: "Rounded corners", formula: "flat", unitPriceCents: 1000 },
      { id: "cnc_cut", name: "CNC contour cut to shape", formula: "flat", unitPriceCents: 0, default: false },
    ],
    finishing_default_json: [],
    qty_tiers_json: [
      { minQty: 3, discountPct: 5 },
      { minQty: 5, discountPct: 10 },
      { minQty: 10, discountPct: 15 },
    ],
    size_tiers_json: [],
    turnaround_days: 5,
    rush_available: true,
    human_quote_required: false,
    display_order: 40,
  },

  // 5. Vinyl decal medium-term + lamination — site signage, vehicle decals,
  //    stick-on graphics. NZ benchmark: $80-100/m² + $20-30/m² lamination.
  //    Launch at $75/m² with lamination as a paid add-on.
  //    Note: vinyl doesn't get cheaper at scale (hand-weeded), qty cap ~15%.
  {
    slug: "vinyl-decal-medium-term",
    name: "Printed Vinyl Decal (medium-term)",
    category: "vinyl_decal",
    description: "Printed self-adhesive vinyl. Indoor or outdoor (3-year UV-rated). Ideal for windows, walls, vehicles, and one-off graphics. Add lamination for scratch resistance.",
    pricing_method: "per_m2",
    base_rate_cents: 7500,
    substrate_cost_per_m2_cents: 1800,
    markup_multiplier: 4.0,
    min_charge_cents: 4500,
    size_min_w_mm: 50,
    size_max_w_mm: 1500,
    size_min_h_mm: 50,
    size_max_h_mm: 1500,
    addons_json: [
      { id: "lamination", name: "Gloss laminate (scratch + UV protection)", formula: "per_perimeter_m", unitPriceCents: 0, default: false },
      { id: "lam_per_m2", name: "Gloss laminate", formula: "flat", unitPriceCents: 2500 },
      { id: "contour_cut", name: "Contour-cut to shape", formula: "flat", unitPriceCents: 1500, default: true },
      { id: "application_tape", name: "Application tape (for easy install)", formula: "flat", unitPriceCents: 800, default: true },
    ],
    finishing_default_json: [],
    qty_tiers_json: [
      { minQty: 5, discountPct: 5 },
      { minQty: 10, discountPct: 10 },
      { minQty: 25, discountPct: 15 },
    ],
    size_tiers_json: [],
    turnaround_days: 3,
    rush_available: true,
    human_quote_required: false,
    display_order: 50,
  },

  // 6. AS Colour Staple Tee + Decoration — garment SKU.
  //    Engine auto-picks DTG (<20) vs screen print (20+) vs embroidery (extra).
  //    Garment cap is 250 (vs 500 default).
  {
    slug: "tee-as-colour-staple",
    name: "AS Colour Staple Tee + Print/Embroidery",
    category: "garment",
    description: "AS Colour Staple Tee (5026) — premium 180gsm cotton. Print method automatically chosen by quantity (DTG for small runs, screen print 20+, embroidery for logos).",
    pricing_method: "garment_decoration",
    base_rate_cents: 1800,         // Blank cost
    substrate_cost_per_m2_cents: 0,
    markup_multiplier: 2.5,
    min_charge_cents: 6000,
    size_min_w_mm: null,
    size_max_w_mm: null,
    size_min_h_mm: null,
    size_max_h_mm: null,
    addons_json: [
      { id: "extra_print_location", name: "Second print location", formula: "flat", unitPriceCents: 800 },
      { id: "named_jersey", name: "Name + number on back", formula: "flat", unitPriceCents: 1500 },
    ],
    finishing_default_json: [],
    qty_tiers_json: [
      { minQty: 20, discountPct: 5 },
      { minQty: 50, discountPct: 12 },
      { minQty: 100, discountPct: 18 },
      { minQty: 200, discountPct: 25 },
    ],
    size_tiers_json: [],
    turnaround_days: 7,
    rush_available: false,         // Garments don't rush — supplier limits
    human_quote_required: false,
    display_order: 60,
  },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const ORG_ID = 8;  // United Prints

  console.log(`Seeding ${seeds.length} materials for org ${ORG_ID}...`);

  for (const seed of seeds) {
    const existing = await pool.query("SELECT id FROM print_materials WHERE slug = $1", [seed.slug]);

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE print_materials SET
          name = $2, category = $3, description = $4,
          pricing_method = $5, base_rate_cents = $6, substrate_cost_per_m2_cents = $7,
          markup_multiplier = $8, min_charge_cents = $9,
          size_min_w_mm = $10, size_max_w_mm = $11, size_min_h_mm = $12, size_max_h_mm = $13,
          addons_json = $14, finishing_default_json = $15, qty_tiers_json = $16, size_tiers_json = $17,
          turnaround_days = $18, rush_available = $19, human_quote_required = $20,
          display_order = $21, is_active = TRUE, updated_at = NOW()
        WHERE slug = $1`,
        [
          seed.slug, seed.name, seed.category, seed.description,
          seed.pricing_method, seed.base_rate_cents, seed.substrate_cost_per_m2_cents,
          seed.markup_multiplier, seed.min_charge_cents,
          seed.size_min_w_mm, seed.size_max_w_mm, seed.size_min_h_mm, seed.size_max_h_mm,
          JSON.stringify(seed.addons_json), JSON.stringify(seed.finishing_default_json),
          JSON.stringify(seed.qty_tiers_json), JSON.stringify(seed.size_tiers_json),
          seed.turnaround_days, seed.rush_available, seed.human_quote_required,
          seed.display_order,
        ]
      );
      console.log(`  · updated ${seed.slug}`);
    } else {
      await pool.query(
        `INSERT INTO print_materials (
          organization_id, slug, name, category, description,
          pricing_method, base_rate_cents, substrate_cost_per_m2_cents,
          markup_multiplier, min_charge_cents,
          size_min_w_mm, size_max_w_mm, size_min_h_mm, size_max_h_mm,
          addons_json, finishing_default_json, qty_tiers_json, size_tiers_json,
          turnaround_days, rush_available, human_quote_required,
          display_order, is_active
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21, $22, TRUE
        )`,
        [
          ORG_ID, seed.slug, seed.name, seed.category, seed.description,
          seed.pricing_method, seed.base_rate_cents, seed.substrate_cost_per_m2_cents,
          seed.markup_multiplier, seed.min_charge_cents,
          seed.size_min_w_mm, seed.size_max_w_mm, seed.size_min_h_mm, seed.size_max_h_mm,
          JSON.stringify(seed.addons_json), JSON.stringify(seed.finishing_default_json),
          JSON.stringify(seed.qty_tiers_json), JSON.stringify(seed.size_tiers_json),
          seed.turnaround_days, seed.rush_available, seed.human_quote_required,
          seed.display_order,
        ]
      );
      console.log(`  + inserted ${seed.slug}`);
    }
  }

  const summary = await pool.query("SELECT slug, name, category, pricing_method, base_rate_cents FROM print_materials WHERE organization_id = $1 ORDER BY display_order", [ORG_ID]);
  console.log("\nSeeded catalog:");
  console.table(summary.rows.map(r => ({
    slug: r.slug,
    name: r.name,
    category: r.category,
    method: r.pricing_method,
    base_rate: `$${(r.base_rate_cents / 100).toFixed(2)}`,
  })));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

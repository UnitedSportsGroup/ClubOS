// Day 1 migration for the United Prints MIS build. Adds the materials catalog,
// line items, files, and events tables; extends print_orders with the v1
// lifecycle columns + Stripe + delivery fields. Idempotent — safe to re-run.
//
// We do this via direct SQL rather than `drizzle-kit push` because push goes
// interactive in this env (asks "create or rename" prompts that won't accept
// piped input).

import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  console.log("Connected. Running migration...");

  // 1. Extend the status enum (additive — no data migration needed)
  console.log("Extending print_order_status enum...");
  for (const value of ["draft", "quote_sent", "paid", "artwork_pending", "in_design", "in_proof", "proof_approved", "finishing"]) {
    await pool.query(`ALTER TYPE print_order_status ADD VALUE IF NOT EXISTS '${value}';`);
  }

  // 2. Create the new enums
  console.log("Creating new enums...");
  await pool.query(`
    DO $$ BEGIN
      CREATE TYPE print_material_category AS ENUM ('banner', 'corflute', 'vinyl_decal', 'aluminium', 'garment', 'rollup', 'poster', 'sticker', 'custom');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await pool.query(`
    DO $$ BEGIN
      CREATE TYPE print_pricing_method AS ENUM ('per_m2', 'per_piece', 'per_piece_tiered', 'garment_decoration', 'bundle');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);

  // 3. Create the materials catalog
  console.log("Creating print_materials...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS print_materials (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category print_material_category NOT NULL,
      description TEXT,
      hero_image_url TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      display_order INTEGER NOT NULL DEFAULT 0,
      pricing_method print_pricing_method NOT NULL,
      base_rate_cents INTEGER NOT NULL DEFAULT 0,
      substrate_cost_per_m2_cents INTEGER NOT NULL DEFAULT 0,
      markup_multiplier NUMERIC(5,2) NOT NULL DEFAULT 2.5,
      min_charge_cents INTEGER NOT NULL DEFAULT 0,
      size_min_w_mm INTEGER,
      size_max_w_mm INTEGER,
      size_min_h_mm INTEGER,
      size_max_h_mm INTEGER,
      addons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      finishing_default_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      qty_tiers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      size_tiers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      turnaround_days INTEGER NOT NULL DEFAULT 3,
      rush_available BOOLEAN NOT NULL DEFAULT TRUE,
      human_quote_required BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // 4. Extend print_orders
  console.log("Extending print_orders...");
  const printOrderCols = [
    `order_number TEXT UNIQUE`,
    `customer_company TEXT`,
    `subtotal_cents INTEGER NOT NULL DEFAULT 0`,
    `gst_cents INTEGER NOT NULL DEFAULT 0`,
    `total_cents INTEGER NOT NULL DEFAULT 0`,
    `paid_cents INTEGER NOT NULL DEFAULT 0`,
    `delivery_method TEXT NOT NULL DEFAULT 'pickup'`,
    `delivery_address TEXT`,
    `delivery_quote_cents INTEGER NOT NULL DEFAULT 0`,
    `pickup_ready_date DATE`,
    `stripe_payment_intent_id TEXT`,
    `stripe_invoice_id TEXT`,
    `magic_link_token TEXT UNIQUE`,
    `quote_expires_at TIMESTAMP`,
    `customer_notes TEXT`,
    `internal_notes TEXT`,
    `rush_requested BOOLEAN NOT NULL DEFAULT FALSE`,
  ];
  for (const col of printOrderCols) {
    const colName = col.split(" ")[0];
    await pool.query(`ALTER TABLE print_orders ADD COLUMN IF NOT EXISTS ${col};`);
    console.log(`  · ${colName}`);
  }

  // 5. Create line items
  console.log("Creating print_order_items...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS print_order_items (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES print_orders(id) ON DELETE CASCADE,
      material_id INTEGER REFERENCES print_materials(id),
      material_name TEXT NOT NULL,
      description TEXT,
      width_mm INTEGER,
      height_mm INTEGER,
      quantity INTEGER NOT NULL DEFAULT 1,
      sides INTEGER NOT NULL DEFAULT 1,
      config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      unit_price_cents INTEGER NOT NULL DEFAULT 0,
      qty_discount_cents INTEGER NOT NULL DEFAULT 0,
      addons_total_cents INTEGER NOT NULL DEFAULT 0,
      subtotal_cents INTEGER NOT NULL DEFAULT 0,
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
      breakdown_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // 6. Create files
  console.log("Creating print_order_files...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS print_order_files (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES print_orders(id) ON DELETE CASCADE,
      order_item_id INTEGER REFERENCES print_order_items(id) ON DELETE CASCADE,
      object_path TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by TEXT NOT NULL DEFAULT 'customer',
      file_type TEXT NOT NULL DEFAULT 'artwork',
      uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // 7. Create events
  console.log("Creating print_order_events...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS print_order_events (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES print_orders(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      notes TEXT,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // 8. Indexes that matter
  console.log("Creating indexes...");
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_print_materials_org ON print_materials(organization_id, is_active, display_order);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_print_order_items_order ON print_order_items(order_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_print_order_files_order ON print_order_files(order_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_print_order_events_order ON print_order_events(order_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_print_orders_status ON print_orders(organization_id, status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_print_orders_magic_link ON print_orders(magic_link_token) WHERE magic_link_token IS NOT NULL;`);

  console.log("Migration complete.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

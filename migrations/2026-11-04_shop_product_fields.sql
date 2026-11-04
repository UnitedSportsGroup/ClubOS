-- Shopify product fields + the warehouse ⇄ shop stock link (2026-11-04). ADDITIVE ONLY.
-- Daniel: everything Shopify's product page has — cost, charge tax, unit price,
-- barcode, shipping (weight, size, country of origin, HS code), SEO, tags,
-- collections, each variant's own page, and "continue selling when out of stock".
-- Every new column is nullable or defaults to what the shops do TODAY, so no
-- storefront or checkout changes behaviour until someone changes a value.

ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS description_html text;      -- rich text; `description` stays the plain text the storefronts render
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS seo_title text;             -- NULL = use the title
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS seo_description text;       -- NULL = use the description

ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS barcode text;
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS compare_at_cents integer;   -- NULL = the product's
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS cost_cents integer;         -- cost per item, NZD
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS charge_tax boolean NOT NULL DEFAULT true;
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS unit_price_measure numeric(12,3);  -- e.g. 500 (g)
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS unit_price_unit text;             -- g · kg · ml · l · m · cm · item
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS unit_price_base_measure numeric(12,3);
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS unit_price_base_unit text;
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS track_inventory boolean NOT NULL DEFAULT true;     -- today every variant is counted
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS continue_selling boolean NOT NULL DEFAULT false;   -- today the checkout refuses at 0
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS physical boolean NOT NULL DEFAULT true;
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS weight_grams numeric(10,1);
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS length_cm numeric(8,1);
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS width_cm numeric(8,1);
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS height_cm numeric(8,1);
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS country_of_origin text;   -- ISO 3166 alpha-2
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS hs_code text;            -- 6–10 digits

DO $$ BEGIN
  ALTER TABLE shop_variants ADD CONSTRAINT shop_variants_money_chk CHECK (
    (compare_at_cents IS NULL OR compare_at_cents >= 0) AND (cost_cents IS NULL OR cost_cents >= 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE shop_variants ADD CONSTRAINT shop_variants_hs_chk CHECK (hs_code IS NULL OR hs_code ~ '^[0-9]{6,10}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE shop_variants ADD CONSTRAINT shop_variants_coo_chk CHECK (country_of_origin IS NULL OR country_of_origin ~ '^[A-Z]{2}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Collections, per shop (Shopify's manual collections).
CREATE TABLE IF NOT EXISTS shop_collections (
  id              serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           text NOT NULL,
  handle          text NOT NULL,
  description     text,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_collections_handle_unq UNIQUE (organization_id, handle)
);
CREATE TABLE IF NOT EXISTS shop_product_collections (
  product_id    integer NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  collection_id integer NOT NULL REFERENCES shop_collections(id) ON DELETE CASCADE,
  sort_order    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, collection_id)
);
CREATE INDEX IF NOT EXISTS shop_product_collections_coll_idx ON shop_product_collections (collection_id);
ALTER TABLE shop_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_product_collections ENABLE ROW LEVEL SECURITY;

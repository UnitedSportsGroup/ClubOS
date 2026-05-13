// One-off migration for the Budget module (USG workspace).
// Purely additive — IF NOT EXISTS + CREATE OR REPLACE only. Wrapped in a
// single transaction so any failure rolls everything back.
//
// Usage: npx tsx --env-file=.env script/apply-budget-module-schema.ts

import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SQL = `
BEGIN;

-- Enums (CREATE TYPE has no IF NOT EXISTS — guard via DO block)
DO $$ BEGIN
  CREATE TYPE budget_kind AS ENUM ('income', 'expense');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE budget_line_type AS ENUM ('simple', 'computed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1) Cost centres
CREATE TABLE IF NOT EXISTS budget_cost_centres (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  bucket text NOT NULL DEFAULT 'operating',
  owner_id integer REFERENCES users(id),
  year integer NOT NULL,
  is_virtual boolean NOT NULL DEFAULT false,
  notes text,
  display_order integer NOT NULL DEFAULT 0,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS budget_cost_centres_org_slug_year_unique
  ON budget_cost_centres (organization_id, slug, year);

-- 2) Line items
CREATE TABLE IF NOT EXISTS budget_lines (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  cost_centre_id integer NOT NULL REFERENCES budget_cost_centres(id) ON DELETE CASCADE,
  kind budget_kind NOT NULL,
  line_type budget_line_type NOT NULL DEFAULT 'simple',
  section text,
  name text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  unit_rate_cents integer,
  units_a numeric(10,2),
  units_b numeric(10,2),
  units_c numeric(10,2),
  unit_label_a text,
  unit_label_b text,
  unit_label_c text,
  monthly_phasing jsonb,
  notes text,
  display_order integer NOT NULL DEFAULT 0,
  source_sync_id integer,
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS budget_lines_cost_centre_idx ON budget_lines(cost_centre_id);

-- 3) Receipt / invoice attachments (Phase 3 surface, schema lives now)
CREATE TABLE IF NOT EXISTS budget_line_attachments (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  line_id integer NOT NULL REFERENCES budget_lines(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'receipt',
  storage_key text NOT NULL,
  original_filename text NOT NULL,
  content_type text,
  size_bytes integer,
  uploaded_by integer REFERENCES users(id),
  uploaded_at timestamp NOT NULL DEFAULT now(),
  notes text
);

CREATE INDEX IF NOT EXISTS budget_line_attachments_line_idx ON budget_line_attachments(line_id);

-- 4) Sheet sync run log (Phase 4 surface)
CREATE TABLE IF NOT EXISTS budget_sync_runs (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  triggered_by integer REFERENCES users(id),
  source text NOT NULL DEFAULT 'google_sheet',
  source_ref text,
  status text NOT NULL DEFAULT 'running',
  started_at timestamp NOT NULL DEFAULT now(),
  finished_at timestamp,
  rows_added integer NOT NULL DEFAULT 0,
  rows_updated integer NOT NULL DEFAULT 0,
  rows_skipped integer NOT NULL DEFAULT 0,
  error_message text,
  diff_summary jsonb
);

COMMIT;
`;

async function main() {
  const client = await pool.connect();
  try {
    console.log("Connected. Applying budget module migration in one transaction...");
    await client.query(SQL);
    console.log("✅ Migration applied.");

    const checks = await client.query<{ name: string }>(`
      SELECT 'budget_cost_centres' AS name WHERE EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'budget_cost_centres'
      )
      UNION ALL SELECT 'budget_lines' WHERE EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'budget_lines'
      )
      UNION ALL SELECT 'budget_line_attachments' WHERE EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'budget_line_attachments'
      )
      UNION ALL SELECT 'budget_sync_runs' WHERE EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'budget_sync_runs'
      );
    `);
    for (const r of checks.rows) console.log(`  ✓ ${r.name}`);
    if (checks.rows.length !== 4) {
      throw new Error(`Expected 4 tables, found ${checks.rows.length}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});

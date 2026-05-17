// One-off migration for the Xero P&L → Budget bridge (Phase 5a).
// Reuses the existing `org_integrations` table for OAuth tokens — adds:
//   - xero_actuals             (monthly P&L cache)
//   - budget_account_mappings  (Xero account → cost centre, per year)
//   - xero_sync_runs           (audit trail)
//
// Purely additive — IF NOT EXISTS + DO/EXCEPTION blocks. Single transaction.
//
// Usage: npx tsx --env-file=.env script/apply-xero-integration-schema.ts

import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SQL = `
BEGIN;

DO $$ BEGIN
  CREATE TYPE budget_mapping_kind AS ENUM ('income', 'expense', 'ignore');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1) Monthly P&L cache
CREATE TABLE IF NOT EXISTS xero_actuals (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period text NOT NULL,
  section text,
  account text NOT NULL,
  amount_cents integer NOT NULL,
  last_sync_id integer,
  collected_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS xero_actuals_org_period_account
  ON xero_actuals(organization_id, period, account);

CREATE INDEX IF NOT EXISTS xero_actuals_period_idx
  ON xero_actuals(organization_id, period);

-- 2) Xero account → cost centre mapping, per year
CREATE TABLE IF NOT EXISTS budget_account_mappings (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year integer NOT NULL,
  xero_account text NOT NULL,
  cost_centre_id integer REFERENCES budget_cost_centres(id) ON DELETE SET NULL,
  kind budget_mapping_kind NOT NULL DEFAULT 'expense',
  notes text,
  updated_by integer REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS budget_mappings_org_year_account
  ON budget_account_mappings(organization_id, year, xero_account);

-- 3) Sync run audit log
CREATE TABLE IF NOT EXISTS xero_sync_runs (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  triggered_by integer REFERENCES users(id),
  status text NOT NULL DEFAULT 'running',
  from_period text,
  to_period text,
  started_at timestamp NOT NULL DEFAULT now(),
  finished_at timestamp,
  rows_added integer NOT NULL DEFAULT 0,
  rows_updated integer NOT NULL DEFAULT 0,
  rows_skipped integer NOT NULL DEFAULT 0,
  error_message text
);

COMMIT;
`;

async function main() {
  const client = await pool.connect();
  try {
    console.log("Connected. Applying Xero integration migration in one transaction...");
    await client.query(SQL);
    console.log("✅ Migration applied.");

    const checks = await client.query<{ name: string }>(`
      SELECT 'xero_actuals' AS name WHERE EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'xero_actuals'
      )
      UNION ALL SELECT 'budget_account_mappings' WHERE EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'budget_account_mappings'
      )
      UNION ALL SELECT 'xero_sync_runs' WHERE EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'xero_sync_runs'
      );
    `);
    for (const r of checks.rows) console.log(`  ✓ ${r.name}`);
    if (checks.rows.length !== 3) {
      throw new Error(`Expected 3 tables, found ${checks.rows.length}`);
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

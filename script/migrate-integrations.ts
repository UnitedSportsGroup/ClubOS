// Adds the org_integrations + print_xero_invoices tables for Day 4b.
// Idempotent.
import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  console.log("Migrating integrations...");

  await pool.query(`
    DO $$ BEGIN
      CREATE TYPE integration_provider AS ENUM ('xero', 'stripe', 'myob', 'quickbooks');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS org_integrations (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      provider integration_provider NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at TIMESTAMP,
      external_id TEXT,
      external_name TEXT,
      config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      connected_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_synced_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT org_integrations_unique UNIQUE (organization_id, provider)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS print_xero_invoices (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      print_order_id INTEGER NOT NULL REFERENCES print_orders(id) ON DELETE CASCADE,
      xero_invoice_id TEXT,
      xero_invoice_number TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      pushed_at TIMESTAMP,
      paid_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_org_integrations ON org_integrations(organization_id, provider);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_print_xero_invoices_order ON print_xero_invoices(print_order_id);`);

  console.log("Done.");
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

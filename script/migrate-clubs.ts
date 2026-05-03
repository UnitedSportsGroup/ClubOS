// One-shot migration: add the clubs table + tournament_teams.club_id column.
// Idempotent — safe to re-run. Hand-rolled because drizzle-kit push needs
// interactive TTY for ambiguous-renames prompts and we can't pipe through
// `npm run` reliably.

import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clubs (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      short_name TEXT,
      logo_url TEXT,
      primary_color TEXT,
      secondary_color TEXT,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      website TEXT,
      notes TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  console.log("✓ clubs table ready");

  await pool.query(`CREATE INDEX IF NOT EXISTS clubs_organization_id_idx ON clubs(organization_id)`);
  console.log("✓ clubs.organization_id index ready");

  await pool.query(`
    ALTER TABLE tournament_teams
    ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL
  `);
  console.log("✓ tournament_teams.club_id column ready");

  await pool.query(`CREATE INDEX IF NOT EXISTS tournament_teams_club_id_idx ON tournament_teams(club_id)`);
  console.log("✓ tournament_teams.club_id index ready");

  await pool.end();
  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });

// One-off migration for the CIC Skills Challenge (tournament workspace).
// Purely additive — CREATE TABLE IF NOT EXISTS only. Wrapped in a single
// transaction so any failure rolls everything back.
//
// Usage: npx tsx --env-file=.env script/apply-skills-challenge-schema.ts

import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SQL = `
BEGIN;

CREATE TABLE IF NOT EXISTS skills_challenge_entries (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  player_name text NOT NULL,
  club_name text NOT NULL,
  age_group text NOT NULL,
  challenge text NOT NULL,
  score numeric(8,2),
  scored_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  scored_at timestamp,
  source text NOT NULL DEFAULT 'public',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skills_challenge_entries_org_idx
  ON skills_challenge_entries (organization_id);

CREATE INDEX IF NOT EXISTS skills_challenge_entries_category_idx
  ON skills_challenge_entries (organization_id, challenge, age_group);

COMMIT;
`;

async function main() {
  const client = await pool.connect();
  try {
    console.log("Connected. Applying skills challenge migration in one transaction...");
    await client.query(SQL);
    console.log("✅ Migration applied.");

    const check = await client.query(`
      SELECT 1 FROM information_schema.tables WHERE table_name = 'skills_challenge_entries'
    `);
    if (check.rows.length !== 1) {
      throw new Error("skills_challenge_entries table not found after migration");
    }
    console.log("  ✓ skills_challenge_entries");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});

// Adds parent/child support to budget_lines so a line item can have
// breakdown sub-lines (mirrors the Google Sheet's row groups, e.g. one
// referee with N per-date payments under it).
//
// Usage: npx tsx --env-file=.env script/apply-budget-sub-lines-schema.ts

import { Pool } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SQL = `
BEGIN;

ALTER TABLE budget_lines
  ADD COLUMN IF NOT EXISTS parent_line_id integer
  REFERENCES budget_lines(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS budget_lines_parent_idx ON budget_lines(parent_line_id);

COMMIT;
`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    console.log("✅ parent_line_id column applied.");
    const r = await client.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name='budget_lines' AND column_name='parent_line_id'`);
    console.log(r.rows.length ? "  ✓ verified present" : "  ✗ NOT present after migration");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error("❌", err); process.exit(1); });

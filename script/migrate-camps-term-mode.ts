// Add the columns needed to run programs in "term mode" through the existing
// Camps admin UI (currently camps-only is holiday-camp shaped).
//
//   programs.weekly_pattern_json  — JSON array of recurring weekly slots so the
//                                   admin can re-generate sessions after the
//                                   linked term's date range changes.
//   camp_dates.name               — optional human label for a slot, e.g.
//                                   "Age 4-6", "Age 7-8" so the U4-U8 academy
//                                   can run two age-split rolls on the same
//                                   Saturday.
//
// Both are nullable so existing holiday camps and registrations stay untouched.

import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE programs
        ADD COLUMN IF NOT EXISTS weekly_pattern_json text;
    `);
    console.log("✓ programs.weekly_pattern_json added");

    await client.query(`
      ALTER TABLE camp_dates
        ADD COLUMN IF NOT EXISTS name text;
    `);
    console.log("✓ camp_dates.name added");

    await client.query("COMMIT");
    console.log("✅ Migration complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Migration failed; rolled back:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();

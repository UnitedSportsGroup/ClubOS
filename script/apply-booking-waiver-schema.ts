// One-off migration: waiver-acceptance columns on facility_bookings, stamped
// by the public booking checkout. Purely additive (ADD COLUMN IF NOT EXISTS),
// single transaction, safe to re-run.
//
// Run BEFORE deploying the app build that writes these columns:
//   npx tsx --env-file=.env script/apply-booking-waiver-schema.ts

import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SQL = `
BEGIN;

ALTER TABLE facility_bookings ADD COLUMN IF NOT EXISTS waiver_accepted boolean NOT NULL DEFAULT false;
ALTER TABLE facility_bookings ADD COLUMN IF NOT EXISTS waiver_version text;
ALTER TABLE facility_bookings ADD COLUMN IF NOT EXISTS waiver_accepted_at timestamp;

COMMIT;
`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    const check = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'facility_bookings' AND column_name LIKE 'waiver%'`
    );
    console.log("waiver columns:", check.rows.map((r: any) => r.column_name).join(", ") || "MISSING");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Migration failed:", e.message);
  process.exit(1);
});

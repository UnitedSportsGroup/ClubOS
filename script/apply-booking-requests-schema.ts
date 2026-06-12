// One-off migration for the member Booking Requests feature (USC workspace).
// Purely additive — CREATE TABLE/INDEX IF NOT EXISTS only, wrapped in a single
// transaction so any failure rolls everything back. Safe to re-run.
//
// Run BEFORE deploying the app build that reads this table:
//   npx tsx --env-file=.env script/apply-booking-requests-schema.ts

import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SQL = `
BEGIN;

CREATE TABLE IF NOT EXISTS booking_requests (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  facility_id integer NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  date_of_birth date NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  booking_date date NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  half_full text,
  half_position text,
  waiver_accepted boolean NOT NULL DEFAULT false,
  waiver_version text,
  waiver_accepted_at timestamp,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by integer REFERENCES users(id),
  reviewed_at timestamp,
  decline_reason text,
  facility_booking_id integer REFERENCES facility_bookings(id),
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_requests_org_status_idx
  ON booking_requests (organization_id, status);

CREATE INDEX IF NOT EXISTS booking_requests_facility_date_idx
  ON booking_requests (facility_id, booking_date);

COMMIT;
`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    const check = await client.query(`SELECT to_regclass('public.booking_requests') AS t`);
    console.log("booking_requests table:", check.rows[0].t ? "OK" : "MISSING");
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

// One-off: add the google_id column to the users table.
// Idempotent — safe to re-run. Run with: node scripts/add-google-id-column.mjs
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new Pool({ connectionString: url });
try {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id text;`);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'users_google_id_unique') THEN
        ALTER TABLE users ADD CONSTRAINT users_google_id_unique UNIQUE (google_id);
      END IF;
    END $$;
  `);
  const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'google_id';`);
  console.log("google_id column:", r.rowCount > 0 ? "present" : "missing");
} finally {
  await pool.end();
}

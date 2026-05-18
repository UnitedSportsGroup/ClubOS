import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    console.log("Adding apple_id column to users (additive, idempotent)...");
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id text;
      CREATE UNIQUE INDEX IF NOT EXISTS users_apple_id_unique ON users(apple_id) WHERE apple_id IS NOT NULL;
    `);
    const r = await client.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'apple_id';
    `);
    if (r.rows.length === 0) throw new Error("apple_id column still missing after ALTER");
    console.log("✅ apple_id column present");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error("❌", err); process.exit(1); });

import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
async function main() {
  const c = await pool.connect();
  try {
    const r = await c.query(
      `SELECT id, title, start_time, location, created_at
         FROM calendar_events
        WHERE organization_id = 7 AND title LIKE 'CUFC vs %'
        ORDER BY start_time`,
    );
    for (const row of r.rows) console.log(row);
  } finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });

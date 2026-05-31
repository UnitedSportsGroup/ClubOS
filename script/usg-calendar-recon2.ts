import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
async function main() {
  const c = await pool.connect();
  try {
    const r = await c.query(
      `SELECT title, calendar_type, color, all_day, start_time, end_time, location, description
       FROM calendar_events
       WHERE organization_id = 7
         AND (title ILIKE '%western springs%' OR title ILIKE '%tournament%' OR all_day = true)
       ORDER BY start_time DESC LIMIT 12`,
    );
    for (const row of r.rows) console.log(row);
  } finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });

import { Pool } from "pg";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    const r = await c.query<{ id: number; name: string; slug: string }>(
      `SELECT id, name, slug FROM organizations WHERE slug = 'united-sports-group'`,
    );
    console.log("USG org:", r.rows[0]);
    const evCount = await c.query<{ c: string }>(
      `SELECT COUNT(*)::text as c FROM calendar_events WHERE organization_id = $1`,
      [r.rows[0].id],
    );
    console.log("Existing events in USG:", evCount.rows[0].c);
    const sample = await c.query(
      `SELECT title, calendar_type, color, all_day, start_time FROM calendar_events WHERE organization_id = $1 ORDER BY start_time DESC LIMIT 8`,
      [r.rows[0].id],
    );
    console.log("Sample existing:");
    for (const row of sample.rows) console.log(" ", row);
    const types = await c.query(
      `SELECT DISTINCT calendar_type FROM calendar_events WHERE organization_id = $1`,
      [r.rows[0].id],
    );
    console.log("Distinct calendar_types in USG:", types.rows.map(r => r.calendar_type));
  } finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });

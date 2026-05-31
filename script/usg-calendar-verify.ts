import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
async function main() {
  const c = await pool.connect();
  try {
    const total = await c.query<{ c: string }>(
      `SELECT COUNT(*)::text c FROM calendar_events WHERE organization_id = 7`,
    );
    console.log("Total USG events:", total.rows[0].c);

    for (const [label, filter] of [
      ["Fixtures", `title LIKE 'CUFC vs %'`],
      ["South Island tournaments", `title LIKE 'South Island %'`],
      ["Canterbury Regional", `title LIKE 'Canterbury Regional %'`],
      ["Western Springs U17", `title = 'Western Springs U17'`],
      ["Holiday Programme days", `title = 'Holiday Programme'`],
      ["Marketing milestones", `title LIKE 'Marketing: %'`],
      ["U4-U8 term blocks", `title LIKE 'U4-U8 Football Programme%'`],
    ] as const) {
      const r = await c.query<{ c: string }>(
        `SELECT COUNT(*)::text c FROM calendar_events WHERE organization_id = 7 AND ${filter}`,
      );
      console.log(`  ${label}: ${r.rows[0].c}`);
    }

    // Show the Western Springs entry to confirm dates
    const ws = await c.query(
      `SELECT title, start_time, end_time, all_day FROM calendar_events WHERE organization_id = 7 AND title = 'Western Springs U17'`,
    );
    console.log("\nWestern Springs U17:", ws.rows[0]);
  } finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });

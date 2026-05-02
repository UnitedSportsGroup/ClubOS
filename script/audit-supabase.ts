import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const tables = await pool.query(`
    SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename
  `);

  console.log("=== Row counts ===");
  for (const r of tables.rows) {
    const t = r.tablename;
    const c = await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    console.log(`  ${t.padEnd(34)} ${String(c.rows[0].n).padStart(8)}`);
  }

  console.log("\n=== Organizations ===");
  const orgs = await pool.query(`SELECT id, slug, name FROM organizations ORDER BY id`);
  console.table(orgs.rows);

  console.log("\n=== Calendar events by organization ===");
  const calByOrg = await pool.query(`
    SELECT organization_id, COUNT(*)::int AS events
    FROM calendar_events GROUP BY organization_id ORDER BY organization_id
  `);
  console.table(calByOrg.rows);

  console.log("\n=== Calendar events sample (recent + upcoming) ===");
  const calSample = await pool.query(`
    SELECT id, organization_id, title, start_time, calendar_type
    FROM calendar_events
    WHERE start_time >= NOW() - INTERVAL '30 days'
    ORDER BY start_time
    LIMIT 30
  `);
  console.table(calSample.rows);

  console.log("\n=== Tournaments ===");
  const t = await pool.query(`SELECT id, organization_id, name, start_date, status FROM tournaments ORDER BY id`);
  console.table(t.rows);

  console.log("\n=== Programs (camps/academy) ===");
  const p = await pool.query(`SELECT id, organization_id, type, name, slug, is_active FROM programs ORDER BY id`);
  console.table(p.rows);

  console.log("\n=== League competitions ===");
  const lc = await pool.query(`SELECT id, organization_id, name, registration_status FROM league_competitions ORDER BY id`);
  console.table(lc.rows);

  console.log("\n=== League teams count ===");
  const lt = await pool.query(`SELECT COUNT(*)::int AS n FROM league_teams`);
  console.log(`  league_teams: ${lt.rows[0].n}`);

  console.log("\n=== Top tables: registrations, contacts, children ===");
  const top = await pool.query(`
    SELECT 'registrations' AS t, COUNT(*)::int AS n FROM registrations
    UNION ALL SELECT 'registration_items', COUNT(*)::int FROM registration_items
    UNION ALL SELECT 'contacts', COUNT(*)::int FROM contacts
    UNION ALL SELECT 'children', COUNT(*)::int FROM children
    UNION ALL SELECT 'analytics_events', COUNT(*)::int FROM analytics_events
    UNION ALL SELECT 'object_acls', COUNT(*)::int FROM object_acls
  `);
  console.table(top.rows);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

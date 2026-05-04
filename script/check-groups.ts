import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query(`
    SELECT
      t.age_group,
      g.id AS group_id,
      g.name AS group_name,
      g.sort_order,
      COUNT(tt.id)::int AS team_count
    FROM tournaments t
    JOIN tournament_groups g ON g.tournament_id = t.id
    LEFT JOIN tournament_teams tt ON tt.group_id = g.id
    WHERE t.organization_id = 5
    GROUP BY t.age_group, g.id, g.name, g.sort_order
    ORDER BY t.age_group, g.name
  `);
  for (const row of r.rows) {
    console.log(`  ${row.age_group} · group #${row.group_id} '${row.group_name}' (sort=${row.sort_order}) — ${row.team_count} teams`);
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });

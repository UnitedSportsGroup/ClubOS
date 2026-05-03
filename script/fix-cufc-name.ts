import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const r1 = await pool.query(
    `UPDATE clubs SET name = 'Christchurch United FC', short_name = 'CUFC'
     WHERE organization_id = 5 AND name = 'CHRISTCHUCH UNITED FC'
     RETURNING id, name, short_name`
  );
  console.log("Clubs updated:", r1.rows);
  const r2 = await pool.query(
    `UPDATE tournament_teams
     SET name = 'Christchurch United FC', club_name = 'Christchurch United FC'
     WHERE club_id IN (SELECT id FROM clubs WHERE organization_id = 5 AND name = 'Christchurch United FC')
     RETURNING id, tournament_id`
  );
  console.log(`Tournament teams renamed: ${r2.rowCount} rows`);
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });

// Consolidate the "Pool A/B/C/D" + "Group A/B/C/D" duplication and standardise
// on "Group" naming throughout. The original setup-cic-tournaments.ts script
// created "Pool A/B/C/D" rows even when "Group A/B/C/D" already existed,
// leaving 8 groups per tournament for the ones that had pre-existing groups.
//
// Daniel wants:
//   - Just 4 groups per tournament: Group A, B, C, D
//   - "Group" terminology everywhere — no "Pool" anywhere in the UI
//
// Strategy (single transaction so partial failure rolls back):
//   1. For each empty Group A-D placeholder that pairs with a populated
//      Pool A-D in the same tournament: delete the empty Group row.
//      (We keep Pool because that's where teams + games actually point.)
//   2. Rename every remaining "Pool X" → "Group X".
//   3. Update tournament_games.stage_detail values "POOL X" → "GROUP X"
//      so fixture cards also say GROUP A instead of POOL A.

import "dotenv/config";
import { Pool } from "pg";

const CIC_ORG_ID = 5;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Delete empty placeholder Group rows when a populated Pool row
    //    exists in the same tournament. This is safe because the Group
    //    rows have 0 teams and 0 games — only the Pool rows have data.
    const deletedRes = await client.query(`
      DELETE FROM tournament_groups g
      WHERE g.tournament_id IN (SELECT id FROM tournaments WHERE organization_id = $1)
        AND g.name IN ('Group A', 'Group B', 'Group C', 'Group D')
        AND NOT EXISTS (SELECT 1 FROM tournament_teams t WHERE t.group_id = g.id)
        AND NOT EXISTS (SELECT 1 FROM tournament_games gm WHERE gm.group_id = g.id)
        AND EXISTS (
          SELECT 1 FROM tournament_groups other
          WHERE other.tournament_id = g.tournament_id
            AND other.name = REPLACE(g.name, 'Group', 'Pool')
        )
      RETURNING id, name, tournament_id
    `, [CIC_ORG_ID]);
    console.log(`✓ Deleted ${deletedRes.rowCount} empty placeholder Group rows`);

    // 2. Rename remaining Pool A/B/C/D → Group A/B/C/D.
    const renamedRes = await client.query(`
      UPDATE tournament_groups
      SET name = REPLACE(name, 'Pool', 'Group')
      WHERE tournament_id IN (SELECT id FROM tournaments WHERE organization_id = $1)
        AND name IN ('Pool A', 'Pool B', 'Pool C', 'Pool D')
      RETURNING id, name, tournament_id
    `, [CIC_ORG_ID]);
    console.log(`✓ Renamed ${renamedRes.rowCount} Pool rows → Group`);

    // 3. Update game stage_detail strings: "POOL A" → "GROUP A" (etc.)
    const gamesRes = await client.query(`
      UPDATE tournament_games
      SET stage_detail = REPLACE(stage_detail, 'POOL', 'GROUP')
      WHERE tournament_id IN (SELECT id FROM tournaments WHERE organization_id = $1)
        AND stage_detail LIKE 'POOL %'
      RETURNING id
    `, [CIC_ORG_ID]);
    console.log(`✓ Updated ${gamesRes.rowCount} game stage_detail strings`);

    await client.query("COMMIT");
    console.log("\nDone — verify by running script/check-groups.ts.");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Migration rolled back:", e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

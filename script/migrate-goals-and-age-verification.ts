// Adds: tournament_goals table + age verification columns on
// tournament_players. Idempotent — safe to re-run.

import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(`
    ALTER TABLE tournament_players
      ADD COLUMN IF NOT EXISTS age_verified BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS verified_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP
  `);
  console.log("✓ tournament_players age verification columns ready");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournament_goals (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      game_id INTEGER NOT NULL REFERENCES tournament_games(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES tournament_players(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES tournament_teams(id) ON DELETE CASCADE,
      minute INTEGER,
      is_own_goal BOOLEAN NOT NULL DEFAULT FALSE,
      is_penalty BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  console.log("✓ tournament_goals table ready");

  await pool.query(`CREATE INDEX IF NOT EXISTS tournament_goals_game_id_idx ON tournament_goals(game_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tournament_goals_player_id_idx ON tournament_goals(player_id)`);
  console.log("✓ tournament_goals indexes ready");

  await pool.end();
  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });

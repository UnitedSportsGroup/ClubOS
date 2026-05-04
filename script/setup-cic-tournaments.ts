// Bring every CIC 2026 tournament into a usable state in one pass:
//   1. Ensure 4 pools (A/B/C/D) exist for each tournament.
//   2. Distribute teams across the pools (round-robin by alphabetical name
//      for reproducibility — Daniel can rearrange in the admin UI later).
//      Sets seed_number 1..N within each pool.
//   3. Flip tournament.status → 'active' so the public API surfaces it
//      (the CIC Youth app filters out anything in 'draft').
//   4. Wipe any existing games (which after the import are pointing at
//      deleted placeholder team rows — that's why the app showed "TBD").
//   5. For tournaments with exactly 16 teams + a start_date, regenerate
//      the full 48-game schedule via buildCICSchedule.
//
// Tournaments that don't fit the 16-team mould (U9 has 13, U11/U12 have
// 18 each) get groups + team assignments only. Schedule decisions for
// those need a human — drop teams, run a different bracket, etc.

import "dotenv/config";
import { Pool } from "pg";
import { buildCICSchedule } from "../server/tournament-schedule";

const CIC_ORG_ID = 5;

interface Tournament {
  id: number;
  name: string;
  age_group: string;
  start_date: Date | string | null;
  status: string;
}

interface Group {
  id: number;
  tournamentId: number;
  name: string;
  sortOrder: number | null;
  createdAt: Date;
}

interface Team {
  id: number;
  tournamentId: number;
  groupId: number | null;
  name: string;
  seedNumber: number | null;
}

function dateToISO(d: Date | string | null): string | null {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  // pg date columns come back as JS Dates parsed in local time. Use local
  // accessors so NZST doesn't shift the date back a day via toISOString().
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function ensurePools(pool: Pool, t: Tournament): Promise<Group[]> {
  const existing = await pool.query<Group>(
    `SELECT id, tournament_id AS "tournamentId", name, sort_order AS "sortOrder", created_at AS "createdAt"
     FROM tournament_groups WHERE tournament_id = $1
     ORDER BY sort_order NULLS LAST, name`,
    [t.id]
  );
  const haveNames = new Set(existing.rows.map(g => g.name));
  const wanted = ["Pool A", "Pool B", "Pool C", "Pool D"];
  const groups = [...existing.rows];
  for (let i = 0; i < wanted.length; i++) {
    if (!haveNames.has(wanted[i])) {
      const ins = await pool.query<Group>(
        `INSERT INTO tournament_groups (tournament_id, name, sort_order)
         VALUES ($1, $2, $3)
         RETURNING id, tournament_id AS "tournamentId", name, sort_order AS "sortOrder", created_at AS "createdAt"`,
        [t.id, wanted[i], i]
      );
      groups.push(ins.rows[0]);
    }
  }
  // Re-sort to canonical pool order, drop anything beyond the first 4 (rare —
  // would happen if someone manually added a 5th pool).
  groups.sort((a, b) => {
    const ai = wanted.indexOf(a.name);
    const bi = wanted.indexOf(b.name);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return groups.slice(0, 4);
}

async function distributeTeamsToPools(pool: Pool, t: Tournament, groups: Group[]): Promise<Team[]> {
  // Sort teams alphabetically for reproducible distribution. Round-robin
  // across the 4 pools — keeps pool sizes balanced for any team count
  // (16 → 4+4+4+4, 13 → 4+3+3+3, 18 → 5+5+4+4).
  const teamsRes = await pool.query<Team>(
    `SELECT id, tournament_id AS "tournamentId", group_id AS "groupId", name, seed_number AS "seedNumber"
     FROM tournament_teams WHERE tournament_id = $1 ORDER BY name`,
    [t.id]
  );
  const teams = teamsRes.rows;
  const poolCounts = [0, 0, 0, 0];
  const newAssignments: { id: number; groupId: number; seed: number }[] = [];
  for (let i = 0; i < teams.length; i++) {
    const poolIdx = i % 4;
    poolCounts[poolIdx]++;
    newAssignments.push({
      id: teams[i].id,
      groupId: groups[poolIdx].id,
      seed: poolCounts[poolIdx],
    });
  }
  for (const a of newAssignments) {
    await pool.query(
      `UPDATE tournament_teams SET group_id = $1, seed_number = $2 WHERE id = $3`,
      [a.groupId, a.seed, a.id]
    );
  }
  // Return teams with the freshly-assigned groupId / seedNumber baked in.
  return newAssignments.map((a, i) => ({
    ...teams[i],
    groupId: a.groupId,
    seedNumber: a.seed,
  }));
}

async function setStatus(pool: Pool, t: Tournament, status: string) {
  if (t.status === status) return false;
  await pool.query(`UPDATE tournaments SET status = $1 WHERE id = $2`, [status, t.id]);
  return true;
}

async function wipeGames(pool: Pool, t: Tournament): Promise<number> {
  const r = await pool.query(`DELETE FROM tournament_games WHERE tournament_id = $1`, [t.id]);
  return r.rowCount ?? 0;
}

async function regenerateSchedule(pool: Pool, t: Tournament, groups: Group[], teams: Team[]) {
  const startDate = dateToISO(t.start_date);
  if (teams.length !== 16) return { generated: 0, skipped: `team count is ${teams.length}, need 16` };
  if (!startDate) return { generated: 0, skipped: "no start_date set" };

  const inserts = buildCICSchedule({
    tournamentId: t.id,
    startDate,
    groups: groups as any,
    teams: teams as any,
  });

  for (const g of inserts) {
    await pool.query(
      `INSERT INTO tournament_games (
         tournament_id, group_id, home_team_id, away_team_id,
         home_team_placeholder, away_team_placeholder,
         game_number, round_number, stage, stage_detail,
         game_date, start_time, end_time, field, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        g.tournamentId, g.groupId ?? null, g.homeTeamId ?? null, g.awayTeamId ?? null,
        g.homeTeamPlaceholder ?? null, g.awayTeamPlaceholder ?? null,
        g.gameNumber ?? null, g.roundNumber ?? null, g.stage ?? "group", g.stageDetail ?? null,
        g.gameDate ?? null, g.startTime ?? null, g.endTime ?? null, g.field ?? null, g.status ?? "scheduled",
      ]
    );
  }
  return { generated: inserts.length };
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const tours = await pool.query<Tournament>(
    `SELECT id, name, age_group, start_date, status FROM tournaments
     WHERE organization_id = $1 ORDER BY age_group`,
    [CIC_ORG_ID]
  );

  console.log(`Setting up ${tours.rowCount} CIC tournaments…\n`);

  const summary: Array<{
    name: string; teams: number; pools: number; activated: boolean; gamesWiped: number;
    gamesGenerated: number; needsAttention: string[];
  }> = [];

  for (const t of tours.rows) {
    console.log(`── ${t.name} (${t.age_group}) ──`);

    const groups = await ensurePools(pool, t);
    console.log(`  pools: ${groups.length}`);

    const teams = await distributeTeamsToPools(pool, t, groups);
    const dist = [0, 0, 0, 0];
    for (const tm of teams) {
      const idx = groups.findIndex(g => g.id === tm.groupId);
      if (idx >= 0) dist[idx]++;
    }
    console.log(`  teams: ${teams.length} → ${groups.map((g, i) => `${g.name.replace("Pool ", "")}:${dist[i]}`).join(" ")}`);

    const activated = await setStatus(pool, t, "active");
    if (activated) console.log(`  status: → active`);

    const gamesWiped = await wipeGames(pool, t);
    if (gamesWiped) console.log(`  wiped ${gamesWiped} stale games`);

    const result = await regenerateSchedule(pool, t, groups, teams);
    if ("generated" in result && result.generated > 0) {
      console.log(`  ✓ generated ${result.generated} games`);
    } else if ("skipped" in result) {
      console.log(`  · schedule skipped: ${result.skipped}`);
    }

    const needsAttention: string[] = [];
    if (teams.length !== 16) needsAttention.push(`${teams.length} teams (CIC format wants 16)`);
    if (!t.start_date) needsAttention.push("no start_date — set in admin");

    summary.push({
      name: t.name,
      teams: teams.length,
      pools: groups.length,
      activated,
      gamesWiped,
      gamesGenerated: "generated" in result ? result.generated : 0,
      needsAttention,
    });
    console.log("");
  }

  console.log("\n=== Summary ===\n");
  console.log("Tournament                                      Teams  Schedule  Notes");
  console.log("-".repeat(95));
  for (const s of summary) {
    const sched = s.gamesGenerated > 0 ? `${s.gamesGenerated} games` : "—";
    const notes = s.needsAttention.length === 0 ? "ready" : s.needsAttention.join("; ");
    console.log(`  ${s.name.padEnd(45)} ${String(s.teams).padStart(5)} ${sched.padEnd(10)} ${notes}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

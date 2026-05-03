import "dotenv/config";
import { Pool } from "pg";
import { buildCICSchedule } from "../server/tournament-schedule";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Pull the U10 2026 tournament + its groups + its teams as the generator
  // would receive them.
  const tour = await pool.query(`SELECT * FROM tournaments WHERE name = 'U10 Christchurch International Cup 2026' LIMIT 1`);
  if (tour.rowCount === 0) { console.log("U10 tournament not found"); process.exit(1); }
  const t = tour.rows[0];
  console.log(`Tournament: ${t.name}, start ${t.start_date}`);

  const groupsRes = await pool.query(`SELECT * FROM tournament_groups WHERE tournament_id = $1 ORDER BY sort_order, name`, [t.id]);
  const teamsRes = await pool.query(`SELECT * FROM tournament_teams WHERE tournament_id = $1 ORDER BY id`, [t.id]);

  // Map snake_case → camelCase for the generator (Drizzle does this in app code)
  const groups = groupsRes.rows.map(g => ({ id: g.id, tournamentId: g.tournament_id, name: g.name, sortOrder: g.sort_order, createdAt: g.created_at }));
  const teams = teamsRes.rows.map(r => ({
    id: r.id,
    tournamentId: r.tournament_id,
    groupId: r.group_id,
    name: r.name,
    clubName: r.club_name,
    logoUrl: r.logo_url,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    primaryColor: r.primary_color,
    secondaryColor: r.secondary_color,
    seedNumber: r.seed_number,
    registrationStatus: r.registration_status,
    paidAmountCents: r.paid_amount_cents,
    active: r.active,
    createdAt: r.created_at,
  }));

  console.log(`Groups: ${groups.length}, Teams: ${teams.length}`);
  console.log("");

  const sd = t.start_date;
  const startDate = (sd instanceof Date)
    ? `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, "0")}-${String(sd.getDate()).padStart(2, "0")}`
    : String(sd).slice(0, 10);
  const games = buildCICSchedule({
    tournamentId: t.id,
    startDate,
    groups: groups as any,
    teams: teams as any,
  });

  console.log(`Generated ${games.length} games:\n`);
  console.log("Game# | Date       | Time  | Field | Stage     | Detail        | Home              vs Away");
  console.log("------|------------|-------|-------|-----------|---------------|----------------------------");
  for (const g of games) {
    const home = g.homeTeamId ? teams.find(t => t.id === g.homeTeamId)?.name?.slice(0, 22) : g.homeTeamPlaceholder;
    const away = g.awayTeamId ? teams.find(t => t.id === g.awayTeamId)?.name?.slice(0, 22) : g.awayTeamPlaceholder;
    console.log(
      `  ${String(g.gameNumber).padStart(3)} | ${g.gameDate} | ${g.startTime} | ${(g.field ?? '').padEnd(5)} | ${g.stage?.padEnd(9) ?? ''} | ${(g.stageDetail ?? '').padEnd(13)} | ${(home ?? '').padEnd(22)} v ${away ?? ''}`
    );
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

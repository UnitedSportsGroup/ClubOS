// MFL Term 4 — the full night structure, and the usual prices behind the discounts.
//
//   npx tsx --env-file=.env script/seed-mfl-term4-fives.ts            (dry run)
//   npx tsx --env-file=.env script/seed-mfl-term4-fives.ts --commit
//
// Daniel, 2026-09-20: "add Tuesday fives and Wednesday fives … at $300 with the
// new league discount … Thursday fives are $400 right now, I would do $300 …
// 5-a-side leagues are usually $500 … show whatever that percentage is off the
// full prices, and then you're showing the whole stack and save concept."
//
// Idempotent: finds each night by (competition, name). Never touches a team or
// a registration — the two sides already on Thursday 5's paid what they paid.
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const COMP = 6;            // Mini Football Leagues — Term 4
const PROGRAM = 23;        // its league_team programme
const BADGE = "New league discount";
const VENUE = "United Sports Centre, 466 Yaldhurst Rd, Russley";

// name → { day, max, cost, list, sort }. list = the usual price for the format
// (5's $500, 7's $600); null where the cost IS the usual price.
const NIGHTS: Record<string, { day: string; max: number; cost: number; list: number | null; badge: string | null; sort: number }> = {
  "Monday 5's":    { day: "Monday",    max: 12, cost: 50000, list: null,  badge: null,  sort: 1 },
  "Monday 7's":    { day: "Monday",    max: 16, cost: 60000, list: null,  badge: null,  sort: 2 },
  "Tuesday 5's":   { day: "Tuesday",   max: 12, cost: 30000, list: 50000, badge: BADGE, sort: 3 },
  "Tuesday 7's":   { day: "Tuesday",   max: 16, cost: 40000, list: 60000, badge: BADGE, sort: 4 },
  "Wednesday 5's": { day: "Wednesday", max: 12, cost: 30000, list: 50000, badge: BADGE, sort: 5 },
  "Wednesday 7's": { day: "Wednesday", max: 16, cost: 60000, list: null,  badge: null,  sort: 6 },
  "Thursday 5's":  { day: "Thursday",  max: 12, cost: 30000, list: 50000, badge: BADGE, sort: 7 },
  "Thursday 7's":  { day: "Thursday",  max: 16, cost: 60000, list: null,  badge: null,  sort: 8 },
};

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query("BEGIN");
  const before = await c.query(`select id, name, team_cost_cents, list_price_cents, badge_text, sort_order from league_divisions where competition_id = $1 order by sort_order`, [COMP]);
  console.log("\n  before:"); console.table(before.rows);

  for (const [name, n] of Object.entries(NIGHTS)) {
    const [row] = (await c.query(`select id, team_cost_cents from league_divisions where competition_id = $1 and name = $2`, [COMP, name])).rows;
    if (row) {
      await c.query(
        `update league_divisions set team_cost_cents = $2, list_price_cents = $3, badge_text = $4, sort_order = $5, max_teams = coalesce(max_teams, $6) where id = $1`,
        [row.id, n.cost, n.list, n.badge, n.sort, n.max]);
      console.log(`  ${row.team_cost_cents === n.cost ? "kept" : "repriced"} ${name}: $${(n.cost / 100).toFixed(0)}${n.list ? ` (usual $${(n.list / 100).toFixed(0)})` : ""}`);
    } else {
      await c.query(
        `insert into league_divisions (competition_id, name, day_of_week, max_teams, team_cost_cents, player_cost_cents, list_price_cents, badge_text, sort_order)
         values ($1, $2, $3, $4, $5, 0, $6, $7, $8)`,
        [COMP, name, n.day, n.max, n.cost, n.list, n.badge, n.sort]);
      console.log(`  ADDED ${name}: $${(n.cost / 100).toFixed(0)} (usual $${((n.list ?? n.cost) / 100).toFixed(0)}), ${n.max} teams, ${n.day}`);
    }
  }
  await c.query(`update programs set location = $2 where id = $1 and (location is null or location = '' or location = 'Christchurch')`, [PROGRAM, VENUE]);

  const after = await c.query(`select id, name, day_of_week, max_teams, team_cost_cents, list_price_cents, badge_text, sort_order from league_divisions where competition_id = $1 order by sort_order`, [COMP]);
  console.log("\n  after:"); console.table(after.rows);
  console.log("  programme location:", (await c.query(`select location from programs where id = $1`, [PROGRAM])).rows[0].location);

  if (COMMIT) { await c.query("COMMIT"); console.log("\n  COMMITTED\n"); }
  else { await c.query("ROLLBACK"); console.log("\n  dry run — rolled back. Re-run with --commit.\n"); }
  await c.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

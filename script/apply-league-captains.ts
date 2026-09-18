// Apply migrations/2026-09-18_league_captains.sql, rehearsing it first.
//
//   npx tsx --env-file=.env script/apply-league-captains.ts            (dry run)
//   npx tsx --env-file=.env script/apply-league-captains.ts --commit
//
// There is no local Postgres, so a dry run is the only rehearsal available: it
// runs the real DDL and the real checks inside a transaction it then rolls back.
//
// 🔴 The behavioural checks are the point. What must be REFUSED:
//   1. two live players wearing the same number on one team
//   2. a shirt number of 100, or −1
//   3. a blank name
//   4. a second captain row on the same team
//   5. a fill-in on two teams' squad lists at once (season asks)
//   6. a 31st live player on one list
//   7. a night ask with no night · a season ask carrying a night
//   8. an ask that expires before it was made
//   9. two OPEN season asks for one player
//  10. two teams holding the same player for the same night (open or accepted)
//
// And what must be ACCEPTED, each easy to break by accident:
//   A. two players with NO number on the same team      — NULLs stay distinct
//   B. the same email on two DIFFERENT teams             — a mate can play Monday and Wednesday
//   C. a removed player's number reused                  — the partial index ignores removed rows
//   D. the same player asked for two DIFFERENT nights    — that is the whole point
//   E. a declined night ask, then the same night asked again by another team
//   F. re-running the whole migration                    — idempotency
//
// Every fixture is created under a SAVEPOINT and rolled back before COMMIT —
// the first Team Pay applier committed a fixture competition straight into
// production, found by probing rather than by the script.
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const MIGRATION = "2026-09-18_league_captains.sql";

const problems: string[] = [];
let checks = 0;
function ok(l: string) { checks++; console.log(`  ✓ ${l}`); }
function bad(l: string) { checks++; problems.push(l); console.log(`  ✗ ${l}`); }

async function mustRefuse(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try {
    await c.query(sql, params);
    await c.query("ROLLBACK TO SAVEPOINT s");
    bad(`${label} — was ALLOWED, and must not be`);
  } catch {
    await c.query("ROLLBACK TO SAVEPOINT s");
    ok(`refused: ${label}`);
  }
}
async function mustAccept(c: pg.Client, label: string, sql: string, params: any[] = []): Promise<any> {
  await c.query("SAVEPOINT s");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT s");
    ok(`accepted: ${label}`);
    return r;
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT s");
    bad(`${label} — was REFUSED: ${e.message}`);
    return null;
  }
}

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", MIGRATION), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log(`\n  MFL captain's dashboard — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");

  try {
    await c.query(sql);
    console.log("  migration ran\n");

    // ── structure ──────────────────────────────────────────────────────────
    for (const t of ["league_squad_members", "league_fillin_requests"]) {
      const r = await c.query(`select 1 from information_schema.tables where table_name = $1`, [t]);
      r.rowCount ? ok(`${t} exists`) : bad(`${t} was not created`);
      const rls = await c.query(`select relrowsecurity from pg_class where relname = $1`, [t]);
      rls.rows[0]?.relrowsecurity ? ok(`${t} has RLS on`) : bad(`${t} has RLS OFF`);
    }
    const col = await c.query(`select 1 from information_schema.columns where table_name='teampay_fillins' and column_name='available_days'`);
    col.rowCount ? ok("teampay_fillins.available_days exists") : bad("teampay_fillins.available_days missing");

    // ── fixtures, under a savepoint that is always rolled back ─────────────
    await c.query("SAVEPOINT fixtures");

    const org = 3; // Mini Football Leagues
    const comp = (await c.query(
      `insert into league_competitions (organization_id, name, archived, active, registration_status)
       values ($1, 'ZZ apply-league-captains fixture', true, false, 'none') returning id`, [org])).rows[0].id;
    const div = (await c.query(
      `insert into league_divisions (competition_id, name, day_of_week) values ($1, 'ZZ Wed', 'Wednesday') returning id`, [comp])).rows[0].id;
    const teamA = (await c.query(
      `insert into league_teams (organization_id, competition_id, division_id, name, contact_name, contact_email)
       values ($1, $2, $3, 'ZZ Team A', 'Cap A', 'zz-a@example.com') returning id`, [org, comp, div])).rows[0].id;
    const teamB = (await c.query(
      `insert into league_teams (organization_id, competition_id, division_id, name, contact_name, contact_email)
       values ($1, $2, $3, 'ZZ Team B', 'Cap B', 'zz-b@example.com') returning id`, [org, comp, div])).rows[0].id;
    // A programme + a teampay pool, so a fill-in can exist.
    const prog = (await c.query(
      `insert into programs (organization_id, name, slug, type, league_competition_id, is_active)
       values ($1, 'ZZ fixture programme', 'zz-apply-league-captains', 'league_team', $2, false) returning id`, [org, comp])).rows[0].id;
    const pool = (await c.query(
      `insert into teampay_competitions (organization_id, kind, program_id, slug, name, brand, fee_cents, default_squad_size)
       values ($1, 'program', $2, 'zz-apply-league-captains', 'ZZ pool', 'mfl', 0, 12) returning id`, [org, prog])).rows[0].id;
    const fillin = async (email: string) => (await c.query(
      `insert into teampay_fillins (competition_id, organization_id, first_name, email, player_token)
       values ($1, $2, 'Zed', $3, md5(random()::text || $3)) returning id`, [pool, org, email])).rows[0].id;
    const f1 = await fillin("zz-f1@example.com");
    const f2 = await fillin("zz-f2@example.com");
    ok("fixtures built (rolled back at the end)");

    // ── the squad list ─────────────────────────────────────────────────────
    const member = (name: string, team = teamA, extra = "") =>
      `insert into league_squad_members (team_id, name ${extra ? "," + extra.split("=")[0] : ""}) values (${team}, '${name}' ${extra ? "," + extra.split("=")[1] : ""})`;

    await mustAccept(c, "a player with no number", member("Nobody Number"));
    await mustAccept(c, "a second player with no number on the same team (NULLs distinct)", member("Also No Number"));
    await mustAccept(c, "number 7", member("Seven", teamA, "shirt_number=7"));
    await mustRefuse(c, "a second live number 7 on the same team", member("Seven Again", teamA, "shirt_number=7"));
    await mustAccept(c, "number 7 on a DIFFERENT team", member("Other Seven", teamB, "shirt_number=7"));
    await mustRefuse(c, "shirt number 100", member("Hundred", teamA, "shirt_number=100"));
    await mustRefuse(c, "shirt number −1", member("Minus", teamA, "shirt_number=-1"));
    await mustAccept(c, "shirt number 0", member("Zero", teamA, "shirt_number=0"));
    await mustRefuse(c, "a blank name", member("   "));
    await mustAccept(c, "an email on team A", member("Mate", teamA, "email='mate@example.com'"));
    await mustRefuse(c, "the same email twice on team A, differing only in case",
      member("Mate Again", teamA, "email='MATE@example.com'"));
    await mustAccept(c, "the same email on team B (plays two nights)", member("Mate", teamB, "email='mate@example.com'"));
    await mustAccept(c, "a captain row", member("Cap A", teamA, "is_captain=true"));
    await mustRefuse(c, "a second captain row on the same team", member("Cap A Twin", teamA, "is_captain=true"));

    // number reuse after removal
    const seven = (await c.query(`select id from league_squad_members where team_id=$1 and shirt_number=7`, [teamA])).rows[0].id;
    await c.query(`update league_squad_members set removed_at = now() where id = $1`, [seven]);
    await mustAccept(c, "number 7 reused once its owner is removed", member("New Seven", teamA, "shirt_number=7"));

    // one team per fill-in (season)
    await mustAccept(c, "a fill-in joins team A's list", member("Zed", teamA, `fillin_id=${f1}`));
    await mustRefuse(c, "the same fill-in on team B's list at the same time", member("Zed", teamB, `fillin_id=${f1}`));

    // the cap
    await c.query("SAVEPOINT cap");
    const live = (await c.query(`select count(*)::int as n from league_squad_members where team_id=$1 and removed_at is null`, [teamA])).rows[0].n;
    for (let i = live; i < 30; i++) await c.query(member(`Filler ${i}`));
    await mustRefuse(c, "a 31st live player on one list", member("Thirty One"));
    await c.query("ROLLBACK TO SAVEPOINT cap");

    // ── asks ───────────────────────────────────────────────────────────────
    const ask = (team: number, f: number, kind: string, date: string | null, extra = "") =>
      `insert into league_fillin_requests (team_id, fillin_id, kind, game_date, request_token, expires_at ${extra ? "," + extra.split("=")[0] : ""})
       values (${team}, ${f}, '${kind}', ${date ? `'${date}'` : "null"}, md5(random()::text || clock_timestamp()::text), now() + interval '2 days' ${extra ? "," + extra.split("=")[1] : ""})`;

    await mustRefuse(c, "a night ask with no night", ask(teamA, f2, "game", null));
    await mustRefuse(c, "a season ask carrying a night", ask(teamA, f2, "season", "2026-10-14"));
    await mustRefuse(c, "an ask that expires before it was made",
      `insert into league_fillin_requests (team_id, fillin_id, kind, request_token, expires_at, requested_at)
       values (${teamA}, ${f2}, 'season', md5(random()::text), now() - interval '1 hour', now())`);

    await mustAccept(c, "a season ask", ask(teamA, f2, "season", null));
    await mustRefuse(c, "a second OPEN season ask for the same player (from team B)", ask(teamB, f2, "season", null));
    await c.query(`update league_fillin_requests set state='declined', responded_at=now() where fillin_id=$1 and kind='season'`, [f2]);
    await mustAccept(c, "a season ask once the first was declined", ask(teamB, f2, "season", null));

    await mustAccept(c, "team A asks for Wed 14 Oct", ask(teamA, f1, "game", "2026-10-14"));
    await mustRefuse(c, "team B asks the same player for the SAME night", ask(teamB, f1, "game", "2026-10-14"));
    await mustAccept(c, "team B asks the same player for a DIFFERENT night", ask(teamB, f1, "game", "2026-10-21"));
    await c.query(`update league_fillin_requests set state='accepted', responded_at=now() where fillin_id=$1 and game_date='2026-10-14'`, [f1]);
    await mustRefuse(c, "another team asks for a night the player already ACCEPTED", ask(teamB, f1, "game", "2026-10-14"));
    await c.query(`update league_fillin_requests set state='declined', responded_at=now() where fillin_id=$1 and game_date='2026-10-21'`, [f1]);
    await mustAccept(c, "the declined night asked again by another team", ask(teamA, f1, "game", "2026-10-21"));

    // ── nothing survives ───────────────────────────────────────────────────
    await c.query("ROLLBACK TO SAVEPOINT fixtures");
    const left = await c.query(`select count(*)::int as n from league_competitions where name like 'ZZ apply-league-captains%'`);
    left.rows[0].n === 0 ? ok("fixtures rolled back — nothing survives") : bad("fixture rows SURVIVED the savepoint rollback");

    // ── idempotency ────────────────────────────────────────────────────────
    await mustAccept(c, "re-running the whole migration", sql);
  } catch (e: any) {
    bad(`unexpected: ${e.message}`);
  }

  const clean = problems.length === 0;
  if (COMMIT && clean) {
    await c.query("COMMIT");
    console.log(`\n  ${checks} checks passed — COMMITTED\n`);
  } else {
    await c.query("ROLLBACK");
    console.log(clean
      ? `\n  ${checks} checks passed — rolled back. Re-run with --commit to apply.\n`
      : `\n  ${problems.length} of ${checks} checks FAILED — rolled back, nothing applied:\n${problems.map((p) => `    · ${p}`).join("\n")}\n`);
  }
  await c.end();
  process.exit(clean ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

// The fill-in pool for an MFL term — one row in teampay_competitions.
//
//   npx tsx --env-file=.env script/seed-teampay-mfl.ts                       (show / create, fill-ins OFF)
//   npx tsx --env-file=.env script/seed-teampay-mfl.ts --open-fillins        (players can list, captains can ask)
//   npx tsx --env-file=.env script/seed-teampay-mfl.ts --close-fillins
//   npx tsx --env-file=.env script/seed-teampay-mfl.ts --term term-3         (another term's programme slug)
//
// The captain's dashboard works without this row (squad, payments, fixtures,
// ladder). The row is what gives a term its fill-in marketplace:
// join.minifootball.co.nz/fill-in/mfl-term-4 for players and the "Find a
// fill-in" button for captains. Idempotent on slug.
//
// 🔴 entries_open and payments_enabled stay FALSE forever on an MFL pool.
// Teams enter and pay through the league checkout, never through /enter/…,
// and fee_cents is 0 because Mini Football does not charge fill-ins.
import pg from "pg";

const ORG = 3; // Mini Football Leagues
const term = process.argv.includes("--term")
  ? process.argv[process.argv.indexOf("--term") + 1]
  : "term-4";
const OPEN = process.argv.includes("--open-fillins");
const CLOSE = process.argv.includes("--close-fillins");

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const prog = await c.query(
    `select p.id, p.name, p.league_competition_id, lc.name as competition_name
       from programs p left join league_competitions lc on lc.id = p.league_competition_id
      where p.organization_id = $1 and p.type = 'league_team' and p.slug = $2`, [ORG, term]);
  if (!prog.rowCount) {
    console.error(`\n  No league_team programme with slug '${term}' in org ${ORG}.\n`);
    process.exit(1);
  }
  const p = prog.rows[0];
  if (!p.league_competition_id) {
    console.error(`\n  Programme '${term}' is not bound to a league competition — nothing to pool for.\n`);
    process.exit(1);
  }

  const slug = `mfl-${term}`;
  const existing = await c.query(`select * from teampay_competitions where slug = $1`, [slug]);
  let row = existing.rows[0];
  if (!row) {
    row = (await c.query(
      `insert into teampay_competitions
         (organization_id, kind, program_id, slug, name, brand, fee_cents, default_squad_size,
          entries_open, payments_enabled, fillins_open, blurb)
       values ($1, 'program', $2, $3, $4, 'mfl', 0, 12, false, false, false, $5)
       returning *`,
      [ORG, p.id, slug, p.competition_name || p.name,
       "Put your hand up and captains who are a player short can ask you to join for the term, or just to cover one night. " +
       "Your contact details stay private until you say yes."])).rows[0];
    console.log(`\n  created pool '${slug}' → programme ${p.id} (${p.name}) → competition ${p.league_competition_id}`);
  } else {
    console.log(`\n  pool '${slug}' exists (id ${row.id}) → programme ${row.program_id}`);
  }

  if (OPEN || CLOSE) {
    row = (await c.query(
      `update teampay_competitions set fillins_open = $2, updated_at = now() where id = $1 returning *`,
      [row.id, OPEN])).rows[0];
  }

  const back = (await c.query(`select * from teampay_competitions where id = $1`, [row.id])).rows[0];
  console.log(`  ${back.name}`);
  console.log(`  entries ${back.entries_open ? "OPEN" : "shut"} · payments ${back.payments_enabled ? "ON" : "OFF"} · fill-ins ${back.fillins_open ? "OPEN" : "shut"}`);
  console.log(`  players list at  https://join.minifootball.co.nz/fill-in/${slug}`);
  console.log(`  captains sign in https://join.minifootball.co.nz/captain\n`);
  await c.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

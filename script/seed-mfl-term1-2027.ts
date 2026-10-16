// Go-live for Mini Football Leagues — Term 1 2027 (org 3). Daniel, 16 Oct 2026.
//
// In ONE transaction:
//   1. CLOSE Term 4 2026 team registration (program #23 is_active=false — the
//      only gate getMflRegistrationProgram() checks). Teams, fixtures, weekly
//      Stripe subscriptions and standings are untouched.
//   2. CLOSE Ballers Youth League sign-ups (programs #44–47 registration_open=false
//      — the gate class-book checks). Rolls, registrations and billing untouched.
//   3. CREATE the Term 1 2027 competition + EIGHT nights (Mon–Thu, 5's and 7's)
//      and its league_team program (slug `term-1`), then OPEN it.
//   4. Re-date the org-wide EARLYBIRD 20% to run from now until
//      Sunday 17 Jan 2027 23:59 NZDT (two weeks before kick-off).
//
// Term: Mon 1 Feb → Thu 8 Apr 2027, 10 playing weeks.
// Prices, capacities, badges and usual prices are COPIED from the live Term 4
// divisions at run time, never typed here. Wednesday 5's did not run in Term 4,
// so it copies Tuesday 5's (the same-shaped mid-week 5's night).
//
// Dry run (default):  npx tsx script/seed-mfl-term1-2027.ts
// Apply:              npx tsx script/seed-mfl-term1-2027.ts --apply

import "dotenv/config";
import { Pool } from "pg";

const APPLY = process.argv.includes("--apply");

const ORG_ID = 3;
const TERM4_PROGRAM_ID = 23;
const TERM4_COMP_ID = 6;
const BALLERS_PROGRAM_IDS = [44, 45, 46, 47];
const EARLYBIRD_ID = 6;

const COMP_NAME = "Mini Football Leagues — Term 1 2027";
const SLUG = "term-1";
const START_DATE = "2027-02-01"; // Monday
const END_DATE = "2027-04-08";   // Thursday
// discounts.end_date is a naive timestamp read as UTC on Fly:
// Sun 17 Jan 2027 23:59:59 NZDT (UTC+13) = 2027-01-17 10:59:59 UTC.
const EARLYBIRD_END_UTC = "2027-01-17 10:59:59";

// Night → which Term 4 division it copies from.
const NIGHTS: { name: string; day: string; copyFrom: string }[] = [
  { name: "Monday 5's",    day: "Monday",    copyFrom: "Monday 5's" },
  { name: "Monday 7's",    day: "Monday",    copyFrom: "Monday 7's" },
  { name: "Tuesday 5's",   day: "Tuesday",   copyFrom: "Tuesday 5's" },
  { name: "Tuesday 7's",   day: "Tuesday",   copyFrom: "Tuesday 7's" },
  { name: "Wednesday 5's", day: "Wednesday", copyFrom: "Tuesday 5's" },
  { name: "Wednesday 7's", day: "Wednesday", copyFrom: "Wednesday 7's" },
  { name: "Thursday 5's",  day: "Thursday",  copyFrom: "Thursday 5's" },
  { name: "Thursday 7's",  day: "Thursday",  copyFrom: "Thursday 7's" },
];

const money = (c: number | null) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Safety: everything is where we think it is ───────────────────────────
    const t4 = await client.query(
      `SELECT p.slug, p.organization_id, p.league_competition_id, p.deposit_cents, p.payment_plan,
              p.num_weekly_payments, p.split_enabled, p.hero_headline, p.hero_subheadline, p.upsells_json
         FROM programs p WHERE p.id=$1`, [TERM4_PROGRAM_ID]);
    const src = t4.rows[0];
    if (!src || src.slug !== "term-4" || src.organization_id !== ORG_ID || src.league_competition_id !== TERM4_COMP_ID) {
      throw new Error("Program #23 is not the MFL Term 4 program — aborting");
    }
    const ballers = await client.query(
      `SELECT id, slug FROM programs WHERE id = ANY($1::int[]) AND organization_id=$2 AND slug LIKE 'ballers-u%'`,
      [BALLERS_PROGRAM_IDS, ORG_ID]);
    if (ballers.rowCount !== 4) throw new Error("Ballers programs #44–47 not as expected — aborting");
    const eb = await client.query(`SELECT code, organization_id FROM discounts WHERE id=$1`, [EARLYBIRD_ID]);
    if (eb.rows[0]?.code !== "EARLYBIRD" || eb.rows[0]?.organization_id !== ORG_ID) throw new Error("Discount #6 is not MFL EARLYBIRD — aborting");

    const t4divs = await client.query(
      `SELECT name, max_teams, team_cost_cents, player_cost_cents, list_price_cents, badge_text, gender, age_group
         FROM league_divisions WHERE competition_id=$1`, [TERM4_COMP_ID]);
    const byName = new Map(t4divs.rows.map((r) => [r.name, r]));

    // ── 1) Close Term 4 ──────────────────────────────────────────────────────
    await client.query(`UPDATE programs SET is_active=false WHERE id=$1`, [TERM4_PROGRAM_ID]);
    await client.query(`UPDATE league_competitions SET enable_registration=false, registration_status='closed' WHERE id=$1`, [TERM4_COMP_ID]);
    console.log(`✓ Term 4 2026 registration CLOSED (program #${TERM4_PROGRAM_ID}; teams + billing untouched)`);

    // ── 2) Close Ballers ─────────────────────────────────────────────────────
    await client.query(`UPDATE programs SET registration_open=false WHERE id = ANY($1::int[])`, [BALLERS_PROGRAM_IDS]);
    console.log(`✓ Ballers Youth League sign-ups CLOSED (${ballers.rows.map((r) => r.slug).join(", ")})`);

    // ── 3) Term 1 2027 competition ───────────────────────────────────────────
    const found = await client.query(
      `SELECT id FROM league_competitions WHERE organization_id=$1 AND name=$2 LIMIT 1`, [ORG_ID, COMP_NAME]);
    let compId: number;
    if (found.rowCount) {
      compId = found.rows[0].id;
      await client.query(`UPDATE league_competitions SET start_date=$1, end_date=$2, active=true, archived=false WHERE id=$3`,
        [START_DATE, END_DATE, compId]);
      console.log(`✓ Updated competition #${compId}`);
    } else {
      const ins = await client.query(
        `INSERT INTO league_competitions
           (organization_id, name, sport, start_date, end_date, registration_status,
            youth_league, playoff_competition, enable_registration, is_private, archived,
            active, half_length_minutes, break_minutes)
         SELECT $1,$2,sport,$3,$4,'none',false,false,false,false,false,true,half_length_minutes,break_minutes
           FROM league_competitions WHERE id=$5
         RETURNING id`, [ORG_ID, COMP_NAME, START_DATE, END_DATE, TERM4_COMP_ID]);
      compId = ins.rows[0].id;
      console.log(`✓ Created competition #${compId}`);
    }
    console.log(`  ${START_DATE} → ${END_DATE}`);

    let capacity = 0;
    for (const [i, n] of NIGHTS.entries()) {
      const s = byName.get(n.copyFrom);
      if (!s) throw new Error(`Term 4 division "${n.copyFrom}" missing — aborting`);
      capacity += s.max_teams;
      const vals = [n.day, s.max_teams, s.team_cost_cents, s.player_cost_cents ?? 0, s.list_price_cents, s.badge_text, s.gender, s.age_group, i + 1];
      const ex = await client.query(`SELECT id FROM league_divisions WHERE competition_id=$1 AND name=$2 LIMIT 1`, [compId, n.name]);
      if (ex.rowCount) {
        await client.query(
          `UPDATE league_divisions SET day_of_week=$1, max_teams=$2, team_cost_cents=$3, player_cost_cents=$4,
              list_price_cents=$5, badge_text=$6, gender=$7, age_group=$8, sort_order=$9 WHERE id=$10`,
          [...vals, ex.rows[0].id]);
      } else {
        await client.query(
          `INSERT INTO league_divisions (day_of_week, max_teams, team_cost_cents, player_cost_cents, list_price_cents,
              badge_text, gender, age_group, sort_order, competition_id, name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [...vals, compId, n.name]);
      }
      console.log(`  ✓ ${n.name.padEnd(14)} ${String(s.max_teams).padStart(2)} teams  ${money(s.team_cost_cents).padStart(8)}  usual ${money(s.list_price_cents)}${n.copyFrom !== n.name ? `  (copied from ${n.copyFrom})` : ""}`);
    }
    console.log(`  Total capacity: ${capacity} teams`);

    // ── 3b) The public program ───────────────────────────────────────────────
    const exProg = await client.query(`SELECT id FROM programs WHERE league_competition_id=$1 AND type='league_team' LIMIT 1`, [compId]);
    const progVals = [COMP_NAME, SLUG, src.deposit_cents, src.payment_plan, src.num_weekly_payments,
      src.hero_headline, src.hero_subheadline, src.split_enabled, JSON.stringify(src.upsells_json ?? [])];
    let programId: number;
    if (exProg.rowCount) {
      programId = exProg.rows[0].id;
      await client.query(
        `UPDATE programs SET name=$1, slug=$2, deposit_cents=$3, payment_plan=$4, num_weekly_payments=$5,
            hero_headline=$6, hero_subheadline=$7, split_enabled=$8, upsells_json=$9::jsonb,
            early_bird_deadline=NULL, late_fee_cents=0 WHERE id=$10`, [...progVals, programId]);
    } else {
      const ins = await client.query(
        `INSERT INTO programs (name, slug, deposit_cents, payment_plan, num_weekly_payments, hero_headline,
            hero_subheadline, split_enabled, upsells_json, organization_id, type, league_competition_id, is_active, late_fee_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,'league_team',$11,false,0) RETURNING id`,
        [...progVals, ORG_ID, compId]);
      programId = ins.rows[0].id;
    }
    console.log(`✓ league_team program #${programId} (slug "${SLUG}", deposit ${money(src.deposit_cents)} + ${src.num_weekly_payments} weekly, Player Pay ${src.split_enabled ? "on" : "off"})`);

    // ── 4) Early bird: now → Sun 17 Jan 2027 23:59 NZDT ──────────────────────
    await client.query(
      `UPDATE discounts SET start_date=(now() AT TIME ZONE 'utc'), end_date=$1, status='active', updated_at=now() WHERE id=$2`,
      [EARLYBIRD_END_UTC, EARLYBIRD_ID]);
    console.log(`✓ EARLYBIRD 20% active now → Sun 17 Jan 2027 23:59 NZDT (stored ${EARLYBIRD_END_UTC} UTC)`);

    // ── 5) Open Term 1 (last, page fully built) ──────────────────────────────
    await client.query(`UPDATE programs SET is_active=true WHERE id=$1`, [programId]);
    await client.query(`UPDATE league_competitions SET enable_registration=true, registration_status='open' WHERE id=$1`, [compId]);
    console.log(`✓ Term 1 2027 registration OPEN`);

    if (APPLY) {
      await client.query("COMMIT");
      console.log(`\n🎉 Live: https://join.minifootball.co.nz/league/${SLUG}`);
    } else {
      await client.query("ROLLBACK");
      console.log(`\n🔍 DRY RUN — rolled back. Re-run with --apply to commit.`);
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error("Seed failed:", e.message || e); process.exit(1); });

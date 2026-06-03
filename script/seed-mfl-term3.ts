// Go-live seed for Mini Football Leagues — Term 3 (org 3, competition 3).
//
// Sets the competition dates, creates/updates the public `league_team`
// registration program (deposit + weekly plan), and opens registration.
// Idempotent: re-running updates the same program rather than duplicating.
// Scoped strictly to org 3 / competition 3.
//
// Run:  npx tsx script/seed-mfl-term3.ts
// (writes to the DATABASE_URL in .env — the live Supabase Sydney prod DB)

import "dotenv/config";
import { Pool } from "pg";

const ORG_ID = 3;          // Mini Football Leagues
const COMP_ID = 3;         // "Mini Football Leagues — Term 3"
const SLUG = "term-3";

// Term 3 2026 — earliest night (Mon 20 Jul) → latest finish (Thu 24 Sep).
// The weekly billing anchors to START_DATE (first charge at term start).
const START_DATE = "2026-07-20";
const END_DATE = "2026-09-24";

const PROGRAM = {
  name: "Mini Football Leagues — Term 3",
  slug: SLUG,
  depositCents: 12000,            // $120 deposit; weekly absorbs rounding to exact total
  paymentPlan: "deposit_weekly",
  numWeeklyPayments: 8,
  heroHeadline: "Register your team — Term 3",
  heroSubheadline: "Christchurch's social football league. Grab your mates and play every week.",
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    // Safety: confirm the competition exists and belongs to MFL before writing.
    const comp = await client.query(
      `SELECT id, name, organization_id FROM league_competitions WHERE id = $1`,
      [COMP_ID],
    );
    if (comp.rowCount === 0) throw new Error(`Competition ${COMP_ID} not found`);
    if (comp.rows[0].organization_id !== ORG_ID) {
      throw new Error(`Competition ${COMP_ID} is org ${comp.rows[0].organization_id}, expected ${ORG_ID} — aborting`);
    }
    console.log(`Competition: #${COMP_ID} "${comp.rows[0].name}" (org ${ORG_ID})`);

    // 1) Dates (no enable yet — flip last so the page is fully built before it opens).
    await client.query(
      `UPDATE league_competitions SET start_date = $1, end_date = $2 WHERE id = $3`,
      [START_DATE, END_DATE, COMP_ID],
    );
    console.log(`✓ Dates set: ${START_DATE} → ${END_DATE}`);

    // 2) Upsert the public league_team registration program.
    const existing = await client.query(
      `SELECT id FROM programs WHERE league_competition_id = $1 AND type = 'league_team' LIMIT 1`,
      [COMP_ID],
    );
    let programId: number;
    if (existing.rowCount && existing.rowCount > 0) {
      programId = existing.rows[0].id;
      await client.query(
        `UPDATE programs SET name=$1, slug=$2, is_active=true, deposit_cents=$3,
           payment_plan=$4, num_weekly_payments=$5, early_bird_deadline=NULL,
           late_fee_cents=0, upsells_json='[]'::jsonb, hero_headline=$6, hero_subheadline=$7
         WHERE id=$8`,
        [PROGRAM.name, PROGRAM.slug, PROGRAM.depositCents, PROGRAM.paymentPlan,
          PROGRAM.numWeeklyPayments, PROGRAM.heroHeadline, PROGRAM.heroSubheadline, programId],
      );
      console.log(`✓ Updated existing league_team program #${programId}`);
    } else {
      const ins = await client.query(
        `INSERT INTO programs
           (organization_id, name, slug, type, league_competition_id, is_active,
            deposit_cents, payment_plan, num_weekly_payments, late_fee_cents, upsells_json,
            hero_headline, hero_subheadline)
         VALUES ($1,$2,$3,'league_team',$4,true,$5,$6,$7,0,'[]'::jsonb,$8,$9)
         RETURNING id`,
        [ORG_ID, PROGRAM.name, PROGRAM.slug, COMP_ID, PROGRAM.depositCents,
          PROGRAM.paymentPlan, PROGRAM.numWeeklyPayments, PROGRAM.heroHeadline, PROGRAM.heroSubheadline],
      );
      programId = ins.rows[0].id;
      console.log(`✓ Created league_team program #${programId}`);
    }

    // 3) Open registration (flip last — page is now fully built).
    await client.query(
      `UPDATE league_competitions SET enable_registration = true, registration_status = 'open' WHERE id = $1`,
      [COMP_ID],
    );
    console.log(`✓ Registration OPEN`);

    console.log(`\n🎉 Live: https://join.minifootball.co.nz/league/${SLUG}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error("Seed failed:", e); process.exit(1); });

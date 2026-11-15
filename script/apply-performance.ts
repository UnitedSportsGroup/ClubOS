// Apply migrations/2026-11-10_performance.sql, rehearsing it first.
//
//   npx tsx --env-file=.env script/apply-performance.ts            (dry run, rolled back)
//   npx tsx --env-file=.env script/apply-performance.ts --commit
//
// Each invariant the Performance tab relies on is proven by an insert that
// must be REFUSED, inside a SAVEPOINT so one failure cannot poison the rest.
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const SIU_ORG = 2;

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-11-10_performance.sql"), "utf8");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log(`\n  perf_* tables — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await client.query("BEGIN");
  const problems: string[] = [];
  try {
    await client.query(sql);
    console.log("  migration ran");

    const tables = ["perf_athletes", "perf_sessions", "perf_session_stats", "perf_availability",
      "perf_wellness", "perf_tests", "perf_test_results", "perf_sync_runs"];
    for (const t of tables) {
      const r = await client.query(`select relrowsecurity from pg_class where relname = $1`, [t]);
      if (!r.rowCount) problems.push(`${t} was not created`);
      else if (!r.rows[0].relrowsecurity) problems.push(`${t} has RLS OFF`);
    }

    // Fixtures inside the transaction (rolled back on dry run; deleted on commit).
    const { rows: [u] } = await client.query(`select id from users order by id limit 1`);
    const { rows: cs } = await client.query(
      `select id from contacts order by id limit 2`);
    if (cs.length < 2) throw new Error("need two SIU contacts to rehearse");
    const [c1, c2] = cs.map((r) => r.id);

    await client.query("SAVEPOINT fixtures");
    const { rows: [a1] } = await client.query(
      `insert into perf_athletes (organization_id, source, source_athlete_key, source_name)
       values ($1,'rehearsal','A1','AA') returning id`, [SIU_ORG]);
    const { rows: [a2] } = await client.query(
      `insert into perf_athletes (organization_id, source, source_athlete_key, source_name, contact_id)
       values ($1,'rehearsal','A2','BB',$2) returning id`, [SIU_ORG, c1]);
    const { rows: [s1] } = await client.query(
      `insert into perf_sessions (organization_id, source, external_key, session_date)
       values ($1,'rehearsal','S1','2026-10-20') returning id`, [SIU_ORG]);
    await client.query(`insert into perf_session_stats (session_id, athlete_id, distance_m) values ($1,$2,7600)`, [s1.id, a1.id]);
    await client.query(
      `insert into perf_availability (organization_id, contact_id, status, started_on, recorded_by)
       values ($1,$2,'injured','2026-10-01',$3)`, [SIU_ORG, c2, u.id]);
    await client.query(
      `insert into perf_wellness (organization_id, contact_id, date, sleep, entered_by) values ($1,$2,'2026-10-20',4,$3)`,
      [SIU_ORG, c2, u.id]);

    const refuses = async (label: string, stmt: string, params: any[]) => {
      await client.query("SAVEPOINT probe");
      try {
        await client.query(stmt, params);
        problems.push(`${label} was ACCEPTED — it must be refused`);
      } catch {
        console.log(`  ✓ refused: ${label}`);
      }
      await client.query("ROLLBACK TO SAVEPOINT probe");
    };

    await refuses("the same Catapult session twice",
      `insert into perf_sessions (organization_id, source, external_key, session_date) values ($1,'rehearsal','S1','2026-10-21')`, [SIU_ORG]);
    await refuses("the same athlete twice",
      `insert into perf_athletes (organization_id, source, source_athlete_key) values ($1,'rehearsal','A1')`, [SIU_ORG]);
    await refuses("one person linked to two athletes",
      `update perf_athletes set contact_id = $1 where id = $2`, [c1, a1.id]);
    await refuses("two stat rows for one player in one session",
      `insert into perf_session_stats (session_id, athlete_id) values ($1,$2)`, [s1.id, a1.id]);
    await refuses("an RPE of 11",
      `insert into perf_session_stats (session_id, athlete_id, rpe) values ($1,$2,11)`, [s1.id, a2.id]);
    await refuses("an unknown session kind",
      `update perf_sessions set kind = 'friendly' where id = $1`, [s1.id]);
    await refuses("a second open injury overlapping the first",
      `insert into perf_availability (organization_id, contact_id, status, started_on, recorded_by)
       values ($1,$2,'ill','2026-10-10',$3)`, [SIU_ORG, c2, u.id]);
    await refuses("an injury that ends before it starts",
      `insert into perf_availability (organization_id, contact_id, status, started_on, ended_on, recorded_by)
       values ($1,$2,'injured','2026-05-10','2026-05-01',$3)`, [SIU_ORG, c1, u.id]);
    await refuses("two wellness check-ins for one player on one day",
      `insert into perf_wellness (organization_id, contact_id, date, entered_by) values ($1,$2,'2026-10-20',$3)`,
      [SIU_ORG, c2, u.id]);
    await refuses("a wellness score of 6",
      `insert into perf_wellness (organization_id, contact_id, date, mood, entered_by) values ($1,$2,'2026-10-21',6,$3)`,
      [SIU_ORG, c2, u.id]);
    await refuses("deleting an athlete who has stats",
      `delete from perf_athletes where id = $1`, [a1.id]);

    // A NULL metric stays NULL — no default slipped in.
    const { rows: [blank] } = await client.query(
      `select top_speed_kmh from perf_session_stats where session_id = $1`, [s1.id]);
    if (blank.top_speed_kmh !== null) problems.push("an unrecorded metric did not stay NULL");
    else console.log("  ✓ an unrecorded metric stays NULL");

    await client.query("ROLLBACK TO SAVEPOINT fixtures"); // fixtures never persist
  } catch (e: any) {
    problems.push(e?.message ?? String(e));
  }

  if (problems.length || !COMMIT) {
    await client.query("ROLLBACK");
    if (problems.length) { console.error("\n  ✗ PROBLEMS:\n   - " + problems.join("\n   - ")); process.exitCode = 1; }
    else console.log("\n  ✓ all checks passed — dry run rolled back. Re-run with --commit.");
  } else {
    await client.query("COMMIT");
    console.log("\n  ✓ committed.");
  }
  await client.end();
}
main();

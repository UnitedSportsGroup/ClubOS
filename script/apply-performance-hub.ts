// Apply migrations/2026-11-14_performance_hub.sql, rehearsing it first.
//
//   npx tsx --env-file=.env script/apply-performance-hub.ts            (dry run, rolled back)
//   npx tsx --env-file=.env script/apply-performance-hub.ts --commit
//
// Every invariant the Performance hub relies on is proven by a write the
// database must REFUSE, each inside its own SAVEPOINT so one failure cannot
// poison the rest. A constraint nobody has seen reject anything is a comment.
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const SIU_ORG = 2;

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-11-14_performance_hub.sql"), "utf8");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log(`\n  performance hub — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await client.query("BEGIN");
  const problems: string[] = [];
  try {
    // The tables this drops must be empty — never drop data.
    const { rows: [n] } = await client.query(
      `select coalesce((select count(*) from perf_session_stats), 0)::int as stats`).catch(() => ({ rows: [{ stats: 0 }] }));
    if (n.stats > 0) throw new Error(`perf_session_stats holds ${n.stats} rows — refusing to drop it`);

    await client.query(sql);
    console.log("  migration ran");

    for (const t of ["perf_metric_values", "perf_imports", "perf_rpe", "perf_media", "perf_athlete_accounts",
      "perf_athlete_sessions", "perf_athlete_tokens", "perf_athlete_auth_events", "perf_wellness", "perf_availability"]) {
      const r = await client.query(`select relrowsecurity from pg_class where relname = $1 and relkind = 'r'`, [t]);
      if (!r.rowCount) problems.push(`${t} does not exist`);
      else if (!r.rows[0].relrowsecurity) problems.push(`${t} has RLS OFF`);
    }

    await client.query("SAVEPOINT fixtures");
    const { rows: [u] } = await client.query(`select id from users order by id limit 1`);
    const { rows: cs } = await client.query(`select id from contacts order by id limit 2`);
    const [c1, c2] = cs.map((r) => r.id);
    const { rows: [imp] } = await client.query(
      `insert into perf_imports (organization_id, source, sha256, bytes, uploaded_by)
       values ($1,'rehearsal','abc', 'x'::bytea, $2) returning id`, [SIU_ORG, u.id]);
    await client.query(
      `insert into perf_metric_values (organization_id, contact_id, observed_on, metric_key, value, source, external_key, import_id)
       values ($1,$2,'2026-11-01','total_distance_m',7600,'rehearsal','S1:c1',$3)`, [SIU_ORG, c1, imp.id]);
    await client.query(
      `insert into perf_rpe (organization_id, contact_id, date, kind, rpe, minutes, entered_by_athlete)
       values ($1,$2,'2026-11-01','training',6,75,true)`, [SIU_ORG, c1]);
    const { rows: [acct] } = await client.query(
      `insert into perf_athlete_accounts (organization_id, contact_id, email, invited_by)
       values ($1,$2,'Rehearsal.Player@example.test',$3) returning id`, [SIU_ORG, c1, u.id]);

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

    await refuses("the same reading imported twice (a retry must update, not add)",
      `insert into perf_metric_values (organization_id, contact_id, observed_on, metric_key, value, source, external_key)
       values ($1,$2,'2026-11-01','total_distance_m',7700,'rehearsal','S1:c1')`, [SIU_ORG, c1]);
    await refuses("a reading with no value (blank is no row, never NULL)",
      `insert into perf_metric_values (organization_id, contact_id, observed_on, metric_key, value, source, external_key)
       values ($1,$2,'2026-11-01','top_speed_kmh',NULL,'rehearsal','S1:c1')`, [SIU_ORG, c1]);
    await refuses("a reading that belongs to nobody",
      `insert into perf_metric_values (organization_id, observed_on, metric_key, value, source, external_key)
       values ($1,'2026-11-01','top_speed_kmh',31,'rehearsal','S1:x')`, [SIU_ORG]);
    await refuses("a metric key that is not a clean slug",
      `insert into perf_metric_values (organization_id, contact_id, observed_on, metric_key, value, source, external_key)
       values ($1,$2,'2026-11-01','Top Speed',31,'rehearsal','S1:c1b')`, [SIU_ORG, c1]);
    await refuses("the same file uploaded twice",
      `insert into perf_imports (organization_id, source, sha256, bytes, uploaded_by) values ($1,'rehearsal','abc','y'::bytea,$2)`, [SIU_ORG, u.id]);
    await refuses("an RPE of 11",
      `insert into perf_rpe (organization_id, contact_id, date, kind, rpe, entered_by_athlete) values ($1,$2,'2026-11-02','training',11,true)`, [SIU_ORG, c1]);
    await refuses("two RPE answers for one player, one day, one kind",
      `insert into perf_rpe (organization_id, contact_id, date, kind, rpe, entered_by_athlete) values ($1,$2,'2026-11-01','training',4,true)`, [SIU_ORG, c1]);
    await refuses("an RPE row that says nobody entered it",
      `insert into perf_rpe (organization_id, contact_id, date, kind, rpe) values ($1,$2,'2026-11-03','training',5)`, [SIU_ORG, c2]);
    await refuses("a wellness row that says nobody entered it",
      `insert into perf_wellness (organization_id, contact_id, date, sleep) values ($1,$2,'2026-11-03',4)`, [SIU_ORG, c2]);
    await refuses("16+ hours of sleep",
      `insert into perf_wellness (organization_id, contact_id, date, sleep_hours, entered_by_athlete) values ($1,$2,'2026-11-04',17,true)`, [SIU_ORG, c2]);
    await refuses("a video link that is not https",
      `insert into perf_media (organization_id, title, url, source, created_by) values ($1,'x','http://a.b','other',$2)`, [SIU_ORG, u.id]);
    await refuses("a second player account on the same email (any case)",
      `insert into perf_athlete_accounts (organization_id, contact_id, email, invited_by) values ($1,$2,'rehearsal.player@EXAMPLE.test',$3)`, [SIU_ORG, c2, u.id]);
    await refuses("deleting a person who has readings",
      `delete from contacts where id = $1`, [c1]);
    await refuses("a file bigger than 5 MB",
      `insert into perf_imports (organization_id, source, sha256, bytes, uploaded_by) values ($1,'rehearsal','big', decode(repeat('00', 5*1024*1024+1),'hex'),$2)`, [SIU_ORG, u.id]);

    // Deleting the import keeps the readings (the file is evidence, not the owner).
    await client.query(`delete from perf_imports where id = $1`, [imp.id]);
    const { rows: [kept] } = await client.query(
      `select count(*)::int n from perf_metric_values where external_key = 'S1:c1'`);
    if (kept.n !== 1) problems.push("deleting an import removed its readings");
    else console.log("  ✓ removing an import keeps its readings");
    void acct;

    await client.query("ROLLBACK TO SAVEPOINT fixtures");
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

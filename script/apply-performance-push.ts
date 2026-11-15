// Apply migrations/2026-11-14_performance_push.sql (rehearse by default).
//   npx tsx --env-file=.env script/apply-performance-push.ts [--commit]
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";
const COMMIT = process.argv.includes("--commit");
(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect(); await c.query("BEGIN");
  const problems: string[] = [];
  try {
    await c.query(readFileSync(join(process.cwd(), "migrations", "2026-11-14_performance_push.sql"), "utf8"));
    for (const t of ["perf_athlete_push_tokens", "perf_reminder_runs"]) {
      const r = await c.query(`select relrowsecurity from pg_class where relname = $1`, [t]);
      if (!r.rows[0]?.relrowsecurity) problems.push(`${t} RLS off or missing`);
    }
    const { rows: [a] } = await c.query(`select id from perf_athlete_accounts limit 1`);
    if (a) {
      await c.query("SAVEPOINT p");
      try { await c.query(`insert into perf_athlete_push_tokens (account_id, token) values ($1,'not-a-token')`, [a.id]); problems.push("a non-Expo token was ACCEPTED"); }
      catch { console.log("  ✓ refuses a token that isn't an Expo push token"); }
      await c.query("ROLLBACK TO SAVEPOINT p");
      await c.query(`insert into perf_reminder_runs (run_date) values ('2000-01-01')`);
      const dup = await c.query(`insert into perf_reminder_runs (run_date) values ('2000-01-01') on conflict do nothing returning run_date`);
      if (dup.rowCount) problems.push("a second reminder run for one day was claimed"); else console.log("  ✓ one reminder run per day");
      await c.query(`delete from perf_reminder_runs where run_date = '2000-01-01'`);
    }
    if (problems.length) throw new Error(problems.join("; "));
    await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(`  ${COMMIT ? "committed" : "rehearsal clean — rolled back"}`);
  } catch (e: any) { await c.query("ROLLBACK").catch(() => {}); console.error("  ✗", e.message); process.exitCode = 1; }
  finally { await c.end(); }
})();

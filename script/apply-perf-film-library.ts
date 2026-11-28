// Apply migrations/2026-11-28_perf_film_library.sql (rehearse by default).
//   npx tsx --env-file=.env script/apply-perf-film-library.ts [--commit]
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";
const COMMIT = process.argv.includes("--commit");
(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect(); await c.query("BEGIN");
  const problems: string[] = [];
  try {
    await c.query(readFileSync(join(process.cwd(), "migrations", "2026-11-28_perf_film_library.sql"), "utf8"));
    const r = await c.query(`select relrowsecurity from pg_class where relname = 'perf_film_libraries'`);
    if (!r.rows[0]?.relrowsecurity) problems.push("perf_film_libraries RLS off"); else console.log("  ✓ perf_film_libraries exists, RLS on");
    const { rows: [n] } = await c.query(`select count(*)::int n, count(*) filter (where in_library)::int lib from perf_films where archived_at is null`);
    console.log(`  ✓ ${n.lib} of ${n.n} live films are in the library`);
    const { rows: [o] } = await c.query(`select id from organizations where slug = 'south-island-united'`);
    await c.query("SAVEPOINT p");
    try { await c.query(`insert into perf_film_libraries (organization_id, token) values ($1, 'short')`, [o.id]); problems.push("a short token was ACCEPTED"); }
    catch { console.log("  ✓ refuses a token that is too short"); }
    await c.query("ROLLBACK TO SAVEPOINT p");
    await c.query(`insert into perf_film_libraries (organization_id, token) values ($1, 'probe-token-aaaaaaaaaaaa')`, [o.id]);
    await c.query("SAVEPOINT q");
    try { await c.query(`insert into perf_film_libraries (organization_id, token) values ($1, 'probe-token-bbbbbbbbbbbb')`, [o.id]); problems.push("a second library for one club was ACCEPTED"); }
    catch { console.log("  ✓ one library per club"); }
    await c.query("ROLLBACK TO SAVEPOINT q");
    await c.query(`delete from perf_film_libraries where token = 'probe-token-aaaaaaaaaaaa'`);
    if (problems.length) throw new Error(problems.join("; "));
    await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(`  ${COMMIT ? "committed" : "rehearsal clean — rolled back"}`);
  } catch (e: any) { await c.query("ROLLBACK").catch(() => {}); console.error("  ✗", e.message); process.exitCode = 1; }
  finally { await c.end(); }
})();

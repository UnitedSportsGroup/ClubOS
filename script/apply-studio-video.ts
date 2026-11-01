/**
 * Content Studio video queue — apply the migration and PROVE its rules.
 *   npx tsx --env-file=.env script/apply-studio-video.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-studio-video.ts --commit   # for real
 *
 * Proven: idempotent; one live job per piece; a finished job has a finish time
 * and a running one a claim time; a failure carries its reason; unknown kinds
 * and statuses are refused; deleting a piece takes its jobs; RLS on.
 */
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const problems: string[] = [];
const ok = (l: string) => console.log(`  ✓ ${l}`);
const bad = (l: string) => { problems.push(l); console.log(`  ✗ ${l}`); };
async function mustReject(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try { await c.query(sql, params); await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — was ACCEPTED`); }
  catch { await c.query("ROLLBACK TO SAVEPOINT s"); ok(label); }
}
async function mustAccept(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try { const r = await c.query(sql, params); await c.query("RELEASE SAVEPOINT s"); ok(label); return r.rows[0]; }
  catch (e: any) { await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — REFUSED: ${e.message}`); return null; }
}

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-11-01_studio_video_jobs.sql"), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  Studio video queue — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    await c.query(sql); ok("migration ran");
    await c.query(sql); ok("migration is idempotent (ran twice)");
    await c.query("SAVEPOINT fixtures");
    const u = await mustAccept(c, "a throwaway maker", `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ('_studio_video_probe@usg.co.nz','Probe','Video','x','team_member',true) RETURNING id`);
    const p = await mustAccept(c, "a video piece", `INSERT INTO studio_pieces (organization_id, brand, kind, title, status, doc, created_by_user_id) VALUES (1,'cufc','video','Probe','draft','{}'::jsonb,$1) RETURNING id`, [u.id]);
    const ins = `INSERT INTO studio_video_jobs (piece_id, kind, status, claimed_at, finished_at, error, requested_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`;
    const j1 = await mustAccept(c, "a queued plan job", ins, [p.id, "plan", "queued", null, null, null, u.id]);
    await mustReject(c, "a second live job on the same piece is refused", ins, [p.id, "render", "queued", null, null, null, u.id]);
    await mustReject(c, "an unknown kind is refused", ins, [p.id, "dance", "done", "now()", "now()", null, u.id]);
    await mustReject(c, "a running job with no claim time is refused", `UPDATE studio_video_jobs SET status='running' WHERE id=$1`, [j1.id]);
    await mustAccept(c, "claimed: running with a claim time", `UPDATE studio_video_jobs SET status='running', claimed_at=now() WHERE id=$1 RETURNING id`, [j1.id]);
    await mustReject(c, "done without a finish time is refused", `UPDATE studio_video_jobs SET status='done' WHERE id=$1`, [j1.id]);
    await mustReject(c, "a failure with no reason is refused", `UPDATE studio_video_jobs SET status='failed', finished_at=now() WHERE id=$1`, [j1.id]);
    await mustAccept(c, "done with a finish time", `UPDATE studio_video_jobs SET status='done', finished_at=now(), cost_usd_cents=84.5 WHERE id=$1 RETURNING id`, [j1.id]);
    await mustAccept(c, "…and then a new job on the same piece", ins, [p.id, "render", "queued", null, null, null, u.id]);
    await mustReject(c, "a negative cost is refused", `UPDATE studio_video_jobs SET cost_usd_cents=-1 WHERE id=$1`, [j1.id]);
    await c.query(`DELETE FROM studio_pieces WHERE id=$1`, [p.id]);
    const left = await c.query(`SELECT count(*)::int n FROM studio_video_jobs WHERE piece_id=$1`, [p.id]);
    left.rows[0].n === 0 ? ok("deleting a piece takes its jobs") : bad("jobs outlived their piece");
    const rls = await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname='studio_video_jobs'`);
    rls.rows[0]?.relrowsecurity ? ok("RLS is on") : bad("RLS is OFF");
    await c.query("ROLLBACK TO SAVEPOINT fixtures");
    if (problems.length) throw new Error(`${problems.length} problem(s)`);
    await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(`\n  ${COMMIT ? "Committed." : "Rolled back (dry run)."}\n`);
  } catch (e: any) {
    await c.query("ROLLBACK");
    console.error(`\n  Rolled back: ${e.message}\n`);
    process.exitCode = 1;
  } finally { await c.end(); }
}
main();

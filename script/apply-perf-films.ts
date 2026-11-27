// Apply migrations/2026-11-27_perf_films.sql (rehearse by default).
//   npx tsx --env-file=.env script/apply-perf-films.ts [--commit]
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";
const COMMIT = process.argv.includes("--commit");
(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect(); await c.query("BEGIN");
  const problems: string[] = [];
  const refused = async (label: string, sql: string, params: unknown[] = []) => {
    await c.query("SAVEPOINT p");
    try { await c.query(sql, params); problems.push(`ACCEPTED: ${label}`); } catch { console.log(`  ✓ refuses ${label}`); }
    await c.query("ROLLBACK TO SAVEPOINT p");
  };
  try {
    await c.query(readFileSync(join(process.cwd(), "migrations", "2026-11-27_perf_films.sql"), "utf8"));
    for (const t of ["perf_films", "perf_film_files", "perf_film_notes"]) {
      const r = await c.query(`select relrowsecurity from pg_class where relname = $1`, [t]);
      if (!r.rows[0]?.relrowsecurity) problems.push(`${t} RLS off or missing`); else console.log(`  ✓ ${t} exists, RLS on`);
    }
    const { rows: [o] } = await c.query(`select id from organizations where slug = 'south-island-united'`);
    if (!o) throw new Error("SIU organisation not found");
    const U = "https://abc123.private.blob.vercel-storage.com/x.mp4";
    const { rows: [f] } = await c.query(`insert into perf_films (organization_id, title) values ($1, 'probe') returning id`, [o.id]);
    await refused("a film with a blank title", `insert into perf_films (organization_id, title) values ($1, '  ')`, [o.id]);
    await refused("sharing switched on with no token", `update perf_films set share_enabled = true where id = $1`, [f.id]);
    await refused("a file outside the private store", `insert into perf_film_files (film_id, role, label, blob_url, download_name, bytes) values ($1,'watch','x','https://example.com/x.mp4','x.mp4',10)`, [f.id]);
    await refused("a file with an unknown role", `insert into perf_film_files (film_id, role, label, blob_url, download_name, bytes) values ($1,'other','x',$2,'x.mp4',10)`, [f.id, U]);
    await refused("a file of zero bytes", `insert into perf_film_files (film_id, role, label, blob_url, download_name, bytes) values ($1,'watch','x',$2,'x.mp4',0)`, [f.id, U]);
    await c.query(`insert into perf_film_files (film_id, role, label, blob_url, download_name, bytes) values ($1,'watch','x',$2,'x.mp4',10)`, [f.id, U]);
    await refused("a second live watching copy of one clip", `insert into perf_film_files (film_id, role, label, blob_url, download_name, bytes) values ($1,'watch','y',$2,'y.mp4',10)`, [f.id, U]);
    await refused("a note before the start of the film", `insert into perf_film_notes (film_id, at_seconds, body) values ($1,-1,'x')`, [f.id]);
    await refused("an empty note", `insert into perf_film_notes (film_id, at_seconds, body) values ($1,5,' ')`, [f.id]);
    await refused("deleting a film that holds files", `delete from perf_films where id = $1`, [f.id]);
    await c.query(`delete from perf_film_files where film_id = $1`, [f.id]);
    await c.query(`delete from perf_films where id = $1`, [f.id]);
    if (problems.length) throw new Error(problems.join("; "));
    await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(`  ${COMMIT ? "committed" : "rehearsal clean — rolled back"}`);
  } catch (e: any) { await c.query("ROLLBACK").catch(() => {}); console.error("  ✗", e.message); process.exitCode = 1; }
  finally { await c.end(); }
})();

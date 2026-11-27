/**
 * Put a film that was uploaded from this Mac (script/upload-siu-film.ts) onto
 * SIU Performance → Video, and optionally switch its share link on.
 *
 *   npx tsx --env-file=.env script/seed-siu-film.ts <spec.json> [--share] [--commit]
 *
 * spec.json: { "title", "filmDate": "YYYY-MM-DD", "kind", "note", "createdByEmail",
 *              "files": [{ "clip", "role", "label", "url", "name", "bytes", "seconds", "width", "height", "posterUrl" }] }
 *
 * Safe to run again: the film is found by title + date, and a clip that already
 * has a live file in that role is left alone. Rehearses unless --commit.
 */
import { readFileSync } from "fs";
import { randomBytes } from "crypto";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const SHARE = process.argv.includes("--share");
const specPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!specPath) { console.error("usage: seed-siu-film.ts <spec.json> [--share] [--commit]"); process.exit(1); }
const spec = JSON.parse(readFileSync(specPath, "utf8"));

(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect(); await c.query("BEGIN");
  try {
    const { rows: [org] } = await c.query(`select id from organizations where slug = 'south-island-united'`);
    if (!org) throw new Error("SIU organisation not found");
    const { rows: [user] } = await c.query(`select id from users where lower(email) = lower($1)`, [spec.createdByEmail]);
    if (!user) throw new Error(`No ClubOS user ${spec.createdByEmail}`);
    let { rows: [film] } = await c.query(`select * from perf_films where organization_id = $1 and title = $2 and film_date = $3 and archived_at is null`, [org.id, spec.title, spec.filmDate]);
    if (!film) {
      ({ rows: [film] } = await c.query(`insert into perf_films (organization_id, title, film_date, kind, note, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
        [org.id, spec.title, spec.filmDate, spec.kind || "training", spec.note || null, user.id]));
      console.log(`  + film #${film.id} "${film.title}"`);
    } else console.log(`  = film #${film.id} already there`);
    for (const f of spec.files) {
      const { rows: [have] } = await c.query(`select id from perf_film_files where film_id = $1 and clip = $2 and role = $3 and archived_at is null`, [film.id, f.clip, f.role]);
      if (have) { console.log(`  = clip ${f.clip} ${f.role} already there`); continue; }
      await c.query(`insert into perf_film_files (film_id, clip, role, label, blob_url, download_name, content_type, bytes, seconds, width, height, poster_url, created_by)
                     values ($1,$2,$3,$4,$5,$6,'video/mp4',$7,$8,$9,$10,$11,$12)`,
        [film.id, f.clip, f.role, f.label, f.url, f.name, f.bytes, f.seconds ?? null, f.width ?? null, f.height ?? null, f.posterUrl ?? null, user.id]);
      console.log(`  + clip ${f.clip} ${f.role}: ${f.label} (${(f.bytes / 1e6).toFixed(0)} MB)`);
    }
    if (SHARE) {
      if (!film.share_token) {
        ({ rows: [film] } = await c.query(`update perf_films set share_token = $1, share_enabled = true, share_created_by = $2, share_created_at = now() where id = $3 returning *`,
          [randomBytes(16).toString("base64url"), user.id, film.id]));
      } else if (!film.share_enabled) ({ rows: [film] } = await c.query(`update perf_films set share_enabled = true where id = $1 returning *`, [film.id]));
      console.log(`  share link: https://join.southislandunited.com/film/${film.share_token}`);
    }
    await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(`  ${COMMIT ? "committed" : "rehearsal — rolled back"}`);
  } catch (e: any) { await c.query("ROLLBACK").catch(() => {}); console.error("  ✗", e.message); process.exitCode = 1; }
  finally { await c.end(); }
})();

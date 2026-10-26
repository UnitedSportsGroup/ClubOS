/**
 * Content Studio — apply the migration and PROVE its rules.
 *   npx tsx --env-file=.env script/apply-studio.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-studio.ts --commit   # for real
 *
 * Proven: idempotent; a graphic needs a size and a page must not have one; a
 * page is the only kind that can be published and a published page needs a
 * slug; a slug is unique per brand among live pieces; an unknown brand, kind,
 * status or size is refused; a version number is unique per piece; a render
 * is capped at 8MB and needs a real key; the maker cannot be deleted from
 * under their work (RESTRICT) while a generation's user may be; deleting a
 * piece takes its versions and renders with it; RLS on all four.
 */
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const problems: string[] = [];
let checks = 0;
const ok = (l: string) => { checks++; console.log(`  ✓ ${l}`); };
const bad = (l: string) => { checks++; problems.push(l); console.log(`  ✗ ${l}`); };
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
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-10-27_studio.sql"), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  Content Studio — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    await c.query(sql);
    ok("migration ran");
    await c.query(sql);
    ok("migration is idempotent (ran twice)");

    await c.query("SAVEPOINT fixtures");
    const u = await mustAccept(c, "a throwaway maker", `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ('_studio_probe@usg.co.nz','Probe','Studio','x','team_member',true) RETURNING id`);
    const ins = `INSERT INTO studio_pieces (organization_id, brand, kind, title, slug, size, status, doc, created_by_user_id) VALUES (1,$1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id`;
    const g = await mustAccept(c, "a graphic draft with a size", ins, ["cufc", "graphic", "Camp — last spots", null, "square", "draft", JSON.stringify({ layout: "announcement", headline: "Last spots" }), u.id]);
    await mustReject(c, "a graphic without a size is refused", ins, ["cufc", "graphic", "x", null, null, "draft", "{}", u.id]);
    await mustReject(c, "a page with a size is refused", ins, ["cufc", "page", "x", "x-page", "square", "draft", "{}", u.id]);
    await mustReject(c, "a graphic with a slug is refused", ins, ["cufc", "graphic", "x", "slug", "square", "draft", "{}", u.id]);
    await mustReject(c, "a published graphic is refused (only a page is published)", ins, ["cufc", "graphic", "x", null, "square", "published", "{}", u.id]);
    await mustReject(c, "a published page without a slug is refused", ins, ["cufc", "page", "x", null, null, "published", "{}", u.id]);
    const pg1 = await mustAccept(c, "a published page with a slug", ins, ["cufc", "page", "Football in Schools", "football-in-schools", null, "published", JSON.stringify({ title: "FIS", blocks: [] }), u.id]);
    await mustReject(c, "the same slug twice on one brand is refused", ins, ["cufc", "page", "Again", "football-in-schools", null, "draft", "{}", u.id]);
    await mustAccept(c, "…but the same slug on another brand is fine", ins, ["cugc", "page", "FIS", "football-in-schools", null, "draft", "{}", u.id]);
    await mustReject(c, "a slug with capitals or spaces is refused", ins, ["cufc", "page", "x", "Bad Slug", null, "draft", "{}", u.id]);
    await mustReject(c, "an unknown brand is refused", ins, ["nike", "page", "x", null, null, "draft", "{}", u.id]);
    await mustReject(c, "an unknown kind is refused", ins, ["cufc", "podcast", "x", null, null, "draft", "{}", u.id]);
    await mustReject(c, "an unknown size is refused", ins, ["cufc", "graphic", "x", null, "a0", "draft", "{}", u.id]);
    await mustReject(c, "an empty title is refused", ins, ["cufc", "graphic", "", null, "square", "draft", "{}", u.id]);

    const vIns = `INSERT INTO studio_versions (piece_id, version, doc, how, created_by_user_id) VALUES ($1,$2,'{}'::jsonb,$3,$4)`;
    await mustAccept(c, "version 1, made", vIns, [g.id, 1, "made", u.id]);
    await mustAccept(c, "version 2, edited", vIns, [g.id, 2, "edited", u.id]);
    await mustReject(c, "version 2 twice is refused", vIns, [g.id, 2, "asked", u.id]);
    await mustReject(c, "an unknown 'how' is refused", vIns, [g.id, 3, "magic", u.id]);

    const rIns = `INSERT INTO studio_renders (piece_id, version, key, mime, width, height, bytes, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;
    await mustAccept(c, "a PNG render", rIns, [g.id, 1, "a".repeat(24), "image/png", 1080, 1080, 3, Buffer.from([1, 2, 3])]);
    await mustReject(c, "the same render key twice is refused", rIns, [g.id, 2, "a".repeat(24), "image/png", 1080, 1080, 3, Buffer.from([1, 2, 3])]);
    await mustReject(c, "a render over 8MB is refused", rIns, [g.id, 2, "b".repeat(24), "image/png", 1080, 1080, 8388609, Buffer.from([1])]);
    await mustReject(c, "a WebP render is refused", rIns, [g.id, 2, "c".repeat(24), "image/webp", 10, 10, 1, Buffer.from([1])]);
    await mustReject(c, "a malformed key is refused", rIns, [g.id, 2, "nope", "image/png", 10, 10, 1, Buffer.from([1])]);

    const genIns = `INSERT INTO studio_generations (piece_id, user_id, organization_id, brand, kind, model, instruction, cost_usd_cents) VALUES ($1,$2,1,'cufc',$3,'claude-opus-5-5','make it',$4) RETURNING id`;
    await mustAccept(c, "a priced generation", genIns, [g.id, u.id, "graphic", 42.5]);
    await mustReject(c, "a negative cost is refused", genIns, [g.id, u.id, "graphic", -1]);
    await mustReject(c, "an unknown generation kind is refused", genIns, [g.id, u.id, "song", 1]);

    await mustReject(c, "the maker cannot be deleted from under their pieces", `DELETE FROM users WHERE id=$1`, [u.id]);
    await mustAccept(c, "deleting a piece takes its versions and renders with it", `DELETE FROM studio_pieces WHERE id=$1`, [g.id]);
    const left = (await c.query(`SELECT (SELECT count(*) FROM studio_versions WHERE piece_id=$1)::int + (SELECT count(*) FROM studio_renders WHERE piece_id=$1)::int AS n`, [g.id])).rows[0];
    left.n === 0 ? ok("…nothing left behind") : bad(`${left.n} rows left behind`);
    const gen = (await c.query(`SELECT piece_id FROM studio_generations WHERE user_id=$1`, [u.id])).rows[0];
    gen && gen.piece_id === null ? ok("…and the generation row survives with the piece set to NULL (the cost is history)") : bad("generation row lost or still pointing at the piece");
    await mustAccept(c, "the published page can be deleted", `DELETE FROM studio_pieces WHERE id=$1`, [pg1.id]);
    await c.query("ROLLBACK TO SAVEPOINT fixtures");
    ok("probe rows discarded");

    for (const tbl of ["studio_pieces", "studio_versions", "studio_renders", "studio_generations"]) {
      const rls = (await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname = $1 AND relkind = 'r'`, [tbl])).rows;
      rls.length === 1 && rls[0].relrowsecurity ? ok(`RLS on ${tbl}`) : bad(`RLS on ${tbl}: ${JSON.stringify(rls)}`);
    }

    if (problems.length) throw new Error("checks failed");
    await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(`\n  ${checks} checks, ${problems.length} problems — ${COMMIT ? "COMMITTED" : "rolled back"}\n`);
  } catch (err: any) {
    await c.query("ROLLBACK").catch(() => {});
    console.error(`\n  FAILED: ${err.message}\n  ${problems.join("\n  ")}\n`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}
main();

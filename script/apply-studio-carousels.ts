/**
 * Content Studio carousels + custom sizes — apply and PROVE.
 *   npx tsx --env-file=.env script/apply-studio-carousels.ts            # dry run
 *   npx tsx --env-file=.env script/apply-studio-carousels.ts --commit
 */
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";
const COMMIT = process.argv.includes("--commit");
const problems: string[] = [];
const ok = (l: string) => console.log(`  ✓ ${l}`);
const bad = (l: string) => { problems.push(l); console.log(`  ✗ ${l}`); };
async function must(c: pg.Client, accept: boolean, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try { const r = await c.query(sql, params); await c.query("RELEASE SAVEPOINT s"); accept ? ok(label) : bad(`${label} — was ACCEPTED`); return r.rows[0]; }
  catch (e: any) { await c.query("ROLLBACK TO SAVEPOINT s"); accept ? bad(`${label} — REFUSED: ${e.message}`) : ok(label); return null; }
}
async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-11-01_studio_carousels_sizes.sql"), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  Studio carousels + sizes — ${COMMIT ? "COMMIT" : "DRY RUN"}\n`);
  await c.query("BEGIN");
  try {
    await c.query(sql); ok("migration ran"); await c.query(sql); ok("idempotent");
    const before = (await c.query(`SELECT count(*)::int n FROM studio_pieces`)).rows[0].n;
    await c.query("SAVEPOINT fx");
    const ins = `INSERT INTO studio_pieces (organization_id, brand, kind, title, size, status, doc, created_by_user_id) VALUES (1,'cufc',$1,'probe',$2,'draft','{}'::jsonb,1) RETURNING id`;
    const car = await must(c, true, "a carousel with a size", ins, ["carousel", "portrait"]);
    await must(c, false, "a carousel without a size is refused", ins, ["carousel", null]);
    await must(c, true, "a billboard size 1440x480", ins, ["graphic", "1440x480"]);
    await must(c, false, "a nonsense size is refused", ins, ["graphic", "huge"]);
    await must(c, false, "a size over 9999 is refused", ins, ["graphic", "12000x400"]);
    await must(c, false, "a page with a size is still refused", ins, ["page", "square"]);
    await must(c, true, "slide 3 render", `INSERT INTO studio_renders (piece_id, version, key, mime, width, height, bytes, data, slide) VALUES ($1,1,$2,'image/png',10,10,1,$3,3)`, [car.id, "d".repeat(24), Buffer.from([1])]);
    await must(c, false, "slide 25 is refused", `INSERT INTO studio_renders (piece_id, version, key, mime, width, height, bytes, data, slide) VALUES ($1,1,$2,'image/png',10,10,1,$3,25)`, [car.id, "e".repeat(24), Buffer.from([1])]);
    await c.query("ROLLBACK TO SAVEPOINT fx");
    const after = (await c.query(`SELECT count(*)::int n FROM studio_pieces`)).rows[0].n;
    after === before ? ok(`every existing piece still valid (${after})`) : bad("piece count changed");
    if (problems.length) throw new Error(`${problems.length} problem(s)`);
    await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(`\n  ${COMMIT ? "Committed." : "Rolled back (dry run)."}\n`);
  } catch (e: any) { await c.query("ROLLBACK"); console.error(`\n  Rolled back: ${e.message}\n`); process.exitCode = 1; }
  finally { await c.end(); }
}
main();

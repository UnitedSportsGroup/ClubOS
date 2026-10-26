/**
 * Pictures in the Mailer — apply the migration and PROVE its rules.
 *   npx tsx --env-file=.env script/apply-mailer-images.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-mailer-images.ts --commit   # for real
 *
 * Proven: idempotent; a shrunk PNG can be stored and read back byte for byte;
 * the same key twice is refused (content-addressed = one row); a width over
 * 1200px, a height over 1800px, more than 2MB, zero bytes, a WebP mime and a
 * malformed key are each refused by the database; deleting the uploader keeps
 * the picture (SET NULL); the organisation cannot be deleted from under it
 * (RESTRICT); RLS on.
 */
import { createHash } from "node:crypto";
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

// A 1×1 transparent PNG — real bytes, so the round trip is byte for byte.
const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-10-26_mailer_images.sql"), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  Mailer pictures — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    await c.query(sql);
    ok("migration ran");
    await c.query(sql);
    ok("migration is idempotent (ran twice)");

    const org = (await c.query(`SELECT id FROM organizations WHERE slug='christchurch-united'`)).rows[0];
    await c.query("SAVEPOINT fixtures");
    const u = await mustAccept(c, "a throwaway user", `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ('_mailer_img_probe@usg.co.nz','Probe','Img','x','team_member',true) RETURNING id`);
    const key = createHash("sha256").update(PNG_1x1).digest("hex").slice(0, 24);
    const ins = `INSERT INTO mailer_images (organization_id, uploaded_by, key, mime, width, height, bytes, data, original_name, original_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`;
    const row = await mustAccept(c, "a shrunk PNG can be stored", ins, [org.id, u.id, key, "image/png", 1, 1, PNG_1x1.length, PNG_1x1, "probe.png", 4096]);
    const back = (await c.query(`SELECT data, mime, bytes FROM mailer_images WHERE id=$1`, [row.id])).rows[0];
    Buffer.compare(back.data, PNG_1x1) === 0 && back.mime === "image/png" ? ok("…and reads back byte for byte") : bad("read-back differs");
    await mustReject(c, "the same key twice is refused (one row per picture)", ins, [org.id, u.id, key, "image/png", 1, 1, PNG_1x1.length, PNG_1x1, "again.png", 1]);
    const k2 = "b".repeat(24);
    await mustReject(c, "wider than 1200px is refused", ins, [org.id, u.id, k2, "image/jpeg", 1201, 10, 10, PNG_1x1, null, null]);
    await mustReject(c, "taller than 1800px is refused", ins, [org.id, u.id, k2, "image/jpeg", 10, 1801, 10, PNG_1x1, null, null]);
    await mustReject(c, "more than 2MB is refused", ins, [org.id, u.id, k2, "image/jpeg", 10, 10, 2097153, PNG_1x1, null, null]);
    await mustReject(c, "zero bytes is refused", ins, [org.id, u.id, k2, "image/jpeg", 10, 10, 0, PNG_1x1, null, null]);
    await mustReject(c, "a WebP mime is refused (Outlook can't show it)", ins, [org.id, u.id, k2, "image/webp", 10, 10, 10, PNG_1x1, null, null]);
    await mustReject(c, "a malformed key is refused", ins, [org.id, u.id, "not-a-key", "image/png", 10, 10, 10, PNG_1x1, null, null]);
    await mustReject(c, "a workspace with pictures cannot be deleted out from under them", `DELETE FROM organizations WHERE id=$1`, [org.id]);
    await mustAccept(c, "deleting the uploader keeps the picture (uploaded_by → NULL)", `DELETE FROM users WHERE id=$1`, [u.id]);
    const kept = (await c.query(`SELECT count(*)::int AS n FROM mailer_images WHERE key=$1 AND uploaded_by IS NULL`, [key])).rows[0];
    kept.n === 1 ? ok("…the picture survived") : bad(`kept rows: ${kept.n}`);
    await c.query("ROLLBACK TO SAVEPOINT fixtures");
    ok("probe rows discarded");

    const rls = (await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'mailer_images' AND relkind = 'r'`)).rows;
    rls.length === 1 && rls[0].relrowsecurity ? ok("RLS on mailer_images") : bad(`RLS: ${JSON.stringify(rls)}`);

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

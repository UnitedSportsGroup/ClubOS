// Apply migrations/2026-09-21_housing_inspections.sql, rehearsing it first.
//
//   npx tsx --env-file=.env script/apply-housing-inspections.ts            (dry run)
//   npx tsx --env-file=.env script/apply-housing-inspections.ts --commit
//
// 🔴 What must be REFUSED: a photo with no house · a photo dated in the future.
// 🔴 What must be ACCEPTED: a photo of the HOUSE with no room (the kitchen, the
//    roof, the driveway) — forcing a room would file it under an arbitrary one.
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const problems: string[] = [];
let checks = 0;
const ok = (l: string) => { checks++; console.log(`  ✓ ${l}`); };
const bad = (l: string) => { checks++; problems.push(l); console.log(`  ✗ ${l}`); };

async function mustRefuse(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try { await c.query(sql, params); await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — was ALLOWED`); }
  catch { await c.query("ROLLBACK TO SAVEPOINT s"); ok(`refused: ${label}`); }
}
async function mustAccept(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try { await c.query(sql, params); await c.query("ROLLBACK TO SAVEPOINT s"); ok(`accepted: ${label}`); }
  catch (e: any) { await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — REFUSED: ${e.message}`); }
}

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-09-21_housing_inspections.sql"), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log(`\n  Accommodation inspections — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    await c.query(sql);
    console.log("  migration ran\n");

    const t = await c.query(`select 1 from information_schema.tables where table_name='housing_inspection_media'`);
    t.rowCount ? ok("housing_inspection_media exists") : bad("table missing");
    const rls = await c.query(`select relrowsecurity from pg_class where relname='housing_inspection_media'`);
    rls.rows[0]?.relrowsecurity ? ok("RLS on") : bad("RLS OFF");

    const { rows: h } = await c.query(`select id, organization_id from housing_houses limit 1`);
    const { rows: r } = await c.query(`select id from housing_rooms limit 1`);
    if (!h.length) { bad("no house to test against"); }
    else {
      const M = `insert into housing_inspection_media (organization_id, house_id, room_id, taken_on, storage_key)
                 values ($1,$2,$3,$4,'k')`;
      const today = new Date().toISOString().slice(0, 10);
      await mustAccept(c, "a photo of a ROOM", M, [h[0].organization_id, h[0].id, r[0]?.id ?? null, today]);
      await mustAccept(c, "a photo of the HOUSE with no room (the kitchen, the roof)", M,
        [h[0].organization_id, h[0].id, null, today]);
      await mustRefuse(c, "a photo dated in the future", M,
        [h[0].organization_id, h[0].id, null, "2099-01-01"]);
      await mustRefuse(c, "a photo belonging to no house", M,
        [h[0].organization_id, null, null, today]);
    }

    // The occupancy history itself needs nothing new — prove the constraint it
    // relies on is already there.
    const ex = await c.query(`select conname from pg_constraint
      where conrelid='housing_tenancies'::regclass and contype='x'`);
    ex.rowCount
      ? ok(`one-room-one-tenant already enforced (${ex.rows[0].conname}) — history needs no new table`)
      : bad("housing_tenancies has NO exclusion constraint — the derived history would be unreliable");

    await c.query(sql);
    ok("re-running the migration is a no-op");

    if (problems.length) { console.log(`\n  ${problems.length} problem(s) — rolling back.\n`); await c.query("ROLLBACK"); process.exit(1); }
    if (COMMIT) { await c.query("COMMIT"); console.log(`\n  ${checks} checks passed. COMMITTED.\n`); }
    else { await c.query("ROLLBACK"); console.log(`\n  ${checks} checks passed. Rolled back — re-run with --commit.\n`); }
  } catch (e: any) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("\n  FAILED:", e.message, "\n");
    process.exit(1);
  } finally { await c.end(); }
}
main();

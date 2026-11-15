// Apply the warehouse transfers migration (2026-11-04). ADDITIVE ONLY.
//   Rehearse:  npx tsx --env-file=.env script/apply-warehouse-transfers.ts --dry-run
//   Apply:     npx tsx --env-file=.env script/apply-warehouse-transfers.ts
// --dry-run runs the migration + every check inside a transaction it ROLLS BACK.
import { Pool } from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const DRY_RUN = process.argv.includes("--dry-run");
const here = dirname(fileURLToPath(import.meta.url));
const ddl = readFileSync(join(here, "..", "migrations", "2026-11-04_warehouse_transfers.sql"), "utf8");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const db = await pool.connect();
let failures = 0;
const check = (ok: boolean, label: string) => { if (!ok) failures++; console.log(`${ok ? "  ok " : " FAIL"}  ${label}`); };

async function refused(sqlText: string, params: unknown[], label: string) {
  await db.query("SAVEPOINT t");
  try { await db.query(sqlText, params); check(false, `${label} (was accepted)`); }
  catch { check(true, label); }
  await db.query("ROLLBACK TO SAVEPOINT t");
}

try {
  console.log(DRY_RUN ? "\nDRY RUN — everything below is rolled back.\n" : "\nAPPLYING to the database.\n");
  await db.query("BEGIN");
  const before = (await db.query(`SELECT (SELECT count(*) FROM wh_items) i, (SELECT count(*) FROM wh_movements) m`)).rows[0];
  await db.query(ddl);

  const rls = await db.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('wh_transfers','wh_transfer_lines')`);
  check(rls.rows.length === 2 && rls.rows.every((r) => r.relrowsecurity), "RLS on both tables");

  const u = (await db.query(`SELECT id FROM users ORDER BY id LIMIT 1`)).rows[0].id;
  const locs = (await db.query(`SELECT id FROM wh_locations WHERE kind <> 'virtual' ORDER BY id LIMIT 2`)).rows.map((r) => r.id);
  const item = (await db.query(`SELECT id FROM wh_items ORDER BY id LIMIT 1`)).rows[0].id;

  await refused(`INSERT INTO wh_transfers (origin_location_id, destination_location_id, created_by_user_id) VALUES ($1,$1,$2)`, [locs[0], u], "refuses a transfer to the same place");
  await refused(`INSERT INTO wh_transfers (origin_location_id, destination_location_id, created_by_user_id, status) VALUES ($1,$2,$3,'transferred')`, [locs[0], locs[1], u], "refuses 'transferred' with no stamp");
  await refused(`INSERT INTO wh_transfers (origin_location_id, destination_location_id, created_by_user_id, status) VALUES ($1,$2,$3,'lost')`, [locs[0], locs[1], u], "refuses an unknown status");

  await db.query("SAVEPOINT ok");
  const t = (await db.query(`INSERT INTO wh_transfers (origin_location_id, destination_location_id, created_by_user_id) VALUES ($1,$2,$3) RETURNING id`, [locs[0], locs[1], u])).rows[0].id;
  check(!!t, "a draft transfer inserts");
  await refused(`INSERT INTO wh_transfer_lines (transfer_id, item_id, qty) VALUES ($1,$2,0)`, [t, item], "refuses a zero-quantity line");
  await db.query(`INSERT INTO wh_transfer_lines (transfer_id, item_id, qty) VALUES ($1,$2,3)`, [t, item]);
  await refused(`INSERT INTO wh_transfer_lines (transfer_id, item_id, qty) VALUES ($1,$2,1)`, [t, item], "refuses the same item twice on one transfer");
  await db.query("ROLLBACK TO SAVEPOINT ok");

  const after = (await db.query(`SELECT (SELECT count(*) FROM wh_items) i, (SELECT count(*) FROM wh_movements) m`)).rows[0];
  check(before.i === after.i && before.m === after.m, "existing items and movements untouched");

  if (failures || DRY_RUN) { await db.query("ROLLBACK"); console.log(failures ? `\n${failures} FAILED — rolled back.` : "\nDry run passed — rolled back."); }
  else { await db.query("COMMIT"); console.log("\nApplied."); }
} catch (e) {
  await db.query("ROLLBACK").catch(() => {});
  console.error(e);
  failures++;
} finally {
  db.release();
  await pool.end();
  process.exit(failures ? 1 : 0);
}

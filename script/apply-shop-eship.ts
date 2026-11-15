// Apply migrations/2026-11-04_shop_eship.sql. Default is a REHEARSAL inside a
// transaction that is rolled back; --commit applies it.
//   npx tsx --env-file=.env script/apply-shop-eship.ts [--commit]
// 🔴 Apply BEFORE deploying the eShip code: drizzle selects every schema
//    column, so code that knows eship_order_id 500s every shop read on a
//    database that does not have it yet.
import pg from "pg";
import { readFileSync } from "fs";
const commit = process.argv.includes("--commit");
const sqlText = readFileSync(new URL("../migrations/2026-11-04_shop_eship.sql", import.meta.url), "utf8");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
let ok = 0, bad = 0;
const check = (name: string, pass: boolean) => { console.log(`${pass ? "✓" : "✗"} ${name}`); pass ? ok++ : bad++; };
try {
  await c.query("BEGIN");
  await c.query(sqlText);
  const cols = (await c.query(`SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name='shop_orders' AND (column_name LIKE 'eship_%' OR column_name LIKE 'tracking_%' OR column_name='shipped_email_sent_at')`)).rows;
  check("10 new columns", cols.length === 10);
  check("all nullable, no defaults", cols.every((r) => r.is_nullable === "YES" && r.column_default == null));
  const before = (await c.query(`SELECT count(*)::int n FROM shop_orders`)).rows[0].n;
  check(`existing ${before} orders untouched (all eship_order_id NULL)`, (await c.query(`SELECT count(*)::int n FROM shop_orders WHERE eship_order_id IS NOT NULL`)).rows[0].n === 0);
  // Uniqueness: one eShip order per shop order.
  const two = (await c.query(`SELECT id FROM shop_orders ORDER BY id LIMIT 2`)).rows;
  if (two.length === 2) {
    await c.query("SAVEPOINT u");
    await c.query(`UPDATE shop_orders SET eship_order_id = 999999999 WHERE id = $1`, [two[0].id]);
    let refused = false;
    try { await c.query(`UPDATE shop_orders SET eship_order_id = 999999999 WHERE id = $1`, [two[1].id]); } catch { refused = true; }
    await c.query("ROLLBACK TO SAVEPOINT u");
    check("same eShip order on two shop orders is refused", refused);
  }
  if (bad) throw new Error(`${bad} check(s) failed`);
  await c.query(commit ? "COMMIT" : "ROLLBACK");
  console.log(commit ? `APPLIED (${ok} checks)` : `REHEARSAL OK, rolled back (${ok} checks) — re-run with --commit`);
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error("FAILED, rolled back:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await c.end();
}

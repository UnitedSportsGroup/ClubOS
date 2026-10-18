// Apply migrations/2026-10-19_shop_orders_pos_sale.sql (till sales → Store orders).
// Dry run by default: everything runs in one transaction and rolls back.
//   npx tsx --env-file=.env script/apply-shop-orders-pos-sale.ts [--commit]
import { Pool } from "pg";
import { readFileSync } from "fs";

const commit = process.argv.includes("--commit");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const c = await pool.connect();
let ok = true;
const check = (label: string, pass: boolean) => { console.log(`${pass ? "ok  " : "FAIL"} ${label}`); if (!pass) ok = false; };
try {
  await c.query("BEGIN");
  await c.query(readFileSync(new URL("../migrations/2026-10-19_shop_orders_pos_sale.sql", import.meta.url), "utf8"));
  const col = await c.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='shop_orders' AND column_name='pos_sale_id'`);
  check("shop_orders.pos_sale_id exists and is nullable", col.rows[0]?.is_nullable === "YES");
  const fk = await c.query(`SELECT confdeltype FROM pg_constraint WHERE conrelid='shop_orders'::regclass AND contype='f' AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='shop_orders'::regclass AND attname='pos_sale_id')]::int2[]`);
  check("FK to pos_sales is ON DELETE RESTRICT", fk.rows[0]?.confdeltype === "r");
  const untouched = await c.query(`SELECT count(*)::int n FROM shop_orders WHERE pos_sale_id IS NOT NULL`);
  check("no existing order gained a till sale", untouched.rows[0].n === 0);

  // The unique index refuses a second Store order for the same till sale + brand.
  const sale = await c.query(`SELECT id FROM pos_sales ORDER BY id LIMIT 1`);
  if (sale.rows[0]) {
    await c.query("SAVEPOINT dup");
    const ins = `INSERT INTO shop_orders (organization_id, first_name, last_name, email, phone, source, pos_sale_id) VALUES (1,'t','t','','', 'pos', $1)`;
    await c.query(ins, [sale.rows[0].id]);
    let refused = false;
    try { await c.query(ins, [sale.rows[0].id]); } catch (e: any) { refused = e.code === "23505"; }
    check("a second Store order for one till sale is refused", refused);
    await c.query("ROLLBACK TO SAVEPOINT dup");
  }
  if (ok && commit) { await c.query("COMMIT"); console.log("\nCOMMITTED."); }
  else { await c.query("ROLLBACK"); console.log(ok ? "\nROLLED BACK (dry run)." : "\nROLLED BACK — checks failed."); }
} catch (e) { await c.query("ROLLBACK"); throw e; }
finally { c.release(); await pool.end(); }
process.exit(ok ? 0 : 1);

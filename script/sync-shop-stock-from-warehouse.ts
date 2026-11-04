// One-off (and safe to re-run): set every warehouse-driven shop's
// shop_variants.stock from the warehouse, using the SAME push the server runs
// after each movement (server/warehouse-sync.ts pushItemNow). Only brands in
// WH_STOCK_BRANDS are touched.
//   WH_STOCK_BRANDS=cufc npx tsx --env-file=.env script/sync-shop-stock-from-warehouse.ts
import { Pool } from "pg";
import { pushItemNow } from "../server/warehouse-sync";
import { warehouseDrivenBrands } from "../server/shop-warehouse-link";

const brands = Array.from(warehouseDrivenBrands());
if (!brands.length) throw new Error("Set WH_STOCK_BRANDS (e.g. cufc)");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const items = (await pool.query(`SELECT id FROM wh_items WHERE shop_variant_id IS NOT NULL AND brand_owner = ANY($1::text[])`, [brands])).rows;
let pushed = 0;
for (const { id } of items) {
  const r = await pushItemNow(Number(id));
  if (r.nativePushed) pushed++;
}
const check = (await pool.query(`
  SELECT count(*) FILTER (WHERE v.stock <> greatest(0, round(coalesce((SELECT sum(s.on_hand) FROM wh_stock s JOIN wh_locations l ON l.id=s.location_id WHERE s.item_id=w.id AND l.kind<>'virtual' AND upper(l.code)<>'QUARANTINE'),0)
     - coalesce((SELECT sum(qty) FROM wh_reservations r WHERE r.item_id=w.id AND r.status='active'),0)))) AS mismatched, count(*) AS total, sum(v.stock) AS units
  FROM wh_items w JOIN shop_variants v ON v.id = w.shop_variant_id WHERE w.brand_owner = ANY($1::text[])`, [brands])).rows[0];
console.log(`${brands.join(", ")}: pushed ${pushed}/${items.length} · shop now shows ${check.units} units · ${check.mismatched} of ${check.total} differ from the warehouse`);
await pool.end();
process.exit(Number(check.mismatched) === 0 ? 0 : 1);

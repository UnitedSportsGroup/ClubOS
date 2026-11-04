// Apply migrations/2026-11-04_shop_product_fields.sql. ADDITIVE ONLY.
//   --dry-run rolls the whole thing back after checking it.
import { Pool } from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const DRY_RUN = process.argv.includes("--dry-run");
const here = dirname(fileURLToPath(import.meta.url));
const ddl = readFileSync(join(here, "..", "migrations", "2026-11-04_shop_product_fields.sql"), "utf8");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const db = await pool.connect();
let failures = 0;
const check = (ok: boolean, l: string) => { if (!ok) failures++; console.log(`${ok ? "  ok " : " FAIL"}  ${l}`); };
async function refused(q: string, p: unknown[], l: string) {
  await db.query("SAVEPOINT t");
  try { await db.query(q, p); check(false, `${l} (accepted)`); } catch { check(true, l); }
  await db.query("ROLLBACK TO SAVEPOINT t");
}
try {
  console.log(DRY_RUN ? "\nDRY RUN — rolled back after.\n" : "\nAPPLYING.\n");
  await db.query("BEGIN");
  const before = (await db.query(`SELECT count(*) v, sum(stock) s FROM shop_variants`)).rows[0];
  await db.query(ddl);
  const after = (await db.query(`SELECT count(*) v, sum(stock) s,
     count(*) FILTER (WHERE track_inventory AND NOT continue_selling AND charge_tax AND physical) defaults FROM shop_variants`)).rows[0];
  check(before.v === after.v && before.s === after.s, "no variant or stock figure changed");
  check(after.defaults === after.v, "every existing variant keeps today's behaviour (tracked, refuse at 0, taxed, physical)");
  const v = (await db.query(`SELECT id FROM shop_variants LIMIT 1`)).rows[0].id;
  await refused(`UPDATE shop_variants SET hs_code = '12ab' WHERE id = $1`, [v], "refuses a bad HS code");
  await refused(`UPDATE shop_variants SET country_of_origin = 'nz' WHERE id = $1`, [v], "refuses a lowercase country code");
  await refused(`UPDATE shop_variants SET cost_cents = -1 WHERE id = $1`, [v], "refuses a negative cost");
  const rls = (await db.query(`SELECT count(*) n FROM pg_class WHERE relname IN ('shop_collections','shop_product_collections') AND relrowsecurity`)).rows[0].n;
  check(Number(rls) === 2, "RLS on both new tables");
  if (failures || DRY_RUN) { await db.query("ROLLBACK"); console.log(failures ? `\n${failures} FAILED — rolled back` : "\nDry run passed — rolled back"); }
  else { await db.query("COMMIT"); console.log("\nApplied."); }
} catch (e) { await db.query("ROLLBACK").catch(() => {}); console.error(e); failures++; }
finally { db.release(); await pool.end(); process.exit(failures ? 1 : 0); }

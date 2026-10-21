// Apply migrations/2026-10-22_kit_sizes.sql (additive, nullable). Dry-run default.
//   npx tsx --env-file=.env script/apply-kit-sizes.ts [--commit]
import "dotenv/config";
import pg from "pg";
import { readFileSync } from "fs";

const COMMIT = process.argv.includes("--commit");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await c.connect();
  await c.query("BEGIN");
  await c.query(readFileSync("migrations/2026-10-22_kit_sizes.sql", "utf8"));
  const r = await c.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_name IN ('contacts','children')
      AND column_name IN ('shirt_size','shorts_size','boot_size','kit_sizes_updated_at')
    ORDER BY 1, 2`);
  console.log(`${r.rows.length}/8 columns present`, r.rows.map(x => `${x.table_name}.${x.column_name}`).join(" "));
  if (r.rows.length !== 8) throw new Error("columns missing");
  await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
  console.log(COMMIT ? "COMMITTED" : "dry run — rolled back");
  await c.end();
}
main().catch(async e => { console.error(e.message); await c.query("ROLLBACK").catch(() => {}); process.exit(1); });

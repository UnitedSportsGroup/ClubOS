import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const supa = new Pool({ connectionString: process.env.DATABASE_URL });
  const prod = new Pool({ connectionString: process.env.PROD_DATABASE_URL, ssl: { rejectUnauthorized: false } });

  console.log("=== facilities columns ===");
  const cols = await supa.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='facilities'
    ORDER BY ordinal_position
  `);
  console.table(cols.rows);

  console.log("\n=== facilities rows (Supabase) ===");
  const supaRows = await supa.query(`SELECT * FROM facilities ORDER BY id`);
  for (const r of supaRows.rows) {
    console.log(`\n  facility id=${r.id} name="${r.name}":`);
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (v === null || v === undefined || v === "") continue;
      const s = typeof v === "string" ? (v.length > 200 ? v.slice(0, 200) + "..." : v) : JSON.stringify(v);
      console.log(`    ${k}: ${s}`);
    }
  }

  console.log("\n=== facilities rows (PROD Replit Neon) ===");
  const prodRows = await prod.query(`SELECT * FROM facilities ORDER BY id`);
  for (const r of prodRows.rows) {
    console.log(`\n  facility id=${r.id} name="${r.name}":`);
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (v === null || v === undefined || v === "") continue;
      const s = typeof v === "string" ? (v.length > 200 ? v.slice(0, 200) + "..." : v) : JSON.stringify(v);
      console.log(`    ${k}: ${s}`);
    }
  }

  await supa.end();
  await prod.end();
}

main().catch(e => { console.error(e); process.exit(1); });

import "dotenv/config";
import { Pool } from "pg";

const PROD_URL = process.env.PROD_DATABASE_URL;
const SUPA_URL = process.env.DATABASE_URL;

if (!PROD_URL || !SUPA_URL) {
  console.error("Missing PROD_DATABASE_URL or DATABASE_URL");
  process.exit(1);
}

async function main() {
  const prod = new Pool({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false } });
  const supa = new Pool({ connectionString: SUPA_URL, ssl: { rejectUnauthorized: false } });

  const tablesQ = `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const prodTables = (await prod.query(tablesQ)).rows.map((r) => r.tablename);
  const supaTables = new Set((await supa.query(tablesQ)).rows.map((r) => r.tablename));

  console.log(`Prod tables: ${prodTables.length}, Supabase tables: ${supaTables.size}`);
  console.log("");
  console.log("Table".padEnd(34) + "  Prod".padEnd(12) + "  Supa".padEnd(12) + "Gap");
  console.log("-".repeat(70));

  let totalGap = 0;
  const gaps: { table: string; prod: number; supa: number; gap: number }[] = [];

  for (const t of prodTables) {
    if (!supaTables.has(t)) {
      console.log(`  ${t.padEnd(32)}  (missing in supa)`);
      continue;
    }
    const prodN = (await prod.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n;
    const supaN = (await supa.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n;
    const gap = prodN - supaN;
    const flag = gap === 0 ? "✓" : (gap > 0 ? "✗" : "+");
    console.log(`${flag} ${t.padEnd(32)}  ${String(prodN).padStart(8)}  ${String(supaN).padStart(8)}  ${gap > 0 ? "-" + gap : (gap < 0 ? "+" + Math.abs(gap) : "")}`);
    if (gap !== 0) gaps.push({ table: t, prod: prodN, supa: supaN, gap });
    totalGap += Math.max(0, gap);
  }

  console.log("");
  console.log(`Total rows missing from Supabase: ${totalGap}`);
  console.log(`Tables with gaps: ${gaps.length}`);

  await prod.end();
  await supa.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const colRes = await pool.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text', 'character varying', 'character', 'jsonb', 'json')
    ORDER BY table_name, column_name
  `);

  console.log(`Scanning ${colRes.rows.length} text-like columns…`);

  // Try several known patterns
  const patterns = ["%/objects/%", "%storage.googleapis%", "%clubbase.replit%", "%uploads/%", "%logos/%", "%/files/%"];

  const hits: { table: string; col: string; pattern: string; sample: string; count: number }[] = [];

  for (const { table_name: t, column_name: c } of colRes.rows) {
    for (const pat of patterns) {
      try {
        const r = await pool.query(
          `SELECT "${c}"::text AS v, COUNT(*)::int AS n FROM "${t}" WHERE "${c}"::text LIKE $1 GROUP BY "${c}"::text LIMIT 1`,
          [pat]
        );
        if (r.rows.length > 0 && r.rows[0].v) {
          const cntRes = await pool.query(
            `SELECT COUNT(*)::int AS n FROM "${t}" WHERE "${c}"::text LIKE $1`,
            [pat]
          );
          hits.push({
            table: t,
            col: c,
            pattern: pat,
            sample: String(r.rows[0].v).slice(0, 200),
            count: cntRes.rows[0].n,
          });
        }
      } catch {}
    }
  }

  if (hits.length === 0) {
    console.log("No file references found in any column with any pattern.");
  } else {
    console.log(`Found ${hits.length} hits:`);
    for (const h of hits) {
      console.log(`\n  ${h.table}.${h.col}  (${h.count} rows match ${h.pattern})`);
      console.log(`    sample: ${h.sample}`);
    }
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

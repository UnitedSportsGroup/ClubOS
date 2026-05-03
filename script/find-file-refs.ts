import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Include ARRAY and USER-DEFINED so we don't miss text[] columns like
  // facilities.image_urls.
  const colRes = await pool.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text', 'character varying', 'character', 'jsonb', 'json', 'ARRAY', 'USER-DEFINED')
    ORDER BY table_name, column_name
  `);

  console.log(`Scanning ${colRes.rows.length} columns (incl. ARRAY/JSON)…`);

  const patterns = [
    "%/objects/%",
    "%storage.googleapis%",
    "%clubbase.replit%",
    "%uploads/%",
    "%/logos/%",
    "%/files/%",
    "%/images/%",
    "%hero%",
    "%.webp%",
    "%.avif%",
    "%.jpg%",
    "%.png%",
  ];

  type Hit = { table: string; col: string; type: string; pattern: string; sample: string; count: number };
  const hits: Hit[] = [];
  const seen = new Set<string>();

  for (const { table_name: t, column_name: c, data_type: dt } of colRes.rows) {
    if (t === "object_acls") continue;
    for (const pat of patterns) {
      try {
        const cntRes = await pool.query(
          `SELECT COUNT(*)::int AS n FROM "${t}" WHERE "${c}"::text LIKE $1`,
          [pat]
        );
        const n = cntRes.rows[0].n;
        if (n === 0) continue;

        const sampleRes = await pool.query(
          `SELECT "${c}"::text AS v FROM "${t}" WHERE "${c}"::text LIKE $1 LIMIT 1`,
          [pat]
        );
        const sample = sampleRes.rows[0]?.v ? String(sampleRes.rows[0].v).slice(0, 250) : "";
        const key = `${t}.${c}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ table: t, col: c, type: dt, pattern: pat, sample, count: n });
      } catch {}
    }
  }

  if (hits.length === 0) {
    console.log("No file references found.");
  } else {
    console.log(`\nFound ${hits.length} columns with media references:`);
    for (const h of hits) {
      console.log(`\n  ${h.table}.${h.col} [${h.type}] (${h.count} rows, first match on ${h.pattern})`);
      console.log(`    sample: ${h.sample}`);
    }
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

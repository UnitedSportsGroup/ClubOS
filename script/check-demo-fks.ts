import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const demoContactIds = [1, 2, 3];
  const demoProgramIds = [1, 2];

  console.log("=== What references demo contacts (Ram/Sarah/Mike, ids 1-3)? ===");
  const tables = await pool.query(`
    SELECT
      tc.table_name AS child_table,
      kcu.column_name AS fk_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_name = 'contacts'
    ORDER BY tc.table_name
  `);

  for (const r of tables.rows) {
    const cnt = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "${r.child_table}" WHERE "${r.fk_column}" = ANY($1)`,
      [demoContactIds]
    );
    console.log(`  ${r.child_table}.${r.fk_column} — ${cnt.rows[0].n} rows linked`);
    if (cnt.rows[0].n > 0 && cnt.rows[0].n <= 5) {
      const sample = await pool.query(
        `SELECT * FROM "${r.child_table}" WHERE "${r.fk_column}" = ANY($1) LIMIT 5`,
        [demoContactIds]
      );
      for (const row of sample.rows) console.log(`    → ${JSON.stringify(row).slice(0, 200)}`);
    }
  }

  console.log("\n=== What references demo programs (FUNdamentals/World Cup, ids 1-2)? ===");
  const programTables = await pool.query(`
    SELECT
      tc.table_name AS child_table,
      kcu.column_name AS fk_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_name = 'programs'
    ORDER BY tc.table_name
  `);

  for (const r of programTables.rows) {
    const cnt = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "${r.child_table}" WHERE "${r.fk_column}" = ANY($1)`,
      [demoProgramIds]
    );
    console.log(`  ${r.child_table}.${r.fk_column} — ${cnt.rows[0].n} rows linked`);
    if (cnt.rows[0].n > 0 && cnt.rows[0].n <= 5) {
      const sample = await pool.query(
        `SELECT * FROM "${r.child_table}" WHERE "${r.fk_column}" = ANY($1) LIMIT 5`,
        [demoProgramIds]
      );
      for (const row of sample.rows) console.log(`    → ${JSON.stringify(row).slice(0, 200)}`);
    }
  }

  console.log("\n=== ON DELETE behavior of those FKs ===");
  const cascadeRes = await pool.query(`
    SELECT
      tc.table_name AS child_table,
      kcu.column_name AS fk_column,
      ccu.table_name AS parent_table,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_name IN ('contacts', 'programs')
    ORDER BY parent_table, child_table
  `);
  console.table(cascadeRes.rows);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

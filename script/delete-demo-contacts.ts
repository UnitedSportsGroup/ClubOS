import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const r = await pool.query(`
    DELETE FROM contacts
    WHERE id IN (1, 2, 3)
      AND email IN ('rambo367@gmail.com', 'kezarchdesign@gmail.com', 'mikechen@outlook.com')
    RETURNING id, first_name, last_name, email
  `);

  console.log(`Deleted ${r.rowCount ?? 0} demo contacts:`);
  for (const row of r.rows) {
    console.log(`  - id=${row.id} ${row.first_name} ${row.last_name} <${row.email}>`);
  }

  const remaining = await pool.query(`SELECT COUNT(*)::int AS n FROM contacts`);
  console.log(`\nRemaining contacts: ${remaining.rows[0].n}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

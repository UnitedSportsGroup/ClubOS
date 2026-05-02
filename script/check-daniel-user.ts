import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    "SELECT id, email, role, active, length(password) AS pwd_len FROM users WHERE LOWER(email) LIKE '%daniel%' OR LOWER(email) LIKE '%cufc%' ORDER BY id"
  );
  console.log(rows);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

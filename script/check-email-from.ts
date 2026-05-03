import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log("=== camp_settings (what ClubOS sends FROM) ===");
  const cs = await pool.query(`SELECT camp_id, from_email, reply_to FROM camp_settings ORDER BY camp_id`);
  console.table(cs.rows);

  console.log("\n=== Distinct from-emails actually used in past sent emails ===");
  // email_logs doesn't have from_email column; check what was attempted
  const logs = await pool.query(`
    SELECT
      camp_id,
      COUNT(*)::int AS sent_count,
      MAX(created_at) AS last_sent
    FROM email_logs
    GROUP BY camp_id
    ORDER BY camp_id
  `);
  console.table(logs.rows);

  console.log("\n=== Recent email subjects (sample) ===");
  const recent = await pool.query(`
    SELECT id, camp_id, to_email, subject, provider_message_id, created_at
    FROM email_logs
    ORDER BY id DESC
    LIMIT 10
  `);
  console.table(recent.rows);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

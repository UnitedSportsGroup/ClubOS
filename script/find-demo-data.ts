import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log("=== Demo contacts (Ram Neupane / Sarah Patterson / Mike Chen) ===");
  const demoContacts = await pool.query(`
    SELECT id, type, first_name, last_name, email, phone, created_at
    FROM contacts
    WHERE email IN ('rambo367@gmail.com', 'kezarchdesign@gmail.com', 'mikechen@outlook.com')
       OR (first_name = 'Ram' AND last_name = 'Neupane')
       OR (first_name = 'Sarah' AND last_name = 'Patterson')
       OR (first_name = 'Mike' AND last_name = 'Chen')
    ORDER BY id
  `);
  console.table(demoContacts.rows);

  console.log("\n=== Demo holiday camps ===");
  const demoCamps = await pool.query(`
    SELECT id, name, slug, type, is_active, start_date, end_date, organization_id
    FROM programs
    WHERE slug IN ('fundamentals-camp', 'world-cup', 'fundamentals')
       OR name IN ('FUNdamentals Holiday Camp', 'World Cup Holiday Camp')
    ORDER BY id
  `);
  console.table(demoCamps.rows);

  console.log("\n=== All programs (for full picture) ===");
  const allPrograms = await pool.query(`
    SELECT id, type, name, slug, is_active, organization_id
    FROM programs
    ORDER BY id
  `);
  console.table(allPrograms.rows);

  console.log("\n=== Registrations linked to demo camps ===");
  const demoRegs = await pool.query(`
    SELECT r.id, r.contact_id, r.status, r.registered_at, p.name AS program_name
    FROM registrations r
    LEFT JOIN registration_items ri ON ri.registration_id = r.id
    LEFT JOIN programs p ON p.id = ri.program_id
    WHERE p.slug IN ('fundamentals-camp', 'world-cup', 'fundamentals')
    ORDER BY r.id
    LIMIT 20
  `);
  console.log(`  Found ${demoRegs.rowCount ?? 0} registrations against demo programs`);
  if ((demoRegs.rowCount ?? 0) > 0) {
    console.table(demoRegs.rows);
  }

  console.log("\n=== Demo audit_logs (created during demo seed) ===");
  const demoAudits = await pool.query(`
    SELECT id, action, entity, entity_id, details, created_at
    FROM audit_logs
    WHERE details LIKE '%FUNdamentals%' OR details LIKE '%World Cup Holiday%'
    ORDER BY id
  `);
  console.log(`  Found ${demoAudits.rowCount ?? 0} demo-related audit logs`);
  if ((demoAudits.rowCount ?? 0) > 0) {
    console.table(demoAudits.rows);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

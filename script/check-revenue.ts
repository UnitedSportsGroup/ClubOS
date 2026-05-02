import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log("\n=== Registrations by status ===\n");
  const byStatus = await pool.query(`
    SELECT status, COUNT(*) AS n,
           COALESCE(SUM(amount_paid), 0) AS sum_paid,
           COALESCE(SUM(total_cents), 0) AS sum_total_cents
    FROM registrations
    GROUP BY status
    ORDER BY n DESC
  `);
  for (const r of byStatus.rows) {
    console.log(`  ${String(r.status).padEnd(20)} count=${r.n}  paid=$${r.sum_paid}  total_cents=${r.sum_total_cents}`);
  }

  console.log("\n=== Registrations by program (org) ===\n");
  const byProgram = await pool.query(`
    SELECT p.id AS program_id, p.name AS program_name, o.name AS org_name,
           COUNT(r.id) AS regs, COALESCE(SUM(r.amount_paid), 0) AS revenue
    FROM programs p
    LEFT JOIN registrations r ON r.program_id = p.id
    LEFT JOIN organizations o ON o.id = p.organization_id
    GROUP BY p.id, p.name, o.name
    ORDER BY regs DESC
  `);
  for (const r of byProgram.rows) {
    console.log(`  [${r.program_id}] ${(r.program_name || "?").padEnd(35)} org=${r.org_name || "-"}  regs=${r.regs}  rev=$${r.revenue}`);
  }

  console.log("\n=== Facility bookings by org ===\n");
  const fb = await pool.query(`
    SELECT o.name AS org_name, COUNT(fb.id) AS bookings,
           COUNT(*) FILTER (WHERE fb.status='paid') AS paid,
           COALESCE(SUM(fb.total_cents) FILTER (WHERE fb.status='paid'), 0) AS revenue_cents
    FROM organizations o
    LEFT JOIN facility_bookings fb ON fb.organization_id = o.id
    GROUP BY o.id, o.name
    ORDER BY bookings DESC
  `).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  facility_bookings query error: ${msg.slice(0, 100)}`);
    return null;
  });
  if (fb) {
    for (const r of fb.rows) {
      console.log(`  ${r.org_name.padEnd(35)} bookings=${r.bookings}  paid=${r.paid}  rev=$${(Number(r.revenue_cents) / 100).toFixed(2)}`);
    }
  }

  console.log("\n=== Daniel's user organization links ===\n");
  const userOrgs = await pool.query(`
    SELECT u.id, u.email, u.role AS user_role, uo.organization_id, o.name AS org_name, uo.role AS org_role
    FROM users u
    LEFT JOIN user_organizations uo ON uo.user_id = u.id
    LEFT JOIN organizations o ON o.id = uo.organization_id
    WHERE u.email LIKE '%daniel%' OR u.role = 'super_admin'
    ORDER BY u.id, uo.organization_id
  `);
  for (const r of userOrgs.rows) {
    console.log(`  user=${r.email} (role=${r.user_role})  → org=${r.org_name || "-"} (org_role=${r.org_role || "-"})`);
  }

  await pool.end();
}

void main().catch((e) => { console.error(e); process.exit(1); });

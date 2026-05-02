// Verify data integrity after migration. Compares actual row counts in
// key tables to confirm all data made it from Replit → Supabase.
import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const tables = [
    "users",
    "organizations",
    "user_organizations",
    "contacts",
    "children",
    "registrations",
    "registration_items",
    "programs",
    "program_sessions",
    "session_bookings",
    "facility_bookings",
    "facilities",
    "tournaments",
    "tournament_teams",
    "tournament_games",
    "tournament_groups",
    "league_competitions",
    "league_teams",
    "league_games",
    "calendar_events",
    "analytics_events",
    "discounts",
    "discount_usages",
    "split_tests",
    "split_test_variants",
    "email_logs",
    "audit_logs",
  ];

  console.log("\n=== Row counts (actual COUNT(*)) ===\n");
  for (const t of tables) {
    try {
      const r = await pool.query(`SELECT COUNT(*) AS n FROM ${t}`);
      const n = Number(r.rows[0].n);
      const flag = n === 0 ? " ⚠️  EMPTY" : "";
      console.log(`  ${t.padEnd(28)} ${String(n).padStart(6)}${flag}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ${t.padEnd(28)} ERROR: ${msg.slice(0, 60)}`);
    }
  }

  console.log("\n=== Revenue check ===\n");
  // Total revenue across all paid registrations
  const rev = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'paid') AS paid_count,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
      COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_count,
      COUNT(*) AS total_count,
      COALESCE(SUM(total_amount_cents) FILTER (WHERE status = 'paid'), 0) AS paid_cents
    FROM registrations
  `).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  registrations status query error: ${msg.slice(0, 100)}`);
    return null;
  });
  if (rev) {
    const r = rev.rows[0];
    console.log(`  Total registrations:    ${r.total_count}`);
    console.log(`  Paid registrations:     ${r.paid_count}`);
    console.log(`  Pending registrations:  ${r.pending_count}`);
    console.log(`  Cancelled registrations:${r.cancelled_count}`);
    console.log(`  Total paid (cents):     ${r.paid_cents}  (= $${(Number(r.paid_cents) / 100).toFixed(2)})`);
  }

  console.log("\n=== Organizations ===\n");
  const orgs = await pool.query(`SELECT id, name, slug FROM organizations ORDER BY id`);
  for (const o of orgs.rows) console.log(`  · [${o.id}] ${o.name} (${o.slug})`);

  await pool.end();
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

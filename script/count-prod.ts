// Reads PROD_DATABASE_URL from env (NOT .env), connects to it, counts rows
// in key tables. Lets us verify what's actually in the production database
// without trusting pg_dump output.
//
// Usage:
//   PROD_DATABASE_URL="postgresql://..." npx tsx script/count-prod.ts
import { Pool } from "pg";

const url = process.env.PROD_DATABASE_URL;
if (!url) {
  console.error(
    "PROD_DATABASE_URL is not set. Run with: PROD_DATABASE_URL=\"...\" npx tsx script/count-prod.ts"
  );
  process.exit(1);
}

const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return "(unparseable)";
  }
})();

console.log(`→ Connecting to ${host}`);

const pool = new Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

const tables = [
  "users",
  "organizations",
  "contacts",
  "children",
  "registrations",
  "registration_items",
  "programs",
  "program_sessions",
  "session_bookings",
  "facility_bookings",
  "tournaments",
  "tournament_teams",
  "tournament_games",
  "calendar_events",
  "analytics_events",
  "email_logs",
  "email_campaigns",
  "contact_relationships",
];

(async () => {
  console.log("\n=== Production row counts ===\n");
  for (const t of tables) {
    try {
      const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
      const n = r.rows[0].n;
      console.log(`  ${t.padEnd(28)} ${String(n).padStart(8)}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ${t.padEnd(28)} ERROR: ${msg.slice(0, 70)}`);
    }
  }

  console.log("\n=== Production registration_items breakdown ===\n");
  try {
    const r = await pool.query(`
      SELECT COUNT(*)::int AS total,
             COALESCE(SUM(price_cents), 0)::bigint AS total_cents
      FROM registration_items
    `);
    console.log(`  total items=${r.rows[0].total}  sum=$${(Number(r.rows[0].total_cents) / 100).toFixed(2)}`);
  } catch (e) {
    console.log(`  registration_items not queryable: ${(e as Error).message}`);
  }

  console.log("\n=== Production registrations status breakdown ===\n");
  try {
    const r = await pool.query(`
      SELECT status::text, COUNT(*)::int AS n,
             COALESCE(SUM(amount_paid), 0)::numeric AS amount_paid_sum,
             COALESCE(SUM(total_cents), 0)::bigint AS total_cents_sum
      FROM registrations
      GROUP BY status
      ORDER BY n DESC
    `);
    for (const row of r.rows) {
      console.log(`  ${String(row.status).padEnd(20)} count=${row.n}  amount_paid=$${row.amount_paid_sum}  total_cents=${row.total_cents_sum}`);
    }
  } catch (e) {
    console.log(`  query failed: ${(e as Error).message}`);
  }

  await pool.end();
})();

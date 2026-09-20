// Read-only: every REAL registration (confirmed / refunded / partially_refunded) since 1 Dec 2025 with what it was for,
// who it was for, what was paid and when, and which Xero account ClubOS's payout poster maps it to — so the P&L can open
// the Stripe payout lumps into the children behind them. Writes outputs/club-finance-2026/clubos_registrations.json.
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { writeFileSync } from "fs";

async function main() {
  const cols = (await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'registrations'`)).rows.map((r: any) => r.column_name as string);
  const dateCol = ["registered_at", "created_at", "confirmed_at"].find(c => cols.includes(c));
  if (!dateCol) throw new Error(`no date column on registrations: ${cols.join(",")}`);
  const r = await db.execute(sql.raw(`
    SELECT r.id, r.status, r.${dateCol} AS at, r.total_cents, r.amount_paid, r.refunded_amount_cents, r.refunded_at,
           r.stripe_payment_intent_id, r.source, r.registration_location, r.payment_mode, r.term_id,
           p.id AS program_id, p.name AS program, p.type AS program_type, p.organization_id AS org,
           o.name AS org_name, po.name AS option_name, t.year AS term_year, t.term_number AS term_no, t.name AS term_name,
           c.first_name AS child_first, c.last_name AS child_last, c.date_of_birth AS dob,
           g.first_name AS g_first, g.last_name AS g_last,
           m.xero_account_code AS xero_code
      FROM registrations r
      JOIN programs p ON p.id = r.program_id
      JOIN organizations o ON o.id = p.organization_id
      LEFT JOIN program_options po ON po.id = r.program_option_id
      LEFT JOIN terms t ON t.id = r.term_id
      LEFT JOIN contacts c ON c.id = r.contact_id
      LEFT JOIN contacts g ON g.id = r.guardian_id
      LEFT JOIN xero_account_map m ON m.organization_id = p.organization_id AND m.program_id = p.id
     WHERE r.status IN ('confirmed','refunded','partially_refunded') AND r.${dateCol} >= '2025-12-01'
     ORDER BY r.${dateCol}`));
  const rows = r.rows as any[];
  const cat = (await db.execute(sql`SELECT organization_id, category, program_id, xero_account_code FROM xero_account_map`)).rows;
  writeFileSync("../../outputs/club-finance-2026/clubos_registrations.json", JSON.stringify({ dateCol, rows, map: cat }, null, 0));
  const byOrg: Record<string, [number, number]> = {};
  for (const x of rows) { const k = x.org_name; byOrg[k] ??= [0, 0]; byOrg[k][0]++; byOrg[k][1] += Number(x.amount_paid || 0); }
  console.log(`${rows.length} registrations since 1 Dec 2025 (date column ${dateCol}); map rows ${cat.length}`);
  for (const [k, v] of Object.entries(byOrg)) console.log(`  ${k}: ${v[0]} · $${v[1].toFixed(2)} paid`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

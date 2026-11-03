// Read-only: every holiday camp in ClubOS, each of its days, and which children were booked on each day (REAL registrations
// only — confirmed / refunded / partially_refunded; refunded days flagged). Feeds the finance report's Coding structure tab
// (camp → holiday → week → day → players, or holiday first). Writes outputs/club-finance-2026/clubos_camp_days.json.
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { writeFileSync } from "fs";

async function main() {
  const camps = (await db.execute(sql`
    SELECT p.id, p.name, p.organization_id AS org, o.name AS org_name
      FROM programs p JOIN organizations o ON o.id = p.organization_id
     WHERE p.type::text = 'holiday_camp' AND EXISTS (SELECT 1 FROM camp_dates cd WHERE cd.camp_id = p.id)
     ORDER BY p.id`)).rows as any[];
  const days = (await db.execute(sql`
    SELECT cd.id, cd.camp_id, to_char(cd.date, 'YYYY-MM-DD') AS date, cd.name FROM camp_dates cd
     WHERE cd.camp_id IN (SELECT id FROM programs WHERE type::text = 'holiday_camp') ORDER BY cd.date, cd.id`)).rows as any[];
  const items = (await db.execute(sql`
    SELECT ri.camp_date_id, ri.product_type, coalesce(ri.refunded_amount_cents, 0) > 0 AS refunded_day, r.status,
           ch.first_name, ch.last_name
      FROM registration_items ri
      JOIN registrations r ON r.id = ri.registration_id
      LEFT JOIN children ch ON ch.id = ri.child_id
     WHERE ri.camp_date_id IS NOT NULL AND r.status IN ('confirmed','refunded','partially_refunded')`)).rows as any[];
  const byDay: Record<string, any[]> = {};
  for (const i of items) (byDay[i.camp_date_id] ??= []).push({ name: [i.first_name, i.last_name].filter(Boolean).join(" ").trim() || "Name not recorded", kind: i.product_type, refunded: i.status === "refunded" || i.refunded_day });
  const out = camps.map((c) => ({ id: c.id, name: c.name, org: c.org, orgName: c.org_name,
    days: days.filter((d) => d.camp_id === c.id).map((d) => ({ date: d.date, name: d.name, players: (byDay[d.id] ?? []).sort((a, b) => a.name.localeCompare(b.name)) })) }));
  writeFileSync("../../outputs/club-finance-2026/clubos_camp_days.json", JSON.stringify({ exported: new Date().toISOString(), camps: out }, null, 0));
  for (const c of out) console.log(`${c.id} ${c.name}: ${c.days.length} days, ${c.days.reduce((a, d) => a + d.players.length, 0)} child-days`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

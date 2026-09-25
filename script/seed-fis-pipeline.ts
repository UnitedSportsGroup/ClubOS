/**
 * Fills the Football in Schools pipeline from the outreach database export.
 *
 *   python3 scripts/export_fis_pipeline_seed.py            (workspace root)
 *   npx tsx --env-file=.env script/seed-fis-pipeline.ts <pipeline-seed.json> [--commit]
 *
 * Dry run by default. Idempotent on (organization, kind, slug) — the slug is the
 * school's proposal-page slug.
 *
 * 🔴 A re-seed refreshes what the SPREADSHEET owns (name, address, drive time,
 *    delivery history, internal background) and nothing a person has touched:
 *    stage, owner, priority, follow-up and notes are set on first insert only.
 *    Contact fields are filled only where the row's are still empty, because
 *    Connor corrects stale contacts in the drawer.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs";

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
const COMMIT = process.argv.includes("--commit");
if (!file) { console.error("usage: seed-fis-pipeline.ts <pipeline-seed.json> [--commit]"); process.exit(1); }

type Row = {
  kind: "school" | "elc"; slug: string; name: string; suburb: string | null; address: string | null; website: string | null;
  driveMin: number | null; returning: boolean; deliveredText: string | null; leadGroup: string | null;
  phone: string | null; email: string | null; contactName: string | null; contactRole: string | null;
  contactEmail: string | null; contactPhone: string | null; sheetStatus: string | null; stage: string;
  closedReason: string | null; background: Record<string, string>;
};

async function main() {
  const rows: Row[] = JSON.parse(fs.readFileSync(file!, "utf8"));
  const bad = rows.filter((r) => !["school", "elc"].includes(r.kind) || !r.slug || !r.name);
  if (bad.length) throw new Error(`${bad.length} rows without kind/slug/name`);
  const ROLLBACK = new Error("__rollback__");
  let inserted = 0, updated = 0;
  try {
    await db.transaction(async (tx) => {
      const [org] = (await tx.execute(sql`SELECT id FROM organizations WHERE slug = 'christchurch-united'`)).rows as any[];
      for (const r of rows) {
        const res = (await tx.execute(sql`
          INSERT INTO fis_leads (organization_id, kind, slug, name, suburb, address, website, drive_min, worked_with_us,
            delivered_text, lead_group, phone, email, contact_name, contact_role, contact_email, contact_phone,
            sheet_status, background, status, closed_reason, stage_changed_at)
          VALUES (${org.id}, ${r.kind}, ${r.slug}, ${r.name}, ${r.suburb}, ${r.address}, ${r.website}, ${r.driveMin}, ${r.returning},
            ${r.deliveredText}, ${r.leadGroup}, ${r.phone}, ${r.email}, ${r.contactName}, ${r.contactRole}, ${r.contactEmail},
            ${r.contactPhone}, ${r.sheetStatus}, ${JSON.stringify(r.background)}::jsonb, ${r.stage}, ${r.closedReason}, now())
          ON CONFLICT (organization_id, kind, slug) DO UPDATE SET
            name = EXCLUDED.name, suburb = EXCLUDED.suburb, address = EXCLUDED.address, website = EXCLUDED.website,
            drive_min = EXCLUDED.drive_min, worked_with_us = EXCLUDED.worked_with_us, delivered_text = EXCLUDED.delivered_text,
            lead_group = EXCLUDED.lead_group, sheet_status = EXCLUDED.sheet_status, background = EXCLUDED.background,
            phone = COALESCE(fis_leads.phone, EXCLUDED.phone), email = COALESCE(fis_leads.email, EXCLUDED.email),
            contact_name = COALESCE(fis_leads.contact_name, EXCLUDED.contact_name),
            contact_role = COALESCE(fis_leads.contact_role, EXCLUDED.contact_role),
            contact_email = COALESCE(fis_leads.contact_email, EXCLUDED.contact_email),
            contact_phone = COALESCE(fis_leads.contact_phone, EXCLUDED.contact_phone),
            updated_at = now()
          RETURNING (xmax = 0) AS inserted`)).rows as any[];
        res[0]?.inserted ? inserted++ : updated++;
      }
      const counts = (await tx.execute(sql`
        SELECT kind, status, count(*)::int n FROM fis_leads WHERE organization_id = ${org.id} GROUP BY 1,2 ORDER BY 1,2`)).rows;
      console.table(counts);
      if (!COMMIT) throw ROLLBACK;
    });
  } catch (e) { if (e !== ROLLBACK) throw e; }
  console.log(`${rows.length} rows · ${inserted} new · ${updated} refreshed — ${COMMIT ? "COMMITTED" : "dry run, rolled back (add --commit)"}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

// Phase 1 seed — imports the duplicated Google Sheet's content as the
// initial dataset for the budget module in the USG workspace. Idempotent:
// matches existing rows by composite key and upserts.
//
// Reads TSV snapshots from outputs/budget-tool-plan/sheet-snapshot/ which
// were generated 2026-05-13 by the openpyxl extractor.
//
// Usage:
//   cd apps/clubos
//   npx tsx --env-file=.env script/seed-budget-from-sheet-snapshot.ts

import { Pool } from "pg";
import { readFileSync, existsSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = resolve(__dirname, "../../../outputs/budget-tool-plan/sheet-snapshot");
const ORG_SLUG = "united-sports-group";
const YEAR = 2026;

// (tab filename) → (cost-centre definition)
// Owner email → must match an active row in `users.email`. Unknown emails
// → ownerId left null and a warning is printed.
const COST_CENTRES: Array<{
  slug: string;
  name: string;
  bucket: "operating" | "team" | "shared" | "tournament";
  ownerEmail: string | null;
  tsvFile: string;
  displayOrder: number;
  isVirtual?: boolean;
}> = [
  { slug: "academy",         name: "Academy",                bucket: "operating",  ownerEmail: "academy@cufc.co.nz",    tsvFile: "Academy_-_Paul.tsv",          displayOrder: 10 },
  { slug: "holiday-camps",   name: "Holiday Camps",          bucket: "operating",  ownerEmail: "grassroots@cufc.co.nz", tsvFile: "Holiday_Camps_-_Zach.tsv",    displayOrder: 20 },
  { slug: "mini-football",   name: "Mini Football Leagues",  bucket: "operating",  ownerEmail: null,                    tsvFile: "Mini_Football_-_Isaac.tsv",   displayOrder: 30 },
  { slug: "siu-pro-team",    name: "SIU Pro Team",           bucket: "team",       ownerEmail: null,                    tsvFile: "SIU_Pro_Team_-_Coen.tsv",     displayOrder: 40 },
  { slug: "cufc-first-team", name: "CUFC First Team",        bucket: "team",       ownerEmail: null,                    tsvFile: "CUFC_First_Team_-_Albert.tsv",displayOrder: 50 },
  { slug: "merchandising",   name: "Merchandising",          bucket: "operating",  ownerEmail: "dima@cufc.co.nz",       tsvFile: "Merchandising_-_Dima.tsv",    displayOrder: 60 },
  { slug: "cic-youth",       name: "CIC Youth",              bucket: "tournament", ownerEmail: "daniel@cufc.co.nz",     tsvFile: "CIC_Youth.tsv",               displayOrder: 70 },
  { slug: "cic-7s",          name: "CIC 7s",                 bucket: "tournament", ownerEmail: "daniel@cufc.co.nz",     tsvFile: "CIC_7s_(January_2026).tsv",   displayOrder: 80 },
  { slug: "media",           name: "Media",                  bucket: "shared",     ownerEmail: null,                    tsvFile: "Media.tsv",                   displayOrder: 90 },
  { slug: "staff",           name: "Staff",                  bucket: "shared",     ownerEmail: "ryan@cufc.co.nz",       tsvFile: "Staff.tsv",                   displayOrder: 100 },
  { slug: "sponsorship",     name: "Sponsorship",            bucket: "shared",     ownerEmail: "daniel@cufc.co.nz",     tsvFile: "Sponsorship.tsv",             displayOrder: 110 },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Pull-back: parse a TSV file into (section, name, amountCents, notes) rows.
// Heuristic (matches the sheet's free-form layout):
//   - Skip blank rows
//   - First 4 rows are header / metadata — skip rows where col[0] looks
//     like a title ("Academy Budget", "Holiday Camps", year, etc.)
//   - A row with text in col[0] and EMPTY col[1] is a section header
//   - A row with text in col[0] and a number in col[1] is a line item
//   - col[2] (when present) is notes
//
// Lines parsed this way are always `kind='expense'` for v1 (every owner tab
// is expense-focused; income lives in the 2026 Budget rollup tab which is
// modelled separately as a "Sponsorship Targets"-style virtual centre when
// needed). Future: detect "Revenue" / "Income" section headings and flip kind.
function parseTsv(path: string): Array<{ section: string | null; name: string; amountCents: number; notes: string | null; displayOrder: number }> {
  if (!existsSync(path)) {
    console.warn(`  ⚠ TSV not found: ${path}`);
    return [];
  }
  const raw = readFileSync(path, "utf8");
  const rows = raw.split("\n").map(line => line.split("\t"));
  const out: Array<{ section: string | null; name: string; amountCents: number; notes: string | null; displayOrder: number }> = [];
  let currentSection: string | null = null;
  let order = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const a = (row[0] ?? "").trim();
    const b = (row[1] ?? "").trim();
    const c = (row[2] ?? "").trim();
    if (!a && !b && !c) continue;
    // Skip the title block at top — first 4 rows where col[0] is non-empty
    // and contains 'Budget', year-like, or other metadata signals.
    if (i < 5 && (a === "" || /budget|jan - dec|2026|Per programme/i.test(a))) continue;
    // Section header — text in col[0], no number in col[1]
    if (a && !b) {
      currentSection = a;
      continue;
    }
    // Line — text in col[0], number-ish in col[1]
    if (a && b) {
      const cleaned = b.replace(/[$,]/g, "").replace(/\s+/g, "");
      const dollars = Number(cleaned);
      if (Number.isFinite(dollars)) {
        order += 10;
        out.push({
          section: currentSection,
          name: a,
          amountCents: Math.round(dollars * 100),
          notes: c || null,
          displayOrder: order,
        });
      }
    }
  }
  return out;
}

async function main() {
  const client = await pool.connect();
  try {
    const orgRes = await client.query<{ id: number }>("SELECT id FROM organizations WHERE slug = $1", [ORG_SLUG]);
    if (orgRes.rows.length === 0) throw new Error(`Organization '${ORG_SLUG}' not found`);
    const orgId = orgRes.rows[0].id;
    console.log(`USG org id = ${orgId}\n`);

    // Resolve owner ids — print warnings for missing accounts.
    const ownerMap = new Map<string, number>();
    const emailsToLookup = Array.from(new Set(COST_CENTRES.map(c => c.ownerEmail).filter(Boolean) as string[]));
    if (emailsToLookup.length > 0) {
      const r = await client.query<{ id: number; email: string }>("SELECT id, email FROM users WHERE email = ANY($1::text[])", [emailsToLookup]);
      for (const u of r.rows) ownerMap.set(u.email, u.id);
    }
    const missing = COST_CENTRES.filter(c => c.ownerEmail && !ownerMap.has(c.ownerEmail));
    if (missing.length > 0) {
      console.warn("⚠ Email accounts not found in DB — these centres will have ownerId=null:");
      for (const c of missing) console.warn(`    ${c.slug.padEnd(20)} → ${c.ownerEmail}`);
      console.warn("");
    }
    const noOwnerByName = COST_CENTRES.filter(c => !c.ownerEmail);
    if (noOwnerByName.length > 0) {
      console.warn("⚠ Cost centres with no assigned owner (need ClubOS account first):");
      for (const c of noOwnerByName) console.warn(`    ${c.slug.padEnd(20)} → (Isaac / Coen / Albert — not in users table yet)`);
      console.warn("");
    }

    // Upsert each cost centre + lines in a single transaction.
    await client.query("BEGIN");
    let ccUpserts = 0;
    let linesInserted = 0;
    let linesUpdated = 0;

    for (const cc of COST_CENTRES) {
      const ownerId = cc.ownerEmail ? (ownerMap.get(cc.ownerEmail) ?? null) : null;
      const existing = await client.query<{ id: number }>(
        "SELECT id FROM budget_cost_centres WHERE organization_id = $1 AND slug = $2 AND year = $3",
        [orgId, cc.slug, YEAR],
      );
      let ccId: number;
      if (existing.rows.length === 0) {
        const ins = await client.query<{ id: number }>(
          `INSERT INTO budget_cost_centres (organization_id, slug, name, bucket, owner_id, year, display_order, is_virtual)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [orgId, cc.slug, cc.name, cc.bucket, ownerId, YEAR, cc.displayOrder, cc.isVirtual ?? false],
        );
        ccId = ins.rows[0].id;
        console.log(`+ Cost centre: ${cc.slug} (id=${ccId}, owner=${ownerId ?? "—"})`);
      } else {
        ccId = existing.rows[0].id;
        await client.query(
          `UPDATE budget_cost_centres SET name=$1, bucket=$2, owner_id=COALESCE($3, owner_id), display_order=$4, is_virtual=$5, updated_at=now() WHERE id=$6`,
          [cc.name, cc.bucket, ownerId, cc.displayOrder, cc.isVirtual ?? false, ccId],
        );
        console.log(`= Cost centre: ${cc.slug} (id=${ccId}, owner=${ownerId ?? "(kept)"})`);
      }
      ccUpserts++;

      // Parse the TSV and upsert lines
      const tsvPath = join(SNAPSHOT_DIR, cc.tsvFile);
      const parsed = parseTsv(tsvPath);
      for (const line of parsed) {
        const existingLine = await client.query<{ id: number; amount_cents: number; notes: string | null; section: string | null }>(
          `SELECT id, amount_cents, notes, section FROM budget_lines WHERE cost_centre_id=$1 AND COALESCE(section,'')=COALESCE($2,'') AND name=$3`,
          [ccId, line.section, line.name],
        );
        if (existingLine.rows.length === 0) {
          await client.query(
            `INSERT INTO budget_lines (cost_centre_id, kind, line_type, section, name, amount_cents, notes, display_order)
             VALUES ($1, 'expense', 'simple', $2, $3, $4, $5, $6)`,
            [ccId, line.section, line.name, line.amountCents, line.notes, line.displayOrder],
          );
          linesInserted++;
        } else {
          await client.query(
            `UPDATE budget_lines SET amount_cents=$1, notes=COALESCE($2, notes), display_order=$3, updated_at=now() WHERE id=$4`,
            [line.amountCents, line.notes, line.displayOrder, existingLine.rows[0].id],
          );
          linesUpdated++;
        }
      }
      console.log(`  → ${parsed.length} lines parsed`);
    }

    // Grant 'budget' tab to each named owner in the USG workspace.
    let tabsGranted = 0;
    for (const cc of COST_CENTRES) {
      if (!cc.ownerEmail) continue;
      const uid = ownerMap.get(cc.ownerEmail);
      if (!uid) continue;
      const mem = await client.query<{ id: number; tabs: string[] | null }>(
        `SELECT id, tabs FROM user_organizations WHERE user_id=$1 AND organization_id=$2`,
        [uid, orgId],
      );
      if (mem.rows.length === 0) {
        await client.query(
          `INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, $2, 'admin', $3::jsonb)`,
          [uid, orgId, JSON.stringify(["budget"])],
        );
        console.log(`+ Membership: ${cc.ownerEmail} added to USG with tabs=[budget]`);
        tabsGranted++;
      } else {
        const current = mem.rows[0].tabs;
        if (current == null) {
          // Already has full access — leave alone.
          continue;
        }
        if (!current.includes("budget")) {
          const next = [...current, "budget"];
          await client.query(`UPDATE user_organizations SET tabs=$1::jsonb WHERE id=$2`, [JSON.stringify(next), mem.rows[0].id]);
          console.log(`+ Granted budget tab to ${cc.ownerEmail}`);
          tabsGranted++;
        }
      }
    }

    await client.query("COMMIT");
    console.log("");
    console.log(`✅ Seed complete: ${ccUpserts} cost centres, ${linesInserted} new lines, ${linesUpdated} updated, ${tabsGranted} tab grants.`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});

// One-shot import of the CIC 2026 entries from Daniel's "Invoices and Team
// Contacts" spreadsheet. Replaces the placeholder/demo team rows that came
// over from prod with real club entries linked to clubs in the CIC org.
//
// Run: npx tsx script/import-cic-2026.ts <path-to-csv>
//
// Idempotent on clubs (matches by org + name). Wipes club-less placeholder
// tournament_teams in CIC tournaments before adding the real ones.

import "dotenv/config";
import { Pool } from "pg";
import { readFileSync } from "fs";

const CIC_ORG_ID = 5;

interface ClubRow {
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  ageGroups: number[]; // [9, 10, 11, ...]
  notes: string | null;
}

// Strip trailing whitespace + collapse internal whitespace.
function clean(s: string | undefined | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

// Pull a name + email out of strings like "Phil Williams - philw@ctfc.nz".
// If multiple contacts (comma-separated), take the first. Returns nulls
// when nothing parseable (e.g. "DONE", "WHO ?").
function parseContact(raw: string): { name: string | null; email: string | null } {
  const first = clean(raw.split(/,(?=\s|$)/)[0] || raw);
  if (!first || /^(done|who\s*\?|\s*-\s*)$/i.test(first)) return { name: null, email: null };

  const emailMatch = first.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const email = emailMatch ? emailMatch[0] : null;
  let name: string | null = null;
  if (email) {
    const before = first.slice(0, first.indexOf(email)).replace(/\s*[-–—]\s*$/, "").trim();
    if (before && !/^(admin|tournaments?)$/i.test(before)) name = before;
  } else if (!/@/.test(first)) {
    name = first;
  }
  return { name: name || null, email };
}

// Pull all age group numbers out of strings like "U9, U10, U11, U12, U13,
// U14, U15" / "U10, U11, U12 and U15" / "U14 ONLY".
function parseAgeGroups(raw: string): number[] {
  const matches = raw.match(/U\s*(\d+)/gi) ?? [];
  const nums = matches
    .map(m => parseInt(m.replace(/[^\d]/g, ""), 10))
    .filter(n => !isNaN(n) && n >= 8 && n <= 18);
  return [...new Set(nums)].sort((a, b) => a - b);
}

// Minimal CSV parser that handles quoted cells with embedded commas.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cell += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch === "\r") { /* skip */ }
      else { cell += ch; }
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) { console.error("Usage: tsx script/import-cic-2026.ts <path-to-csv>"); process.exit(1); }

  const raw = readFileSync(csvPath, "utf8");
  const rows = parseCsv(raw);
  if (rows.length === 0) throw new Error("Empty CSV");

  // Drop header row, then turn each row into a ClubRow.
  const header = rows[0];
  console.log(`CSV header: ${header.map(clean).join(" | ")}`);
  const data = rows.slice(1).filter(r => clean(r[0]).length > 0);

  const clubRows: ClubRow[] = data.map(r => {
    const name = clean(r[0]);
    const { name: contactName, email: contactEmail } = parseContact(clean(r[1]));
    const ageGroups = parseAgeGroups(clean(r[2]));
    return { name, contactName, contactEmail, ageGroups, notes: clean(r[3]) || null };
  });

  console.log(`\nParsed ${clubRows.length} clubs from CSV:\n`);
  for (const c of clubRows) {
    const ages = c.ageGroups.length > 0 ? c.ageGroups.map(n => `U${n}`).join(",") : "(no ages parsed)";
    console.log(`  ${c.name.padEnd(35)}  ${ages.padEnd(40)}  ${c.contactName || "—"}`);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Look up tournament IDs by age group within the CIC org.
  const tourRes = await pool.query(
    `SELECT id, age_group FROM tournaments WHERE organization_id = $1`,
    [CIC_ORG_ID]
  );
  const tournamentByAge = new Map<number, number>();
  for (const t of tourRes.rows) {
    const m = String(t.age_group || "").match(/U?\s*(\d+)/i);
    if (m) tournamentByAge.set(parseInt(m[1], 10), t.id);
  }
  console.log(`\nFound ${tournamentByAge.size} CIC tournaments:`);
  for (const [age, id] of [...tournamentByAge].sort((a, b) => a[0] - b[0])) {
    console.log(`  U${age} → tournament_id ${id}`);
  }

  // Clean up placeholder teams in CIC tournaments. These are the demo seed
  // rows ("Christchurch United Blue", "Auckland City Juniors", etc.) that
  // came across from prod. Anything without a club_id and matching a CIC
  // tournament is fair game.
  const tournIds = [...tournamentByAge.values()];
  const delRes = await pool.query(
    `DELETE FROM tournament_teams
     WHERE tournament_id = ANY($1)
       AND club_id IS NULL
     RETURNING id, name, tournament_id`,
    [tournIds]
  );
  console.log(`\nDeleted ${delRes.rowCount} placeholder teams (no club_id) in CIC tournaments.`);

  // Upsert clubs. Match on (org_id, name) to keep the import idempotent.
  console.log("\nUpserting clubs…");
  const clubIdByName = new Map<string, number>();
  for (const cr of clubRows) {
    const existing = await pool.query(
      `SELECT id FROM clubs WHERE organization_id = $1 AND LOWER(name) = LOWER($2)`,
      [CIC_ORG_ID, cr.name]
    );
    if (existing.rowCount && existing.rows[0]) {
      const id = existing.rows[0].id;
      // Update non-empty fields so re-runs sync new contact details.
      await pool.query(
        `UPDATE clubs SET
           contact_name = COALESCE($1, contact_name),
           contact_email = COALESCE($2, contact_email),
           notes = COALESCE($3, notes)
         WHERE id = $4`,
        [cr.contactName, cr.contactEmail, cr.notes, id]
      );
      clubIdByName.set(cr.name, id);
      console.log(`  ↻ ${cr.name} (id ${id}, updated)`);
    } else {
      const ins = await pool.query(
        `INSERT INTO clubs (organization_id, name, contact_name, contact_email, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [CIC_ORG_ID, cr.name, cr.contactName, cr.contactEmail, cr.notes]
      );
      clubIdByName.set(cr.name, ins.rows[0].id);
      console.log(`  + ${cr.name} (id ${ins.rows[0].id})`);
    }
  }

  // Insert tournament_teams for each (club, age_group) — only if no team
  // for that club already exists in that tournament.
  console.log("\nInserting tournament team entries…");
  let added = 0;
  let skippedExisting = 0;
  let skippedNoTournament = 0;
  for (const cr of clubRows) {
    const clubId = clubIdByName.get(cr.name);
    if (!clubId) continue;
    for (const age of cr.ageGroups) {
      const tournamentId = tournamentByAge.get(age);
      if (!tournamentId) {
        console.log(`    ⚠  ${cr.name} entered U${age} but no tournament exists for U${age}`);
        skippedNoTournament++;
        continue;
      }
      const dup = await pool.query(
        `SELECT id FROM tournament_teams WHERE tournament_id = $1 AND club_id = $2`,
        [tournamentId, clubId]
      );
      if (dup.rowCount && dup.rows[0]) {
        skippedExisting++;
        continue;
      }
      await pool.query(
        `INSERT INTO tournament_teams (tournament_id, club_id, name, club_name, contact_name, contact_email)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tournamentId, clubId, cr.name, cr.name, cr.contactName, cr.contactEmail]
      );
      added++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Clubs in CSV:                ${clubRows.length}`);
  console.log(`  Placeholder teams deleted:   ${delRes.rowCount ?? 0}`);
  console.log(`  Tournament teams created:    ${added}`);
  console.log(`  Already existed, skipped:    ${skippedExisting}`);
  console.log(`  No matching tournament:      ${skippedNoTournament}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

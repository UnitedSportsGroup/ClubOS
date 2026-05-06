// Seed the Christchurch United (org id=1) workspace with NZ school terms
// for 2026 — same dates as the gymnastics workspace already uses. Holiday
// windows derive automatically from the gaps between consecutive terms,
// so we only need the four term rows here. Idempotent: skips any term
// that already exists for (org, year, term_number).

import "dotenv/config";
import { Pool } from "pg";

const ORG_ID = 1; // Christchurch United

const TERMS_2026 = [
  { year: 2026, termNumber: 1, name: "Term 1", startDate: "2026-01-26", endDate: "2026-04-02" },
  { year: 2026, termNumber: 2, name: "Term 2", startDate: "2026-04-20", endDate: "2026-07-03" },
  { year: 2026, termNumber: 3, name: "Term 3", startDate: "2026-07-20", endDate: "2026-09-25" },
  { year: 2026, termNumber: 4, name: "Term 4", startDate: "2026-10-12", endDate: "2026-12-18" },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const t of TERMS_2026) {
      const existing = await client.query(
        `SELECT id, start_date, end_date FROM terms
          WHERE organization_id = $1 AND year = $2 AND term_number = $3`,
        [ORG_ID, t.year, t.termNumber],
      );

      if (existing.rows.length > 0) {
        console.log(`✓ ${t.year} Term ${t.termNumber} already exists (id=${existing.rows[0].id}) — skipping`);
        continue;
      }

      const inserted = await client.query(
        `INSERT INTO terms (organization_id, year, term_number, name, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [ORG_ID, t.year, t.termNumber, t.name, t.startDate, t.endDate],
      );
      console.log(`✓ inserted ${t.year} Term ${t.termNumber} (id=${inserted.rows[0].id}): ${t.startDate} → ${t.endDate}`);
    }

    await client.query("COMMIT");
    console.log("✅ CUFC 2026 terms seeded.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Seed failed; rolled back:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();

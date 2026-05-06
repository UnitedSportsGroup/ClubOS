// One-shot: find the CUFC U4-U8 program and flip it from holiday-camp shape
// to term-mode shape so the new Schedule + ClassPricing tabs render. Idempotent.
import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    // Find Christchurch United org by slug guesses (handles cufc / christchurch-united).
    const orgRes = await client.query(`
      SELECT id, slug, name FROM organizations
       WHERE slug IN ('cufc', 'christchurch-united', 'christchurch-united-fc')
          OR name ILIKE '%christchurch united%'
       ORDER BY id
    `);
    if (orgRes.rows.length === 0) {
      console.log("⚠ no Christchurch United org found");
      return;
    }
    console.log("Candidate orgs:", orgRes.rows);

    // Find U4-U8 program in any of those orgs.
    const orgIds = orgRes.rows.map(r => r.id);
    const progRes = await client.query(
      `SELECT id, name, slug, organization_id, type, schedule_type, term_id, pricing_model
         FROM programs
        WHERE organization_id = ANY($1::int[])
          AND (name ILIKE '%U4%U8%' OR slug ILIKE '%u4-u8%' OR name ILIKE '%u4-u8%' OR slug ILIKE '%u4_u8%')`,
      [orgIds],
    );
    if (progRes.rows.length === 0) {
      console.log("⚠ no U4-U8 program found in any CUFC org. Programs in those orgs:");
      const all = await client.query(`SELECT id, name, slug, organization_id, schedule_type FROM programs WHERE organization_id = ANY($1::int[]) ORDER BY id`, [orgIds]);
      console.table(all.rows);
      return;
    }
    console.log("Found U4-U8 program(s):");
    console.table(progRes.rows);

    for (const p of progRes.rows) {
      if (p.schedule_type === "term") {
        console.log(`✓ id=${p.id} already term mode — skipping`);
        continue;
      }
      await client.query(
        `UPDATE programs
            SET schedule_type = 'term',
                pricing_model = COALESCE(NULLIF(pricing_model, ''), 'term_prorated')
          WHERE id = $1`,
        [p.id],
      );
      console.log(`✓ id=${p.id} flipped to term mode`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch(e => { console.error(e); process.exitCode = 1; });

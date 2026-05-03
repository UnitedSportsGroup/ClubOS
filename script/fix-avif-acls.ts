import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const paths = [
    "/objects/uploads/19760cdb-719e-4f20-ab25-024252995082.avif",
    "/objects/uploads/45131cc2-2709-4533-abc1-5b4ca3802de4.avif",
    "/objects/uploads/6e008f41-dacf-4c3b-9f39-a231888144d3.avif",
    "/objects/uploads/f48409f8-9984-4876-bfff-e798cd46b2f1.avif",
    "/objects/uploads/f514fad8-c606-4e69-a2b0-90fe04d82de6.avif",
  ];

  for (const p of paths) {
    await pool.query(
      `INSERT INTO public.object_acls (object_path, owner_user_id, visibility)
       VALUES ($1, NULL, 'public')
       ON CONFLICT (object_path) DO UPDATE SET visibility='public', updated_at = now()`,
      [p]
    );
    console.log(`✓ ACL set public: ${p}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

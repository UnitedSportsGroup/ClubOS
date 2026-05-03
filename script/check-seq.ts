import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // tournament_groups uses GENERATED ALWAYS AS IDENTITY (not nextval/serial),
  // so pg_get_serial_sequence returns NULL. The implicit sequence is named
  // <table>_<col>_seq. Use that path instead.
  const tables = ["tournament_groups", "tournament_teams", "tournament_games", "tournament_players", "tournaments"];
  console.log("=== max(id) vs identity sequence last_value ===\n");
  for (const t of tables) {
    const max = await pool.query(`SELECT COALESCE(MAX(id), 0)::int AS m FROM "${t}"`);
    // Find the identity sequence (GENERATED ALWAYS AS IDENTITY)
    // Identity columns store the sequence in pg_class via dependency
    const seqRes = await pool.query(`
      SELECT pg_get_serial_sequence($1, 'id') AS s1,
             (SELECT (n.nspname||'.'||c.relname)
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_depend d ON d.objid = c.oid
                WHERE c.relkind = 'S'
                  AND d.refobjid = $1::regclass
                LIMIT 1) AS s2
    `, [t]);
    const seqName: string | null = seqRes.rows[0].s1 || seqRes.rows[0].s2;
    let seqLast: number | string = "—";
    if (seqName) {
      try {
        const lv = await pool.query(`SELECT last_value::int AS lv FROM ${seqName}`);
        seqLast = lv.rows[0].lv;
      } catch (e: any) { seqLast = `err: ${e.message.slice(0,40)}`; }
    }
    const stale = typeof seqLast === "number" && seqLast <= max.rows[0].m;
    console.log(`  ${t.padEnd(22)}  max=${String(max.rows[0].m).padStart(4)}  seq=${String(seqLast).padStart(5)} ${stale ? "⚠ STALE" : ""} ${seqName ? `(${seqName})` : ""}`);
  }
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

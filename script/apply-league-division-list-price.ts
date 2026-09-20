// Apply migrations/2026-09-20_league_division_list_price.sql, rehearsed first.
//   npx tsx --env-file=.env script/apply-league-division-list-price.ts            (dry run)
//   npx tsx --env-file=.env script/apply-league-division-list-price.ts --commit
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const problems: string[] = []; let checks = 0;
const ok = (l: string) => { checks++; console.log(`  ✓ ${l}`); };
const bad = (l: string) => { checks++; problems.push(l); console.log(`  ✗ ${l}`); };

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-09-20_league_division_list_price.sql"), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  league_divisions.list_price_cents — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    await c.query(sql);
    const col = await c.query(`select 1 from information_schema.columns where table_name='league_divisions' and column_name='list_price_cents'`);
    col.rowCount ? ok("column exists") : bad("column missing");
    await c.query("SAVEPOINT s");
    try { await c.query(`update league_divisions set list_price_cents = -1 where id = (select min(id) from league_divisions)`); await c.query("ROLLBACK TO SAVEPOINT s"); bad("a negative usual price was ALLOWED"); }
    catch { await c.query("ROLLBACK TO SAVEPOINT s"); ok("refused: a negative usual price"); }
    await c.query("SAVEPOINT s2");
    try { await c.query(`update league_divisions set list_price_cents = null where id = (select min(id) from league_divisions)`); await c.query("ROLLBACK TO SAVEPOINT s2"); ok("accepted: NULL (the usual price is the price)"); }
    catch (e: any) { await c.query("ROLLBACK TO SAVEPOINT s2"); bad(`NULL refused: ${e.message}`); }
    await c.query("SAVEPOINT s3");
    try { await c.query(sql); await c.query("RELEASE SAVEPOINT s3"); ok("re-running the migration is a no-op"); }
    catch (e: any) { await c.query("ROLLBACK TO SAVEPOINT s3"); bad(`re-run failed: ${e.message}`); }
  } catch (e: any) { bad(`unexpected: ${e.message}`); }
  const clean = problems.length === 0;
  if (COMMIT && clean) { await c.query("COMMIT"); console.log(`\n  ${checks} checks passed — COMMITTED\n`); }
  else { await c.query("ROLLBACK"); console.log(clean ? `\n  ${checks} checks passed — rolled back. Re-run with --commit.\n` : `\n  FAILED:\n${problems.map((p) => "    · " + p).join("\n")}\n`); }
  await c.end(); process.exit(clean ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

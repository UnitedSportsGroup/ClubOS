// Apply migrations/2026-09-09_pos_cashless.sql, rehearsing it first.
//
//   npx tsx --env-file=.env script/apply-pos-cashless.ts             (dry run)
//   npx tsx --env-file=.env script/apply-pos-cashless.ts --commit
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-09-09_pos_cashless.sql"), "utf8");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`\n  pos cashless — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await client.query("BEGIN");
  const problems: string[] = [];
  const ok = (l: string, c: boolean, d = "") => { console.log(`  ${c ? "✓" : "✗"} ${l}${d ? ` — ${d}` : ""}`); if (!c) problems.push(l); };
  const refused = async (l: string, stmt: string, params: unknown[] = []) => {
    await client.query("SAVEPOINT p");
    try { await client.query(stmt, params); await client.query("RELEASE SAVEPOINT p"); ok(l, false, "ACCEPTED"); }
    catch (e: any) { await client.query("ROLLBACK TO SAVEPOINT p"); ok(l, true, String(e?.message).slice(0, 70)); }
  };
  try {
    await client.query(sql);
    console.log("  migration ran");

    const col = await client.query(`select column_default, is_nullable from information_schema.columns where table_name='pos_registers' and column_name='handles_cash'`);
    ok("pos_registers.handles_cash exists", col.rowCount === 1);
    ok("it defaults to FALSE — cashless is the club's normal", /false/i.test(col.rows[0]?.column_default ?? ""), col.rows[0]?.column_default);

    const existing = await client.query(`select count(*) filter (where handles_cash) as cash, count(*) as total from pos_registers`);
    ok("every existing register is cashless", Number(existing.rows[0].cash) === 0, `${existing.rows[0].total} register(s)`);

    const u = await client.query(`select id from users where active = true order by id limit 1`);
    const r = await client.query(`insert into pos_registers (name) values ('cashless probe') returning id`);
    const s = await client.query(`insert into pos_shifts (register_id, opened_by_user_id) values ($1,$2) returning id`, [r.rows[0].id, u.rows[0].id]);

    // The point of the change: a cashless shift closes without a drawer count.
    await client.query(`update pos_shifts set closed_at = now(), closed_by_user_id = $2 where id = $1`, [s.rows[0].id, u.rows[0].id]);
    const closed = await client.query(`select closed_at, closing_cash_counted_cents from pos_shifts where id = $1`, [s.rows[0].id]);
    ok("a cashless shift closes with NO counted figure", closed.rows[0].closed_at != null && closed.rows[0].closing_cash_counted_cents == null);

    // And the half-closed state is still refused.
    const s2 = await client.query(`insert into pos_shifts (register_id, opened_by_user_id) values ($1,$2) returning id`, [r.rows[0].id, u.rows[0].id]);
    await refused("a shift still cannot be closed without naming who closed it",
      `update pos_shifts set closed_at = now() where id = $1`, [s2.rows[0].id]);

    if (problems.length) throw new Error(`${problems.length} check(s) failed: ${problems.join("; ")}`);
    if (!COMMIT) { await client.query("ROLLBACK"); console.log("\n  DRY RUN — rolled back. All checks passed.\n"); return; }
    await client.query("ROLLBACK");
    await client.query("BEGIN"); await client.query(sql); await client.query("COMMIT");
    console.log("\n  COMMITTED — migration applied (rehearsal passed, then the DDL alone).\n");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\n  FAILED:", (e as Error).message, "\n"); process.exit(1);
  } finally { await client.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });

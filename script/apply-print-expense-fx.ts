import { db } from "../server/db"; import { sql } from "drizzle-orm";
import fs from "fs"; import path from "path";
const DRY = process.argv.includes("--dry-run");
let pass = 0, fail = 0;
const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); g ? pass++ : fail++; };
async function main() {
  const ddl = fs.readFileSync(path.join(process.cwd(), "migrations/2026-09-16_print_expense_fx.sql"), "utf8");
  console.log(`\nExpenses in another currency — ${DRY ? "DRY RUN" : "APPLYING"}\n`);
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(ddl));
    const c: any = await tx.execute(sql`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_name='print_expenses' AND column_name IN ('currency','foreign_cents','fx_rate','fx_rate_on','fx_source')`);
    ok("all five columns exist", (c.rows ?? c).length === 5, String((c.rows ?? c).length));
    ok("currency defaults to NZD", /NZD/.test(String((c.rows ?? c).find((x: any) => x.column_name === "currency")?.column_default ?? "")));

    const [{ id }]: any = ((await tx.execute(sql`SELECT id FROM print_expenses ORDER BY id LIMIT 1`)).rows ?? []) as any[];
    const refused = async (label: string, stmt: any) => {
      await tx.execute(sql`SAVEPOINT s`);
      try { await tx.execute(stmt); await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); ok(label, false, "ACCEPTED"); }
      catch { await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); ok(label, true); }
    };
    await refused("a foreign currency with no foreign amount is refused",
      sql`UPDATE print_expenses SET currency='CNY', foreign_cents=NULL WHERE id=${id}`);
    await refused("NZD carrying a foreign amount is refused",
      sql`UPDATE print_expenses SET currency='NZD', foreign_cents=150000 WHERE id=${id}`);
    await tx.execute(sql`SAVEPOINT a`);
    try {
      await tx.execute(sql`UPDATE print_expenses SET currency='CNY', foreign_cents=150000, fx_rate=0.2350, fx_rate_on='2026-09-10', fx_source='frankfurter/ECB' WHERE id=${id}`);
      ok("a real CNY invoice with a dated, sourced rate is accepted", true);
      await tx.execute(sql`ROLLBACK TO SAVEPOINT a`);
    } catch (e: any) { await tx.execute(sql`ROLLBACK TO SAVEPOINT a`); ok("a real CNY invoice with a dated, sourced rate is accepted", false, e.message); }

    const n: any = await tx.execute(sql`SELECT count(*)::int n FROM print_expenses WHERE currency <> 'NZD'`);
    ok("every existing expense stays NZD — nothing was reinterpreted", Number((n.rows ?? n)[0].n) === 0);
    if (DRY) throw new Error("__ROLLBACK__");
  }).catch((e: any) => { if (e?.message !== "__ROLLBACK__") throw e; });
  console.log(`\n${pass} passed, ${fail} failed${DRY ? " — NOTHING WRITTEN" : ""}\n`);
  process.exit(fail ? 1 : 0);
}
main();

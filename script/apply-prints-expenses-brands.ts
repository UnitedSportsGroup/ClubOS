/**
 * Applies migrations/2026-09-16_prints_expenses_brands.sql and proves it.
 *   npx tsx --env-file=.env script/apply-prints-expenses-brands.ts [--dry-run]
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

const DRY = process.argv.includes("--dry-run");
let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); good ? pass++ : fail++; };

async function main() {
  const ddl = fs.readFileSync(path.join(process.cwd(), "migrations/2026-09-16_prints_expenses_brands.sql"), "utf8");
  const outside = ddl.replace(/DO\s*\$\$[\s\S]*?\$\$\s*;/gi, "");
  if (/^\s*(BEGIN|COMMIT)\b/im.test(outside)) throw new Error("migration carries its own BEGIN/COMMIT");

  console.log(`\nUnited Prints — expense brands + quote fields — ${DRY ? "DRY RUN (rolled back)" : "APPLYING"}\n`);
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(ddl));

    const t: any = await tx.execute(sql`SELECT to_regclass('print_expense_allocations') AS t`);
    ok("print_expense_allocations exists", (t.rows ?? t)[0]?.t != null);

    const c: any = await tx.execute(sql`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name='print_quotes' AND column_name IN ('customer_company','heard_about')`);
    const cols = (c.rows ?? c) as any[];
    ok("print_quotes.customer_company exists, nullable", cols.some((x) => x.column_name === "customer_company" && x.is_nullable === "YES"));
    ok("print_quotes.heard_about exists, nullable", cols.some((x) => x.column_name === "heard_about" && x.is_nullable === "YES"));

    const [{ id: expenseId }]: any = ((await tx.execute(sql`SELECT id FROM print_expenses ORDER BY id LIMIT 1`)).rows ?? []) as any[];
    ok("there is an expense to test against", expenseId != null, String(expenseId));

    const refused = async (label: string, stmt: any) => {
      await tx.execute(sql`SAVEPOINT s`);
      try { await tx.execute(stmt); await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); ok(label, false, "ACCEPTED"); }
      catch { await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); ok(label, true); }
    };
    await refused("a zero allocation is refused", sql`
      INSERT INTO print_expense_allocations (expense_id, brand, amount_cents) VALUES (${expenseId}, 'cufc', 0)`);
    await refused("a negative allocation is refused", sql`
      INSERT INTO print_expense_allocations (expense_id, brand, amount_cents) VALUES (${expenseId}, 'cufc', -100)`);
    await refused("the same brand twice on one expense is refused", sql`
      INSERT INTO print_expense_allocations (expense_id, brand, amount_cents)
      VALUES (${expenseId}, 'cufc', 100), (${expenseId}, 'cufc', 200)`);

    await tx.execute(sql`SAVEPOINT a`);
    try {
      await tx.execute(sql`
        INSERT INTO print_expense_allocations (expense_id, brand, amount_cents)
        VALUES (${expenseId}, 'cic', 66000), (${expenseId}, 'ethniccup', 66000)`);
      const n: any = await tx.execute(sql`SELECT count(*)::int n FROM print_expense_allocations WHERE expense_id=${expenseId}`);
      ok("one invoice CAN be split across two brands", Number((n.rows ?? n)[0].n) === 2);
      await tx.execute(sql`ROLLBACK TO SAVEPOINT a`);
    } catch (e: any) { await tx.execute(sql`ROLLBACK TO SAVEPOINT a`); ok("one invoice CAN be split across two brands", false, e.message); }

    const orphan: any = await tx.execute(sql`SELECT count(*)::int n FROM print_expense_allocations`);
    ok("nothing is allocated by default — the six on file stay unassigned", Number((orphan.rows ?? orphan)[0].n) === 0);

    if (DRY) { console.log("\n  (rolling back — dry run)"); throw new Error("__ROLLBACK__"); }
  }).catch((e: any) => { if (e?.message !== "__ROLLBACK__") throw e; });

  console.log(`\n${pass} passed, ${fail} failed${DRY ? " — NOTHING WRITTEN" : ""}\n`);
  process.exit(fail ? 1 : 0);
}
main();

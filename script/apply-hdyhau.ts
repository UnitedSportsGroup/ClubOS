// Add registrations.referral_detail ("How did you hear about us?" → Other text).
//   npx tsx --env-file=.env script/apply-hdyhau.ts            ← rehearsal (rolls back)
//   npx tsx --env-file=.env script/apply-hdyhau.ts --commit   ← applies
// Additive and nullable. The code tolerates the column being absent, so this can
// run before or after the deploy.
import fs from "node:fs"; import path from "node:path"; import { Client } from "pg";
const COMMIT = process.argv.includes("--commit");
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL lock_timeout = '5s'");
    const sqlText = fs.readFileSync(path.resolve(process.cwd(), "migrations/2026-10-20_hdyhau_detail.sql"), "utf8");
    if (/^\s*(BEGIN|COMMIT)\b/im.test(sqlText)) throw new Error("migration must not carry its own BEGIN/COMMIT");
    await c.query(sqlText);
    let pass = 0, fail = 0;
    const check = (name: string, ok: boolean) => { console.log(`  ${ok ? "✅" : "❌"} ${name}`); ok ? pass++ : fail++; };
    const col = await c.query(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_name='registrations' AND column_name='referral_detail'`);
    check("registrations.referral_detail exists", col.rows.length === 1);
    check("it is text", col.rows[0]?.data_type === "text");
    check("it is nullable", col.rows[0]?.is_nullable === "YES");
    check("it has no default", col.rows[0]?.column_default == null);
    const filled = await c.query(`SELECT count(*)::int n FROM registrations WHERE referral_detail IS NOT NULL`);
    check("no existing row was given a value", filled.rows[0].n === 0);
    // Idempotent: running it twice is harmless.
    await c.query(sqlText);
    check("re-running the migration is a no-op", true);
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) { await c.query("ROLLBACK"); process.exit(1); }
    if (COMMIT) { await c.query("COMMIT"); console.log("🟢 COMMITTED"); }
    else { await c.query("ROLLBACK"); console.log("↩️  rolled back (rehearsal). Re-run with --commit to apply."); }
  } catch (e: any) { await c.query("ROLLBACK").catch(() => {}); console.error("FATAL", e?.message); process.exit(1); }
  finally { await c.end(); }
  process.exit(0);
})();

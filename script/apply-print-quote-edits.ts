// Applies migrations/2026-10-02_print_quote_edits.sql. Dry-run by default (one
// transaction, rolled back); --commit to keep it.
import fs from "fs"; import path from "path"; import pg from "pg"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes("--commit");
const sqlText = fs.readFileSync(path.join(__dirname, "../migrations/2026-10-02_print_quote_edits.sql"), "utf8");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let fail = 0; const ok = (b: boolean, m: string) => { if (!b) fail++; console.log(`${b ? "✓" : "✗"} ${m}`); };
await c.connect(); await c.query("BEGIN");
try {
  const bad = (await c.query(`SELECT (SELECT count(*) FROM print_quotes WHERE subtotal_cents<0 OR gst_cents<0 OR total_cents<0)::int q, (SELECT count(*) FROM print_quote_items WHERE line_ex_gst_cents<0 OR quantity<1)::int i`)).rows[0];
  ok(bad.q === 0 && bad.i === 0, `no existing row breaks the new checks (quotes ${bad.q}, items ${bad.i})`);
  await c.query(sqlText);
  const cols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='print_quotes' AND column_name IN ('original_subtotal_cents','original_total_cents','edited_at','edited_by')`)).rowCount;
  ok(cols === 4, "four new columns");
  const nulls = (await c.query(`SELECT count(*)::int n FROM print_quotes WHERE edited_at IS NOT NULL OR original_total_cents IS NOT NULL`)).rows[0].n;
  ok(nulls === 0, "every existing quote reads as never edited");
  await c.query("SAVEPOINT t");
  try { await c.query(`UPDATE print_quote_items SET line_ex_gst_cents=-1 WHERE id=(SELECT min(id) FROM print_quote_items)`); ok(false, "refuses a negative line"); }
  catch { ok(true, "refuses a negative line"); }
  await c.query("ROLLBACK TO SAVEPOINT t");
  if (fail) throw new Error(`${fail} failed`);
  await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
  console.log(COMMIT ? "COMMITTED" : "dry run OK — rolled back (pass --commit)");
} catch (e) { await c.query("ROLLBACK"); console.error(e); process.exitCode = 1; } finally { await c.end(); }

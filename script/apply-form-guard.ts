// Anti-spam for every public form that emails the address typed into it.
//   npx tsx --env-file=.env script/apply-form-guard.ts [--commit]
//
// Dry run by default: applies the migration inside a transaction, proves it, and
// rolls back. The migration carries no BEGIN/COMMIT of its own — one that does
// ends the wrapper's transaction and the rollback then runs in autocommit.
import fs from "node:fs"; import path from "node:path"; import { Client } from "pg";
const COMMIT = process.argv.includes("--commit");
let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n} ${d}`); } };

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect(); await c.query("BEGIN");
  try {
    await c.query(fs.readFileSync(path.resolve(process.cwd(), "migrations/2026-09-10_public_form_guard.sql"), "utf8"));

    console.log("\nThe table");
    const cols = await c.query(`SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name='public_form_submissions'`);
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
    for (const col of ["id", "form", "ip", "email", "outcome", "reasons", "page", "created_at"]) ok(`has ${col}`, Boolean(byName[col]));
    ok("form is NOT NULL — a log row that cannot say which form is useless", byName.form?.is_nullable === "NO");
    ok("outcome is NOT NULL", byName.outcome?.is_nullable === "NO");
    ok("reasons is an array, not a joined string", byName.reasons?.data_type === "ARRAY");

    console.log("\nIndexes — the rate check runs on every public submission");
    const idx = await c.query(`SELECT indexname FROM pg_indexes WHERE tablename='public_form_submissions'`);
    const names = idx.rows.map((r) => r.indexname);
    for (const n of ["public_form_submissions_ip_idx", "public_form_submissions_email_idx", "public_form_submissions_form_idx"]) ok(n, names.includes(n));

    console.log("\nRLS");
    const rls = await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname='public_form_submissions'`);
    ok("row level security is on", rls.rows[0]?.relrowsecurity === true);

    console.log("\nIt actually records and counts");
    await c.query(`INSERT INTO public_form_submissions (form, ip, email, outcome, reasons, page)
                   VALUES ('mfl_waitlist','198.51.100.1','A@Example.com','held', ARRAY['random_text','no_form_token'], '/waitlist')`);
    const read = await c.query(`SELECT form, email, outcome, reasons FROM public_form_submissions WHERE ip='198.51.100.1'`);
    ok("the row reads back", read.rows.length === 1);
    ok("reasons survive as an array", Array.isArray(read.rows[0]?.reasons) && read.rows[0].reasons.length === 2);
    // The guard lower()s the email on the way in; the index is on lower(email).
    const cnt = await c.query(`SELECT count(*) FILTER (WHERE ip='198.51.100.1' AND created_at > now() - interval '1 hour') AS ip_hour,
                                      count(*) FILTER (WHERE lower(email)='a@example.com') AS by_email
                               FROM public_form_submissions`);
    ok("the hourly IP count sees it", Number(cnt.rows[0].ip_hour) === 1);
    ok("the email lookup is case-insensitive", Number(cnt.rows[0].by_email) === 1);

    console.log(`\n${pass} passed, ${fails.length} failed`);
    if (fails.length) { for (const f of fails) console.log(`  FAILED: ${f}`); await c.query("ROLLBACK"); process.exit(1); }
    if (COMMIT) {
      // The rehearsal row must never survive into production.
      await c.query(`DELETE FROM public_form_submissions WHERE ip='198.51.100.1'`);
      await c.query("COMMIT"); console.log("\n🟢 COMMITTED (rehearsal row removed)");
    } else { await c.query("ROLLBACK"); console.log("\n↩️  rolled back — rehearsal only. Re-run with --commit."); }
  } catch (e: any) { await c.query("ROLLBACK"); console.error("FATAL", e?.message); process.exit(1); }
  finally { await c.end(); }
  process.exit(0);
})();

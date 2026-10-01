// Apply the mailer_templates migration. Rehearsal by default (rolled back);
// --commit to keep it. One dedicated client so BEGIN covers every statement.
//   npx tsx --env-file=.env script/apply-mailer-templates.ts [--commit]
import { Pool } from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const COMMIT = process.argv.includes("--commit");
const ddl = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "2026-10-02_mailer_templates.sql"), "utf8");
if (/^\s*(BEGIN|COMMIT)\s*;/im.test(ddl)) { console.error("migration carries its own BEGIN/COMMIT — refusing"); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const c = await pool.connect();
let fails = 0;
const check = (ok: boolean, l: string) => { if (!ok) fails++; console.log(`${ok ? "  ok " : " FAIL"}  ${l}`); };
async function refused(l: string, q: string, p: any[] = []) {
  await c.query("SAVEPOINT s");
  try { await c.query(q, p); check(false, `${l} — was ACCEPTED`); } catch { check(true, l); }
  await c.query("ROLLBACK TO SAVEPOINT s");
}
try {
  console.log(COMMIT ? "\nAPPLYING\n" : "\nREHEARSAL — rolled back\n");
  await c.query("BEGIN");
  await c.query(ddl);
  const r = await c.query("SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('mailer_templates')");
  check(r.rows[0]?.relrowsecurity === true, "table exists, RLS on");
  const org = (await c.query("SELECT id FROM organizations ORDER BY id LIMIT 1")).rows[0].id;
  await c.query(`INSERT INTO mailer_templates (organization_id, name, body_doc, body_html) VALUES ($1,'Term letter','{}'::jsonb,'<p>Hi</p>')`, [org]);
  check(true, "a template saves");
  await refused("a second live template with the same name (any case) is refused",
    `INSERT INTO mailer_templates (organization_id, name, body_doc, body_html) VALUES ($1,' term LETTER ','{}'::jsonb,'<p>x</p>')`, [org]);
  await refused("a blank name is refused", `INSERT INTO mailer_templates (organization_id, name, body_doc, body_html) VALUES ($1,'  ','{}'::jsonb,'<p>x</p>')`, [org]);
  await refused("an empty email is refused", `INSERT INTO mailer_templates (organization_id, name, body_doc, body_html) VALUES ($1,'Empty','{}'::jsonb,'  ')`, [org]);
  await c.query(`UPDATE mailer_templates SET archived_at = now() WHERE organization_id=$1 AND name='Term letter'`, [org]);
  await c.query(`INSERT INTO mailer_templates (organization_id, name, body_doc, body_html) VALUES ($1,'Term letter','{}'::jsonb,'<p>v2</p>')`, [org]);
  check(true, "an archived name can be reused");
  await c.query(`DELETE FROM mailer_templates WHERE organization_id=$1 AND name='Term letter'`, [org]);
  if (fails) { await c.query("ROLLBACK"); console.error(`\n${fails} FAILED — rolled back`); process.exit(1); }
  await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
  console.log(COMMIT ? "\nCommitted.\n" : "\nRolled back. Re-run with --commit.\n");
} catch (e: any) { await c.query("ROLLBACK").catch(() => {}); console.error("FAILED:", e.message); process.exit(1); }
finally { c.release(); await pool.end(); }

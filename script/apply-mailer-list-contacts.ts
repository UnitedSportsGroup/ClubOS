// Creates mailer_list_contacts and loads the MFL "schools" list
// (Connor's Football in Schools primary-school database, forwarded by Isaac
// 22 Sep 2026). Dry-run by default: everything runs inside one transaction
// that is rolled back. --commit to keep it. Idempotent (ON CONFLICT DO NOTHING).
//   npx tsx --env-file=.env script/apply-mailer-list-contacts.ts [--commit]
import fs from "fs";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMMIT = process.argv.includes("--commit");
const MFL_ORG_ID = 3;
const LIST = "schools";
const ROLE: Record<string, string> = { office: "School office", sports: "Sports coordinator", principal: "Principal" };

const sqlFile = fs.readFileSync(path.join(__dirname, "../migrations/2026-10-02_mailer_list_contacts.sql"), "utf8");
if (/\b(BEGIN|COMMIT)\s*;/i.test(sqlFile)) throw new Error("migration must not carry its own BEGIN/COMMIT");
const rows: { email: string; school: string; role: string }[] =
  JSON.parse(fs.readFileSync(path.join(__dirname, "data/mfl-primary-schools-2026-09.json"), "utf8"));

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const check = (ok: boolean, msg: string) => { ok ? pass++ : fail++; console.log(`${ok ? "✓" : "✗"} ${msg}`); };
async function refused(label: string, q: string, params: any[]) {
  await c.query("SAVEPOINT t");
  try { await c.query(q, params); check(false, `refused: ${label}`); }
  catch { check(true, `refused: ${label}`); }
  await c.query("ROLLBACK TO SAVEPOINT t");
}

await c.connect();
await c.query("BEGIN");
try {
  await c.query(sqlFile);
  let added = 0;
  for (const r of rows) {
    const res = await c.query(
      `INSERT INTO mailer_list_contacts (organization_id, list_key, email, organisation, role, source)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (organization_id, list_key, email) DO NOTHING`,
      [MFL_ORG_ID, LIST, r.email.trim().toLowerCase(), r.school, ROLE[r.role] || "School", "fis-primary-schools-2026-09 (Connor via Isaac)"]);
    added += res.rowCount ?? 0;
  }
  const { rows: [n] } = await c.query(`SELECT count(*)::int n, count(DISTINCT organisation)::int schools FROM mailer_list_contacts WHERE organization_id=$1 AND list_key=$2`, [MFL_ORG_ID, LIST]);
  console.log(`added ${added} · list now ${n.n} addresses across ${n.schools} schools`);
  check(n.n === new Set(rows.map((r) => r.email.toLowerCase())).size, `list holds every distinct address (${n.n})`);
  const { rows: [rls] } = await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname='mailer_list_contacts'`);
  check(rls.relrowsecurity === true, "RLS is on");
  await refused("an upper-case email", `INSERT INTO mailer_list_contacts (organization_id,list_key,email,source) VALUES ($1,$2,'Office@X.school.nz','t')`, [MFL_ORG_ID, LIST]);
  await refused("a non-email", `INSERT INTO mailer_list_contacts (organization_id,list_key,email,source) VALUES ($1,$2,'via school office','t')`, [MFL_ORG_ID, LIST]);
  await refused("the same address twice in one list", `INSERT INTO mailer_list_contacts (organization_id,list_key,email,source) VALUES ($1,$2,$3,'t')`, [MFL_ORG_ID, LIST, rows[0].email.toLowerCase()]);
  // Never overlaps the captains/players audience by construction — report any address that is both.
  const { rows: both } = await c.query(
    `SELECT m.email FROM mailer_list_contacts m WHERE m.organization_id=$1 AND m.list_key=$2
       AND EXISTS (SELECT 1 FROM league_teams t WHERE lower(t.contact_email)=m.email)`, [MFL_ORG_ID, LIST]);
  console.log(`addresses that are also an MFL captain: ${both.length}${both.length ? " → " + both.map((b) => b.email).join(", ") : ""}`);
  if (fail) throw new Error(`${fail} check(s) failed`);
  await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
  console.log(COMMIT ? `COMMITTED · ${pass} checks` : `dry run OK · ${pass} checks · rolled back (pass --commit)`);
} catch (e) {
  await c.query("ROLLBACK");
  console.error(e); process.exitCode = 1;
} finally { await c.end(); }

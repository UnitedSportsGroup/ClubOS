// 25 Nov 2026 — the app update from the Michael + Adria meeting:
//   1. migration (staff logins, report alerts)   2. the stored daily form brought up to the
//   template's revision (staff-added questions kept, hidden)   3. optional TEST coach login.
//   npx tsx --env-file=.env script/apply-perf-app-staff.ts [--commit] [--test-coach]
// Dry run by default: everything runs inside one transaction and is rolled back.
import pg from "pg"; import fs from "fs"; import crypto from "crypto";
import { FORM_TEMPLATES, allQuestions, formProblem, type FormDef } from "../shared/perf-forms";
const commit = process.argv.includes("--commit"), testCoach = process.argv.includes("--test-coach");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const hash = (p: string) => { const salt = crypto.randomBytes(16).toString("hex"); return `s1$${salt}$${crypto.scryptSync(p, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex")}`; };
(async () => {
  const c = await pool.connect(); await c.query("begin");
  let fail = 0; const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fail++; };
  try {
    await c.query(fs.readFileSync("migrations/2026-11-25_performance_app_staff.sql", "utf8"));
    const { rows: [org] } = await c.query(`select id from organizations where slug = 'south-island-united'`);
    const { rows: [admin] } = await c.query(`select id from users where role='super_admin' order by id limit 1`);
    const refused = async (sql: string, params: unknown[], what: string) => {
      await c.query("savepoint s"); let ok = false;
      try { await c.query(sql, params); } catch { ok = true; }
      await c.query("rollback to savepoint s"); check(ok, `refused: ${what}`);
    };
    const { rows: [acct] } = await c.query(`select id from perf_athlete_accounts limit 1`);
    if (acct) {
      await refused(`update perf_athlete_accounts set staff_role='owner' where id=$1`, [acct.id], "an unknown staff role");
      await refused(`update perf_athlete_accounts set notify_reports=true, staff_role=null where id=$1`, [acct.id], "report alerts on a player's account");
    }
    const { rows: forms } = await c.query(`select * from perf_forms where organization_id=$1 and archived_at is null`, [org.id]);
    for (const f of forms) {
      const tpl = FORM_TEMPLATES.find((t) => t.key === (f.template_key ?? f.key));
      const cur = f.definition as FormDef;
      if (!tpl || (cur.revision ?? 1) >= (tpl.revision ?? 1)) { console.log(`form ${f.key}: already at revision ${cur.revision ?? 1}`); continue; }
      const tplIds = new Set(allQuestions(tpl).map((x) => x.id));
      const extras = allQuestions(cur).filter((x) => !tplIds.has(x.id)).map((x) => ({ ...x, hidden: true, showIf: undefined }));
      const def: FormDef = JSON.parse(JSON.stringify(tpl));
      if (extras.length) def.sections.push({ id: "kept", title: "Kept from earlier (hidden)", questions: extras });
      check(formProblem(def) == null, `form ${f.key}: new definition is well formed`);
      const lost = allQuestions(cur).filter((x) => !allQuestions(def).some((y) => y.id === x.id));
      check(lost.length === 0, `form ${f.key}: no question id dropped`);
      const version = f.version + 1;
      await c.query(`update perf_forms set definition=$1, title=$2, version=$3, updated_by=$4, updated_at=now() where id=$5`, [JSON.stringify(def), def.title, version, admin.id, f.id]);
      await c.query(`insert into perf_form_versions (form_id, version, definition, saved_by) values ($1,$2,$3,$4)`, [f.id, version, JSON.stringify(def), admin.id]);
      console.log(`form ${f.key}: v${f.version} -> v${version} (revision ${tpl.revision}); kept hidden: ${extras.map((x) => x.id).join(", ") || "none"}`);
    }
    if (testCoach) {
      const email = "test.coach@siu.test";
      let { rows: [t] } = await c.query(`select id from contacts where email=$1`, [email]);
      if (!t) ({ rows: [t] } = await c.query(`insert into contacts (type,first_name,last_name,email,notes) values ('staff','Test','Coach',$1,'Test coach login for the SIU Performance app, 25 Nov 2026. Not a real person.') returning id`, [email]));
      const pw = "Siu-" + crypto.randomBytes(4).toString("hex");
      await c.query(`insert into perf_athlete_accounts (organization_id,contact_id,email,invited_by,password_hash,staff_role) values ($1,$2,$3,$4,$5,'coach')
        on conflict (organization_id, contact_id) do update set password_hash=excluded.password_hash, staff_role='coach', disabled_at=null`, [org.id, t.id, email, admin.id, hash(pw)]);
      console.log(JSON.stringify({ testCoach: email, password: pw }));
    }
    if (fail) throw new Error(`${fail} check(s) failed`);
    await c.query(commit ? "commit" : "rollback"); console.log(commit ? "COMMITTED" : "dry run: rolled back");
  } catch (e) { await c.query("rollback"); console.error(e); process.exitCode = 1; } finally { c.release(); await pool.end(); }
})();

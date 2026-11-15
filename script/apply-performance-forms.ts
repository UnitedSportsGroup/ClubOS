// Apply migrations/2026-11-14_performance_forms.sql and seed Rowan's
// "SI United Check In" as SIU's daily form. Rehearses first.
//
//   npx tsx --env-file=.env script/apply-performance-forms.ts            (dry run, rolled back)
//   npx tsx --env-file=.env script/apply-performance-forms.ts --commit
//
// Seeding never overwrites a form staff have already edited (it only inserts).
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";
import { SI_UNITED_CHECK_IN, formProblem } from "../shared/perf-forms";

const COMMIT = process.argv.includes("--commit");

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-11-14_performance_forms.sql"), "utf8");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`\n  performance forms — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  const problems: string[] = [];
  await client.query("BEGIN");
  try {
    const bad = formProblem(SI_UNITED_CHECK_IN);
    if (bad) throw new Error(`the template itself is broken: ${bad}`);
    await client.query(sql);
    console.log("  migration ran");

    for (const t of ["perf_forms", "perf_form_versions", "perf_form_responses", "perf_saved_reports"]) {
      const r = await client.query(`select relrowsecurity from pg_class where relname = $1 and relkind = 'r'`, [t]);
      if (!r.rowCount) problems.push(`${t} does not exist`);
      else if (!r.rows[0].relrowsecurity) problems.push(`${t} has RLS OFF`);
    }

    const { rows: [org] } = await client.query(`select id from organizations where slug = 'south-island-united'`);
    if (!org) throw new Error("SIU organisation missing");
    const { rows: [daniel] } = await client.query(`select id from users where role = 'super_admin' order by id limit 1`);
    const ins = await client.query(`
      insert into perf_forms (organization_id, key, title, definition, version, is_daily, template_key, updated_by)
      values ($1,$2,$3,$4,1,true,$2,$5)
      on conflict (organization_id, key) do nothing returning id`,
      [org.id, SI_UNITED_CHECK_IN.key, SI_UNITED_CHECK_IN.title, JSON.stringify(SI_UNITED_CHECK_IN), daniel.id]);
    if (ins.rowCount) {
      await client.query(`insert into perf_form_versions (form_id, version, definition, saved_by) values ($1,1,$2,$3)`,
        [ins.rows[0].id, JSON.stringify(SI_UNITED_CHECK_IN), daniel.id]);
      console.log(`  seeded "${SI_UNITED_CHECK_IN.title}" as the daily form (id ${ins.rows[0].id})`);
    } else console.log("  form already there — left exactly as staff have it");
    const { rows: [form] } = await client.query(`select id from perf_forms where organization_id = $1 and key = $2`, [org.id, SI_UNITED_CHECK_IN.key]);

    // ── invariants the database must REFUSE ──
    const { rows: [c] } = await client.query(`select id from contacts order by id limit 1`);
    await client.query("SAVEPOINT fx");
    await client.query(`insert into perf_form_responses (organization_id, form_id, form_version, contact_id, entry_date, answers, entered_by_athlete)
                        values ($1,$2,1,$3,'2000-01-01','{}',true)`, [org.id, form.id, c.id]);
    const refuses = async (label: string, stmt: string, params: any[]) => {
      await client.query("SAVEPOINT probe");
      try { await client.query(stmt, params); problems.push(`${label} was ACCEPTED — it must be refused`); }
      catch { console.log(`  ✓ refuses ${label}`); }
      await client.query("ROLLBACK TO SAVEPOINT probe");
    };
    await refuses("a second response for the same player, form and day",
      `insert into perf_form_responses (organization_id, form_id, form_version, contact_id, entry_date, answers, entered_by_athlete) values ($1,$2,1,$3,'2000-01-01','{}',true)`, [org.id, form.id, c.id]);
    await refuses("a response that says nobody entered it",
      `insert into perf_form_responses (organization_id, form_id, form_version, contact_id, entry_date, answers) values ($1,$2,1,$3,'2000-01-02','{}')`, [org.id, form.id, c.id]);
    await refuses("a real (non-test) response with no player",
      `insert into perf_form_responses (organization_id, form_id, form_version, entry_date, answers, entered_by_athlete) values ($1,$2,1,'2000-01-03','{}',true)`, [org.id, form.id]);
    await refuses("a flag level that isn't red or amber",
      `insert into perf_form_responses (organization_id, form_id, form_version, contact_id, entry_date, answers, entered_by_athlete, flag_level) values ($1,$2,1,$3,'2000-01-04','{}',true,'green')`, [org.id, form.id, c.id]);
    await refuses("a second daily form for SIU",
      `insert into perf_forms (organization_id, key, title, definition, is_daily) values ($1,'second-daily','x','{}',true)`, [org.id]);
    await refuses("a form key with spaces",
      `insert into perf_forms (organization_id, key, title, definition) values ($1,'bad key','x','{}')`, [org.id]);
    await client.query("SAVEPOINT probe");
    await client.query(`insert into perf_form_responses (organization_id, form_id, form_version, entry_date, answers, entered_by, is_test) values ($1,$2,1,'2000-01-01','{}',$3,true)`, [org.id, form.id, daniel.id]);
    await client.query(`insert into perf_form_responses (organization_id, form_id, form_version, entry_date, answers, entered_by, is_test) values ($1,$2,1,'2000-01-01','{}',$3,true)`, [org.id, form.id, daniel.id]);
    console.log("  ✓ accepts test responses with no player");
    await client.query("ROLLBACK TO SAVEPOINT probe");
    await client.query("ROLLBACK TO SAVEPOINT fx");

    if (problems.length) throw new Error(problems.join("\n  "));
    await client.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(`\n  ${COMMIT ? "committed" : "rehearsal clean — rolled back"}\n`);
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`\n  ✗ ${e.message}\n`);
    process.exitCode = 1;
  } finally { await client.end(); }
}
main();

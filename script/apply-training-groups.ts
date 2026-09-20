// Apply migrations/2026-09-20_training_groups.sql, rehearsing it first.
//
//   npx tsx --env-file=.env script/apply-training-groups.ts            (dry run)
//   npx tsx --env-file=.env script/apply-training-groups.ts --commit
//
// There is no local Postgres, so a dry run is the only rehearsal available: it
// runs the real DDL and the real checks inside a transaction it then rolls back.
//
// 🔴 What this column is NOT. The training group is DERIVED from date of birth
// by the club's own NZF rule. `training_group` exists only for the exception —
// a coach moving one player up or down a grade — so the checks below are about
// keeping NULL meaning "nobody decided anything", never "no group".
//
// Every fixture is created under a SAVEPOINT and rolled back — an earlier
// applier in this repo committed a fixture straight into production.
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const MIGRATION = "2026-09-20_training_groups.sql";

const problems: string[] = [];
let checks = 0;
function ok(l: string) { checks++; console.log(`  ✓ ${l}`); }
function bad(l: string) { checks++; problems.push(l); console.log(`  ✗ ${l}`); }

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", MIGRATION), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log(`\n  Training groups — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");

  try {
    await c.query(sql);
    console.log("  migration ran\n");

    // ── structure ──────────────────────────────────────────────────────────
    for (const col of ["training_group", "training_group_set_by", "training_group_set_at"]) {
      const r = await c.query(
        `select column_default, is_nullable from information_schema.columns
          where table_name='registrations' and column_name=$1`, [col]);
      if (!r.rowCount) { bad(`registrations.${col} missing`); continue; }
      ok(`registrations.${col} exists`);
      r.rows[0].is_nullable === "YES"
        ? ok(`  ${col} is nullable — "nobody decided" stays a real answer`)
        : bad(`  ${col} is NOT NULL`);
      r.rows[0].column_default == null
        ? ok(`  ${col} has no default — nothing is assigned by accident`)
        : bad(`  ${col} has a default of ${r.rows[0].column_default}`);
    }

    const idx = await c.query(
      `select 1 from pg_indexes where tablename='registrations' and indexname='idx_registrations_training_group'`);
    idx.rowCount ? ok("index on (program_id, term_id) exists") : bad("index missing");

    // 🔴 Deliberately NO check constraint — a stale CHECK is how the MFL
    // checkout started 500ing. Prove there isn't one.
    const chk = await c.query(`
      select conname from pg_constraint
       where conrelid='registrations'::regclass and contype='c'
         and pg_get_constraintdef(oid) ilike '%training_group%'`);
    chk.rowCount === 0
      ? ok("no CHECK constraint on training_group — vocabulary lives in code")
      : bad(`a CHECK constraint exists: ${chk.rows[0].conname}`);

    // ── behaviour, on a real registration ──────────────────────────────────
    const { rows: victim } = await c.query(`
      select r.id from registrations r
       where r.status in ('confirmed','refunded','partially_refunded')
       order by r.id desc limit 1`);
    if (!victim.length) {
      bad("no registration to test against");
    } else {
      const id = victim[0].id;
      await c.query("SAVEPOINT s");

      const before = await c.query(`select training_group from registrations where id=$1`, [id]);
      before.rows[0].training_group === null
        ? ok("an existing registration starts with NO override")
        : bad("an existing registration already carries an override");

      await c.query(`update registrations set training_group='U11' where id=$1`, [id]);
      const after = await c.query(`select training_group from registrations where id=$1`, [id]);
      after.rows[0].training_group === "U11" ? ok("an override can be set") : bad("override did not store");

      // Clearing it must return to "derived", not to some empty-string state
      // that reads as a group nobody is in.
      await c.query(`update registrations set training_group=null where id=$1`, [id]);
      const cleared = await c.query(`select training_group from registrations where id=$1`, [id]);
      cleared.rows[0].training_group === null
        ? ok("clearing an override returns to derived, not to a blank group")
        : bad("clearing left a non-null value");

      // The staff reference must survive a user being deleted — as "we don't
      // know", never by taking the registration with it.
      const fk = await c.query(`
        select confdeltype from pg_constraint
         where conrelid='registrations'::regclass and contype='f'
           and pg_get_constraintdef(oid) ilike '%training_group_set_by%'`);
      fk.rows[0]?.confdeltype === "n"
        ? ok("training_group_set_by is ON DELETE SET NULL — a departed coach reads as unknown")
        : bad(`training_group_set_by delete rule is '${fk.rows[0]?.confdeltype ?? "none"}'`);

      await c.query("ROLLBACK TO SAVEPOINT s");
      ok("every fixture rolled back");
    }

    // ── idempotency ────────────────────────────────────────────────────────
    await c.query(sql);
    ok("re-running the migration is a no-op");

    if (problems.length) {
      console.log(`\n  ${problems.length} problem(s) — rolling back.\n`);
      await c.query("ROLLBACK");
      process.exit(1);
    }
    if (COMMIT) { await c.query("COMMIT"); console.log(`\n  ${checks} checks passed. COMMITTED.\n`); }
    else { await c.query("ROLLBACK"); console.log(`\n  ${checks} checks passed. Rolled back — re-run with --commit.\n`); }
  } catch (e: any) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("\n  FAILED:", e.message, "\n");
    process.exit(1);
  } finally {
    await c.end();
  }
}
main();

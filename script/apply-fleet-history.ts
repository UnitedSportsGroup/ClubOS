// Apply migrations/2026-09-21_fleet_history.sql, rehearsing it first.
//
//   npx tsx --env-file=.env script/apply-fleet-history.ts            (dry run)
//   npx tsx --env-file=.env script/apply-fleet-history.ts --commit
//
// There is no local Postgres, so the dry run IS the rehearsal: it runs the real
// DDL and the real behavioural checks inside a transaction it rolls back.
//
// 🔴 The behavioural checks are the point. What must be REFUSED:
//   1. two holders of the same vehicle on overlapping dates  (the new rule)
//   2. an assignment returned before it was assigned
//   3. an agreement expiring before it was signed
//   4. an agreement that is neither a file nor a note
//   5. a condition photo dated in the future
//
// And what must be ACCEPTED, each easy to break by accident:
//   A. a handover with no daylight — returned Monday, reassigned Tuesday
//   B. the same holder on the SAME vehicle twice, at different times
//   C. the same dates on a DIFFERENT vehicle
//   D. an open assignment after a closed one
//   E. re-running the whole migration
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const MIGRATION = "2026-09-21_fleet_history.sql";
const problems: string[] = [];
let checks = 0;
const ok = (l: string) => { checks++; console.log(`  ✓ ${l}`); };
const bad = (l: string) => { checks++; problems.push(l); console.log(`  ✗ ${l}`); };

async function mustRefuse(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try {
    await c.query(sql, params);
    await c.query("ROLLBACK TO SAVEPOINT s");
    bad(`${label} — was ALLOWED, and must not be`);
  } catch {
    await c.query("ROLLBACK TO SAVEPOINT s");
    ok(`refused: ${label}`);
  }
}
async function mustAccept(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try {
    await c.query(sql, params);
    await c.query("ROLLBACK TO SAVEPOINT s");
    ok(`accepted: ${label}`);
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT s");
    bad(`${label} — was REFUSED: ${e.message}`);
  }
}

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", MIGRATION), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log(`\n  Vehicle history — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");

  try {
    await c.query(sql);
    console.log("  migration ran\n");

    // ── structure ──────────────────────────────────────────────────────────
    const col = await c.query(`select is_nullable, column_default from information_schema.columns
      where table_name='fleet_vehicles' and column_name='parked_location'`);
    col.rowCount ? ok("fleet_vehicles.parked_location exists") : bad("parked_location missing");
    col.rows[0]?.is_nullable === "YES" ? ok("  nullable — \"nobody has said\" stays a real answer") : bad("  NOT NULL");
    col.rows[0]?.column_default == null ? ok("  no default — no vehicle is assumed to live anywhere") : bad("  has a default");

    for (const t of ["fleet_agreements", "fleet_condition_media", "fleet_drivers"]) {
      const r = await c.query(`select 1 from information_schema.tables where table_name=$1`, [t]);
      r.rowCount ? ok(`${t} exists`) : bad(`${t} was not created`);
      const rls = await c.query(`select relrowsecurity from pg_class where relname=$1`, [t]);
      rls.rows[0]?.relrowsecurity ? ok(`  ${t} has RLS on`) : bad(`  ${t} has RLS OFF`);
    }

    const ex = await c.query(`select conname from pg_constraint
      where conrelid='fleet_assignments'::regclass and conname='fleet_assignments_no_overlap'`);
    ex.rowCount ? ok("the no-overlap exclusion constraint exists") : bad("no-overlap constraint missing");

    // ── behaviour, against a REAL vehicle, all rolled back ─────────────────
    const { rows: v } = await c.query(`select id, organization_id from fleet_vehicles order by id limit 2`);
    // ⚠️ Test D needs a vehicle with NO open assignment. Every vehicle in daily
    // use has one, and a second open row is then refused by BOTH rules — which
    // made the first version of this check fail on a fact about the fleet
    // rather than about the schema. Assert the shape, not this week's data.
    // …and it must start AFTER that vehicle's last closed stint, or the new
    // exclusion constraint refuses it for a second, equally correct reason.
    const { rows: free } = await c.query(`
      select fv.id, fv.organization_id,
             (coalesce(max(a.returned_on) + 1, current_date))::text as free_from   -- ::text, or pg hands back a JS Date and String() gives "Fri Jul 31"
        from fleet_vehicles fv
        left join fleet_assignments a on a.vehicle_id = fv.id
       where not exists (select 1 from fleet_assignments x
                          where x.vehicle_id = fv.id and x.returned_on is null)
       group by fv.id, fv.organization_id
       order by fv.id limit 1`);
    if (v.length < 2) { bad("need two vehicles to test against"); }
    else {
      const [v1, v2] = v;
      const A = `insert into fleet_assignments (organization_id, vehicle_id, holder_name, assigned_on, returned_on)
                 values ($1,$2,$3,$4,$5)`;

      // A clean window nothing real occupies, well clear of the live rows.
      await c.query("SAVEPOINT base");
      await c.query(A, [v1.organization_id, v1.id, "Probe One", "2019-01-10", "2019-03-10"]);

      await mustRefuse(c, "a second holder overlapping the same vehicle", A,
        [v1.organization_id, v1.id, "Probe Two", "2019-02-01", "2019-02-20"]);
      await mustRefuse(c, "an overlap that only touches on the boundary day", A,
        [v1.organization_id, v1.id, "Probe Two", "2019-03-10", "2019-04-01"]);
      await mustAccept(c, "A. a handover with no daylight — next day", A,
        [v1.organization_id, v1.id, "Probe Two", "2019-03-11", "2019-05-01"]);
      await mustAccept(c, "B. the same holder again later on the same vehicle", A,
        [v1.organization_id, v1.id, "Probe One", "2020-01-01", "2020-02-01"]);
      await mustAccept(c, "C. the very same dates on a DIFFERENT vehicle", A,
        [v2.organization_id, v2.id, "Probe Two", "2019-02-01", "2019-02-20"]);
      if (free.length) {
        const freeFrom = String(free[0].free_from);
        await mustAccept(c, `D. an open assignment on a vehicle nobody holds (from ${freeFrom})`, A,
          [free[0].organization_id, free[0].id, "Probe Three", freeFrom, null]);
      } else {
        ok("D. skipped — every vehicle currently has a holder (nothing to test against)");
      }
      await mustRefuse(c, "a SECOND open assignment on a vehicle someone already holds", A,
        [v1.organization_id, v1.id, "Probe Three", "2019-06-01", null]);
      await mustRefuse(c, "returned before it was assigned", A,
        [v1.organization_id, v1.id, "Probe Two", "2019-09-01", "2019-08-01"]);

      await c.query("ROLLBACK TO SAVEPOINT base");

      // Agreements
      const AG = `insert into fleet_agreements (organization_id, vehicle_id, holder_name, signed_on, expires_on, storage_key, notes)
                  values ($1,$2,'Probe',$3,$4,$5,$6)`;
      await mustRefuse(c, "an agreement expiring before it was signed", AG,
        [v1.organization_id, v1.id, "2026-05-01", "2026-04-01", "k", null]);
      await mustRefuse(c, "an agreement that is neither a file nor a note", AG,
        [v1.organization_id, v1.id, "2026-05-01", null, null, null]);
      await mustAccept(c, "a note-only agreement (the paper is in a drawer)", AG,
        [v1.organization_id, v1.id, "2026-05-01", null, null, "Signed hard copy held in the office"]);

      // Drivers and their licences
      const D = `insert into fleet_drivers (organization_id, full_name, licence_number, licence_expires_on)
                 values ($1,$2,$3,$4)`;
      await c.query("SAVEPOINT d");
      await c.query(D, [v1.organization_id, "Probe Driver", "PROBE-LIC-1", "2030-01-01"]);
      await mustRefuse(c, "a second driver on the same licence number", D,
        [v1.organization_id, "Someone Else", "PROBE-LIC-1", "2031-01-01"]);
      await mustAccept(c, "a driver with NO licence number yet (we have not seen the card)", D,
        [v1.organization_id, "Probe Driver Two", null, null]);
      await mustAccept(c, "a second driver with no licence number — NULLs stay distinct", D,
        [v1.organization_id, "Probe Driver Three", null, null]);
      await c.query("ROLLBACK TO SAVEPOINT d");

      const dcol = await c.query(`select 1 from information_schema.columns
        where table_name='fleet_assignments' and column_name='driver_id'`);
      dcol.rowCount ? ok("fleet_assignments.driver_id exists") : bad("driver_id missing");

      const fcol = await c.query(`select 1 from information_schema.columns
        where table_name='fines' and column_name='fleet_assignment_id'`);
      fcol.rowCount ? ok("fines.fleet_assignment_id exists") : bad("fines link missing");
      const fdel = await c.query(`select confdeltype from pg_constraint
        where conrelid='fines'::regclass and contype='f'
          and pg_get_constraintdef(oid) ilike '%fleet_assignment_id%'`);
      fdel.rows[0]?.confdeltype === "n"
        ? ok("  ON DELETE SET NULL — deleting a stint never deletes the fine")
        : bad(`  wrong delete rule '${fdel.rows[0]?.confdeltype ?? "none"}'`);

      // Condition media
      const M = `insert into fleet_condition_media (organization_id, vehicle_id, taken_on, storage_key)
                 values ($1,$2,$3,'k')`;
      await mustRefuse(c, "a condition photo dated in the future", M,
        [v1.organization_id, v1.id, "2099-01-01"]);
      await mustAccept(c, "a condition photo dated today", M,
        [v1.organization_id, v1.id, new Date().toISOString().slice(0, 10)]);
    }

    await c.query(sql);
    ok("E. re-running the migration is a no-op");

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

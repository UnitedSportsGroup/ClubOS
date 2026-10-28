/**
 * Apply migrations/2026-10-28_registration_removal.sql.
 *   npx tsx --env-file=.env script/apply-registration-removal.ts            # DRY RUN — rolls back
 *   npx tsx --env-file=.env script/apply-registration-removal.ts --commit
 *
 * There is no local Postgres, so the dry run IS the rehearsal: the real
 * migration against the real schema, every invariant proven by a write that
 * must be REFUSED, then rolled back.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { sql } from "drizzle-orm";
import { db } from "../server/db";

const COMMIT = process.argv.includes("--commit");
const FILE = join(import.meta.dirname, "..", "migrations", "2026-10-28_registration_removal.sql");
const rows = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);

/** Runs `fn` in a savepoint and reports whether Postgres REFUSED it. */
async function refused(tx: any, fn: (t: any) => Promise<unknown>): Promise<boolean> {
  try {
    await tx.transaction(async (sp: any) => { await fn(sp); throw new Error("__ACCEPTED__"); });
    return false;
  } catch (e: any) {
    return e?.message !== "__ACCEPTED__";
  }
}

async function main() {
  const body = readFileSync(FILE, "utf8");
  console.log(`\n${COMMIT ? "🔴 APPLYING FOR REAL" : "🧪 DRY RUN (will roll back)"}\n`);

  const statusBefore = rows(await db.execute(sql`SELECT status::text, count(*)::int n FROM registrations GROUP BY 1 ORDER BY 1`));
  const [{ reg: anyReg }] = rows(await db.execute(sql`SELECT min(id)::int reg FROM registrations`));
  const [{ uid }] = rows(await db.execute(sql`SELECT min(id)::int uid FROM users`));

  let ok = true;
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(body));
    const checks: Array<[string, boolean, string]> = [];

    const cols = rows(await tx.execute(sql`
      SELECT column_name, is_nullable, column_default FROM information_schema.columns
       WHERE table_name = 'registrations' AND column_name LIKE 'removed_%'`));
    for (const c of ["removed_at", "removed_by_user_id", "removed_reason", "removed_from_status"]) {
      const col = cols.find((x) => x.column_name === c);
      checks.push([`${c} exists, nullable, no default`, !!col && col.is_nullable === "YES" && col.column_default == null, JSON.stringify(col ?? null)]);
    }

    const enumVals = rows(await tx.execute(sql`SELECT e.enumlabel v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'registration_status'`)).map((r) => r.v);
    checks.push(["'removed' is a registration_status", enumVals.includes("removed"), enumVals.join(",")]);

    const [rls] = rows(await tx.execute(sql`SELECT relrowsecurity FROM pg_class WHERE relname = 'registration_removal_events'`));
    checks.push(["RLS on registration_removal_events", rls?.relrowsecurity === true, String(rls?.relrowsecurity)]);

    // Half a stamp must be refused — a removal with no name on it is the thing we are closing.
    checks.push(["half a stamp (time, no person) is REFUSED", await refused(tx, (t) =>
      t.execute(sql`UPDATE registrations SET removed_at = now() WHERE id = ${anyReg}`)), `reg ${anyReg}`]);
    checks.push(["a blank reason is REFUSED", await refused(tx, (t) =>
      t.execute(sql`UPDATE registrations SET removed_at = now(), removed_by_user_id = ${uid},
                      removed_reason = '  ', removed_from_status = status WHERE id = ${anyReg}`)), ""]);
    checks.push(["a full stamp is ACCEPTED", !(await refused(tx, (t) =>
      t.execute(sql`UPDATE registrations SET removed_at = now(), removed_by_user_id = ${uid},
                      removed_reason = 'rehearsal', removed_from_status = status WHERE id = ${anyReg}`))), ""]);

    // The trail cannot be tidied.
    const [ev] = rows(await tx.execute(sql`
      INSERT INTO registration_removal_events (registration_id, action, user_id, reason, snapshot)
      VALUES (${anyReg}, 'removed', ${uid}, 'rehearsal', '{}'::jsonb) RETURNING id`));
    checks.push(["an event can be written", !!ev?.id, String(ev?.id)]);
    checks.push(["an event cannot be EDITED", await refused(tx, (t) =>
      t.execute(sql`UPDATE registration_removal_events SET reason = 'changed' WHERE id = ${ev.id}`)), ""]);
    checks.push(["an event cannot be DELETED", await refused(tx, (t) =>
      t.execute(sql`DELETE FROM registration_removal_events WHERE id = ${ev.id}`)), ""]);
    checks.push(["an unknown action is REFUSED", await refused(tx, (t) =>
      t.execute(sql`INSERT INTO registration_removal_events (registration_id, action, user_id, snapshot)
                    VALUES (${anyReg}, 'deleted', ${uid}, '{}'::jsonb)`)), ""]);

    for (const [name, pass, detail] of checks) {
      console.log(`  ${pass ? "✅" : "❌"} ${name}${detail ? `  (${detail})` : ""}`);
      if (!pass) ok = false;
    }
    // The rehearsal ALWAYS rolls back — its test event row cannot be deleted by
    // design, so it must never be committed. --commit applies the clean file below.
    throw new Error("__ROLLBACK__");
  }).catch((e: any) => {
    if (e?.message !== "__ROLLBACK__") throw e;
    console.log("\n🧪 Rehearsal rolled back.");
  });

  if (COMMIT && ok) {
    await db.transaction(async (tx) => { await tx.execute(sql.raw(body)); });
    console.log("🔴 Migration committed.");
  }

  const statusAfter = rows(await db.execute(sql`SELECT status::text, count(*)::int n FROM registrations GROUP BY 1 ORDER BY 1`));
  const same = JSON.stringify(statusBefore) === JSON.stringify(statusAfter);
  console.log(`  ${same ? "✅" : "❌"} no registration changed status  (${statusAfter.map((r) => `${r.status} ${r.n}`).join(" · ")})`);
  if (!same) ok = false;

  if (!ok) {
    console.error("\n❌ Invariants failed — do NOT commit this migration.");
    process.exit(1);
  }
  console.log(COMMIT ? "\n✅ Applied." : "\n✅ Rehearsal clean. Re-run with --commit to apply.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

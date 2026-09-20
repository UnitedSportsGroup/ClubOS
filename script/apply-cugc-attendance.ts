/**
 * Rehearse (and optionally apply) the CUGC roll migration.
 *
 *   npx tsx --env-file=.env script/apply-cugc-attendance.ts            # dry run
 *   npx tsx --env-file=.env script/apply-cugc-attendance.ts --commit   # for real
 *
 * There is no local Postgres, so the dry run IS the rehearsal: everything
 * happens inside ONE transaction against the live database and is rolled back
 * unless --commit. The migration file deliberately carries no BEGIN/COMMIT of
 * its own — an inner COMMIT would end this transaction and the ROLLBACK would
 * then run in autocommit, against a database that had already kept the changes.
 *
 * Every invariant is proved by an insert that MUST be refused. A constraint
 * nobody has seen reject anything is a comment.
 */
import pg from "pg";
import { readFileSync } from "fs";
import {
  CUGC_TERMS, termStatus, isSellable, sellableTerms, defaultTerm, resolveTermForSale,
} from "../shared/cugc-terms";
import { classesForRegistration, classDatesInTerm, allClasses, classById } from "../shared/cugc-classes";
import { proratedTermPrice } from "../server/cugc-pricing";

const COMMIT = process.argv.includes("--commit");

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

/**
 * Assert that a statement is REFUSED by the database, BY THE CONSTRAINT WE
 * MEAN.
 *
 * 🔴 `byConstraint` is not decoration. The first version of the "a staff member
 * who took the roll cannot be deleted" test passed green while proving nothing:
 * the delete was refused by `api_keys_created_by`, a completely unrelated
 * foreign key that happened to reference the same user. A refusal is only
 * evidence when you know what refused it.
 */
async function refused(
  client: pg.PoolClient, label: string, byConstraint: string, sql: string, params: any[] = [],
) {
  await client.query("SAVEPOINT s");
  try {
    await client.query(sql, params);
    await client.query("ROLLBACK TO SAVEPOINT s");
    ok(label, false, "the database ALLOWED it");
  } catch (e: any) {
    await client.query("ROLLBACK TO SAVEPOINT s");
    const msg = String(e.message).replace(/\s+/g, " ");
    const right = msg.includes(byConstraint);
    ok(label, right, right ? byConstraint : `refused by something ELSE — ${msg.slice(0, 90)}`);
  }
}

async function main() {
  // ── Pure logic first: no database needed, and a wrong answer here would be
  //    invisible in the SQL below. ────────────────────────────────────────────
  console.log("\nTerms — dates decide, not a constant anyone has to remember");
  const t3 = CUGC_TERMS.find((t) => t.id === "t3-2026")!;
  const t4 = CUGC_TERMS.find((t) => t.id === "t4-2026")!;
  ok("Term 3 is active on its last day", termStatus(t3, "2026-09-25") === "active");
  ok("Term 3 has ended the day after", termStatus(t3, "2026-09-26") === "ended");
  ok("Term 4 is upcoming in September", termStatus(t4, "2026-09-20") === "upcoming");
  ok("Term 4 is active on its first day", termStatus(t4, "2026-10-12") === "active");

  // 🔴 The bug this whole change exists to close.
  ok("a FINISHED term can never be sold", !isSellable(t3, "2026-09-26"));
  // The dangerous half of the old behaviour, pinned down: the number survives
  // (it is display-only), but nothing can buy it. Proving the price is still
  // $165 matters — that is exactly what would have been charged on 26 Sep.
  const endedPrice = proratedTermPrice(165, t3.start, t3.end, t3.weeks, new Date("2026-09-26T09:00:00+12:00"));
  ok("…and on 26 Sep it STILL reports the full $165 — which is what would have been charged",
     endedPrice.status === "ended" && endedPrice.price === 165);
  ok("on 26 Sep the only sellable term is Term 4",
     sellableTerms("2026-09-26").map((t) => t.id).join() === "t4-2026");
  ok("today BOTH terms are sellable (Daniel's call, 2026-09-20)",
     sellableTerms("2026-09-20").map((t) => t.id).join() === "t3-2026,t4-2026");
  ok("the default is the WHOLE term, not the two-week stub",
     defaultTerm("2026-09-20")?.id === "t4-2026");

  console.log("\nTerms — the browser no longer chooses");
  const ended = resolveTermForSale("t3-2026", "2026-09-26");
  ok("a request naming a finished term is refused", !ended.ok && ended.reason === "ended");
  const unknown = resolveTermForSale("t9-2099", "2026-09-20");
  ok("a request naming a term that does not exist is refused", !unknown.ok && unknown.reason === "unknown");
  const legacy = resolveTermForSale(null, "2026-09-20");
  ok("an OLD cugc.co.nz bundle (no term) still works, and means the running term",
     legacy.ok && legacy.term.id === "t3-2026");
  const legacyGap = resolveTermForSale(null, "2026-10-01");
  ok("…and in the holidays it means the term about to start",
     legacyGap.ok && legacyGap.term.id === "t4-2026");

  console.log("\nThe roll — which classes a child is on");
  const pick = classesForRegistration("gymplay", "1–2 sessions per week", "Wednesday 4:00–4:45pm");
  ok("a family's own choice wins", pick.placed && pick.classIds.join() === "gymplay-wed-1600");
  const twice = classesForRegistration("gymbasics", "Ages 5–7 · twice a week", "Tuesday + Saturday");
  ok("'Tuesday + Saturday' puts one child on TWO rolls",
     twice.placed && twice.classIds.length === 2, twice.classIds.join(" + "));
  const only = classesForRegistration("gymbasics", "Ages 8+ · once a week", null);
  ok("a blank is fine when the option has only one class", only.placed && only.classIds.length === 1);
  const blank = classesForRegistration("gymplay", "1–2 sessions per week", null);
  ok("🔴 a blank with THREE classes to choose from is NOT all three",
     !blank.placed && blank.reason === "not-recorded");
  const comp = classesForRegistration("competitive", "1× per week (2 hours)", "Thursday");
  ok("Competitive has no timetable and says so rather than guessing",
     !comp.placed && comp.reason === "no-timetable");

  console.log("\nThe roll — session dates");
  const wed = classDatesInTerm(3, t4.start, t4.end);
  ok("Term 4 has 10 Wednesdays", wed.length === 10, `${wed[0]} … ${wed[wed.length - 1]}`);
  ok("the first is the term's own first Wednesday", wed[0] === "2026-10-14");
  ok("none falls outside the term", wed.every((d) => d >= t4.start && d <= t4.end));
  const sat3 = classDatesInTerm(6, t3.start, t3.end);
  ok("Term 3's last Saturday is inside the term", sat3[sat3.length - 1] <= t3.end, sat3[sat3.length - 1]);
  ok("every class id resolves", allClasses().every((c) => !!classById(c.id)));

  // ── Now the database ──────────────────────────────────────────────────────
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    console.log(`\nMigration (${COMMIT ? "COMMIT" : "dry run — will roll back"})`);
    const sql = readFileSync(new URL("../migrations/2026-09-20_cugc_attendance.sql", import.meta.url), "utf8");
    await client.query(sql);
    ok("migration runs", true);

    const { rows: [{ count: cols }] } = await client.query(
      `SELECT count(*) FROM information_schema.columns WHERE table_name='cugc_attendance'`);
    ok("cugc_attendance exists", Number(cols) > 0, `${cols} columns`);

    const { rows: rls } = await client.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname='cugc_attendance'`);
    ok("RLS is ON (the second wall if an anon key leaks)", rls[0]?.relrowsecurity === true);

    // A throwaway enrolment to hang the tests off — never a real one.
    const { rows: [org] } = await client.query(`SELECT id FROM organizations WHERE slug='united-gymnastics'`);
    ok("the gymnastics workspace is there", !!org, `org ${org?.id}`);
    const { rows: [reg] } = await client.query(
      `INSERT INTO cugc_registrations (organization_id, program_slug, program_name, option_label,
         session_time, price_cents, full_price_cents, term, gymnast_name, parent_name, email, status)
       VALUES ($1,'gymplay','GymPlay','1–2 sessions per week','Wednesday 4:00–4:45pm',
         16500,16500,'Term 4 2026','ROLLBACK Test Child','ROLLBACK Test Parent','rollback@example.invalid','paid')
       RETURNING id`, [org.id]);
    const { rows: [usr] } = await client.query(`SELECT id FROM users WHERE email='daniel@cufc.co.nz'`);

    await client.query(
      `INSERT INTO cugc_attendance (organization_id, registration_id, class_id, session_date, status, marked_by_user_id)
       VALUES ($1,$2,'gymplay-wed-1600','2026-10-14','present',$3)`, [org.id, reg.id, usr.id]);
    ok("a mark can be recorded", true);

    console.log("\nInvariants — each proved by a refusal");
    await refused(client, "the same child cannot be marked twice for one class on one day",
      "cugc_attendance_once",
      `INSERT INTO cugc_attendance (organization_id, registration_id, class_id, session_date, status)
       VALUES ($1,$2,'gymplay-wed-1600','2026-10-14','absent')`, [org.id, reg.id]);

    await refused(client, "an enrolment with attendance cannot be deleted (the afternoon is a fact)",
      "cugc_attendance_registration_id_fkey",
      `DELETE FROM cugc_registrations WHERE id=$1`, [reg.id]);

    // 🔴 Deliberately NOT a `DELETE FROM users` test. Every staff account in
    // this database is already protected by a dozen unrelated RESTRICT keys, so
    // such a test passes no matter what this migration does. The honest way to
    // prove OUR key is to ask the catalogue what it says.
    const { rows: [fk] } = await client.query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conname = 'cugc_attendance_marked_by_user_id_fkey'`);
    ok("who took the roll is protected by RESTRICT, per the catalogue",
       fk?.confdeltype === "r", `confdeltype=${fk?.confdeltype ?? "missing"}`);

    await refused(client, "a mark cannot point at an enrolment that does not exist",
      "cugc_attendance_registration_id_fkey",
      `INSERT INTO cugc_attendance (organization_id, registration_id, class_id, session_date, status)
       VALUES ($1,2147483600,'gymplay-wed-1600','2026-10-21','present')`, [org.id]);

    // The same child on the SAME day in a DIFFERENT class is legitimate — a
    // twice-a-week place can have two classes on one Saturday.
    await client.query(
      `INSERT INTO cugc_attendance (organization_id, registration_id, class_id, session_date, status)
       VALUES ($1,$2,'gymplay-sat-0930','2026-10-14','present')`, [org.id, reg.id]);
    ok("the same child CAN be marked for a different class the same day", true);

    if (COMMIT) {
      // Never commit the throwaway rows, only the schema.
      await client.query(`DELETE FROM cugc_attendance WHERE registration_id=$1`, [reg.id]);
      await client.query(`DELETE FROM cugc_registrations WHERE id=$1`, [reg.id]);
      await client.query("COMMIT");
      console.log("\n✅ COMMITTED — cugc_attendance is live. Test rows removed.");
    } else {
      await client.query("ROLLBACK");
      console.log("\n↩️  Rolled back — nothing changed. Re-run with --commit to apply.");
    }
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

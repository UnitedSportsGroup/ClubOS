// Term 4 2026 sessions for Pre-Academy U9–U12 — Tuesday, Thursday, Saturday,
// one slot per training group.
//
// Daniel, 2026-09-20: "sessions for term 4 would be Tuesday, Thursday and
// Saturday for each training group can be reflected in coaches rolls in
// coaches platform for U9-U12."
//
//   npx tsx --env-file=.env script/seed-preacademy-term4.ts            (dry run)
//   npx tsx --env-file=.env script/seed-preacademy-term4.ts --commit
//
// 🔴 IT REFUSES TO RUN UNTIL THE TIMES ARE FILLED IN. What time a child turns
// up is a fact about the real world, not something to infer from another
// programme. U4–U8 trains weekdays 16:30–17:15 and splits Saturday by age
// (09:30 U4–U6, 10:30 U7–U8) — a reasonable shape to copy, and still a guess
// about U9–U12. A wrong time here sends families to an empty pitch and puts a
// coach on a roll nobody attends, so the script stops instead.
//
// 🔴 Slots are keyed (camp_id, date, start_time) by a partial unique index, so
// two groups CAN share a date at different times and the seed is idempotent —
// re-running never duplicates a session. Never reinstate a plain
// UNIQUE (camp_id, date): it makes an age-split day impossible.
//
// 🔴 It writes only inside the term's own window (12 Oct – 18 Dec 2026), read
// from `terms`, never a hand-typed range.
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const PROGRAM_SLUG = "pre-academy-u9-u12";
const TERM_ID = 8;                      // Term 4 2026

/** 🔴 FILL THIS IN. One row per training group per day.
 *  `day`: 2 = Tuesday, 4 = Thursday, 6 = Saturday (JS getDay).
 *  Times are 24h "HH:MM" in NZ local time. */
const SLOTS: { group: string; day: number; start: string; end: string }[] = [
  // { group: "U9",  day: 2, start: "16:30", end: "17:30" },
  // { group: "U9",  day: 4, start: "16:30", end: "17:30" },
  // { group: "U9",  day: 6, start: "09:00", end: "10:00" },
  // … U10, U11, U12
];

const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function main() {
  if (SLOTS.length === 0) {
    console.error(`
  Nothing to do — SLOTS is empty.

  Pre-Academy has NEVER had a session generated, so there is no previous
  timetable to copy. Fill in the training times at the top of this file
  (Tuesday, Thursday, Saturday for each of U9, U10, U11, U12) and run it again.

  For reference, U4–U8 runs weekdays 16:30–17:15, and splits Saturday
  09:30 (U4–U6) / 10:30 (U7–U8).
`);
    process.exit(1);
  }

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log(`\n  Pre-Academy Term 4 sessions — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    const { rows: prog } = await c.query(
      `select id, name from programs where slug = $1`, [PROGRAM_SLUG]);
    if (!prog.length) throw new Error(`no programme with slug ${PROGRAM_SLUG}`);
    const campId = prog[0].id;

    const { rows: term } = await c.query(
      `select id, name, year, start_date::text s, end_date::text e from terms where id = $1`, [TERM_ID]);
    if (!term.length) throw new Error(`no term ${TERM_ID}`);
    console.log(`  ${prog[0].name} (#${campId}) · ${term[0].name} ${term[0].year} · ${term[0].s} → ${term[0].e}\n`);

    // Walk the term's own dates — never a hand-typed range, and never a JS
    // Date stepped by 7, which drifts across a daylight-saving boundary.
    // NZDT begins inside Term 4, so this matters here specifically.
    let made = 0, already = 0;
    for (const slot of SLOTS) {
      const { rows: dates } = await c.query(
        `select d::date::text as day from generate_series($1::date, $2::date, '1 day') d
          where extract(dow from d) = $3`,
        [term[0].s, term[0].e, slot.day]);
      for (const d of dates) {
        const ins = await c.query(
          `insert into camp_dates (camp_id, date, start_time, end_time, name)
           values ($1, $2, $3, $4, $5)
           on conflict do nothing
           returning id`,
          [campId, d.day, slot.start, slot.end, `${slot.group} Training Group`]);
        ins.rowCount ? made++ : already++;
      }
      console.log(`  ${slot.group.padEnd(4)} ${DAY_NAME[slot.day].padEnd(9)} ${slot.start}–${slot.end}  ${dates.length} dates`);
    }

    console.log(`\n  ${made} session(s) to create, ${already} already there.`);
    if (COMMIT) { await c.query("COMMIT"); console.log("  COMMITTED.\n"); }
    else { await c.query("ROLLBACK"); console.log("  Rolled back — re-run with --commit.\n"); }
  } catch (e: any) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("\n  FAILED:", e.message, "\n");
    process.exit(1);
  } finally {
    await c.end();
  }
}
main();

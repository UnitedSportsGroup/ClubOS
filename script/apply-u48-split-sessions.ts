// The U4–U8 split (Zach's newsletter, 27 Oct 2026): from Monday 2 November,
// Mondays, Tuesdays and Thursdays get a second session, 5:20–6:05pm, for the
// U7–U8s. 4:30–5:15 stays all ages; Wednesday, Friday and the two Saturday
// sessions are unchanged.
//
//   npx tsx --env-file=.env script/apply-u48-split-sessions.ts            # dry run
//   npx tsx --env-file=.env script/apply-u48-split-sessions.ts --commit
//
// 1. Adds the slot to programme 4's weekly pattern WITH `from: 2026-11-02`, so
//    the term-session builder (server/term-sessions-cron.ts) keeps making it
//    every term and never invents it on the days already gone by.
//    🔴 Run only after the deploy that taught the planner `from` — the old
//    planner ignores it and would add 5:20 sessions back to 12 October.
// 2. Creates this term's sessions through the SAME planner, insert-only.
// Nothing is deleted or edited. Idempotent.
import { pool } from "../server/db";
import { planTermSessions } from "../server/term-sessions";

const COMMIT = process.argv.includes("--commit");
const PROGRAMME = 4;
const SLOT = { daysOfWeek: [1, 2, 4], startTime: "17:20", endTime: "18:05", name: "U7–U8", capacity: null, from: "2026-11-02" };

async function main() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const { rows: [p] } = await c.query(`SELECT id, name, organization_id, weekly_pattern_json FROM programs WHERE id = $1`, [PROGRAMME]);
    if (!p) throw new Error("programme 4 not found");
    const slots: any[] = JSON.parse(p.weekly_pattern_json || "[]");
    const has = slots.some((s) => s.startTime === SLOT.startTime && JSON.stringify(s.daysOfWeek) === JSON.stringify(SLOT.daysOfWeek));
    const next = has ? slots : [...slots, SLOT];
    console.log(`${p.name}: pattern ${has ? "already has" : "gains"} Mon/Tue/Thu 17:20–18:05 "U7–U8" from 2026-11-02`);
    if (!has) await c.query(`UPDATE programs SET weekly_pattern_json = $1 WHERE id = $2`, [JSON.stringify(next), PROGRAMME]);

    const { rows: [{ today }] } = await c.query(`SELECT (now() AT TIME ZONE 'Pacific/Auckland')::date::text AS today`);
    const { rows: terms } = await c.query(`SELECT id, start_date::text AS start, end_date::text AS "end" FROM terms WHERE organization_id = $1`, [p.organization_id]);
    const { rows: existing } = await c.query(`SELECT date::text AS date, left(coalesce(start_time,''),5) AS start FROM camp_dates WHERE camp_id = $1`, [PROGRAMME]);
    const plan = planTermSessions({ slots: next, terms, existing, today, horizonDays: 21 });
    const mine = plan.filter((s) => s.startTime === SLOT.startTime);
    const other = plan.filter((s) => s.startTime !== SLOT.startTime);
    if (other.length) console.log(`  (the planner also wants ${other.length} other missing sessions — left to the cron)`);
    if (mine.some((s) => s.date < SLOT.from)) throw new Error("planner produced a session before 2 Nov — refusing (is the deploy live?)");
    let created = 0;
    for (const s of mine) {
      const r = await c.query(
        `INSERT INTO camp_dates (camp_id, date, start_time, end_time, name, capacity_full_day)
         SELECT $1, $2::date, $3, $4, $5, $6
          WHERE NOT EXISTS (SELECT 1 FROM camp_dates WHERE camp_id = $1 AND date = $2::date AND start_time = $3)`,
        [PROGRAMME, s.date, s.startTime, s.endTime, s.name, s.capacity]);
      created += r.rowCount ?? 0;
    }
    console.log(`  ${created} new U7–U8 sessions: ${mine.map((s) => s.date.slice(5)).join(" ")}`);
    const check = await c.query(`SELECT count(*)::int n, min(date)::text a, max(date)::text b, bool_or(extract(dow from date) not in (1,2,4)) bad FROM camp_dates WHERE camp_id=$1 AND start_time='17:20'`, [PROGRAMME]);
    console.log(`  check: ${JSON.stringify(check.rows[0])}`);
    if (check.rows[0].bad) throw new Error("a 5:20 session landed on a day other than Mon/Tue/Thu — rolled back");
    if (COMMIT) { await c.query("COMMIT"); console.log("\nCOMMITTED"); }
    else { await c.query("ROLLBACK"); console.log("\nDRY RUN — rolled back. Pass --commit."); }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error("REFUSED:", e?.message ?? e); process.exit(1); });

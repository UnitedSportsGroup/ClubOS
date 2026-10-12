// Make sure every term programme has its sessions for the term that is running
// now and any term starting soon — so the roll is there on day one, every term,
// without anybody pressing Generate.
//
//   Rehearse:  npx tsx --env-file=.env script/ensure-term-sessions.ts --dry-run
//   Apply:     npx tsx --env-file=.env script/ensure-term-sessions.ts
//   Options:   --program 16   --set-pattern '<json>'   --horizon-days 21
//
// The shape of a programme's week is DATA: `programs.weekly_pattern_json`, the
// same field the Schedule tab's Generate button writes. A programme with no
// pattern is reported, never guessed.
//
// The term is found from the `terms` table by DATE (every term of the
// programme's organisation that is running or starts within the horizon),
// NEVER from `programs.term_id` — that is what the programme is selling and is
// flipped by hand, which is exactly how Term 4 2026 opened with no sessions.
//
// Idempotent on (camp_id, date, start_time). Never deletes, never edits.
// Logic shared with the server's daily job: server/term-sessions.ts.
import { Pool } from "pg";
import { planTermSessions, type PatternSlot } from "../server/term-sessions";

const DRY = process.argv.includes("--dry-run");
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined; };
const ONLY = arg("--program") ? Number(arg("--program")) : undefined;
const SET_PATTERN = arg("--set-pattern");
const HORIZON = Number(arg("--horizon-days") ?? 21);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const db = await pool.connect();
try {
  if (SET_PATTERN) {
    if (!ONLY) throw new Error("--set-pattern needs --program");
    const slots: PatternSlot[] = JSON.parse(SET_PATTERN);
    planTermSessions({ slots, terms: [], existing: [], today: "2000-01-01", horizonDays: 0 }); // validates
    if (!DRY) await db.query(`UPDATE programs SET weekly_pattern_json = $2 WHERE id = $1`, [ONLY, JSON.stringify(slots)]);
    console.log(`${DRY ? "[dry] would set" : "Set"} pattern on programme ${ONLY}`);
  }

  const { rows: [{ today }] } = await db.query(`SELECT (now() AT TIME ZONE 'Pacific/Auckland')::date::text AS today`);
  const { rows: programs } = await db.query(
    `SELECT id, organization_id, name, weekly_pattern_json FROM programs
      WHERE schedule_type = 'term' AND is_active = true ${ONLY ? "AND id = $1" : ""}
      ORDER BY organization_id, id`, ONLY ? [ONLY] : []);

  let total = 0;
  for (const p of programs) {
    if (!p.weekly_pattern_json) { console.log(`– ${p.name} (#${p.id}): no weekly pattern saved — skipped`); continue; }
    const { rows: terms } = await db.query(
      `SELECT id, name, start_date::text AS start, end_date::text AS end FROM terms
        WHERE organization_id = $1 ORDER BY start_date`, [p.organization_id]);
    const { rows: existing } = await db.query(
      `SELECT date::text AS date, left(coalesce(start_time,''),5) AS start FROM camp_dates WHERE camp_id = $1`, [p.id]);
    const plan = planTermSessions({
      slots: JSON.parse(p.weekly_pattern_json), terms, existing, today, horizonDays: HORIZON,
    });
    console.log(`• ${p.name} (#${p.id}): ${plan.length} missing${plan.length ? ` · ${plan[0].date} → ${plan[plan.length - 1].date}` : ""}`);
    if (!DRY && plan.length) {
      for (const s of plan) {
        await db.query(
          `INSERT INTO camp_dates (camp_id, date, start_time, end_time, name, capacity_full_day)
           SELECT $1, $2::date, $3, $4, $5, $6
            WHERE NOT EXISTS (SELECT 1 FROM camp_dates WHERE camp_id = $1 AND date = $2::date AND start_time = $3)`,
          [p.id, s.date, s.startTime, s.endTime, s.name, s.capacity]);
      }
    }
    total += plan.length;
  }
  console.log(`\n${DRY ? "DRY RUN — would create" : "Created"} ${total} session(s). Today (NZ) = ${today}.`);
} finally {
  db.release();
  await pool.end();
}

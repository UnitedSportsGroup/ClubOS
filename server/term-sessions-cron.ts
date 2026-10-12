// Term sessions, every term, without anybody pressing Generate.
//
// Daniel, 2026-10-12: "for any new term, it shows the new session dates, the
// new roll … always done for us every single new term." Term 4 2026 opened at
// 3pm on day one with the FUNiño roll still showing Term 3.
//
// Every 6 hours (and once at boot) each active term programme that has a saved
// weekly pattern gets its sessions for the term running now and any term that
// starts in the next 21 days. Terms are found by DATE from `terms`, never from
// `programs.term_id`. Insert-only, never deletes or edits, idempotent — safe to
// run on both Fly machines at once (the (camp_id, date, start_time) unique
// index turns a lost race into a no-op). Off switch: TERM_SESSIONS_CRON=0.
import { pool } from "./db";
import { planTermSessions } from "./term-sessions";

const EVERY_MS = 6 * 60 * 60 * 1000;
const HORIZON_DAYS = 21;

export async function ensureTermSessions(): Promise<{ created: number; skipped: string[] }> {
  const client = await pool.connect();
  let created = 0;
  const skipped: string[] = [];
  try {
    const { rows: [{ today }] } = await client.query(
      `SELECT (now() AT TIME ZONE 'Pacific/Auckland')::date::text AS today`);
    const { rows: programs } = await client.query(
      `SELECT id, organization_id, name, weekly_pattern_json FROM programs
        WHERE schedule_type = 'term' AND is_active = true`);
    for (const p of programs) {
      if (!p.weekly_pattern_json) { skipped.push(`${p.name} (#${p.id})`); continue; }
      try {
        const { rows: terms } = await client.query(
          `SELECT id, start_date::text AS start, end_date::text AS "end" FROM terms WHERE organization_id = $1`,
          [p.organization_id]);
        const { rows: existing } = await client.query(
          `SELECT date::text AS date, left(coalesce(start_time,''),5) AS start FROM camp_dates WHERE camp_id = $1`, [p.id]);
        const plan = planTermSessions({
          slots: JSON.parse(p.weekly_pattern_json), terms, existing, today, horizonDays: HORIZON_DAYS,
        });
        for (const s of plan) {
          try {
            const r = await client.query(
              `INSERT INTO camp_dates (camp_id, date, start_time, end_time, name, capacity_full_day)
               SELECT $1, $2::date, $3, $4, $5, $6
                WHERE NOT EXISTS (SELECT 1 FROM camp_dates WHERE camp_id = $1 AND date = $2::date AND start_time = $3)`,
              [p.id, s.date, s.startTime, s.endTime, s.name, s.capacity]);
            created += r.rowCount ?? 0;
          } catch (e: any) {
            if (e?.code !== "23505") throw e; // the other machine got there first
          }
        }
        if (plan.length) console.log(`[term-sessions] ${p.name} (#${p.id}): +${plan.length}`);
      } catch (e: any) {
        console.error(`[term-sessions] ${p.name} (#${p.id}) failed:`, e?.message ?? e);
      }
    }
  } finally {
    client.release();
  }
  return { created, skipped };
}

export function startTermSessionsCron() {
  if (process.env.TERM_SESSIONS_CRON === "0") return;
  const run = () => ensureTermSessions()
    .then(r => { if (r.created) console.log(`[term-sessions] created ${r.created}`); })
    .catch(e => console.error("[term-sessions] sweep failed:", e?.message ?? e));
  setTimeout(run, 60_000);
  setInterval(run, EVERY_MS);
}

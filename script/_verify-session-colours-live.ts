// The Sessions list, checked against production.
//
// Daniel, 2026-09-11: "make all the sessions appear either green if roll was
// done, red if not done and in the past and make it yellow if that is the roll
// for today… and leave as is if it's in future."
//
// Two things are asserted, because two things were wrong:
//   1. Every session's Roll count is ITS OWN TERM's cohort. FUNiño has run four
//      terms and a flat count printed 443 on every row, July's included.
//   2. Whether the roll was taken reads BOTH `status` and `checked_in_at` —
//      Zach's 19 marks came from the phone as check-ins and the web could not
//      see them.
//
//   npx tsx --env-file=.env script/_verify-session-colours-live.ts
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE ?? "https://app.usg.co.nz";
const WS = "christchurch-united";
const CAMP = 4;                       // FUNiño — First Kicks
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const ok = (c: boolean, m: string, extra = "") => {
  if (c) { pass++; console.log(`  ✓ ${m}`); }
  else { fail++; console.log(`  ✗ ${m}${extra ? `  — ${extra}` : ""}`); }
};
const nzToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function main() {
  // A throwaway ORDINARY admin — a super admin sees a different app and would
  // not reproduce what staff hit.
  const email = `_sess_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows: u } = await pool.query(
    `INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Sessions','Probe',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)]);
  const uid = u[0].id;
  const { rows: o } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WS]);
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [uid, o[0].id]);

  try {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pw }),
    });
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    const get = async (p: string) => {
      const r = await fetch(`${BASE}${p}`, { headers: { cookie, "X-Workspace-Slug": WS } });
      return { status: r.status, body: await r.json().catch(() => null) as any };
    };

    console.log(`\nSessions list — ${BASE}, programme ${CAMP}\n`);

    const s = await get(`/api/admin/camps/${CAMP}/sessions-summary`);
    ok(s.status === 200, "sessions-summary answers", String(s.status));
    const rows: any[] = s.body ?? [];
    ok(rows.length > 0, `returns sessions (${rows.length})`);

    // ── the shape ────────────────────────────────────────────────────────────
    const need = ["rollTaken", "markedCount", "presentCount", "isToday", "isPast"];
    for (const k of need) ok(rows.every(r => k in r), `every row carries ${k}`);

    // ── the cohort is this session's own term ───────────────────────────────
    const { rows: cohort } = await pool.query(`
      SELECT r.term_id, count(*)::int n FROM registrations r JOIN contacts c ON c.id = r.contact_id
      WHERE r.program_id = $1 AND r.status IN ('confirmed','refunded','partially_refunded') AND c.type = 'player'
      GROUP BY r.term_id`, [CAMP]);
    const byTerm = new Map<number | null, number>(cohort.map((r: any) => [r.term_id === null ? null : Number(r.term_id), Number(r.n)]));
    const everyTerm = cohort.reduce((a: number, r: any) => a + Number(r.n), 0);
    ok(!rows.some(r => r.bookedCount === everyTerm) || byTerm.size === 1,
      `no session counts every term at once (${everyTerm} across ${byTerm.size} terms)`);

    const { rows: dts } = await pool.query(`
      SELECT d.id, d.date::text AS date, t.id AS term_id
      FROM camp_dates d LEFT JOIN terms t
        ON t.organization_id = (SELECT organization_id FROM programs WHERE id = $1)
       AND d.date BETWEEN t.start_date AND t.end_date
      WHERE d.camp_id = $1`, [CAMP]);
    const termOf = new Map<number, number | null>(dts.map((r: any) => [Number(r.id), r.term_id === null ? null : Number(r.term_id)]));
    const wrong = rows.filter(r => {
      const t = termOf.get(r.campDateId);
      const expect = t == null ? everyTerm : (byTerm.get(t) ?? 0) + (byTerm.get(null) ?? 0);
      return r.bookedCount !== expect;
    });
    ok(wrong.length === 0, "every Roll count is its own term's cohort",
      wrong.slice(0, 3).map(r => `${r.date}=${r.bookedCount}`).join(" "));

    // ── the roll facts ──────────────────────────────────────────────────────
    const { rows: marks } = await pool.query(`
      SELECT camp_date_id,
             count(*) FILTER (WHERE status IS NOT NULL OR checked_in_at IS NOT NULL)::int marked,
             count(*) FILTER (WHERE status = 'present' OR (status IS DISTINCT FROM 'absent' AND checked_in_at IS NOT NULL))::int present
      FROM attendance WHERE camp_id = $1 GROUP BY camp_date_id`, [CAMP]);
    const markOf = new Map<number, { marked: number; present: number }>(
      marks.map((r: any) => [Number(r.camp_date_id), { marked: Number(r.marked), present: Number(r.present) }]));
    const badMark = rows.filter(r => (markOf.get(r.campDateId)?.marked ?? 0) !== r.markedCount);
    ok(badMark.length === 0, "markedCount matches the attendance table", `${badMark.length} rows differ`);
    ok(rows.filter(r => r.rollTaken).length === [...markOf.values()].filter(v => v.marked > 0).length,
      `rollTaken is true exactly where a mark exists (${rows.filter(r => r.rollTaken).length})`);

    // 🔴 The one that would have gone unnoticed: a session marked ONLY from the
    // phone (checked_in_at, no status) must still read as taken.
    const { rows: phoneOnly } = await pool.query(`
      SELECT camp_date_id FROM attendance WHERE camp_id = $1
      GROUP BY camp_date_id
      HAVING count(*) FILTER (WHERE checked_in_at IS NOT NULL) > 0
         AND count(*) FILTER (WHERE status IS NOT NULL) = 0`, [CAMP]);
    ok(phoneOnly.length === 0 || phoneOnly.every((p: any) => rows.find(r => r.campDateId === Number(p.camp_date_id))?.rollTaken),
      `a phone-only roll reads as taken (${phoneOnly.length} such session${phoneOnly.length === 1 ? "" : "s"})`);

    // ── today, on the server's clock ────────────────────────────────────────
    const today = nzToday();
    const todays = rows.filter(r => r.isToday);
    ok(todays.every(r => r.date === today), `isToday uses NZ's today (${today})`, todays.map(r => r.date).join(","));
    ok(rows.filter(r => r.date === today).length === todays.length, "no session dated today is missed");
    ok(!rows.some(r => r.isPast && r.date >= today), "nothing in the future is marked past");
    // 🔴 A future session is never red — nobody failed to take a roll that has
    // not happened.
    ok(!rows.some(r => !r.isPast && !r.isToday && r.rollTaken === false && r.date < today), "no future session can read as missed");

    const state = (r: any) => r.isToday ? "today" : r.rollTaken ? "done" : r.isPast ? "missed" : "upcoming";
    const tally = rows.reduce((a: any, r) => ({ ...a, [state(r)]: (a[state(r)] ?? 0) + 1 }), {});
    console.log(`\n  ${JSON.stringify(tally)}`);

    // ── the tiles agree with the list ───────────────────────────────────────
    const tc = await get(`/api/admin/camps/${CAMP}/term-counts`);
    ok(tc.status === 200, "term-counts answers");
    ok("currentTermId" in (tc.body ?? {}), "term-counts names the term we are IN");
    const { rows: cur } = await pool.query(
      `SELECT id FROM terms WHERE organization_id = (SELECT organization_id FROM programs WHERE id=$1) AND $2 BETWEEN start_date AND end_date`,
      [CAMP, today]);
    ok((tc.body?.currentTermId ?? null) === (cur[0]?.id ?? null),
      `currentTermId = ${cur[0]?.id ?? "null"} (the term containing ${today})`, String(tc.body?.currentTermId));

    if (cur[0]?.id) {
      const stats = await get(`/api/admin/camps/${CAMP}/stats?termId=${cur[0].id}`);
      const expect = (byTerm.get(Number(cur[0].id)) ?? 0);
      ok(stats.body?.totalRegistrations === expect,
        `the tiles for the current term read ${expect}, the same number the roll does`,
        String(stats.body?.totalRegistrations));
      const sessionForThisTerm = rows.find(r => termOf.get(r.campDateId) === Number(cur[0].id));
      ok(sessionForThisTerm?.bookedCount === expect + (byTerm.get(null) ?? 0),
        "a session in the current term shows that same cohort",
        String(sessionForThisTerm?.bookedCount));
    }

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
  } finally {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [uid]);
    await pool.end();
  }
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error("\n✗", e.message ?? e); process.exit(1); });

// Repairs the Summer 2027 camp dates (programmes 65 FUNdamentals + 66 World Cup).
//
// Daniel, 27 Oct 2026: "the december/jan holiday camp dates look wrong … shifted one
// day … showing we're running on a sunday". He was right: open-summer-camps-2027.mjs
// stamped each day as `2026-12-21T00:00:00+13:00`.toISOString() — i.e. the UTC
// instant 2026-12-20T11:00Z — and Postgres cast that into the DATE column as the
// UTC calendar day, one day early. Every week read Sun–Thu instead of Mon–Fri.
// The October rows (plain ISO dates) were never affected, and no booking, roll or
// coach row hangs off the 36 wrong rows (checked before this was written).
//
// Zach's dates (WhatsApp 14 Oct): 21–23 Dec · 4–8, 11–15, 18–22 Jan — 18 weekdays.
//
//   node --env-file=.env script/fix-summer-camp-dates-2027.mjs            # dry run
//   node --env-file=.env script/fix-summer-camp-dates-2027.mjs --commit
//
// Refuses unless EVERY row of both camps is exactly one day before its intended
// date, so it can neither double-shift nor touch a camp somebody has already fixed.
import pg from "pg";
pg.types.setTypeParser(1082, (v) => v); // DATE as the ISO text Postgres holds, never a local-midnight Date

const COMMIT = process.argv.includes("--commit");
const CAMPS = [65, 66];
const WANT = [
  "2026-12-21", "2026-12-22", "2026-12-23",
  "2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07", "2027-01-08",
  "2027-01-11", "2027-01-12", "2027-01-13", "2027-01-14", "2027-01-15",
  "2027-01-18", "2027-01-19", "2027-01-20", "2027-01-21", "2027-01-22",
];
const dayBefore = (iso) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const WRONG = WANT.map(dayBefore);

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("BEGIN");
try {
  for (const id of CAMPS) {
    const { rows } = await c.query(`select date::text from camp_dates where camp_id=$1 order by date`, [id]);
    const have = rows.map((r) => r.date);
    if (have.length !== WRONG.length || have.some((d, i) => d !== WRONG[i])) {
      throw new Error(`camp ${id}: dates are not the one-day-early set this script repairs — have ${JSON.stringify(have)}; nothing changed`);
    }
    const refs = await c.query(
      `select (select count(*) from registration_items ri join camp_dates cd on cd.id=ri.camp_date_id where cd.camp_id=$1) items,
              (select count(*) from attendance a join camp_dates cd on cd.id=a.camp_date_id where cd.camp_id=$1) att,
              (select count(*) from session_coaches s join camp_dates cd on cd.id=s.camp_date_id where cd.camp_id=$1) coaches`, [id]);
    console.log(`camp ${id}: 18 rows, each one day early (${have[0]} … ${have[17]}); rows hanging off them — items ${refs.rows[0].items}, attendance ${refs.rows[0].att}, coaches ${refs.rows[0].coaches}`);
    const p = await c.query(`select start_date::text s, end_date::text e from programs where id=$1`, [id]);
    if (p.rows[0].s !== WRONG[0] || p.rows[0].e !== WRONG[17]) throw new Error(`camp ${id}: programme start/end ${p.rows[0].s}–${p.rows[0].e} are not the shifted pair; nothing changed`);
    // Two hops: camp_dates_day_uniq is checked per row, so a one-day shift collides
    // with the neighbour it has not moved yet (20 Dec → 21 Dec while 21 Dec exists).
    await c.query(`update camp_dates set date = date + interval '1000 days' where camp_id=$1`, [id]);
    await c.query(`update camp_dates set date = date - interval '999 days' where camp_id=$1`, [id]);
    await c.query(`update programs set start_date = start_date + interval '1 day', end_date = end_date + interval '1 day' where id=$1`, [id]);
    const after = await c.query(`select date::text, to_char(date,'Dy') dow from camp_dates where camp_id=$1 order by date`, [id]);
    const got = after.rows.map((r) => r.date);
    if (got.some((d, i) => d !== WANT[i])) throw new Error(`camp ${id}: after the shift the dates are ${JSON.stringify(got)} — rolled back`);
    if (after.rows.some((r) => r.dow === "Sat" || r.dow === "Sun")) throw new Error(`camp ${id}: a weekend date survived — rolled back`);
    const pa = await c.query(`select start_date::text s, end_date::text e from programs where id=$1`, [id]);
    console.log(`   → ${got[0]} (${after.rows[0].dow}) … ${got[17]} (${after.rows[17].dow}); programme ${pa.rows[0].s} – ${pa.rows[0].e}`);
  }
  if (COMMIT) { await c.query("COMMIT"); console.log("\nCOMMITTED — both summer camps now run Mon–Fri on Zach's dates."); }
  else { await c.query("ROLLBACK"); console.log("\nDRY RUN — rolled back. Pass --commit to apply."); }
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error("\nREFUSED:", e.message);
  process.exitCode = 1;
} finally { await c.end(); }

// A throwaway SIU player with a real password, for driving the SIU Performance app in a simulator.
//   npx tsx --env-file=.env script/_probe-perf-app-player.ts create   → prints email + password
//   npx tsx --env-file=.env script/_probe-perf-app-player.ts check    → what the app wrote
//   npx tsx --env-file=.env script/_probe-perf-app-player.ts cleanup
import pg from "pg";
import crypto from "crypto";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const EMAIL = "delivered+siuperfapp@resend.dev";
const PASSWORD = "AppProbe-2026-x9";
const hash = (p: string) => {
  const salt = crypto.randomBytes(16).toString("hex");
  return `s1$${salt}$${crypto.scryptSync(p, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex")}`;
};

async function cleanup() {
  const ids = (await pool.query(`select id from contacts where email = $1`, [EMAIL])).rows.map((r) => r.id as number);
  for (const id of ids) {
    await pool.query(`delete from perf_rpe where contact_id = $1`, [id]);
    await pool.query(`delete from perf_form_responses where contact_id = $1`, [id]);
    await pool.query(`delete from perf_athlete_accounts where contact_id = $1`, [id]); // sessions + push tokens cascade
    await pool.query(`delete from club_squad_members where contact_id = $1`, [id]);
    await pool.query(`delete from contacts where id = $1`, [id]);
  }
  await pool.query(`delete from club_squads where slug = '_perf-app-probe'`);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "create") {
    await cleanup();
    const { rows: [sq] } = await pool.query(`insert into club_squads (organization_id, name, slug, season_year, is_active, notes) values (2,'_App probe','_perf-app-probe',2026,true,'SIU Performance app probe') returning id`);
    const { rows: [c] } = await pool.query(`insert into contacts (type, first_name, last_name, email) values ('player','Aroha','Probe',$1) returning id`, [EMAIL]);
    await pool.query(`insert into club_squad_members (squad_id, contact_id, role, position) values ($1,$2,'player','Midfielder')`, [sq.id, c.id]);
    const { rows: [u] } = await pool.query(`select id from users where role = 'super_admin' order by id limit 1`);
    await pool.query(`insert into perf_athlete_accounts (organization_id, contact_id, email, invited_by, password_hash) values (2,$1,$2,$3,$4)`, [c.id, EMAIL, u.id, hash(PASSWORD)]);
    console.log(JSON.stringify({ email: EMAIL, password: PASSWORD, contactId: c.id }));
  } else if (cmd === "check") {
    const r = await pool.query(`select r.entry_date, r.answers, r.flag_level, r.flag_reasons, r.entered_by_athlete from perf_form_responses r join contacts c on c.id = r.contact_id where c.email = $1`, [EMAIL]);
    const s = await pool.query(`select s.user_agent, s.revoked_at from perf_athlete_sessions s join perf_athlete_accounts a on a.id = s.account_id where a.email = $1 order by s.id`, [EMAIL]);
    console.log(JSON.stringify({ responses: r.rows, sessions: s.rows }, null, 1));
  } else if (cmd === "cleanup") {
    await cleanup();
    console.log("cleaned");
  }
  await pool.end();
}
main();

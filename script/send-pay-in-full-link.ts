// Email a captain the link to pay the rest of their MFL term in one go —
// through the SAME route the Payments tab button uses, so the send is
// recorded like any other (league_payment_reminders, kind 'pay_in_full').
//
//   npx tsx --env-file=.env script/send-pay-in-full-link.ts <registrationId>
//
// Signs in as a short-lived staff account named "ClubOS Payments" in the MFL
// workspace (the audit row reads "by ClubOS Payments"), sends, then deletes
// the account. Refuses if the route says there is nothing left to pay.
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.MFL_ADMIN_BASE || "https://app.usg.co.nz";
const WORKSPACE = "mini-football-leagues";
const regId = Number(process.argv[2]);
if (!Number.isInteger(regId)) { console.error("usage: send-pay-in-full-link.ts <registrationId>"); process.exit(1); }

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let userId: number | null = null;
  try {
    const before = (await pool.query(`select id, team_name, payment_mode, weeks_paid, weeks_total, weekly_amount_cents, balance_status from registrations where id=$1`, [regId])).rows[0];
    if (!before) throw new Error(`registration ${regId} not found`);
    console.log(`\n  ${before.team_name} (#${regId}) · ${before.payment_mode} · ${before.weeks_paid}/${before.weeks_total} weeks paid · balance ${before.balance_status}`);

    const email = `_clubos_payments_${Date.now()}@usg.co.nz`;
    const pw = `P${Math.random().toString(36).slice(2)}!aA9`;
    userId = (await pool.query(
      `insert into users (email, first_name, last_name, password, role, active) values ($1,'ClubOS','Payments',$2,'team_member',true) returning id`,
      [email, await bcrypt.hash(pw, 10)])).rows[0].id;
    const orgId = (await pool.query(`select id from organizations where slug=$1`, [WORKSPACE])).rows[0].id;
    await pool.query(`insert into user_organizations (user_id, organization_id, role, tabs) values ($1,$2,'admin',NULL)`, [userId, orgId]);

    const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
    if (!login.ok) throw new Error(`login HTTP ${login.status}`);
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];

    const res = await fetch(`${BASE}/api/admin/league/registrations/${regId}/payment-reminder`, {
      method: "POST", headers: { cookie, "X-Workspace-Slug": WORKSPACE, "Content-Type": "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    console.log(`  route → HTTP ${res.status}`, JSON.stringify(body).slice(0, 200));
    if (!res.ok) throw new Error(body?.message || `HTTP ${res.status}`);

    const row = (await pool.query(`select id, kind, sent_to, sent_by_name, payoff_cents, missed_cents, token from league_payment_reminders where registration_id=$1 order by id desc limit 1`, [regId])).rows[0];
    console.log(`  recorded: #${row.id} kind=${row.kind} to=${row.sent_to} by="${row.sent_by_name}" payoff=$${(row.payoff_cents / 100).toFixed(2)} missed=$${(row.missed_cents / 100).toFixed(2)}`);
    const link = `https://join.minifootball.co.nz/league/balance/${regId}?rt=${row.token}`;
    const page = await fetch(link, { redirect: "manual" });
    console.log(`  pay page ${page.status} → ${link.slice(0, 60)}…`);
    const log = (await pool.query(`select id, subject, sent_at from email_logs where registration_id=$1 order by id desc limit 1`, [regId])).rows[0];
    if (log) console.log(`  email log: "${log.subject}" · ${new Date(log.sent_at).toISOString()}`);
  } finally {
    if (userId) await pool.query(`delete from users where id=$1`, [userId]).catch(() => {});
    await pool.end();
  }
}
main().catch((e) => { console.error("\n  ✗", e.message); process.exit(1); });

// Live end-to-end check of Payments → Move team, against PRODUCTION.
// Creates a throwaway team (Wednesday 5's, $240 paid), moves it to Wednesday 7's
// at $480 with an emailed link (to the captain address below), checks every
// number in the database and the pay page, checks the refusals, then deletes
// everything it made. Signs in with the session saved by scripts/clubos_chat.
//   npx tsx --env-file=.env script/_verify-league-move-live.ts [captain-email]
import fs from "fs";
import pg from "pg";

const BASE = "https://app.usg.co.nz";
const EMAIL = process.argv[2] || "daniel@cufc.co.nz";
const session = JSON.parse(fs.readFileSync(process.env.CLUBOS_SESSION_FILE || "/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/credentials/clubos-session.json", "utf8"));
const H = { Cookie: session.cookie, "Content-Type": "application/json", "X-Workspace-Slug": "mini-football-leagues" };
const api = async (m: string, p: string, b?: any) => {
  const r = await fetch(BASE + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
};
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}`); };

await db.connect();
const FROM = 30, TO = 21, FULL = 22; // Wednesday 5's, Wednesday 7's, Thursday 7's (Term 4)
let contactId = 0, regId = 0, teamId = 0;
try {
  contactId = (await db.query(`INSERT INTO contacts (type, first_name, last_name, email) VALUES ('player','Movetest','Delete-me',$1) RETURNING id`, [EMAIL])).rows[0].id;
  regId = (await db.query(`INSERT INTO registrations (program_id, contact_id, status, total_cents, amount_paid, payment_mode, deposit_cents, balance_cents, balance_status, league_division_id, team_name)
    VALUES (23,$1,'confirmed',24000,'240.00','upfront',24000,0,'paid',$2,'ZZ Move Test') RETURNING id`, [contactId, FROM])).rows[0].id;
  teamId = (await db.query(`INSERT INTO league_teams (organization_id, competition_id, division_id, name, active, registration_id, payment_status, contact_name, contact_email)
    VALUES (3,6,$1,'ZZ Move Test (delete)',true,$2,'paid_in_full','Movetest Delete-me',$3) RETURNING id`, [FROM, regId, EMAIL])).rows[0].id;
  console.log(`fixtures made: contact ${contactId} · registration ${regId} · team ${teamId}`);

  const opt = await api("GET", `/api/admin/league/registrations/${regId}/move-options`);
  ok(opt.status === 200 && opt.json.paidCents === 24000 && opt.json.fixtures === 0 && !opt.json.feeLocked, `move-options: paid $240, no fixtures, fee editable (${opt.status})`);
  ok(opt.json.divisions?.some((d: any) => d.id === TO && d.priceCents === 60000), "lists Wednesday 7's at today's $600");

  const r1 = await api("POST", `/api/admin/league/registrations/${regId}/move`, { divisionId: FROM, totalCents: 24000 });
  ok(r1.status === 400, `refused: same league (${r1.status} ${r1.json.message})`);
  const r2 = await api("POST", `/api/admin/league/registrations/${regId}/move`, { divisionId: TO, totalCents: 20000 });
  ok(r2.status === 400, `refused: fee below what was paid (${r2.status} ${r2.json.message})`);
  const r3 = await api("POST", `/api/admin/league/registrations/${regId}/move`, { divisionId: FULL, totalCents: 48000 });
  ok(r3.status === 409 && r3.json.full === true, `refused: full league without override (${r3.status} ${r3.json.message})`);
  const unchanged = (await db.query(`SELECT division_id FROM league_teams WHERE id=$1`, [teamId])).rows[0];
  ok(unchanged.division_id === FROM, "refusals changed nothing");

  const mv = await api("POST", `/api/admin/league/registrations/${regId}/move`, { divisionId: TO, totalCents: 48000, notify: true });
  ok(mv.status === 200 && mv.json.owedCents === 24000 && mv.json.to === "Wednesday 7's", `moved: owes $${(mv.json.owedCents ?? 0) / 100} (${mv.status} ${mv.json.message || ""})`);
  ok(mv.json.emailed === true, `payment link emailed to ${EMAIL}`);
  ok(mv.json.payUrl === `https://join.minifootball.co.nz/league/balance/${regId}`, "returns the pay link to copy");

  const reg = (await db.query(`SELECT payment_mode,total_cents,deposit_cents,balance_cents,balance_status,balance_due_date,league_division_id,amount_paid FROM registrations WHERE id=$1`, [regId])).rows[0];
  ok(reg.payment_mode === "installment" && reg.total_cents === 48000 && reg.deposit_cents === 24000 && reg.balance_cents === 24000, "registration: fee $480, paid $240, balance $240");
  ok(reg.balance_status === "scheduled" && reg.balance_due_date === null, "balance has NO due date — the cron can never charge it");
  ok(reg.league_division_id === TO && reg.amount_paid === "240.00", "registration's own league moved; amount paid untouched");
  const team = (await db.query(`SELECT division_id,payment_status FROM league_teams WHERE id=$1`, [teamId])).rows[0];
  ok(team.division_id === TO && team.payment_status === "deposit_paid", "team now in Wednesday 7's, marked deposit paid");
  const audit = (await db.query(`SELECT details,user_id FROM audit_logs WHERE action='league_team_moved' AND entity_id=$1`, [regId])).rows;
  ok(audit.length === 1 && audit[0].user_id != null, "one audit row, with who did it");
  const rem = (await db.query(`SELECT kind,payoff_cents,sent_by_name FROM league_payment_reminders WHERE registration_id=$1`, [regId])).rows;
  ok(rem.length === 1 && rem[0].kind === "team_moved" && rem[0].payoff_cents === 24000, `reminder recorded (sent by ${rem[0]?.sent_by_name})`);

  const bd = await api("GET", `/api/admin/league/registrations/${regId}/payment-breakdown`);
  ok(bd.json.paidCents === 24000 && bd.json.remainingCents === 24000 && bd.json.balance?.amountCents === 24000, "breakdown: paid $240, remaining $240, a Balance row");
  const pi = await fetch("https://join.minifootball.co.nz/api/public/league/balance-intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registrationId: regId }) }).then((r) => r.json()) as any;
  ok(pi.amountCents === 24000 && !!pi.clientSecret, "the captain's pay page asks for exactly $240");
  const page = await fetch(`https://join.minifootball.co.nz/league/balance/${regId}`);
  ok(page.status === 200, "pay page answers 200");
} catch (e) {
  fail++; console.error(e);
} finally {
  // Cleanup — cancel any open balance intent, then remove every row we made.
  if (regId) {
    const r = (await db.query(`SELECT balance_payment_intent_id FROM registrations WHERE id=$1`, [regId])).rows[0];
    if (r?.balance_payment_intent_id) {
      await fetch(`https://api.stripe.com/v1/payment_intents/${r.balance_payment_intent_id}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
    }
    await db.query(`DELETE FROM audit_logs WHERE action='league_team_moved' AND entity_id=$1`, [regId]);
    await db.query(`DELETE FROM email_logs WHERE registration_id=$1`, [regId]); // the test email logs against the registration
  }
  if (teamId) await db.query(`DELETE FROM league_teams WHERE id=$1`, [teamId]);
  if (regId) await db.query(`DELETE FROM registrations WHERE id=$1`, [regId]);
  if (contactId) await db.query(`DELETE FROM contacts WHERE id=$1`, [contactId]);
  const left = (await db.query(`SELECT (SELECT count(*) FROM league_teams WHERE id=$1)+(SELECT count(*) FROM registrations WHERE id=$2)+(SELECT count(*) FROM contacts WHERE id=$3) AS n`, [teamId, regId, contactId])).rows[0].n;
  ok(Number(left) === 0, "cleaned up: nothing left behind");
  await db.end();
  console.log(`\n${pass} passed · ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}

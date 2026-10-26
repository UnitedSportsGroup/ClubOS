// Rambo answers the money question for someone who may see registrations, and
// refuses it — plainly, with no figure — for someone who may not. Two paid
// prompts (~4c) against PRODUCTION, through Rambo's own chat routes.
//   npx tsx --env-file=.env script/_verify-rambo-access-live.ts
//
// Daniel, 2026-10-27: "if someone like Connor only has access to football
// schools and shouldn't know the numbers of 4 to 8, he should not be able to
// answer that for him … 'Sorry, you do not have access to this kind of data.'"
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WS = "christchurch-united";
const QUESTION = "how much money have we made off fundamentals camp this year";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d.replace(/\s+/g, " ").slice(0, 260)}` : ""}`); good ? pass++ : fail++; };
const users: number[] = [];

async function person(tabs: string[] | null, role: "admin" | "team_member", last: string) {
  const email = `_ramboaccess_${last.toLowerCase()}_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Probe',$2,$3,'team_member',true) RETURNING id`, [email, last, await bcrypt.hash(pw, 10)]);
  users.push(rows[0].id);
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,1,$2,$3)`, [rows[0].id, role, tabs]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  if (!login.ok) throw new Error(`login HTTP ${login.status}`);
  return (login.headers.get("set-cookie") || "").split(";")[0];
}

async function ask(cookie: string): Promise<string> {
  const h = { "Content-Type": "application/json", cookie, "X-Workspace-Slug": WS };
  const t = await (await fetch(`${BASE}/api/admin/rambo/threads`, { method: "POST", headers: h, body: "{}" })).json() as any;
  const r = await fetch(`${BASE}/api/admin/rambo/threads/${t.thread.id}/ask`, { method: "POST", headers: h, body: JSON.stringify({ question: QUESTION }) });
  const j = JSON.parse((await r.text()).trim()) as any;
  if (!j.ok) throw new Error(j.message || "ask failed");
  return String(j.message?.content ?? "");
}

try {
  console.log(`\nRambo — who may know the camp takings, against ${BASE}\n`);
  const admin = await person(null, "admin", "Admin");
  const schools = await person(["football-in-schools"], "team_member", "Schools");

  const yes = await ask(admin);
  ok("a workspace admin gets the figure in dollars", /\$[\d,]+/.test(yes) && /(taken|net)/i.test(yes), yes);
  ok("…and is told what the figure is and is not (ClubOS takings, not Xero)", /(ClubOS|Xero|online|counter)/i.test(yes), yes);

  const no = await ask(schools);
  ok("someone with only Football in Schools is told they do not have access", /(access|Registrations)/i.test(no) && /(super admin|Daniel)/i.test(no), no);
  ok("…and gets NO dollar figure, no count, and no guess from the budget files", !/\$\s?[\d,]+/.test(no) && !/\b\d{3,}\b/.test(no) && !/budget/i.test(no), no);
} catch (e: any) {
  ok("the proof ran", false, String(e?.message ?? e));
} finally {
  for (const id of users) {
    await pool.query(`DELETE FROM kb_chat_sessions WHERE user_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [id]));
  }
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

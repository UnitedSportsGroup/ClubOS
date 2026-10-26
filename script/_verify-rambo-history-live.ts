// Rambo answers the question that exposed the gap, through PRODUCTION's own
// chat routes, as an ordinary workspace admin (three paid prompts, ~15c):
//   npx tsx --env-file=.env script/_verify-rambo-history-live.ts
//
// Daniel, 2026-10-27 (screenshot): "Why are you only showing numbers for April
// and October? … I believe we still weren't doing the registrations on ClubOS
// at that point, but the historical data should still be loaded." The answer
// must now carry the January (Dec–Jan summer) camp, the April and the Sep–Oct
// camp, and a year total — from camp_history, not programme_revenue alone.
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WS = "christchurch-united";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d.replace(/\s+/g, " ").slice(0, 320)}` : ""}`); good ? pass++ : fail++; };
const users: number[] = [];

async function person(tabs: string[] | null, role: "admin" | "team_member", last: string) {
  const email = `_rambohist_${last.toLowerCase()}_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Probe',$2,$3,'team_member',true) RETURNING id`, [email, last, await bcrypt.hash(pw, 10)]);
  users.push(rows[0].id);
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,1,$2,$3)`, [rows[0].id, role, tabs ? JSON.stringify(tabs) : null]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  if (!login.ok) throw new Error(`login HTTP ${login.status}`);
  return (login.headers.get("set-cookie") || "").split(";")[0];
}

async function ask(cookie: string, question: string): Promise<{ content: string; tools: string[] }> {
  const h = { "Content-Type": "application/json", cookie, "X-Workspace-Slug": WS };
  const t = await (await fetch(`${BASE}/api/admin/rambo/threads`, { method: "POST", headers: h, body: "{}" })).json() as any;
  const r = await fetch(`${BASE}/api/admin/rambo/threads/${t.thread.id}/ask`, { method: "POST", headers: h, body: JSON.stringify({ question }) });
  const j = JSON.parse((await r.text()).trim()) as any;
  if (!j.ok) throw new Error(j.message || "ask failed");
  return { content: String(j.message?.content ?? ""), tools: (j.message?.toolsUsed ?? j.toolsUsed ?? []) as string[] };
}

try {
  console.log(`\nRambo — the history gap, against ${BASE}\n`);
  const admin = await person(null, "admin", "Admin");

  const a = await ask(admin, "how much money have we made off fundamentals camp this year");
  ok("the camp year includes January (the Dec–Jan summer camp), April and Sep–Oct", /jan/i.test(a.content) && /apr/i.test(a.content) && /(sep|oct)/i.test(a.content), a.content);
  ok("…with a dollar figure for the year and for each holiday", (a.content.match(/\$[\d,]+/g) ?? []).length >= 4, a.content);
  ok("…and it says January was sold through Shopify, not that ClubOS has no January", /shopify/i.test(a.content) && !/no january|there are no january camps/i.test(a.content), a.content);
  ok("…without 'only April and October'", !/only (showing )?(april|two)/i.test(a.content), a.content);

  const b = await ask(admin, "what is a U4-U8 kid worth to us over their time with the club, and how long do they usually stay?");
  ok("lifetime value answers with a mean and median and a stay in terms", /\$[\d,]+/.test(b.content) && /median/i.test(b.content) && /term/i.test(b.content), b.content);
  ok("…and names where the value comes from (Pre-Academy / moving up)", /pre-academy/i.test(b.content), b.content);

  const c = await ask(admin, "how did the academy do in 2025 compared to 2024?");
  ok("a 2025 vs 2024 question is answered from the history with both years", /2025/.test(c.content) && /2024/.test(c.content) && /\$[\d,]+/.test(c.content), c.content);
  ok("…not as 'ClubOS has nothing before 2026'", !/no (data|records?) (for|before) 20(24|25)/i.test(c.content), c.content);
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

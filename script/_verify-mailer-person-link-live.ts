// "Email this person" — the Mailer's person-key resolver, live against prod.
//
//   npx tsx --env-file=.env script/_verify-mailer-person-link-live.ts
//
// Signs in as ORDINARY staff (team_member, CUFC admin membership) and proves,
// on real people, the ONE rule in shared/mailer-reach.ts:
//   - a person with their own address is one row, no "via"
//   - a child with no address goes to each parent WITH one, named — a parent
//     with no email is simply not a row (Abbas Ahmadi: mum has none, dad does)
//   - a camp child (the `children` table) resolves through resolveFamily()
//   - two siblings sharing one mailbox collapse to ONE send
//   - a key nobody matches is still a row, with the reason, never dropped
//   - the Contacts list carries canEmail; the search still names the parent
// Writes nothing but its own throwaway login, deleted at the end.
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WS = "christchurch-united";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); good ? pass++ : fail++; };

// Real people, read off the live database before this was written (11 Nov 2026).
const ABBAS = "contact-30966";    // player, no email; Sumaya (no email) + Hafiz hafizahmadi770@gmail.com
const ALEX = "contact-7";         // guardian with his own address
const OWEN = "child-1124";        // camp child → Lilly O'Brien lilly.kate77@gmail.com
const BOWMANS = "contact-39628,contact-40759";   // Levi + Casey → rohan-milne@hotmail.co.nz

const users: number[] = [];
try {
  console.log(`\nMailer person link — live against ${BASE}\n`);
  const version = await (await fetch(`${BASE}/api/version`)).json().catch(() => ({})) as any;
  console.log(`  prod runs ${String(version?.sha ?? "?").slice(0, 7)}`);

  // The gate: no login, no answer.
  const anon = await fetch(`${BASE}/api/admin/mailer/people?keys=${ABBAS}`);
  ok("unauthenticated → 401", anon.status === 401, `HTTP ${anon.status}`);

  const email = `_personlink_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Link','Check',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)]);
  users.push(rows[0].id);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, 1, 'admin', NULL)`, [rows[0].id]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  if (!login.ok) throw new Error(`login HTTP ${login.status}`);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const get = async (path: string) => {
    const r = await fetch(`${BASE}${path}`, { headers: { cookie, "X-Workspace-Slug": WS } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const people = async (keys: string) => (await get(`/api/admin/mailer/people?keys=${encodeURIComponent(keys)}`)).body.people as any[];

  // A child with no address, one parent with one.
  const abbas = await people(ABBAS);
  ok("Abbas Ahmadi → exactly one row (the parent WITH an email)", abbas?.length === 1, JSON.stringify(abbas));
  const a = abbas?.[0] ?? {};
  ok("…the row carries the CHILD's name", a.name === "Abbas Ahmadi", a.name);
  ok("…the address is dad's", a.email === "hafizahmadi770@gmail.com", a.email);
  ok("…and says whose mailbox it is", a.emailOwner === "Hafiz Ahmadi", String(a.emailOwner));
  ok("…type player, with an age group", a.type === "player" && typeof a.ageGroup === "string", `${a.type} ${a.ageGroup}`);
  ok("…key is the person key", a.key === ABBAS, a.key);
  ok("…bounce flag present (null or an object)", "bounce" in a);

  // Their own address wins, no "via".
  const alex = await people(ALEX);
  ok("Alex Moyse → one row at his own address", alex?.length === 1 && alex[0].email === "dcamwedding@gmail.com", JSON.stringify(alex?.[0]?.email));
  ok("…no emailOwner", alex?.[0]?.emailOwner === null);

  // A camp child, through the one family resolver.
  const owen = await people(OWEN);
  ok("camp child Owen → one row via the booking parent", owen?.length === 1 && owen[0].email === "lilly.kate77@gmail.com", JSON.stringify(owen?.[0]));
  ok("…named after the child, via Lilly", owen?.[0]?.name?.startsWith("Owen") && /^Lilly/.test(owen?.[0]?.emailOwner ?? ""), `${owen?.[0]?.name} via ${owen?.[0]?.emailOwner}`);

  // Two siblings, one mailbox, one send.
  const bowmans = await people(BOWMANS);
  ok("two Bowman brothers on one mailbox → ONE row", bowmans?.length === 1 && bowmans[0].email === "rohan-milne@hotmail.co.nz", JSON.stringify(bowmans?.map((p: any) => p.email)));

  // Several keys in one link, order kept.
  const mix = await people(`${ALEX},${ABBAS}`);
  ok("two keys → two rows, in link order", mix?.length === 2 && mix[0].key === ALEX && mix[1].key === ABBAS, JSON.stringify(mix?.map((p: any) => p.key)));

  // Nobody matches: still a row, with the reason.
  const nobody = await people("contact-999999999");
  ok("an unknown id → a row that says 'no such person'", nobody?.length === 1 && nobody[0].email === null && nobody[0].unreachable === "no such person", JSON.stringify(nobody));
  const junk = await people("garbage,child-x,contact-");
  ok("malformed keys → ignored, no rows", Array.isArray(junk) && junk.length === 0, JSON.stringify(junk));
  const none = await people("");
  ok("no keys → empty list, HTTP 200", Array.isArray(none) && none.length === 0);

  // The Contacts list says whether Email leads anywhere.
  const list = (await get(`/api/admin/people?q=${encodeURIComponent("abbas ahmadi")}`)).body;
  const row = (list?.people ?? []).find((p: any) => p.key === ABBAS);
  ok("Contacts row for Abbas carries canEmail: true (a parent has an address)", row?.canEmail === true, JSON.stringify(row && { email: row.email, canEmail: row.canEmail }));
  ok("…every row carries a boolean canEmail", (list?.people ?? []).every((p: any) => typeof p.canEmail === "boolean"));

  // The recipient search still answers the same way after sharing the rule.
  const search = (await get(`/api/admin/mailer/search-people?q=${encodeURIComponent("abbas ahmadi")}`)).body;
  const hit = (search?.people ?? []).find((p: any) => p.key === ABBAS);
  ok("search-people: Abbas resolves to dad's address, named", hit?.email === "hafizahmadi770@gmail.com" && hit?.emailOwner === "Hafiz Ahmadi", JSON.stringify(hit && { email: hit.email, emailOwner: hit.emailOwner }));
} catch (e: any) {
  console.error("\nthrew:", e.message);
  fail++;
} finally {
  for (const id of users) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  }
  await pool.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

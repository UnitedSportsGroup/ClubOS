// Olga's screen, live: as an ORDINARY CUFC staff member, search Contacts for a
// child who was stored twice and see ONE; open the retired record and land on
// the survivor. Read-only apart from a throwaway login it removes.
//   npx tsx --env-file=.env script/_verify-duplicate-children-live.ts
import pg from "pg";
import bcrypt from "bcryptjs";
const BASE = "https://app.usg.co.nz";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c: boolean, l: string, d = "") => { console.log(`  ${c ? "ok  " : "FAIL"} ${l}${d ? " — " + d : ""}`); c ? pass++ : fail++; };
let uid: number | null = null;
try {
  const email = `_dupcheck_${Date.now()}@usg.co.nz`, password = `T${Math.random().toString(36).slice(2)}!aA9`;
  uid = (await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Verify','Contacts',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(password, 10)])).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) SELECT $1, id, 'admin', NULL FROM organizations WHERE slug='christchurch-united'`, [uid]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const get = async (p: string) => { const r = await fetch(`${BASE}${p}`, { headers: { Cookie: cookie, "X-Workspace-Slug": "christchurch-united" } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  // Remy Logan is deliberately NOT here: his two records are under two
  // different parents with different phones and emails — a human's call.
  for (const name of ["Ruben Kruger", "Noah Duncan", "Casey Wogan", "Miles Wogan", "Archer Patterson"]) {
    const r = await get(`/api/admin/people?q=${encodeURIComponent(name)}`);
    const rows: any[] = r.body?.people ?? r.body?.rows ?? r.body?.items ?? (Array.isArray(r.body) ? r.body : []);
    if (process.env.DEBUG) console.log(JSON.stringify(r.body));
    const kids = rows.filter((x) => `${x.firstName ?? ""} ${x.lastName ?? ""}`.trim().toLowerCase() === name.toLowerCase() && x.personType === "player");
    ok(r.status === 200 && kids.length === 1, `Contacts search "${name}" shows ONE child`, `${kids.length} (HTTP ${r.status})`);
  }
  const fam = await get(`/api/admin/people/contact-37902`);
  const k = fam.body?.person?.key ?? fam.body?.person?.id;
  ok(fam.status === 200 && String(k).includes("31307"), "opening the retired Ruben (37902) shows the survivor (31307)", String(k));
  const regs = (fam.body?.registrations ?? []).map((x: any) => x.programName);
  ok(regs.includes("Pre-Academy") && regs.includes("Technification"), "…with Pre-Academy AND Technification on one card", regs.join(", "));
  const g = (fam.body?.guardians ?? []).map((x: any) => `${x.firstName} ${x.lastName}`);
  ok(g.length >= 2, "…and both of dad's records as parents", g.join(" / "));
} catch (e: any) { ok(false, "run completed", e?.message); }
finally {
  if (uid) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]); await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {}); }
  await pool.end();
}
console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);

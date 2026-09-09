// Registrations belong to ONE workspace, and the page must never mix two.
//
// Daniel, 2026-09-10, with a screenshot of Christchurch United's Registrations
// page carrying "Mini Football Leagues — Term 4" rows and totalling the money
// across both: "update it so that the registrations/payments are showing per
// workspace."
//
// The cause was not the scope rule, which was right. It was the PAGE: its query
// used a bare fetch() instead of workspaceFetch(), so no X-Workspace-Slug ever
// reached the server, and registrationOrgScope() then fell back to every
// workspace the caller belongs to. Ryan is an admin of both clubs, so he was
// shown the union — and the "Taken at the office" total at the top added up
// two clubs' money.
//
//   npx tsx --env-file=.env script/_verify-registrations-workspace-scope.ts
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`);
  good ? pass++ : fail++;
};
const users: number[] = [];

async function main() {
  console.log(`\nRegistrations are scoped to one workspace — ${BASE}\n`);

  // Ryan's shape exactly: an admin of BOTH Christchurch United and Mini
  // Football Leagues. A single-workspace account cannot reproduce this.
  const email = `_scope_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email,first_name,last_name,password,role,active)
     VALUES ($1,'Scope','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  users.push(rows[0].id);
  const { rows: orgs } = await pool.query(
    `SELECT id, slug FROM organizations WHERE slug IN ('christchurch-united','mini-football-leagues')`);
  for (const o of orgs) {
    await pool.query(
      `INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`,
      [rows[0].id, o.id]);
  }
  const cufc = orgs.find((o: any) => o.slug === "christchurch-united")!;
  const mfl = orgs.find((o: any) => o.slug === "mini-football-leagues")!;

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }) });
  if (!login.ok) throw new Error(`login HTTP ${login.status}`);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];

  // Which org each row really belongs to, straight from the database.
  const orgOf = new Map<number, number>();
  for (const r of (await pool.query(
    `SELECT r.id, p.organization_id FROM registrations r JOIN programs p ON p.id = r.program_id`)).rows) {
    orgOf.set(r.id, r.organization_id);
  }

  const get = (slug?: string) => fetch(`${BASE}/api/admin/registrations`, {
    headers: slug ? { cookie, "X-Workspace-Slug": slug } : { cookie },
  });

  const foreign = (list: any[], mine: number) =>
    list.filter((r) => { const o = orgOf.get(r.id); return o != null && o !== mine; });

  for (const [label, org] of [["Christchurch United", cufc], ["Mini Football Leagues", mfl]] as const) {
    const res = await get(org.slug);
    ok(`${label}: the list loads`, res.status === 200, `HTTP ${res.status}`);
    if (res.status !== 200) continue;
    const list: any[] = await res.json();
    const strays = foreign(list, org.id);
    ok(`${label}: every row belongs to this workspace`, strays.length === 0,
      strays.length ? `${strays.length} foreign row(s), e.g. #${strays[0]?.orderNumber ?? strays[0]?.id}` : `${list.length} rows`);
  }

  // 🔴 The actual defect: no header at all. A page using a bare fetch() lands
  // here, and this is what put two clubs on one screen.
  const bare = await get();
  const bareList: any[] = bare.status === 200 ? await bare.json() : [];
  const mixed = new Set(bareList.map((r) => orgOf.get(r.id)).filter((v) => v != null));
  ok("with NO workspace header the server does not mix workspaces",
    bare.status !== 200 || mixed.size <= 1,
    bare.status !== 200 ? `HTTP ${bare.status} (refused — good)` : `returned rows from ${mixed.size} workspaces`);
}

main()
  .catch((e) => { console.error("\nthrew:", e.message); fail++; })
  .finally(async () => {
    for (const id of users) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {});
    }
    await pool.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });

/**
 * Financial Insight — live verification against production, as ORDINARY USG staff (never the super admin).
 *   npx tsx --env-file=.env script/_verify-finance-insight-live.ts
 * Proves: the tab gate (a member without the tab is refused), the status endpoint, that the MODEL is refused without the
 * password, that a wrong password is refused, that the right password unlocks and the model then serves with the totals,
 * that lock re-locks, and that the internal snapshot endpoint refuses a bad token. Throwaway accounts are deleted after.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0; const created: number[] = [];
const check = (label: string, good: boolean, detail = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); good ? pass++ : fail++; };
async function account(tag: string, tabs: string[] | null): Promise<string> {
  const email = `_fi_${tag}_${Date.now()}@usg.co.nz`; const pw = `F${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1, 'Finance', 'Probe', $2, 'team_member', true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  created.push(rows[0].id);
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug = 'united-sports-group'`);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, $2, 'team_member', $3)`, [rows[0].id, org[0].id, tabs == null ? null : JSON.stringify(tabs)]);
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  if (!res.ok) throw new Error(`login ${tag}: HTTP ${res.status}`);
  return (res.headers.get("set-cookie") || "").split(";")[0];
}
const call = (cookie: string | null, path: string, init: RequestInit = {}) => fetch(`${BASE}/api/admin/finance-insight/${path}`, { ...init, headers: { ...(cookie ? { cookie } : {}), "X-Workspace-Slug": "united-sports-group", "Content-Type": "application/json", ...(init.headers || {}) } });
async function main() {
  const password = readFileSync("/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/credentials/finance-insight-password.txt", "utf8").trim();
  console.log(`\n  Financial Insight — live verification against ${BASE}\n`);
  try {
    const anon = await call(null, "status"); check("no session → 401", anon.status === 401, `HTTP ${anon.status}`);
    const noTab = await account("notab", ["dashboard"]);
    const nt = await call(noTab, "status"); check("a USG member WITHOUT the tab is refused", nt.status === 403, `HTTP ${nt.status}`);
    const staff = await account("tab", ["finance-insight"]);
    const st = await call(staff, "status"); const sj: any = await st.json();
    check("a member WITH the tab reads status", st.status === 200, `HTTP ${st.status}`);
    check("password is configured on the server", sj.configured === true);
    check("session starts LOCKED", sj.unlocked === false);
    const m0 = await call(staff, "model"); check("the model is refused while locked", m0.status === 403, `HTTP ${m0.status}`);
    const wrong = await call(staff, "unlock", { method: "POST", body: JSON.stringify({ password: "not-it" }) }); check("a wrong password is refused", wrong.status === 401, `HTTP ${wrong.status}`);
    const right = await call(staff, "unlock", { method: "POST", body: JSON.stringify({ password }) }); check("the right password unlocks", right.status === 200, `HTTP ${right.status}`);
    const m1 = await call(staff, "model"); const mj: any = await m1.json().catch(() => ({}));
    check("the model serves once unlocked", m1.status === 200, `HTTP ${m1.status}`);
    if (m1.status === 200) {
      const nodes = mj.model?.nodes ?? []; const inc = nodes.filter((n: any) => n.side === "income").reduce((x: number, n: any) => x + Object.values(n.vals as Record<string, number>).reduce((a, b) => a + b, 0), 0);
      check("the snapshot carries the club's lines", nodes.length > 200, `${nodes.length} nodes`);
      check("income sums to the P&L (2,210,334)", Math.abs(inc - 2210334.07) < 1, inc.toFixed(2));
      check("snapshot is dated", !!mj.generatedAt, String(mj.generatedAt));
    }
    const lk = await call(staff, "lock", { method: "POST" }); check("lock re-locks", lk.status === 200);
    const m2 = await call(staff, "model"); check("the model is refused again after lock", m2.status === 403, `HTTP ${m2.status}`);
    const bad = await fetch(`${BASE}/api/internal/finance-insight/snapshot`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer nope" }, body: JSON.stringify({ model: { nodes: [], months: [] } }) });
    check("the internal snapshot endpoint refuses a bad token", bad.status === 401, `HTTP ${bad.status}`);
  } finally {
    for (const id of created) { await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]); await pool.query(`DELETE FROM users WHERE id = $1`, [id]); }
    await pool.end();
  }
  console.log(`\n  ${pass} passed · ${fail} failed\n`); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

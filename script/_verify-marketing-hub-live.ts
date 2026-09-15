/**
 * Marketing hub — prove, against PRODUCTION, that the right people can open it
 * and that everyone who can sees the same numbers.
 *
 *   npx tsx --env-file=.env script/_verify-marketing-hub-live.ts
 *
 * 🔴 It signs in as ORDINARY staff, never as Daniel. A super admin short-circuits
 * the membership and tab checks, so "it works for me" proves nothing about
 * anybody else (Daniel, 2026-09-10: "I ship features, think the work is done,
 * but actually only i can see it"). Four throwaway accounts, deleted at the end:
 *
 *   usg-admin   United Sports Group admin (sees every USG tab)
 *   usg-staff   USG team member granted ONLY the Marketing tab — the realistic grant
 *   usg-other   USG team member with a different tab and not this one
 *   mfl-admin   admin of Mini Football only
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const USG = "united-sports-group";
const MFL = "mini-football-leagues";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0;
let fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};

const created: number[] = [];

async function account(tag: string, workspace: string, role: string, tabs: string[] | null): Promise<string> {
  const email = `_mhub_${tag}_${Date.now()}@usg.co.nz`;
  const pw = `M${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1, 'Marketing', 'Probe', $2, 'team_member', true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)],
  );
  created.push(rows[0].id);
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug = $1`, [workspace]);
  await pool.query(
    `INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, $2, $3, $4)`,
    [rows[0].id, org[0].id, role, tabs == null ? null : JSON.stringify(tabs)],
  );
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  if (!res.ok) throw new Error(`login for ${tag} failed: HTTP ${res.status}`);
  return (res.headers.get("set-cookie") || "").split(";")[0];
}

const call = (cookie: string | null, path: string, workspace: string | null, init: RequestInit = {}) =>
  fetch(`${BASE}/api/admin/marketing-hub/${path}`, {
    ...init,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(workspace ? { "X-Workspace-Slug": workspace } : {}),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

async function main() {
  console.log(`\nMarketing hub — who can open it, on ${BASE}\n`);

  const anon = await call(null, "overview", USG);
  ok("signed out → 401", anon.status === 401, `HTTP ${anon.status}`);

  const admin = await account("usg_admin", USG, "admin", null);
  const staff = await account("usg_staff", USG, "team_member", ["marketing-hub"]);
  const other = await account("usg_other", USG, "team_member", ["calendar"]);
  const mfl = await account("mfl_admin", MFL, "admin", null);

  console.log("\nGates");
  const noHeader = await call(admin, "overview", null);
  ok("no workspace header → 400, for everyone", noHeader.status === 400, `HTTP ${noHeader.status}`);
  const fromMfl = await call(mfl, "overview", MFL);
  ok("an admin of another workspace, from that workspace → 404", fromMfl.status === 404, `HTTP ${fromMfl.status}`);
  const mflIntoUsg = await call(mfl, "overview", USG);
  ok("an admin of another workspace, claiming USG → 403", mflIntoUsg.status === 403, `HTTP ${mflIntoUsg.status}`);
  const otherRes = await call(other, "overview", USG);
  ok("USG staff without the Marketing tab → 403", otherRes.status === 403, `HTTP ${otherRes.status}`);

  console.log("\nEvery section opens for staff who have the tab");
  const query = "period=30d";
  const bodies: Record<string, any> = {};
  for (const path of [`overview?${query}`, `websites?${query}`, `forms?${query}`, `ads?${query}`, `tracked?${query}`, `organic?${query}`, "sources", "programmes?workspace=christchurch-united"]) {
    const t = Date.now();
    const res = await call(staff, path, USG);
    const ms = Date.now() - t;
    ok(`${path.split("?")[0]} → 200 for ordinary staff`, res.status === 200, `HTTP ${res.status}, ${ms}ms`);
    if (res.ok) bodies[path.split("?")[0]] = await res.json();
  }

  console.log("\nThe same numbers for everyone who can see them");
  const adminOverview = await (await call(admin, `overview?${query}`, USG)).json();
  const staffOverview = bodies.overview;
  ok("admin and ordinary staff see identical tiles",
    JSON.stringify(adminOverview?.tiles) === JSON.stringify(staffOverview?.tiles));
  ok("admin and ordinary staff see identical workspace rows",
    JSON.stringify(adminOverview?.byWorkspace) === JSON.stringify(staffOverview?.byWorkspace));

  console.log("\nWhat production is showing");
  const o = staffOverview;
  if (o) {
    const money = (c: number) => `$${(c / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2 })}`;
    console.log(`        visitors ${o.tiles.visitors.current} (${o.tiles.visitors.status}) · submissions ${o.tiles.submissions.current} · paid ${o.tiles.paidRegistrations.current} · revenue ${money(o.tiles.revenueCents.current)} · ad spend ${money(o.tiles.adSpendCents.current)} (${o.tiles.adSpendCents.status}) · followers ${o.tiles.followers.current} (${o.tiles.followers.status})`);
    ok("the overview has a number for ad spend, not 'not connected'", o.tiles.adSpendCents.status === "ok", o.tiles.adSpendCents.status);
    ok("the overview has followers", o.tiles.followers.status === "ok", o.tiles.followers.status);
  }
  const src = bodies.sources;
  if (src) {
    ok("automatic pulls are switched on in production", src.syncEnabled === true);
    const failing = src.sources.filter((s: any) => s.lastStatus === "error");
    ok("no account's last pull failed", failing.length === 0, failing.map((s: any) => `${s.label}: ${s.lastError}`).join(" | "));
  }

  console.log("\nFilters");
  const badProgramme = await call(staff, "overview?period=30d&workspace=christchurch-united&program=999999", USG);
  ok("a programme that isn't in the workspace → 400", badProgramme.status === 400, `HTTP ${badProgramme.status}`);
  const badWorkspace = await call(staff, "overview?period=30d&workspace=nope", USG);
  ok("an unknown workspace → 400", badWorkspace.status === 400, `HTTP ${badWorkspace.status}`);

  console.log("\nSync now");
  const s1 = await call(staff, "sync", USG, { method: "POST" });
  ok("staff can ask for a pull (202), or are told one just ran (429)", s1.status === 202 || s1.status === 429, `HTTP ${s1.status}`);
  const s2 = await call(staff, "sync", USG, { method: "POST" });
  ok("a second press straight away is refused, not run twice", s2.status === 429, `HTTP ${s2.status}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    for (const id of created) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
    }
    await pool.end();
    process.exit(fail ? 1 : 0);
  });

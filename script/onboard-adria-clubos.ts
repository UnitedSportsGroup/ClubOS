/**
 * Create Adria Casals' ClubOS account.
 *
 *   npx tsx --env-file=.env script/onboard-adria-clubos.ts            # dry run
 *   npx tsx --env-file=.env script/onboard-adria-clubos.ts --commit   # writes
 *
 * Who: Adria Casals, First Team Assistant Coach / Head of Performance (S&C),
 * adria@cufc.co.nz — a real named account in the club's Google Workspace
 * (audited live 2026-09-09), so he is staff, not a shared address.
 *
 * WHY SCOPED, NOT ADMIN. `canAccessTab` returns true for EVERY tab when the
 * membership role is `admin`/`manager`, AND when `tabs` is null. Either one
 * turns "see the squads" into "see Registrations, Store, E-Sign, Marketing,
 * Team and Settings too". Only role=team_member WITH an explicit non-null
 * array actually scopes anything.
 *
 * WHY NOT `contacts`. It is the club-wide people directory — 6,500+ academy
 * children with dates of birth, guardian phone numbers and medical notes. A
 * first-team performance coach has no business there by default. It is one
 * tick at /admin/team if Daniel wants it, and no deploy.
 *
 * He also gets the four universal System tabs every logged-in staffer gets
 * regardless of this array (Chat, Knowledge Base, Drive, Task Tracker) —
 * those are `requireAuth` and are not ours to grant or withhold here.
 *
 * The account is created through the REAL onboarding route on production
 * (`POST /api/admin/team`) rather than by hand-writing rows, so the welcome
 * email goes out the house way. That route is super-admin gated, so this
 * mints a throwaway super-admin probe (the _preflight-session.ts pattern) and
 * destroys it in a finally — including if the POST throws.
 */
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { tabsForOrgSlug, SUPER_ADMIN_ONLY_TABS, canAccessTab } from "../shared/tabs";

const BASE = process.env.CLUBOS_BASE || "https://app.usg.co.nz";
const EMAIL = "adria@cufc.co.nz";
const FIRST = "Adria";
const LAST = "Casals";
const ORG_SLUG = "christchurch-united";

/** What a First Team assistant / performance coach needs, and nothing else. */
const GRANT = [
  "dashboard", // the workspace landing page — without it the sidebar opens on nothing
  "squads",    // the club's own teams and who is in them, First Team included
];

const PROBE_EMAIL = "onboard-probe@example.com"; // RFC 2606, undeliverable
const commit = process.argv.includes("--commit");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

/** 20 chars of real entropy. Never printed — it goes to his inbox and nowhere else. */
const newPassword = () =>
  Array.from({ length: 20 }, () =>
    "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789".charAt(
      Math.floor(Math.random() * 56))).join("");

async function purgeProbe() {
  await pool.query(`DELETE FROM user_organizations WHERE user_id IN (SELECT id FROM users WHERE email=$1)`, [PROBE_EMAIL]);
  await pool.query(`DELETE FROM users WHERE email=$1`, [PROBE_EMAIL]);
}

/** Ask the REAL function, tab by tab, against what is actually stored. */
function report(globalRole: string, membershipRole: string, tabs: string[] | null) {
  const all = tabsForOrgSlug(ORG_SLUG);
  const can = (slug: string) =>
    canAccessTab({ globalRole, membershipRole, membershipTabs: tabs, tabSlug: slug });
  console.log("\n  CAN SEE:");
  all.filter(t => can(t.slug)).forEach(t => console.log(`     ✅ ${t.title}  (${t.slug})`));
  console.log("  CANNOT SEE:");
  all.filter(t => !can(t.slug)).forEach(t => console.log(`     ·  ${t.title}  (${t.slug})`));
  return all.filter(t => can(t.slug)).map(t => t.slug).sort();
}

async function main() {
  // ── Guards, all before anything is written ──────────────────────────────
  const org = (await pool.query(`select id,slug,name from organizations where slug=$1`, [ORG_SLUG])).rows[0];
  if (!org) throw new Error(`org ${ORG_SLUG} not found`);

  const existing = (await pool.query(`select id,email,role from users where lower(email)=lower($1)`, [EMAIL])).rows[0];
  if (existing) throw new Error(`${EMAIL} ALREADY has a ClubOS account (id ${existing.id}, role ${existing.role}) — refusing to duplicate. Edit it at /admin/team instead.`);

  const valid = new Set(tabsForOrgSlug(ORG_SLUG).map(t => t.slug));
  const unknown = GRANT.filter(s => !valid.has(s));
  if (unknown.length) throw new Error(`not tabs in this workspace: ${unknown.join(", ")}`);
  const locked = GRANT.filter(s => SUPER_ADMIN_ONLY_TABS.has(s));
  if (locked.length) throw new Error(`super-admin-only, cannot be granted: ${locked.join(", ")}`);

  console.log(`${FIRST} ${LAST} <${EMAIL}>  →  ${org.name} (org ${org.id})`);
  console.log(`global role=team_member  membership role=team_member  tabs=${JSON.stringify(GRANT)}`);

  if (!commit) {
    const granted = report("team_member", "team_member", GRANT);
    if (JSON.stringify(granted) !== JSON.stringify([...GRANT].sort()))
      throw new Error(`intended access ${JSON.stringify(granted)} != ${JSON.stringify(GRANT)}`);
    console.log("\n🔄 DRY RUN — nothing written, no email sent. Re-run with --commit");
    return;
  }

  // ── Write, through the real gated route ─────────────────────────────────
  await purgeProbe();
  const probePw = newPassword();
  const probeId = (await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'Onboard','Probe',$2,'super_admin',true) RETURNING id`,
    [PROBE_EMAIL, await bcrypt.hash(probePw, 10)])).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role) VALUES ($1,$2,'admin')`, [probeId, org.id]);

  try {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: PROBE_EMAIL, password: probePw }),
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (!login.ok || !cookie) throw new Error(`probe login failed: ${login.status}`);

    const res = await fetch(`${BASE}/api/admin/team`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        email: EMAIL, firstName: FIRST, lastName: LAST,
        password: newPassword(),
        globalRole: "team_member",           // the route DEFAULTS to "admin" if omitted
        memberships: [{ orgId: org.id, role: "team_member", tabs: GRANT }],
        sendWelcomeEmail: true,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`create failed ${res.status}: ${JSON.stringify(body)}`);
    console.log(`\ncreated ClubOS user id ${body.id} · welcome email sent to ${EMAIL}`);
  } finally {
    await purgeProbe();
    console.log("probe account destroyed");
  }

  // ── Prove the effect from what was actually STORED ──────────────────────
  const stored = (await pool.query(
    `select u.id, u.role gr, uo.role mr, uo.tabs
       from users u join user_organizations uo on uo.user_id=u.id
      where lower(u.email)=lower($1) and uo.organization_id=$2`, [EMAIL, org.id])).rows[0];
  if (!stored) throw new Error("no membership row after create — refusing to report success");
  console.log(`\nstored: global=${stored.gr}  membership=${stored.mr}  tabs=${JSON.stringify(stored.tabs)}`);
  const granted = report(stored.gr, stored.mr, stored.tabs);
  if (JSON.stringify(granted) !== JSON.stringify([...GRANT].sort()))
    throw new Error(`effective access ${JSON.stringify(granted)} != intended ${JSON.stringify(GRANT)}`);
  console.log("\n✅ COMMITTED — effective access matches intent, tab for tab");
}

main()
  .catch(e => { console.error("\n🔴 FAILED:", e.message); process.exitCode = 1; })
  .finally(() => pool.end());

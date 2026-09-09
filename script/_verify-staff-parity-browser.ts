// "It works for me" is not evidence. This opens the same pages as a SUPER ADMIN
// and as an ORDINARY STAFF MEMBER and fails when they do not see the same thing.
//
// Daniel, 2026-09-10: "so many inconsistencies around me seeing things and ryan
// not... I ship features, think the work is done, but actually only i can see it
// and no one else. big problem."
//
// 🔴 The mechanism it guards. `requireTab()` used to return early on the
// super_admin check one line BEFORE it looked for X-Workspace-Slug, so a page
// calling a tab-gated endpoint with a bare fetch() answered 200 with real data
// for Daniel and 400 for everybody else — and the page rendered that 400 as
// zeros, so it did not even look broken. Grant Funding showed him 52 funders
// and Ryan "Funders tracked 0".
//
// Two guards now sit under that: requireTab demands the header of everyone
// (so Daniel hits the failure first), and script/check-workspace-fetch.mjs
// fails the build on a bare fetch() to a gated endpoint. This is the third —
// it proves the actual rendered page, because a page can be broken for staff in
// ways neither of those can see.
//
//   npx tsx --env-file=.env script/_verify-staff-parity-browser.ts
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WORKSPACE = "united-sports-group";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`);
  good ? pass++ : fail++;
};

// The pages whose data came through a bare fetch() before 2026-09-10. Every one
// of these worked for a super admin and was empty for staff.
const PAGES: [string, string][] = [
  ["Grants", "/admin/grants"],
  ["Sponsorship", "/admin/sponsorship"],
  ["Proposals", "/admin/proposals"],
  ["Sponsor Traffic", "/admin/sponsor-traffic"],
  ["Content", "/admin/content"],
  ["Calendar", "/admin/calendar"],
  ["Domains", "/admin/domains"],
];

const users: number[] = [];
let browser: any = null;

async function makeUser(role: string) {
  const email = `_parity_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'Parity','Probe',$2,$3,true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10), role],
  );
  users.push(rows[0].id);
  const { rows: o } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  // Ryan's exact shape: workspace admin, no tab whitelist.
  await pool.query(
    `INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`,
    [rows[0].id, o[0].id],
  );
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  if (!login.ok) throw new Error(`login HTTP ${login.status}`);
  const [n, v] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
  return { name: n, value: v };
}

/** What the page actually shows: how much real text, and whether anything on it
 *  is an access failure rather than an empty dataset. */
const PROBE = `(function () {
  var t = document.body.innerText || "";
  return {
    chars: t.replace(/\\s+/g, " ").trim().length,
    denied: /X-Workspace-Slug|header required|Forbidden|access denied|No access to this workspace|Unauthorized/i.test(t),
    login: /Sign in|Forgot password/i.test(t),
    text: t.replace(/\\s+/g, " ").slice(0, 120)
  };
})()`;

async function render(cookie: { name: string; value: string }, path: string) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ ...cookie, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
  const bad: string[] = [];
  page.on("response", (r: any) => {
    const u = r.url();
    if (u.includes("/api/admin/") && (r.status() === 400 || r.status() === 403)) {
      bad.push(`${r.status()} ${u.replace(BASE, "").split("?")[0]}`);
    }
  });
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), WORKSPACE);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));
  const m: any = await page.evaluate(PROBE);
  await page.close();
  return { ...m, bad };
}

async function main() {
  console.log(`\nSuper admin vs staff, same pages — ${BASE}\n`);
  const admin = await makeUser("super_admin");
  const staff = await makeUser("team_member");

  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

  for (const [label, path] of PAGES) {
    const a = await render(admin, path);
    const s = await render(staff, path);
    console.log(`\n${label}  ${path}`);
    ok("staff reach the page at all", !s.login && !s.denied, s.denied ? s.text : "");
    // 🔴 The real test. Not "did it load" — did it show the SAME thing. A page
    // that renders a permission failure as an empty state passes every other
    // check ever written for it.
    ok("no admin request is refused for staff", s.bad.length === 0, s.bad.slice(0, 3).join(", "));
    ok("no admin request is refused for the super admin", a.bad.length === 0, a.bad.slice(0, 3).join(", "));
    // Text length within a wide band: staff and admin may legitimately differ a
    // little (an extra button), but not by half a page of content.
    const ratio = a.chars === 0 ? 1 : s.chars / a.chars;
    ok("staff see as much of the page as the super admin does",
      ratio >= 0.6, `staff ${s.chars} chars vs admin ${a.chars} (${(ratio * 100).toFixed(0)}%)`);
  }
}

main()
  .catch((e) => { console.error("\nthrew:", e.message); fail++; })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    for (const id of users) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {});
    }
    await pool.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });

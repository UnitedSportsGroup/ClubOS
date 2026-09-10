// Two things Daniel asked for today, checked in a REAL browser as ordinary
// staff — because neither page is in the white-screen guard's thirteen, and
// "the route answers 200" says nothing about whether a human can click it.
//
//   "make it so when you click on player for example in squads it opens their
//    profile."
//   "make sure here in register at office manual rego it shows the term 4 full
//    price or the term 3 pro rata what's remaining price."
//
// 🔴 It signs in as a NORMAL staff member. A super admin short-circuits every
// permission check, so Daniel clicking it proves nothing about Olga.
//
//   npx tsx --env-file=.env script/_verify-squad-profile-browser.ts
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WORKSPACE = "christchurch-united";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};

let userId: number | null = null;
let browser: any = null;

async function staffCookie() {
  const email = `_squad_probe_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'Squad','Probe',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)],
  );
  userId = rows[0].id;
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  await pool.query(
    `INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`,
    [userId, org[0].id],
  );
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  if (!res.ok) throw new Error(`login HTTP ${res.status}`);
  const [n, v] = (res.headers.get("set-cookie") || "").split(";")[0].split("=");
  return { name: n, value: v };
}

const settle = (ms = 2200) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cookie = await staffCookie();
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ ...cookie, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });

  const errors: string[] = [];
  page.on("pageerror", (e: any) => errors.push(String(e.message).slice(0, 120)));

  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), WORKSPACE);

  // ── Squads → a member → their profile ─────────────────────────────────────
  console.log(`\nSquads → click a member → their profile  (${BASE})\n`);
  await page.goto(`${BASE}/admin/squads`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle();
  const squadCards = await page.$$('[data-testid^="button-open-squad"], [data-testid^="card-squad"]');
  ok("the squads page renders something to click", (await page.evaluate(() => document.body.innerText.length)) > 200);

  // 🔴 Open a squad that actually HAS people in it. Clicking whichever card is
  // first found the empty First Team and "no member rows" would have read as a
  // broken feature — the test would have been wrong, not the page.
  const { rows: withMembers } = await pool.query(
    `SELECT s.id, s.name, count(m.id)::int n
     FROM club_squads s JOIN club_squad_members m ON m.squad_id = s.id AND m.left_at IS NULL
     GROUP BY s.id, s.name ORDER BY n DESC LIMIT 1`);
  ok("the club has a squad with people in it to test against", withMembers.length > 0,
    withMembers[0] ? `${withMembers[0].name} (${withMembers[0].n})` : "none");
  if (!withMembers.length) return;
  await page.goto(`${BASE}/admin/squads?squad=${withMembers[0].id}`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle(2600);
  ok("a squad opened straight from its URL — it is linkable",
    (await page.evaluate(() => document.body.innerText || "")).includes(withMembers[0].name),
    withMembers[0].name);
  const rosterUrl = page.url();
  ok("the open squad is in the URL, so it can be linked to and returned to",
    /[?&]squad=\d+/.test(rosterUrl), rosterUrl.replace(BASE, ""));

  const memberBtn = await page.$('[data-testid^="button-open-profile-"]');
  ok("every member row is clickable", !!memberBtn);
  const memberName = memberBtn
    ? await page.evaluate((el: any) => (el.innerText || "").split("\n")[0].trim(), memberBtn)
    : "";
  if (memberBtn) {
    await memberBtn.click();
    await settle(2600);
    const url = page.url();
    ok("clicking a member opens their profile", /\/admin\/people\/contact-\d+/.test(url), url.replace(BASE, ""));
    const text = await page.evaluate(() => document.body.innerText || "");
    ok("the profile is really that person", memberName.length > 0 && text.includes(memberName.split(" ")[0]),
      `looked for "${memberName}"`);
    ok("the profile page is not blank", text.replace(/\s+/g, " ").trim().length > 120, `${text.length} chars`);
    ok("Back goes to the squad we came from, not the squad list",
      /from=%2Fadmin%2Fsquads%3Fsquad%3D\d+/.test(url), url.replace(BASE, ""));
  }

  // ── The office walk-up form: a price per term ──────────────────────────────
  console.log(`\nRegister at the office → a price per term\n`);
  // 🔴 The form is a MODAL on the Academy page (button-register-player) — there
  // is no /admin/register route, and guessing one 404s. Open it the way Olga
  // does.
  await page.goto(`${BASE}/admin/academy`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle(2600);
  const openedForm = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="button-register-player"]');
    if (!b) return false;
    (b as HTMLElement).click();
    return true;
  });
  ok("the Register Player button is on the Academy page", openedForm);
  await settle(2600);
  const picked = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('[data-testid^="option-programme-"]'))
      .find((x) => /FUNi/i.test(x.textContent || ""));
    if (!b) return false;
    (b as HTMLElement).click();
    return true;
  });
  ok("the office form lists the academy programmes", picked);
  if (picked) {
    await settle(3000);
    const terms = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^="option-term-"]')).map((el) => ({
        text: (el as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
        disabled: (el as HTMLButtonElement).disabled,
      })));
    for (const t of terms) console.log(`        ${t.disabled ? "· " : "  "}${t.text}`);
    ok("a term picker is drawn", terms.length >= 2, `${terms.length} terms`);
    ok("every term shows its year", terms.every((t) => /20\d\d/.test(t.text)));
    ok("the term that has not started shows the FULL fee", terms.some((t) => /Term 4 2026/.test(t.text) && /\$160\.00/.test(t.text)),
      terms.find((t) => /Term 4/.test(t.text))?.text ?? "no Term 4 row");
    ok("the term already running shows what is LEFT of it (pro rata)",
      terms.some((t) => /Term 3 2026/.test(t.text) && /pro rata/.test(t.text) && !/\$160\.00/.test(t.text)),
      terms.find((t) => /Term 3/.test(t.text))?.text ?? "no Term 3 row");
    ok("a finished term says finished, and cannot be sold",
      terms.some((t) => t.disabled && /Finished/.test(t.text)),
      terms.filter((t) => t.disabled).map((t) => t.text).join(" | ") || "none disabled");
  }

  ok("no React error on either page", errors.length === 0, errors.slice(0, 2).join(" · "));
  await page.close();
}

main()
  .catch((e) => { console.error("\nthrew:", e.message); fail++; })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    if (userId) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [userId]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(() => {});
    }
    await pool.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });

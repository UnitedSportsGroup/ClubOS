// Sessions tab shows ONE term at a time (Daniel, 2026-10-12: "don't show old
// ones"). Real Chrome, ordinary CUFC staff, FUNiño (#4). Read-only.
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let fail = 0; const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); if (!g) fail++; };
let uid: number | null = null, browser: any;
const settle = (ms = 2500) => new Promise(r => setTimeout(r, ms));
try {
  const email = `_sess_term_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  uid = (await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Sess','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)])).rows[0].id;
  const org = (await pool.query(`SELECT id FROM organizations WHERE slug='christchurch-united'`)).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [uid, org]);
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const [n, v] = (res.headers.get("set-cookie") || "").split(";")[0].split("=");
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage(); await page.setViewport({ width: w, height: h });
    await page.setCookie({ name: n, value: v, domain: new URL(BASE).hostname, path: "/" });
    await page.goto(`${BASE}/admin/academy/4#sessions`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="sessions-filter-terms"]', { timeout: 20000 }).catch(() => {});
    await settle();
    const weeks = async () => page.$$eval('[data-testid^="table-sessions-"]', (els: any[]) => els.map(e => e.getAttribute("data-testid")));
    const w0 = await weeks();
    ok(`${w}px: picker shows`, !!(await page.$('[data-testid="sessions-filter-terms"]')));
    ok(`${w}px: opens on Term 4 — first week 12/10`, (w0[0] ?? "").includes("12/10"), w0[0]);
    ok(`${w}px: no July session listed`, !w0.some((x: string) => /\/07|\/08|\/09/.test(x)), `${w0.length} weeks`);
    const first = await page.$eval('[data-testid^="row-session-"]', (e: any) => e.getAttribute("data-state")).catch(() => null);
    ok(`${w}px: Upcoming opens with today's session first`, first === "today", String(first));
    const pastInUpcoming = await page.$$eval('[data-state="done"],[data-state="missed"]', (e: any[]) => e.length);
    ok(`${w}px: no past session in Upcoming`, pastInUpcoming === 0, String(pastInUpcoming));
    await page.screenshot({ path: `/tmp/claude-501/sessions-t4-${w}.png` });
    await page.click('[data-testid="sessions-when-past"]'); await settle(800);
    const p4 = await page.$$eval('[data-testid^="row-session-"]', (e: any[]) => e.map(x => x.getAttribute("data-state")));
    ok(`${w}px: Past holds only sessions already gone`, p4.length > 0 && p4.every((x: string) => x === "done" || x === "missed"), `${p4.length}`);
    await page.click('[data-testid="sessions-filter-term-7"]'); await settle(1500);
    const w3 = await weeks();
    ok(`${w}px: Term 3 › Past shows Term 3, newest week first`, (w3[0] ?? "").includes("21/09") && w3.some((x: string) => x.includes("20/07")) && !w3.some((x: string) => x.includes("12/10")), `${w3[0]} … ${w3[w3.length - 1]}`);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`${w}px: no sideways scroll`, sw <= 1, String(sw));
    await page.close();
  }
} finally {
  await browser?.close();
  if (uid) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]); await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [uid])); }
  await pool.end();
  console.log(fail ? `${fail} FAILED` : "all passed"); process.exit(fail ? 1 : 0);
}

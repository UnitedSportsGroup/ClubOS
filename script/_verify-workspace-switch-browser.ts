// Switching workspace must change the dashboard WITHOUT a refresh (Daniel,
// 2026-10-14: "switch from cufc to mfl and it still shows cufc graph until i
// refresh"). Real Chrome, an ordinary admin of CUFC + MFL + Gymnastics.
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
  const email = `_ws_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  uid = (await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Ws','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)])).rows[0].id;
  for (const slug of ["christchurch-united", "mini-football-leagues", "united-gymnastics"]) {
    const org = (await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [slug])).rows[0].id;
    await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [uid, org]);
  }
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const [n, v] = (res.headers.get("set-cookie") || "").split(";")[0].split("=");
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ name: n, value: v, domain: new URL(BASE).hostname, path: "/" });
  await page.goto(BASE + "/admin", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("clubos_workspace", "christchurch-united"));
  await page.goto(BASE + "/admin", { waitUntil: "networkidle2" });
  const total = async () => { await page.waitForSelector('[data-testid="text-revenue-total"]', { timeout: 30000 }).catch(() => {}); await settle(1500); return page.$eval('[data-testid="text-revenue-total"]', (e: any) => e.textContent.trim()).catch(() => "(none)"); };
  const name = () => page.$eval('[data-testid="text-workspace-name"]', (e: any) => e.textContent.trim()).catch(() => "?");
  const switchTo = async (slug: string) => { await page.click('[data-testid="button-workspace-switcher"]'); await settle(400); await page.click(`[data-testid="button-workspace-${slug}"]`); await settle(3000); };
  await settle(4000);
  console.log("  [debug]", await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="revenue"],[data-testid^="text-revenue"],[data-testid="text-page-title"]')).map((e: any) => e.getAttribute("data-testid") + "=" + e.textContent.slice(0, 60)).join(" | ")));
  await page.screenshot({ path: "/private/tmp/claude-501/-Users-danielmeyn-Desktop-AIOS-DanielMeynOS/3e8471f7-8e53-4d1e-8d18-b086dd453901/scratchpad/ws-cufc.png" });
  const cufc = await total();
  ok("CUFC dashboard shows a figure", cufc !== "(none)", `${await name()}: ${cufc}`);
  await switchTo("mini-football-leagues");
  const mfl = await total();
  ok("switch to MFL (no refresh) shows a DIFFERENT figure", mfl !== "(none)" && mfl !== cufc, `${await name()}: ${mfl}`);
  await switchTo("united-gymnastics");
  const gym = await total();
  ok("switch to Gymnastics shows its own figure (not $0.00, not MFL's)", gym !== "(none)" && gym !== mfl && gym !== "$0.00", `${await name()}: ${gym}`);
  await switchTo("christchurch-united");
  const back = await total();
  ok("back to CUFC shows CUFC's figure again", back === cufc, `${back}`);
  ok("chart is drawn", !!(await page.$('[data-testid="revenue-chart"] svg')));
} finally {
  await browser?.close();
  if (uid) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]); await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [uid])); }
  await pool.end();
  console.log(fail ? `${fail} FAILED` : "all passed"); process.exit(fail ? 1 : 0);
}

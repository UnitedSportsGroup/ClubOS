// Technification's Attendance tab = the coaches' TERM roll, display-only
// (Daniel, 2026-11-20). Real Chrome, ORDINARY CUFC admin; probe user deleted.
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.SHOTS || "/tmp";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let fail = 0; const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); if (!g) fail++; };
let uid: number | null = null, browser: any;
const settle = (ms = 2500) => new Promise(r => setTimeout(r, ms));
try {
  const prog = (await pool.query(`SELECT id FROM programs WHERE slug='technification'`)).rows[0].id;
  const email = `_tr_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  uid = (await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Roll','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)])).rows[0].id;
  const org = (await pool.query(`SELECT id FROM organizations WHERE slug='christchurch-united'`)).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [uid, org]);
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  const [n, v] = cookie.split("=");
  const api = await (await fetch(`${BASE}/api/admin/camps/${prog}/coach-attendance`, { headers: { cookie, "X-Workspace-Slug": "christchurch-united" } })).json();
  ok("feed connected", api.connected === true, api.reason ?? "");
  ok("weekly = Monday", api.weekly?.label === "Monday", JSON.stringify(api.weekly));
  const t = api.teams?.[0];
  const mondays = (t?.sessions ?? []).filter((s: any) => new Date(s.date + "T00:00:00Z").getUTCDay() === 1);
  ok("every Monday of the term is a column", mondays.length >= 8, `${mondays.length} Mondays, ${t?.sessions?.length} cols, ${t?.players?.length} players`);
  ok("Labour Day greyed as a holiday (if in term)", !(t?.sessions ?? []).some((s: any) => s.date === "2026-10-26") || (t.sessions.find((s: any) => s.date === "2026-10-26").holiday === "Labour Day"));
  const att = (await pool.query(`SELECT id FROM attendance WHERE camp_id=$1 LIMIT 1`, [prog])).rows[0];
  if (att) {
    const r = await fetch(`${BASE}/api/admin/attendance/${att.id}`, { method: "PATCH", headers: { cookie, "Content-Type": "application/json", "X-Workspace-Slug": "christchurch-united" }, body: JSON.stringify({ status: "present" }) });
    ok("ClubOS refuses a roll mark (409)", r.status === 409, String(r.status));
  } else ok("no ClubOS attendance rows exist to mark (nothing to refuse)", true);
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage(); await page.setViewport({ width: w, height: h });
    const errs: string[] = []; page.on("pageerror", (e: any) => errs.push(String(e.message)));
    await page.setCookie({ name: n, value: v, domain: new URL(BASE).hostname, path: "/" });
    await page.goto(`${BASE}/admin/academy/${prog}#sessions`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="attendance-team"] table', { timeout: 30000 }).catch(() => {});
    await settle();
    const tabs = await page.$$eval('[data-testid^="tab-"]', (els: any[]) => els.map(e => e.textContent.trim()));
    ok(`${w}px tabs: Attendance, no Sessions, Content kept`, tabs.includes("Attendance") && !tabs.includes("Sessions") && tabs.includes("Content"), tabs.join(" · "));
    ok(`${w}px opens straight on the term roll grid`, !!(await page.$('[data-testid="attendance-team"] table')));
    const cols = await page.$$eval('[data-testid="attendance-team"] thead th', (els: any[]) => els.length);
    ok(`${w}px grid has a column per Monday + Term`, cols >= 10, String(cols));
    ok(`${w}px term total column`, (await page.$$('[data-term-present]')).length > 0);
    ok(`${w}px no roll buttons (display only)`, (await page.$$('[data-testid="attendance-team"] tbody button')).length === 0);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`${w}px no sideways page scroll`, sw <= 1, String(sw));
    ok(`${w}px no page errors`, errs.length === 0, errs.join(" | "));
    await page.screenshot({ path: `${OUT}/tech-roll-${w}.png`, fullPage: true });
    await page.close();
  }
} catch (e: any) { ok("threw", false, e.message); }
finally {
  await browser?.close();
  if (uid) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]).catch(() => {}); await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {}); }
  await pool.end(); console.log(fail ? `\n${fail} FAILED` : "\nall passed"); process.exit(fail ? 1 : 0);
}

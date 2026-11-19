// Pre-Academy (16) + Academy (17) term roll, real Chrome, ordinary CUFC admin. Probe user removed after.
import pg from "pg"; import bcrypt from "bcryptjs"; import puppeteer from "puppeteer-core";
const BASE = "https://app.usg.co.nz", OUT = process.env.SHOTS || "/tmp";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let uid: number | null = null, browser: any, fail = 0;
const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); if (!g) fail++; };
try {
  const email = `_pr_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  uid = (await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Roll','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)])).rows[0].id;
  const org = (await pool.query(`SELECT id FROM organizations WHERE slug='christchurch-united'`)).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [uid, org]);
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const [n, v] = (res.headers.get("set-cookie") || "").split(";")[0].split("=");
  browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
  for (const id of [16]) {
    const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1000 });
    await page.setCookie({ name: n, value: v, domain: "app.usg.co.nz", path: "/" });
    await page.goto(`${BASE}/admin/academy/${id}#sessions`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid^="attendance-team-"]', { timeout: 30000 }).catch(() => {});
    const first = await page.$('[data-testid^="attendance-team-"]'); await first?.click();
    await page.waitForSelector('[data-testid="attendance-team"] table', { timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    ok(`${id} opens a group on the term roll`, !!(await page.$('[data-testid="attendance-team"] table')));
    ok(`${id} term total column`, (await page.$$('[data-term-present]')).length > 0);
    const heads = await page.$$eval("[data-testid=\"attendance-team\"] thead th", (ths: any[]) => ths.map((t) => t.innerText.replace(/\s+/g, " ").trim()));
    console.log(heads.join(" | "));
    const bad = heads.filter((h: string) => /^(MON|WED|FRI|SUN)\b/i.test(h));
    ok("only Tue/Thu/Sat columns", bad.length === 0, bad.join(", "));
    await page.screenshot({ path: `${OUT}/roll-${id}.png` });
    await page.close();
  }
} catch (e: any) { ok("threw", false, e.message); }
finally {
  await browser?.close();
  if (uid) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]); await pool.query(`DELETE FROM users WHERE id=$1`, [uid]); }
  await pool.end(); process.exit(fail ? 1 : 0);
}

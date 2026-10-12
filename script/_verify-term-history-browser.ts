// Term programme History tab (Daniel, 2026-10-13). Real Chrome, ordinary CUFC
// staff, read-only: FUNiño #4, Technification #5, Pre-Academy #16.
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
  const email = `_th_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  uid = (await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Hist','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)])).rows[0].id;
  const org = (await pool.query(`SELECT id FROM organizations WHERE slug='christchurch-united'`)).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [uid, org]);
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const [n, v] = (res.headers.get("set-cookie") || "").split(";")[0].split("=");
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  for (const [id, stream] of [[4, "funino"], [5, "technification"], [16, "pre_academy"]] as const) {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const page = await browser.newPage(); await page.setViewport({ width: w, height: h });
      await page.setCookie({ name: n, value: v, domain: new URL(BASE).hostname, path: "/" });
      await page.goto(`${BASE}/admin/academy/${id}#history`, { waitUntil: "networkidle2" });
      await page.waitForSelector('[data-testid="term-history-table"]', { timeout: 30000 }).catch(() => {});
      await settle();
      const tag = `#${id} ${w}px`;
      ok(`${tag}: history renders`, !!(await page.$('[data-testid="term-history-table"]')));
      const on = await page.$eval(`[data-testid="term-history-filter-${stream}"]`, (e: any) => e.className.includes("font-semibold")).catch(() => false);
      ok(`${tag}: opens on its own programme (${stream})`, on);
      const rows = await page.$$eval('[data-testid^="term-history-row-"]', (e: any[]) => e.map(x => x.getAttribute("data-testid")));
      ok(`${tag}: has terms`, rows.length >= 4, `${rows.length} rows, newest ${rows[0]}`);
      ok(`${tag}: no year before 2017`, !rows.some((r: string) => /-(19|20(0|1[0-6]))\d?-/.test(r) || /row-201[0-6]/.test(r)));
      if (w === 1440) {
        await page.click('[data-testid="term-history-mode-year"]'); await settle(800);
        const yrs = await page.$$eval('[data-testid^="term-history-row-"]', (e: any[]) => e.map(x => x.getAttribute("data-testid")));
        ok(`${tag}: By year works`, yrs[0] === "term-history-row-2026", yrs[0]);
        await page.click('[data-testid="term-history-mode-term"]'); await settle(500);
        await page.screenshot({ path: `/tmp/claude-501/th-${id}.png` });
      }
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(`${tag}: no sideways scroll`, sw <= 1, String(sw));
      await page.close();
    }
  }
} finally {
  await browser?.close();
  if (uid) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]); await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [uid])); }
  await pool.end();
  console.log(fail ? `${fail} FAILED` : "all passed"); process.exit(fail ? 1 : 0);
}

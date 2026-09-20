/**
 * Financial Insight — real Chrome on production, as ORDINARY USG staff: the sidebar link is there, the page asks for the
 * password, the right password opens the report, the gap cards render, nothing overflows at 1440 and 390. Screenshots in
 * outputs/ui-preflight/finance-insight-clubos/. Throwaway account deleted after.
 *   npx tsx --env-file=.env script/_verify-finance-insight-browser.ts
 */
import puppeteer from "puppeteer-core";
import pg from "pg";
import bcrypt from "bcryptjs";
import { mkdirSync, readFileSync } from "fs";
import { join } from "path";
const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/outputs/ui-preflight/finance-insight-clubos"; mkdirSync(OUT, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0; const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); g ? pass++ : fail++; };
async function main() {
  const password = readFileSync("/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/credentials/finance-insight-password.txt", "utf8").trim();
  const email = `_fib_${Date.now()}@usg.co.nz`, pw = `F${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1, 'Finance', 'Browser', $2, 'team_member', true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  const uid = rows[0].id; const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug = 'united-sports-group'`);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, $2, 'team_member', $3)`, [uid, org[0].id, JSON.stringify(["dashboard", "finance-insight"])]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const [cn, cv] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  try {
    for (const vp of [{ label: "desktop", width: 1440, height: 900 }, { label: "mobile", width: 390, height: 844 }]) {
      const page = await browser.newPage(); await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 2 });
      await page.setCookie({ name: cn, value: cv, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
      await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluate(() => localStorage.setItem("clubos_workspace", "united-sports-group"));
      await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 60000 });
      if (vp.label === "desktop") { const link = await page.$('a[href="/admin/finance-insight"]'); ok(`desktop: the sidebar carries the Financial Insight link`, !!link); }
      // the session is shared between viewports — lock it so each pass starts at the password screen
      await fetch(`${BASE}/api/admin/finance-insight/lock`, { method: "POST", headers: { cookie: `${cn}=${cv}`, "X-Workspace-Slug": "united-sports-group" } });
      await page.goto(`${BASE}/admin/finance-insight`, { waitUntil: "networkidle2", timeout: 60000 });
      const gate = await page.waitForFunction(() => /password protected/i.test(document.body.innerText), { timeout: 30000 }).then(() => true).catch(() => false);
      ok(`${vp.label}: the page asks for the password first`, gate);
      const figures = await page.evaluate(() => /\$2,210,334|\$1,494,944/.test(document.body.innerText)); ok(`${vp.label}: no figure is shown before the password`, !figures);
      await page.screenshot({ path: join(OUT, `${vp.label}-locked.png`) });
      await page.type('input[type="password"]', password); await page.click('button[type="submit"]');
      const opened = await page.waitForFunction(() => /TOTAL GAP/i.test(document.body.innerText) && /\$740,774/.test(document.body.innerText), { timeout: 45000 }).then(() => true).catch(() => false);
      ok(`${vp.label}: the right password opens the report with the gap`, opened);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(`${vp.label}: no horizontal overflow`, overflow <= 1, `${overflow}px`);
      await page.screenshot({ path: join(OUT, `${vp.label}-open.png`), fullPage: vp.label === "mobile" });
      if (vp.label === "desktop") {
        await page.evaluate(() => { const b = Array.from(document.querySelectorAll("button")).find((x) => /By stream/.test(x.textContent || "")); (b as HTMLButtonElement)?.click(); });
        const streams = await page.waitForFunction(() => /at actuals/i.test(document.body.innerText), { timeout: 15000 }).then(() => true).catch(() => false); ok("desktop: By stream renders", streams);
        await page.screenshot({ path: join(OUT, `desktop-streams.png`) });
      }
      await page.close();
    }
  } finally {
    await browser.close(); await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [uid]); await pool.query(`DELETE FROM users WHERE id = $1`, [uid]); await pool.end();
  }
  console.log(`\n  ${pass} passed · ${fail} failed · screenshots in ${OUT}\n`); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

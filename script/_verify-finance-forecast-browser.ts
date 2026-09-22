/**
 * Financial Insight's forward views — real Chrome on production, as ORDINARY USG staff holding the finance-insight tab:
 * the password opens the report; "Cash to 31 Dec", "Money owed" and "Term fees" each render real figures from the pushed
 * snapshot (never the "not pushed yet" empty state); a typed bank balance turns the answer into YES or NO and survives a reload
 * in this browser; the P&L levers panel is hidden on these views; nothing overflows at 1440 or 390; the views live in the URL
 * hash. Screenshots in outputs/ui-preflight/finance-insight-forecast/. The throwaway account is deleted after.
 *   npx tsx --env-file=.env script/_verify-finance-forecast-browser.ts
 */
import puppeteer from "puppeteer-core";
import pg from "pg";
import bcrypt from "bcryptjs";
import { mkdirSync, readFileSync } from "fs";
import { join } from "path";
const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/outputs/ui-preflight/finance-insight-forecast"; mkdirSync(OUT, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0; const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); g ? pass++ : fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const password = readFileSync("/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/credentials/finance-insight-password.txt", "utf8").trim();
  const email = `_fif_${Date.now()}@usg.co.nz`, pw = `F${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1, 'Finance', 'Forecast', $2, 'team_member', true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  const uid = rows[0].id; const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug = 'united-sports-group'`);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, $2, 'team_member', $3)`, [uid, org[0].id, JSON.stringify(["dashboard", "finance-insight"])]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const [cn, cv] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
  ok("the throwaway staff account can sign in", login.ok, `HTTP ${login.status}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  try {
    for (const vp of [{ label: "desktop", width: 1440, height: 900 }, { label: "mobile", width: 390, height: 844 }]) {
      const page = await browser.newPage(); await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 2 });
      const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
      await page.setCookie({ name: cn, value: cv, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
      await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluate(() => localStorage.setItem("clubos_workspace", "united-sports-group"));
      await fetch(`${BASE}/api/admin/finance-insight/lock`, { method: "POST", headers: { cookie: `${cn}=${cv}`, "X-Workspace-Slug": "united-sports-group" } });
      await page.goto(`${BASE}/admin/finance-insight#forecast`, { waitUntil: "networkidle2", timeout: 60000 });
      const gate = await page.waitForFunction(() => /password protected/i.test(document.body.innerText), { timeout: 30000 }).then(() => true).catch(() => false);
      ok(`${vp.label}: the password screen comes first`, gate);
      await page.type('input[type="password"]', password); await page.click('button[type="submit"]');
      // ---- Cash to 31 Dec (the hash opened it) ----
      const cash = await page.waitForFunction(() => /needs \$[\d,]+ in the bank today/.test(document.body.innerText) && !!document.querySelector('[data-testid="cf-tree"]'), { timeout: 45000 }).then(() => true).catch(() => false);
      ok(`${vp.label}: #forecast opens "Cash to 31 Dec" with the answer and every line`, cash);
      const notPushed = await page.evaluate(() => /has not been pushed yet/.test(document.body.innerText)); ok(`${vp.label}: the forecast came from the snapshot (no empty state)`, !notPushed);
      const levers = await page.evaluate(() => /What if…/.test(document.body.innerText)); ok(`${vp.label}: the P&L levers panel is hidden on a forward view`, !levers);
      ok(`${vp.label}: the weekly chart draws`, !!(await page.$('[data-testid="cf-chart"] svg path')));
      let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(`${vp.label}: Cash to 31 Dec — no horizontal overflow`, overflow <= 1, `${overflow}px`);
      await page.screenshot({ path: join(OUT, `${vp.label}-cash.png`), fullPage: vp.label === "desktop" });
      // a typed balance → YES/NO; then a reload keeps it (this browser only)
      await page.evaluate(() => { const el = document.querySelector("#cf-bank") as HTMLInputElement; el.focus(); el.select(); });
      await page.keyboard.press("Backspace"); await page.type("#cf-bank", "50000"); await sleep(300);
      const no = await page.$eval('[data-testid="cf-answer"]', (e) => (e as HTMLElement).innerText);
      ok(`${vp.label}: $50,000 in the bank reads NO with the lowest point`, /\bNO\b/.test(no) && /lowest point is −\$/.test(no), no.replace(/\s+/g, " ").slice(0, 120));
      await page.evaluate(() => { const el = document.querySelector("#cf-bank") as HTMLInputElement; el.focus(); el.select(); });
      await page.keyboard.press("Backspace"); await page.type("#cf-bank", "400000"); await sleep(300);
      const yes = await page.$eval('[data-testid="cf-answer"]', (e) => (e as HTMLElement).innerText);
      ok(`${vp.label}: $400,000 in the bank reads YES`, /\bYES\b/.test(yes));
      await page.reload({ waitUntil: "networkidle2" });
      await page.waitForSelector("#cf-bank", { timeout: 30000 }).catch(() => null);
      const kept = await page.$eval("#cf-bank", (e) => (e as HTMLInputElement).value).catch(() => "");
      ok(`${vp.label}: the typed balance survives a reload in this browser`, kept === "400000", kept);
      await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("fi-bank-balance-")) localStorage.removeItem(k); });
      // open a row of the tree
      const opened = await page.evaluate(() => { const tr = Array.from(document.querySelectorAll('[data-testid="cf-tree"] tbody tr')).find((r) => (r as HTMLElement).innerText.includes("Term 4 fees")); (tr as HTMLElement)?.click(); return !!tr; });
      await sleep(200);
      const kids = await page.evaluate(() => /Academy U13–U17 and U20/.test((document.querySelector('[data-testid="cf-tree"]') as HTMLElement).innerText));
      ok(`${vp.label}: tapping "Term 4 fees" opens it into its programmes`, opened && kids);
      // ---- the South Island United toggle ----
      const cufcNeed = await page.$eval('[data-testid="cf-answer"]', (e) => (e as HTMLElement).innerText);
      await page.click('[data-testid="cf-siu"]'); await sleep(400);
      const siuNeed = await page.$eval('[data-testid="cf-answer"]', (e) => (e as HTMLElement).innerText);
      ok(`${vp.label}: adding South Island United changes the answer and says what it adds`,
         /Both clubs together need/.test(siuNeed) && /pre-season adds/.test(siuNeed) && siuNeed !== cufcNeed, siuNeed.replace(/\s+/g, " ").slice(0, 140));
      const siuTree = await page.evaluate(() => /SOUTH ISLAND UNITED/i.test((document.querySelector('[data-testid="cf-tree"]') as HTMLElement).innerText));
      ok(`${vp.label}: the SIU lines are in the tree`, siuTree);
      await page.screenshot({ path: join(OUT, `${vp.label}-siu.png`), fullPage: vp.label === "desktop" });
      await page.click('[data-testid="cf-siu"]'); await sleep(300);
      ok(`${vp.label}: switching SIU back off restores the CUFC-only answer`, (await page.$eval('[data-testid="cf-answer"]', (e) => (e as HTMLElement).innerText)) === cufcNeed);
      // ---- What we owe ----
      await page.evaluate(() => (document.querySelector('[data-view="owe"]') as HTMLButtonElement).click());
      const owe = await page.waitForFunction(() => /What the club owes/.test(document.body.innerText) && /Belgravia/.test(document.body.innerText) && document.querySelectorAll('[data-testid="owe-table"] tbody tr').length >= 8, { timeout: 15000 }).then(() => true).catch(() => false);
      ok(`${vp.label}: What we owe lists the debts, Belgravia included`, owe);
      overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(`${vp.label}: What we owe — no horizontal overflow`, overflow <= 1, `${overflow}px`);
      await page.screenshot({ path: join(OUT, `${vp.label}-owe.png`), fullPage: vp.label === "desktop" });
      // ---- Money owed ----
      await page.evaluate(() => (document.querySelector('[data-view="owed"]') as HTMLButtonElement).click());
      const owed = await page.waitForFunction(() => /Money owed to the club — \$[\d,]+ on unpaid invoices/.test(document.body.innerText) && document.querySelectorAll('[data-testid="owed-table"] tbody tr').length > 10, { timeout: 15000 }).then(() => true).catch(() => false);
      ok(`${vp.label}: Money owed lists the unpaid invoices`, owed);
      ok(`${vp.label}: the view is in the URL (#owed)`, (await page.evaluate(() => location.hash)) === "#owed");
      overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(`${vp.label}: Money owed — no horizontal overflow`, overflow <= 1, `${overflow}px`);
      await page.screenshot({ path: join(OUT, `${vp.label}-owed.png`) });
      // ---- Term fees ----
      await page.evaluate(() => (document.querySelector('[data-view="fees"]') as HTMLButtonElement).click());
      const fees = await page.waitForFunction(() => /Term fees — both ways a family pays/.test(document.body.innerText) && /Academy U13–U17 and U20/.test(document.body.innerText) && /invoiced in Xero/i.test(document.body.innerText), { timeout: 15000 }).then(() => true).catch(() => false);
      ok(`${vp.label}: Term fees shows the book by programme, card and invoice`, fees);
      overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(`${vp.label}: Term fees — no horizontal overflow`, overflow <= 1, `${overflow}px`);
      await page.screenshot({ path: join(OUT, `${vp.label}-fees.png`) });
      // ---- the P&L views still work ----
      await page.evaluate(() => (document.querySelector('[data-view="overview"]') as HTMLButtonElement).click());
      const gap = await page.waitForFunction(() => /TOTAL GAP/i.test(document.body.innerText), { timeout: 15000 }).then(() => true).catch(() => false);
      ok(`${vp.label}: "The gap" still renders`, gap);
      ok(`${vp.label}: no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
      await page.close();
    }
  } finally {
    await browser.close(); await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [uid]); await pool.query(`DELETE FROM users WHERE id = $1`, [uid]); await pool.end();
  }
  console.log(`\n  ${pass} passed · ${fail} failed · screenshots in ${OUT}\n`); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

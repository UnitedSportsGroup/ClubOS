// Live: sign in at cufc.co.nz/account (reserved test@example.com), then check the
// nav shows the person on every page and the account leads with Register.
//   npx tsx --env-file=.env script/_verify-account-nav-browser.ts
import puppeteer from "puppeteer-core";
import { Pool } from "pg";
import crypto from "crypto";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EMAIL = "test@example.com";
const OUT = process.env.OUT || "/tmp/account-nav";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c: boolean, l: string, x = "") => { console.log(`${c ? "  ok  " : " FAIL "} ${l}${x ? " — " + x : ""}`); c ? pass++ : fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function crack(): Promise<string | null> {
  for (let t = 0; t < 20; t++) {
    const { rows } = await pool.query(`SELECT code_hash FROM parent_login_codes WHERE email=$1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`, [EMAIL]);
    if (rows[0]) for (let i = 0; i < 1_000_000; i++) { const c = String(i).padStart(6, "0"); if (crypto.createHash("sha256").update(`${c}:${EMAIL}`).digest("hex") === rows[0].code_hash) return c; }
    await sleep(500);
  }
  return null;
}
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  await pool.query(`DELETE FROM parent_login_codes WHERE email=$1`, [EMAIL]);
  for (const [name, vp] of [["phone", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ["desktop", { width: 1440, height: 900 }]] as const) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage(); await page.setViewport(vp as any);
    await page.goto("https://cufc.co.nz/account", { waitUntil: "networkidle0" });
    ok(!!(await page.$("[data-testid=nav-login]")), `${name}: signed out, the nav says Login`);
    await page.type("input[type=email]:not([hidden])", EMAIL);
    await page.click("button[type=submit]");
    await page.waitForFunction(() => /6-digit code/i.test(document.body.innerText), { timeout: 15000 });
    const code = await crack();
    ok(!!code, `${name}: a code was issued`);
    await page.type("input[autocomplete=one-time-code]", code || "000000");
    await page.click("button[type=submit]");
    await page.waitForSelector("[data-testid=register-block]", { timeout: 20000 }).catch(() => {});
    ok(!!(await page.$("[data-testid=register-block]")), `${name}: the account leads with the Register block`);
    const chip = await page.waitForSelector("[data-testid=nav-account]", { timeout: 15000 }).catch(() => null);
    ok(!!chip, `${name}: the nav now shows the person, not Login`);
    const chipText = chip ? await page.evaluate((el) => el.textContent?.trim() || "", chip) : "";
    ok(/^TP/.test(chipText), `${name}: initials "TP" in the nav`, chipText);
    const t = (await page.evaluate(() => document.body.innerText)).toLowerCase();
    ok(t.includes("register your first child"), `${name}: no children → "Register your first child"`);
    ok(!t.includes("we don't have any children"), `${name}: the negative line is gone`);
    ok(t.includes("pre-academy") && t.includes("$405.00"), `${name}: open programmes listed with prices`);
    const reg = await page.$eval("[data-testid=nav-register]", (el) => el.getAttribute("href") || "");
    ok(reg.endsWith("#register"), `${name}: nav Register points into the account`, reg);
    await page.screenshot({ path: `${OUT}/${name}-account.png`, fullPage: true });
    await page.goto("https://cufc.co.nz/programmes", { waitUntil: "networkidle0" });
    ok(!!(await page.waitForSelector("[data-testid=nav-account]", { timeout: 15000 }).catch(() => null)), `${name}: another page's nav shows the person too`);
    await page.screenshot({ path: `${OUT}/${name}-programmes-nav.png` });
    await ctx.close();
  }
} catch (e: any) { ok(false, "run completed", e?.message); }
finally {
  await browser.close();
  await pool.query(`DELETE FROM parent_login_codes WHERE email=$1`, [EMAIL]);
  await pool.query(`DELETE FROM parent_sessions WHERE email=$1`, [EMAIL]);
  await pool.query(`DELETE FROM parent_auth_events WHERE lower(email)=$1`, [EMAIL]);
  await pool.end();
}
console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);

// The live academy checkout, in a real browser: the new-or-returning question,
// signing in INSIDE the checkout (reserved test@example.com — the code is
// recovered from its hash because we hold the row), and the "I'm new" path.
//   npx tsx --env-file=.env script/_verify-checkout-returning-browser.ts
// Creates no registration. Cleans every code and session it makes.
import puppeteer from "puppeteer-core";
import { Pool } from "pg";
import crypto from "crypto";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL0 = "https://join.cufc.co.nz/academy/pre-academy-u9-u12?option=30";
const ACCOUNT = "https://cufc.co.nz/account";
const EMAIL = "test@example.com";
const OUT = process.env.OUT || "/tmp/checkout-returning";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c: boolean, l: string, x = "") => { console.log(`${c ? "  ok  " : " FAIL "} ${l}${x ? " — " + x : ""}`); c ? pass++ : fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const click = (page: any, text: string) => page.evaluate((t: string) => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim().toLowerCase().includes(t.toLowerCase()));
  if (b) { (b as HTMLButtonElement).click(); return true; } return false;
}, text);

async function crack(): Promise<string | null> {
  for (let tries = 0; tries < 20; tries++) {
    const { rows } = await pool.query(`SELECT code_hash FROM parent_login_codes WHERE email = $1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`, [EMAIL]);
    if (rows[0]) {
      for (let i = 0; i < 1_000_000; i++) {
        const c = String(i).padStart(6, "0");
        if (crypto.createHash("sha256").update(`${c}:${EMAIL}`).digest("hex") === rows[0].code_hash) return c;
      }
    }
    await sleep(500);
  }
  return null;
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  await pool.query(`DELETE FROM parent_login_codes WHERE email = $1`, [EMAIL]);
  for (const [name, vp] of [["phone", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ["desktop", { width: 1440, height: 900 }]] as const) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport(vp as any);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(URL0, { waitUntil: "networkidle0" });
    const panel = await page.waitForSelector("[data-testid=returning-panel]", { timeout: 15000 }).catch(() => null);
    ok(!!panel, `${name}: live checkout asks "Registered a child with us before?"`);
    await page.screenshot({ path: `${OUT}/${name}-1-question.png` });

    // Sign in inside the checkout.
    await click(page, "Yes — sign me in");
    await page.waitForSelector("[data-testid=input-signin-email]");
    await page.type("[data-testid=input-signin-email]", EMAIL);
    await click(page, "Email me a code");
    await page.waitForSelector("[data-testid=input-signin-code]", { timeout: 15000 });
    const code = await crack();
    ok(!!code, `${name}: a code was issued from inside the checkout`);
    await page.type("[data-testid=input-signin-code]", code || "000000");
    await click(page, "Sign in and fill it in");
    const bar = await page.waitForSelector("[data-testid=signed-in-bar]", { timeout: 15000 }).catch(() => null);
    ok(!!bar, `${name}: signed in without leaving the checkout`);
    const email = await page.$eval("[data-testid=signed-in-bar]", (el) => el.textContent || "").catch(() => "");
    ok(email.includes(EMAIL), `${name}: "Signed in as ${EMAIL}"`);
    await page.screenshot({ path: `${OUT}/${name}-2-signed-in.png` });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(over <= 0, `${name}: no sideways scroll`, `${over}px`);

    // The same session opens the account page on cufc.co.nz (one account, two sites).
    const acct = await ctx.newPage();
    await acct.setViewport(vp as any);
    await acct.goto(ACCOUNT, { waitUntil: "networkidle0" });
    await acct.waitForFunction(() => /kia ora/i.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
    const t = (await acct.evaluate(() => document.body.innerText)).toLowerCase();
    ok(t.includes("kia ora") && t.includes("signing in") && t.includes("saved cards"), `${name}: cufc.co.nz/account opens signed in, with the new sections`);
    await acct.screenshot({ path: `${OUT}/${name}-3-account.png`, fullPage: true });

    // Sign out from the checkout clears the session everywhere.
    await click(page, "Not you? Sign out");
    await sleep(1500);
    const pre: any = await page.evaluate(() => fetch("/api/public/parent/prefill", { credentials: "include" }).then((r) => r.json()));
    ok(pre.signedIn === false, `${name}: "Not you? Sign out" ends the session`);
    ok(errors.length === 0, `${name}: no page errors`, errors.join(" | ").slice(0, 200));
    await ctx.close();

    // The "I'm new" path, fresh browser.
    const ctx2 = await browser.createBrowserContext();
    const p2 = await ctx2.newPage();
    await p2.setViewport(vp as any);
    await p2.goto(URL0, { waitUntil: "networkidle0" });
    await p2.waitForSelector("[data-testid=returning-panel]", { timeout: 15000 });
    await click(p2, "No — I'm new to the club");
    await sleep(300);
    ok(!(await p2.$("[data-testid=returning-panel]")), `${name}: "I'm new" puts the question away`);
    await click(p2, "Continue");
    await p2.waitForSelector("[data-testid=input-child-first-name]", { timeout: 10000 });
    ok(!!(await p2.$("[data-testid=prefill-sign-in]")), `${name}: the child step still offers "Sign in" to a family who chose new`);
    await p2.screenshot({ path: `${OUT}/${name}-4-new-child-step.png`, fullPage: true });
    await ctx2.close();
  }
} catch (e: any) {
  ok(false, "run completed", e?.message);
} finally {
  await browser.close();
  await pool.query(`DELETE FROM parent_login_codes WHERE email = $1`, [EMAIL]);
  await pool.query(`DELETE FROM parent_sessions WHERE email = $1`, [EMAIL]);
  await pool.query(`DELETE FROM parent_auth_events WHERE lower(email) = $1`, [EMAIL]);
  await pool.end();
}
console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);

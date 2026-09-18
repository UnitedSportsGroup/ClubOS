// Real-browser walk of the CIC 7's funnel on the LIVE site, phone-sized.
//
//   npx tsx --env-file=.env script/_verify-cic7s-browser.ts
//   SITE=https://cic7s.com (default) — or a Vercel preview URL
//
// What a manager does: opens cic7s.com from an ad link, fills in Register Your
// Interest, lands on the sales page, names their team, taps "Pay for the whole
// team", and arrives on their Team Pay page on app.usg.co.nz. Asserts each
// step, screenshots the sales page at phone + desktop for the ui-preflight
// read, then deletes the probe registration and team.
//
// Sends ONE probe "New CIC 7's registration" email to info@cic7s.com and one
// team-page email to delivered@resend.dev.
import pg from "pg";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const SITE = process.env.SITE || "https://cic7s.com";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "..", "..", "outputs", "cic7s-ads", "2026-09-08", "preflight");
const EMAIL = "delivered@resend.dev";
const TEAM = `_probe browser ${Date.now()}`;

let n = 0; const fails: string[] = [];
const check = (c: boolean, l: string) => { n++; console.log(`  ${c ? "✓" : "✗"} ${l}`); if (!c) fails.push(l); };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  let regId: number | undefined; let entryId: number | undefined;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

    // 1. land like an ad click
    await page.goto(`${SITE}/?utm_source=facebook&utm_medium=paid&utm_campaign=probe&fbclid=PROBE123`, { waitUntil: "networkidle2", timeout: 60000 });
    const pixel = await page.evaluate(() => typeof (window as any).fbq === "function");
    check(pixel, "Meta pixel is on the page");
    const tracking = await page.evaluate(() => sessionStorage.getItem("cic7s.tracking") || "");
    check(tracking.includes("PROBE123"), "fbclid + utm captured for the session");

    // 2. the form
    await page.goto(`${SITE}/#register-interest`, { waitUntil: "networkidle2" });
    await page.type('input[placeholder="First Name"]', "Probe");
    await page.type('input[placeholder="Last Name"]', "Browser (ignore)");
    await page.type('input[type="email"]', EMAIL);
    // 2026-09-17: phone, city, country and grade are DRAWN controls (house rule:
    // no native widgets). The dial code and country default to NZ, so a national
    // number and a typed city are enough; the grade is a listbox of buttons.
    await page.type('input[placeholder="City"]', "Christchurch");
    await page.type('input[type="tel"]', "210000000");
    await page.click('[data-testid="grade-select"]');
    await page.waitForSelector('[data-testid="option-Social"]', { timeout: 5000 });
    await page.click('[data-testid="option-Social"]');
    await Promise.all([
      page.waitForFunction(() => location.pathname === "/thank-you", { timeout: 30000 }),
      page.click('form button[type="submit"]'),
    ]);
    check(true, "form submitted → /thank-you");
    const reg = await page.evaluate(() => sessionStorage.getItem("cic7s.registration") || "");
    check(/"token":"[a-f0-9]{32}"/.test(reg), "registration token handed back and stored");

    // 3. the sales page, screenshots
    await page.waitForSelector('[data-testid="input-team-name"]', { timeout: 15000 });
    check(true, "sales page shows the team-name field (registered state)");
    const registeredAs = await page.evaluate(() => document.body.innerText.includes("Registered as") && document.body.innerText.includes("Probe"));
    check(registeredAs, "shows who is registered");
    await page.screenshot({ path: join(OUT, "thank-you-mobile.png"), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!overflow, "no horizontal overflow at 390px");

    // 4. name the team, pay for the whole team
    await page.type('[data-testid="input-team-name"]', TEAM);
    await Promise.all([
      page.waitForFunction(() => location.hostname === "app.usg.co.nz" && location.pathname.startsWith("/team/"), { timeout: 45000 }),
      page.click('[data-testid="option-whole"] button'),
    ]);
    const url = page.url();
    check(url.startsWith("https://app.usg.co.nz/team/"), `landed on the Team Pay page (${url.slice(0, 40)}…)`);
    check(url.includes("fbclid=PROBE123"), "fbclid carried across to app.usg.co.nz");
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 30000 }, TEAM);
    check(true, "team page shows the team name");
    const fee = await page.evaluate(() => document.body.innerText.includes("$500.00"));
    check(fee, "team page shows the Social fee $500.00 (Isaac's price, not the old $990)");
    const volt = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(volt === "rgb(10, 17, 34)", `Team Pay page is navy, the cic7s brand (got ${volt})`);
    await page.screenshot({ path: join(OUT, "team-page-mobile.png"), fullPage: true });
    // 2026-09-18: the marketplace is open, so a captain can find a fill-in from here.
    const findFillin = await page.evaluate(() => document.body.innerText.includes("Find a fill-in"));
    check(findFillin, "team page offers 'Find a fill-in' (fill-ins open for the 7's)");

    // 4b. the two new doors on /enter (2026-09-18): no team → the fill-in list; already entered → team login
    await page.goto(`${SITE}/enter`, { waitUntil: "networkidle2" });
    const fillinHref = await page.$eval('[data-testid="link-fill-in"]', (a) => (a as HTMLAnchorElement).href).catch(() => "");
    check(fillinHref.includes("app.usg.co.nz/fill-in/cic-summer-7s-2027-open"), `/enter links the fill-in list under Open by default (${fillinHref.slice(0, 60)})`);
    await page.click('[data-testid="fillin-grade-social"]');
    const fillinHrefSocial = await page.$eval('[data-testid="link-fill-in"]', (a) => (a as HTMLAnchorElement).href).catch(() => "");
    check(fillinHrefSocial.includes("/fill-in/cic-summer-7s-2027-social"), "picking Social re-points the fill-in link");
    const loginHref = await page.$eval('[data-testid="link-team-login"]', (a) => (a as HTMLAnchorElement).href).catch(() => "");
    check(loginHref === "https://app.usg.co.nz/captain?brand=cic7s", `/enter links the captain login with the 7's brand (${loginHref})`);

    // 4c. the public marketplace reads the live pool
    await page.goto(`${SITE}/marketplace`, { waitUntil: "networkidle2" });
    const mkt = await page.evaluate(() => document.body.innerText);
    // 🔴 innerText reflects text-transform: the empty-state heading is CSS-uppercased, so match case-insensitively.
    check(/players? available|nobody on the list yet/i.test(mkt), "/marketplace rendered the pool (a count, or the honest empty state)");
    check(!/Couldn't load the list/.test(mkt), "/marketplace loaded the list from ClubOS (CORS + endpoint)");
    const noindex = await page.$eval('meta[name="robots"]', (m) => (m as HTMLMetaElement).content).catch(() => "");
    check(noindex.includes("noindex"), "/marketplace is noindex");

    // 5. desktop look of the sales page (fresh session → direct-entry state)
    const desk = await browser.newPage();
    await desk.setViewport({ width: 1440, height: 900 });
    await desk.goto(`${SITE}/mens-draw`, { waitUntil: "networkidle2" });
    await desk.waitForSelector("#secure-your-spot");
    const direct = await desk.$eval("#secure-your-spot", (el) => el.textContent?.includes("Ready to enter?") ?? false);
    check(direct, "/mens-draw without a registration shows the direct-entry state");
    const hrefs = await desk.$$eval('#secure-your-spot a[href*="app.usg.co.nz/enter/"]', (as) => as.map((a) => (a as HTMLAnchorElement).href));
    check(hrefs.length === 2 && hrefs.every((h) => h.includes("/enter/cic-summer-7s-2027")), "both option buttons link to the ClubOS entry page");
    await desk.screenshot({ path: join(OUT, "mens-draw-desktop.png"), fullPage: true });
    await desk.setViewport({ width: 1366, height: 768 });
    await desk.goto(`${SITE}/thank-you`, { waitUntil: "networkidle2" });
    await desk.screenshot({ path: join(OUT, "thank-you-1366.png") });
  } catch (e: any) {
    // 🔴 Without this, a selector that no longer exists on the page threw
    // straight into `finally`, which exited with the cleanup's verdict — the
    // 2026-09-17 form rebuild broke the walk and the script reported 3 checks
    // and one cleanup failure instead of the actual error.
    check(false, `walk threw: ${e?.message || e}`);
  } finally {
    await browser.close();
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      const rows = (await c.query(`select id, teampay_entry_id from cic7s_registrations where email = $1 and first_name = 'Probe'`, [EMAIL])).rows;
      for (const r of rows) {
        if (r.teampay_entry_id) {
          const kids = (await c.query(`
            select cl.relname as tbl, att.attname as col from pg_constraint con
              join pg_class cl on cl.oid = con.conrelid
              join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
             where con.contype = 'f' and con.confrelid = 'teampay_entries'::regclass`)).rows as { tbl: string; col: string }[];
          for (const k of kids) if (k.tbl !== "cic7s_registrations") await c.query(`delete from ${k.tbl} where ${k.col} = $1`, [r.teampay_entry_id]);
          await c.query(`delete from teampay_entries where id = $1`, [r.teampay_entry_id]);
          entryId = r.teampay_entry_id;
        }
        await c.query(`delete from cic7s_registrations where id = $1`, [r.id]);
        regId = r.id;
      }
      check(!!regId, `probe rows deleted (registration ${regId}, entry ${entryId})`);
    } finally { await c.end(); }
    console.log(`\n  ${n} checks, ${fails.length} failed${fails.length ? ":\n   - " + fails.join("\n   - ") : ""}\n  screenshots → ${OUT}\n`);
    process.exit(fails.length ? 1 : 0);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

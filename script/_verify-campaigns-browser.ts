/**
 * Campaigns — drive the REAL page in a real browser, as an ORDINARY staff
 * member holding only this tab, at laptop and phone size: make a campaign
 * through the form, add a task, tick it, add a channel, move between the
 * sections, and go Back.
 *
 *   npx tsx --env-file=.env script/_verify-campaigns-browser.ts [screenshot-dir]
 *   VERIFY_BASE=http://localhost:5230 …   (the local preview: no sign-in)
 *
 * Everything it makes is named "_probe …" and removed at the end, along with
 * the throwaway login.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer, { type Page } from "puppeteer-core";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const LOCAL = BASE.startsWith("http://localhost");
const SHOTS = process.argv[2] || null;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0;
let fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};
let userId: number | null = null;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function clickText(page: Page, selector: string, text: RegExp) {
  const handles = await page.$$(selector);
  for (const h of handles) {
    const t = await h.evaluate((el) => (el.textContent || "").trim());
    if (text.test(t)) {
      await h.click();
      return true;
    }
  }
  return false;
}

/** The dialog must sit inside the screen, and nothing in it may stick out sideways. */
async function dialogFits(page: Page) {
  return page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]') as HTMLElement | null;
    if (!d) return { ok: false, why: "no dialog" };
    const r = d.getBoundingClientRect();
    let widest = 0;
    d.querySelectorAll("*").forEach((el) => {
      const b = (el as HTMLElement).getBoundingClientRect();
      if (b.width > 0) widest = Math.max(widest, b.right);
    });
    const good = r.left >= -1 && r.right <= innerWidth + 1 && widest <= r.right + 1;
    return { ok: good, why: `dialog ${Math.round(r.left)}–${Math.round(r.right)} of ${innerWidth}, widest child reaches ${Math.round(widest)}` };
  });
}

/** Save the open form and wait until it has really gone: its fading overlay swallows the next click. */
async function saveForm(page: Page) {
  await page.click('[data-testid="form-save"]');
  await page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 30_000 }).catch(() => {});
  await wait(350);
}

async function main() {
  let cookie: { name: string; value: string } | null = null;
  if (!LOCAL) {
    const email = `_cmp_browser_${Date.now()}@usg.co.nz`;
    const pw = `C${Math.random().toString(36).slice(2)}!aA9`;
    const { rows } = await pool.query(
      `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1, 'Campaign', 'Probe', $2, 'team_member', true) RETURNING id`,
      [email, await bcrypt.hash(pw, 10)],
    );
    userId = rows[0].id;
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role, tabs) SELECT $1, id, 'team_member', $2 FROM organizations WHERE slug = 'united-sports-group'`,
      [userId, JSON.stringify(["marketing-hub", "campaign-planner"])],
    );
    const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
    const [name, ...rest] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
    cookie = { name, value: rest.join("=") };
  }

  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  for (const [w, h, tag] of [[1440, 900, "laptop"], [390, 844, "phone"]] as const) {
    console.log(`\n${tag} ${w}×${h}`);
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    if (cookie) await page.setCookie({ ...cookie, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const shot = async (n: string) => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/cmp-${n}-${tag}.png` });
    };
    const name = `_probe ${tag} ${Date.now()}`;

    if (!LOCAL && tag === "laptop") {
      await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 90_000 });
      let link = await page.$('a[href="/admin/campaigns"]');
      if (!link) {
        await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll("button, a")).find((e) => /^Marketing$/.test((e.textContent || "").trim())) as HTMLElement | undefined;
          b?.click();
        });
        await wait(1000);
        link = await page.$('a[href="/admin/campaigns"]');
      }
      ok("the sidebar has a Campaigns link under Marketing", !!link);
    }

    await page.goto(`${BASE}/admin/campaigns?show=all`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="campaign-new"]', { timeout: 40_000 });
    ok("the list has no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);

    // ── Make a campaign through the form ──
    await page.click('[data-testid="campaign-new"]');
    await page.waitForSelector('[data-testid="campaign-name"]', { timeout: 10_000 });
    await wait(500);
    const fit = await dialogFits(page);
    ok("the new-campaign form fits the screen", fit.ok, fit.why);
    await shot("form");
    await page.type('[data-testid="campaign-name"]', name);
    await page.type('[data-testid="campaign-goal-signups"]', "50");
    await saveForm(page);
    await page.waitForSelector('[data-testid="campaign-title"]', { timeout: 30_000 }).catch(() => {});
    const title = (await page.$eval('[data-testid="campaign-title"]', (e) => e.textContent).catch(() => "")) || "";
    ok("saving opens the new campaign", title.includes(name) && /\/admin\/campaigns\/\d+/.test(page.url()), page.url());
    const body = await page.evaluate(() => document.body.innerText);
    ok("the goal shows, with nothing invented as a result", /of 50/.test(body) && /Nothing is linked yet/i.test(body));
    ok("the campaign page has no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);

    // ── Timeline: add a task, tick it ──
    await page.click('[data-testid="campaign-tab-timeline"]');
    ok("the open section is in the URL", page.url().includes("tab=timeline"), page.url());
    await page.waitForSelector('[data-testid="task-add"]');
    await page.click('[data-testid="task-add"]');
    await page.waitForSelector('[data-testid="task-title"]', { timeout: 10_000 });
    await wait(400);
    const fit2 = await dialogFits(page);
    ok("the task form fits the screen", fit2.ok, fit2.why);
    await page.type('[data-testid="task-title"]', "Probe task");
    await saveForm(page);
    await page.waitForSelector('[data-testid="task-row"]', { timeout: 20_000 }).catch(() => {});
    ok("the task appears", (await page.$$('[data-testid="task-row"]')).length === 1);
    await page.click('[data-testid="task-toggle"]');
    await page.waitForFunction(() => /Done · 1/i.test(document.body.innerText), { timeout: 15_000 }).catch(() => {});
    const done = await page.evaluate(() => document.body.innerText);
    ok("ticking it moves it to Done and says who", /done · 1/i.test(done) && /done by/i.test(done));
    const toggle = await page.$eval('[data-testid="task-toggle"]', (e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); });
    ok("the tick is big enough to tap", tag === "laptop" ? toggle >= 28 : toggle >= 44, `${Math.round(toggle)}px`);
    await shot("timeline");

    // ── Channels: add one ──
    await page.click('[data-testid="campaign-tab-channels"]');
    await page.waitForSelector('[data-testid="channel-add"]');
    await page.click('[data-testid="channel-add"]');
    await page.waitForSelector('[data-testid="channel-name"]', { timeout: 10_000 });
    await wait(1500);
    const fit3 = await dialogFits(page);
    ok("the channel form fits the screen", fit3.ok, fit3.why);
    await shot("channel-form");
    await page.type('[data-testid="channel-name"]', "Probe ads");
    await saveForm(page);
    await page.waitForSelector('[data-testid="channel-card"]', { timeout: 20_000 }).catch(() => {});
    ok("the channel appears", (await page.$$('[data-testid="channel-card"]')).length === 1);
    ok("the channels section has no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);

    // ── Split tests: make one ──
    await page.click('[data-testid="campaign-tab-tests"]');
    await page.waitForSelector('[data-testid="test-add"]');
    await page.click('[data-testid="test-add"]');
    await page.waitForSelector('[data-testid="test-name"]', { timeout: 10_000 });
    await wait(400);
    const fit4 = await dialogFits(page);
    ok("the split-test form fits the screen", fit4.ok, fit4.why);
    await page.type('[data-testid="test-name"]', "Probe test");
    await saveForm(page);
    await page.waitForSelector('[data-testid="test-card"]', { timeout: 20_000 }).catch(() => {});
    const verdict = (await page.$eval('[data-testid="test-verdict"]', (e) => e.textContent).catch(() => "")) || "";
    ok("the test appears and does not name a winner with nothing counted", /Nothing to compare yet/i.test(verdict), verdict.slice(0, 80));
    ok("the tests section has no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);
    await shot("tests");

    // ── Reload keeps the section; Back goes to the list ──
    await page.reload({ waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="test-card"]', { timeout: 20_000 }).catch(() => {});
    ok("a reload stays on the same section", !!(await page.$('[data-testid="test-card"]')));
    await page.click('[data-testid="campaign-back"]');
    await page.waitForSelector('[data-testid="campaign-new"]', { timeout: 20_000 }).catch(() => {});
    ok("Back returns to the campaign list", /\/admin\/campaigns(\?|$)/.test(page.url()), page.url());
    await page.goto(`${BASE}/admin/campaigns?show=all`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="campaign-card"]', { timeout: 20_000 }).catch(() => {});
    const cards = await page.$$eval('[data-testid="campaign-card"]', (els) => els.map((e) => (e as HTMLElement).innerText));
    ok("the new campaign is on the list with its goal", cards.some((c) => c.includes(name) && /of 50/.test(c)));
    await shot("list");
    ok("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
    await page.close();
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await pool.query(`DELETE FROM cmp_campaigns WHERE name LIKE '\\_probe %'`).catch(() => {});
    if (userId) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [userId]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    }
    await pool.end();
    process.exit(fail ? 1 : 0);
  });

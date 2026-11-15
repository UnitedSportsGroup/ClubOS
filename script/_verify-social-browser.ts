/**
 * Social media — open the REAL page on production in a real browser, as an
 * ORDINARY staff member holding only this tab, at laptop and phone size.
 *
 *   npx tsx --env-file=.env script/_verify-social-browser.ts [screenshot-dir]
 *
 * Checks: the sidebar link exists and can be clicked · each view renders real
 * data · no sideways scroll · pictures actually load · the brand choice and
 * view survive in the URL. Read-only; the throwaway login is cleaned up after.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
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

async function main() {
  const email = `_social_browser_${Date.now()}@usg.co.nz`;
  const pw = `S${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1, 'Social', 'Probe', $2, 'team_member', true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)],
  );
  userId = rows[0].id;
  await pool.query(
    `INSERT INTO user_organizations (user_id, organization_id, role, tabs) SELECT $1, id, 'team_member', $2 FROM organizations WHERE slug = 'united-sports-group'`,
    [userId, JSON.stringify(["marketing-hub", "social-media"])],
  );
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const [name, ...rest] = cookie.split("=");

  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  for (const [w, h, tag] of [[1440, 900, "laptop"], [390, 844, "phone"]] as const) {
    console.log(`\n${tag} ${w}×${h}`);
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    await page.setCookie({ name, value: rest.join("="), domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const shot = async (n: string) => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/prod-${n}-${tag}.png` });
    };

    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 90_000 });
    if (tag === "laptop") {
      // The link lives under the Marketing dropdown — open it if it is shut.
      let link = await page.$('a[href="/admin/social-media"]');
      if (!link) {
        await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll("button, a")).find((e) => /^Marketing$/.test((e.textContent || "").trim())) as HTMLElement | undefined;
          b?.click();
        });
        await wait(1000);
        link = await page.$('a[href="/admin/social-media"]');
      }
      ok("the sidebar has a Social media link under Marketing", !!link);
      if (link) {
        await link.evaluate((el) => (el as HTMLElement).click());
        await page.waitForSelector('[data-testid="social-accounts"]', { timeout: 30_000 }).catch(() => {});
      }
      ok("clicking it opens the page", page.url().includes("/admin/social-media"), page.url());
    }

    await page.goto(`${BASE}/admin/social-media?brand=cufc`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="social-post"]', { timeout: 40_000 }).catch(() => {});
    const chips = await page.$$eval('[data-testid="social-account-chip"]', (els) => els.map((e) => (e.textContent || "").trim()));
    ok("CUFC shows its Instagram and Facebook accounts", chips.filter((c) => /christchurchunitedfc/i.test(c)).length >= 2, chips.join(" · ").slice(0, 160));
    const text = await page.evaluate(() => document.body.innerText);
    ok("the overview shows a follower number", /Followers\s*\d{1,3}(,\d{3})+/i.test(text));
    ok("best posts are drawn", (await page.$$('[data-testid="social-post"]')).length > 0);
    ok("no sideways scroll on the overview", (await overflow()) <= 0, `${await overflow()}px`);
    await page.evaluate(() => document.querySelector('[data-testid="social-post"]')?.scrollIntoView());
    await wait(6000);
    const imgs = await page.$$eval('[data-testid="social-post"] img', (els) =>
      els
        .filter((i) => {
          const r = i.getBoundingClientRect();
          return r.top < innerHeight && r.bottom > 0;
        })
        .map((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0),
    );
    ok("the pictures on screen have actually loaded", imgs.length > 0 && imgs.every(Boolean), `${imgs.filter(Boolean).length} of ${imgs.length}`);
    await shot("overview");

    await page.click('[data-testid="social-view-posts"]');
    await page.waitForSelector('[data-testid="social-post-total"]', { timeout: 30_000 }).catch(() => {});
    ok("the Posts view is in the URL", page.url().includes("view=posts") && page.url().includes("brand=cufc"), page.url());
    ok("no sideways scroll on Posts", (await overflow()) <= 0);
    await page.click('[data-testid="social-post"]');
    await page.waitForSelector('[role="dialog"]', { timeout: 10_000 }).catch(() => {});
    await wait(600);
    const dialog = await page
      .$eval('[role="dialog"]', (d) => {
        const r = d.getBoundingClientRect();
        return { left: r.left, right: r.right, vw: innerWidth };
      })
      .catch(() => null);
    ok("a post opens, and its sheet fits the screen", !!dialog && dialog.left >= 0 && dialog.right <= dialog.vw + 1, dialog ? `${Math.round(dialog.left)}–${Math.round(dialog.right)} of ${dialog.vw}` : "no dialog");
    await shot("post");
    await page.keyboard.press("Escape");

    await page.goto(`${BASE}/admin/social-media?brand=cufc&view=calendar&month=2026-05`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="social-cal-day"]', { timeout: 40_000 }).catch(() => {});
    const title = (await page.$eval('[data-testid="social-cal-title"]', (e) => e.textContent).catch(() => "")) || "";
    ok("the calendar opens on the month in the URL", title.includes("May 2026"), title);
    ok("days with posts are drawn", (await page.$$('[data-testid="social-cal-day"]')).length > 3);
    await page.click('[data-testid="social-cal-day"]');
    await page.waitForSelector('[data-testid="social-cal-daylist"]', { timeout: 10_000 }).catch(() => {});
    ok("tapping a day lists that day's posts", !!(await page.$('[data-testid="social-cal-daylist"] [data-testid="social-post"]')));
    ok("no sideways scroll on the calendar", (await overflow()) <= 0, `${await overflow()}px`);
    await shot("calendar");

    await page.goto(`${BASE}/admin/social-media?view=accounts`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="social-account-row"]', { timeout: 40_000 }).catch(() => {});
    ok("Accounts lists every connected account", (await page.$$('[data-testid="social-account-row"]')).length >= 16);
    ok("no sideways scroll on Accounts", (await overflow()) <= 0, `${await overflow()}px`);
    await shot("accounts");
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
    if (userId) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [userId]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    }
    await pool.end();
    process.exit(fail ? 1 : 0);
  });

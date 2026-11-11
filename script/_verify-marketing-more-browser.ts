/**
 * Marketing → Mobile Apps · Search & Reviews · Flyers & Print · Events &
 * Activations · Product Quality · Listings · Partners & Ambassadors · Word of
 * Mouth · Offers & Codes, and "Other people's newsletters" on Email — prove on
 * PRODUCTION, as an ORDINARY staff member holding only these tabs, that the
 * gates hold and the real pages work at laptop and phone size.
 *
 *   npx tsx --env-file=.env script/_verify-marketing-more-browser.ts [screenshot-dir]
 *
 * Rows it adds are named "_probe …" and removed at the end, with its logins.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const USG = "united-sports-group";
const SHOTS = process.argv[2] || null;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0;
let fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const users: number[] = [];

async function account(tag: string, workspace: string, tabs: string[]) {
  const email = `_mktmore_${tag}_${Date.now()}@usg.co.nz`;
  const pw = `M${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1, 'Marketing', 'Probe', $2, 'team_member', true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)],
  );
  users.push(rows[0].id);
  await pool.query(
    `INSERT INTO user_organizations (user_id, organization_id, role, tabs) SELECT $1, id, 'team_member', $3 FROM organizations WHERE slug = $2`,
    [rows[0].id, workspace, JSON.stringify(tabs)],
  );
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const [name, ...rest] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
  return { name, value: rest.join("=") };
}
type C = { name: string; value: string };
const call = (c: C | null, path: string, ws: string | null, init: RequestInit = {}) =>
  fetch(`${BASE}/api/admin/${path}`, {
    ...init,
    headers: { ...(c ? { cookie: `${c.name}=${c.value}` } : {}), ...(ws ? { "X-Workspace-Slug": ws } : {}), "Content-Type": "application/json", ...(init.headers || {}) },
  });

const TABS = ["flyers-print", "events-activations", "search-reviews", "listings", "mobile-apps", "partners-ambassadors", "word-of-mouth", "offers-codes", "product-quality", "email-stats"];
// page path, heading, the list a row is added to, a report testid that must show (or null)
const REGISTERS: [string, string, string, string | null][] = [
  ["/admin/flyers-print", "Flyers & Print", "flyers-print", null],
  ["/admin/events-activations", "Events & Activations", "events-activations", null],
  ["/admin/search-reviews", "Search & Reviews", "search-checks", "more-not-connected"],
  ["/admin/listings", "Listings", "listings", null],
  ["/admin/mobile-apps", "Mobile Apps", "mobile-apps", "app-row"],
  ["/admin/partners-ambassadors", "Partners & Ambassadors", "partners-ambassadors", null],
  ["/admin/product-quality", "Product Quality", "product-quality", "quality-tiles"],
];

async function main() {
  const staff = await account("all", USG, TABS);
  const one = await account("one", USG, ["listings"]);

  console.log("\nGates");
  ok("signed out is refused", (await call(null, "word-of-mouth/report", USG)).status === 401);
  for (const p of ["word-of-mouth/report", "offers-codes/report", "mobile-apps/report", "product-quality/signals", ...["flyers-print", "events-activations", "product-quality", "listings", "partners-ambassadors", "newsletter-placements", "review-profiles", "search-checks", "search-fixes", "mobile-apps"].map((c) => `offline-marketing/${c}`)]) {
    ok(`staff with the tabs can read ${p}`, (await call(staff, p, USG)).status === 200);
  }
  for (const p of ["word-of-mouth/report", "offers-codes/report", "mobile-apps/report", "product-quality/signals", "offline-marketing/flyers-print", "offline-marketing/newsletter-placements", "offline-marketing/search-checks"]) {
    ok(`a person with only Listings cannot read ${p}`, (await call(one, p, USG)).status === 403);
  }
  ok("another workspace gets 404", [404, 403].includes((await call(staff, "word-of-mouth/report", "christchurch-united")).status) && [404, 403].includes((await call(staff, "offers-codes/report", "mini-football-leagues")).status));

  const wom = await (await call(staff, "word-of-mouth/report?period=all", USG)).json();
  ok("Word of Mouth: the groups add up to the answers", wom.groups.reduce((s: number, g: any) => s + g.count, 0) === wom.answered && wom.answered > 0, `${wom.answered} answers of ${wom.bookings} bookings`);
  ok("…and no typed-in answer is listed", !wom.answers.some((a: any) => /^other:/i.test(a.label)));
  const direct = await pool.query(`SELECT count(*) FILTER (WHERE NULLIF(btrim(r.referral_source), '') IS NOT NULL) a, count(*) b FROM registrations r JOIN programs p ON p.id = r.program_id JOIN organizations o ON o.id = p.organization_id WHERE r.status IN ('confirmed','refunded','partially_refunded')`);
  ok("…and match a direct count of paid bookings", Math.abs(Number(direct.rows[0].a) - wom.answered) <= 3 && Math.abs(Number(direct.rows[0].b) - wom.bookings) <= 3, `${direct.rows[0].a} / ${direct.rows[0].b}`);
  const off = await (await call(staff, "offers-codes/report?period=all", USG)).json();
  const directOff = await pool.query(`SELECT count(*) n, COALESCE(sum(discount_cents),0) d FROM registrations WHERE status IN ('confirmed','refunded','partially_refunded') AND NULLIF(btrim(discount_code), '') IS NOT NULL`);
  ok("Offers: totals count each booking once", off.totals.uses >= Number(directOff.rows[0].n) && off.totals.uses <= Number(directOff.rows[0].n) + 200 && off.rows.length > 0, `${off.totals.uses} sales, ${directOff.rows[0].n} bookings with a code`);
  const bad = await call(staff, "offline-marketing/events-activations", USG, { method: "POST", body: JSON.stringify({ title: "_probe bad", kind: "nonsense" }) });
  ok("a type that is not on the list is refused", bad.status === 400);

  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  for (const [w, h, tag] of [[1440, 900, "laptop"], [390, 844, "phone"]] as const) {
    console.log(`\n${tag} ${w}×${h}`);
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    await page.setCookie({ ...staff, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const shot = async (n: string) => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/more-${n}-${tag}.png`, fullPage: true });
    };

    if (tag === "laptop") {
      await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 90_000 });
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll("button, a")).find((e) => /^Marketing$/.test((e.textContent || "").trim())) as HTMLElement | undefined;
        if (!document.querySelector('a[href="/admin/listings"]')) b?.click();
      });
      await wait(1000);
      for (const t of TABS.filter((x) => x !== "email-stats")) ok(`the sidebar has a link to /admin/${t}`, !!(await page.$(`a[href="/admin/${t}"]`)));
      await shot("sidebar");
    }

    for (const [path, heading, list, reportId] of REGISTERS) {
      const name = `_probe ${list} ${tag}`;
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: 90_000 });
      await page.waitForSelector('[data-testid="offline-add"]', { timeout: 40_000 });
      const h1 = await page.$eval("h1", (e) => e.textContent);
      ok(`${heading} opens`, h1 === heading, String(h1));
      if (reportId) {
        await page.waitForSelector(`[data-testid="${reportId}"]`, { timeout: 30_000 }).catch(() => {});
        ok(`${heading}: its panel above the list shows`, !!(await page.$(`[data-testid="${reportId}"]`)));
      }
      ok(`${heading}: no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
      await page.click('[data-testid="offline-add"]');
      await page.waitForSelector('[data-testid="offline-title"]', { timeout: 10_000 });
      await wait(400);
      const fit = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]') as HTMLElement;
        const r = d.getBoundingClientRect();
        let widest = 0;
        d.querySelectorAll("*").forEach((el) => {
          const b = (el as HTMLElement).getBoundingClientRect();
          if (b.width > 0) widest = Math.max(widest, b.right);
        });
        return { good: r.left >= -1 && r.right <= innerWidth + 1 && widest <= r.right + 1, why: `dialog ${Math.round(r.left)}–${Math.round(r.right)} of ${innerWidth}, widest child ${Math.round(widest)}` };
      });
      ok(`${heading}: the form fits the screen`, fit.good, fit.why);
      if (tag === "laptop") await page.screenshot({ path: SHOTS ? `${SHOTS}/more-${list}-form.png` : undefined as any }).catch(() => {});
      await page.type('[data-testid="offline-title"]', name);
      await page.click('[data-testid="offline-save"]');
      await page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 30_000 }).catch(() => {});
      await wait(700);
      const cards = await page.$$eval('[data-testid="offline-item"]', (els) => els.map((e) => (e as HTMLElement).innerText));
      ok(`${heading}: the new row appears`, cards.some((c) => c.includes(name)));
      ok(`${heading}: still no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
      await shot(list);
    }

    // Search & Reviews holds three lists, in the URL.
    await page.goto(`${BASE}/admin/search-reviews`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="offline-list-review-profiles"]');
    await page.click('[data-testid="offline-list-review-profiles"]');
    await wait(800);
    ok("Search & Reviews: the Reviews list is in the URL", page.url().includes("list=review-profiles"), page.url());
    await page.click('[data-testid="offline-add"]');
    await page.waitForSelector("#om-size", { timeout: 10_000 });
    ok("…and a review page asks for a star rating", /Star rating/.test(await page.$eval('[role="dialog"]', (e) => (e as HTMLElement).innerText)));
    await page.keyboard.press("Escape");
    await wait(400);

    // Reports
    await page.goto(`${BASE}/admin/word-of-mouth?period=all`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="wom-tiles"]', { timeout: 40_000 });
    ok("Word of Mouth opens with its numbers", (await page.$eval("h1", (e) => e.textContent)) === "Word of Mouth" && (await page.$$('[data-testid="wom-workspace"]')).length > 0);
    ok("Word of Mouth: no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);
    await shot("word-of-mouth");
    await page.goto(`${BASE}/admin/offers-codes?period=all`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="offers-tiles"]', { timeout: 40_000 });
    ok("Offers & Codes opens with its codes", (await page.$$('[data-testid="offer-row"]')).length > 0);
    ok("Offers & Codes: no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);
    await shot("offers-codes");

    // Email: the outside newsletters sit under the club's own sends, and filtering them leaves Email's URL alone.
    await page.goto(`${BASE}/admin/email-stats`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="register-newsletter-placements"] [data-testid="offline-add"]', { timeout: 40_000 });
    const nl = `_probe newsletter ${tag}`;
    await page.click('[data-testid="register-newsletter-placements"] [data-testid="offline-add"]');
    await page.waitForSelector('[data-testid="offline-title"]', { timeout: 10_000 });
    await wait(400);
    ok("Email: the newsletter form asks whose newsletter and the size of their list", /Whose newsletter/.test(await page.$eval('[role="dialog"]', (e) => (e as HTMLElement).innerText)) && /People on their list/.test(await page.$eval('[role="dialog"]', (e) => (e as HTMLElement).innerText)));
    await page.type('[data-testid="offline-title"]', nl);
    await page.click('[data-testid="offline-save"]');
    await page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 30_000 }).catch(() => {});
    await wait(700);
    ok("Email: the outside newsletter appears under the club's sends", (await page.$$eval('[data-testid="offline-item"]', (els) => els.map((e) => (e as HTMLElement).innerText))).some((c) => c.includes(nl)));
    ok("Email: no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);
    await shot("email");
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
    await pool.query(`DELETE FROM offline_marketing_items WHERE title LIKE '\\_probe %'`).catch(() => {});
    for (const id of users) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
    }
    await pool.end();
    process.exit(fail ? 1 : 0);
  });

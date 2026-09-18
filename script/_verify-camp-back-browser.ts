/**
 * Academy → a camp → Back must return to ACADEMY.
 *
 * Daniel, 2026-09-18: "I click into academy and click into for example
 * fundamentals camp and then when I click back it doesn't take me back to
 * academy, it takes me here [Camps]. Confusing user journey."
 *
 * 🔴 Only a browser can prove this, and the cause was the LINK, not the back
 * button. The Academy page lists holiday camps in its own "Holiday Camps"
 * section but linked each one to /admin/camps/:id — and CUFC deliberately
 * HIDES its Camps sidebar item (sidebar-hidden.ts, Daniel 2026-09-02, "camps
 * are now a section on the Academy page"). So the journey landed on a page
 * with no sidebar entry and nothing highlighted, and Back kept him there.
 *
 * The invariant worth holding, beyond this one journey: you are never left
 * standing on a section this workspace does not draw.
 *
 *   npx tsx --env-file=.env script/_verify-camp-back-browser.ts
 */
import pg from "pg"; import bcrypt from "bcryptjs"; import puppeteer from "puppeteer-core";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WS = "christchurch-united";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0, uid: number | null = null, browser: any = null;
const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); g ? pass++ : fail++; };
const settle = (ms = 2600) => new Promise(r => setTimeout(r, ms));

async function main() {
  const email = `_back_${Date.now()}@usg.co.nz`, pw = `B${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Back','Probe',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)]);
  uid = rows[0].id;
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WS]);
  // 🔴 ORDINARY staff, not a super admin — a super admin sees a different
  // sidebar and would not reproduce the journey Daniel is describing.
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [uid, org[0].id]);
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const [n, v] = (r.headers.get("set-cookie") || "").split(";")[0].split("=");

  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ name: n, value: v, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
  const errs: string[] = []; page.on("pageerror", (e: any) => errs.push(String(e.message).slice(0, 120)));

  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((w: string) => localStorage.setItem("clubos_workspace", w), WS);

  const { rows: camp } = await pool.query(
    `SELECT id, name FROM programs WHERE type <> 'academy' AND is_active AND organization_id=$1 ORDER BY id DESC LIMIT 1`, [org[0].id]);
  const { rows: acad } = await pool.query(
    `SELECT id, name FROM programs WHERE type = 'academy' AND is_active AND organization_id=$1 ORDER BY id DESC LIMIT 1`, [org[0].id]);
  ok("the club has a holiday camp to test with", camp.length > 0, camp[0]?.name);
  ok("the club has an academy programme to test with", acad.length > 0, acad[0]?.name);
  if (!camp.length || !acad.length) return finish();

  const openByName = async (name: string) => page.evaluate((n: string) => {
    const el = Array.from(document.querySelectorAll("tr"))
      .find(x => (x.textContent || "").includes(n) && (x as HTMLElement).offsetHeight > 0);
    if (!el) return false;
    (el as HTMLElement).click();
    return true;
  }, name);
  const backHref = () => page.evaluate(() => {
    const b = document.querySelector('[data-testid="button-back"]');
    return b?.closest("a")?.getAttribute("href") ?? null;
  });
  // 🔴 data-active is stamped on EVERY nav row as "true"/"false" — a bare
  // [data-active] selector matches the inactive ones too and would pass
  // vacuously. Ask for the one that is actually true.
  const activeNav = () => page.evaluate(() =>
    (document.querySelector('[data-active="true"]') as HTMLAnchorElement | null)?.getAttribute("href") ?? null);
  const drawnSections = () => page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-active]"))
      .map(e => (e as HTMLAnchorElement).getAttribute("href")).filter(Boolean) as string[]);

  // ── 1. THE REPORTED BUG ────────────────────────────────────────────────
  console.log("\n  Academy → a holiday camp → Back");
  await page.goto(`${BASE}/admin/academy`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle();
  ok("the Academy page loads", (await page.evaluate(() => document.body.innerText.length)) > 200);
  const drawn = await drawnSections();
  ok("this workspace really does hide its Camps item (the premise)",
    !drawn.includes("/admin/camps"), `sidebar: ${drawn.filter(h => h.startsWith("/admin/a") || h.startsWith("/admin/c")).join(" ")}`);
  ok("a camp opens from the Academy page", await openByName(camp[0].name));
  await settle(3000);
  const afterOpen = page.url().replace(BASE, "");
  ok("the address stays under /admin/academy — not rewritten to Camps",
    afterOpen.startsWith("/admin/academy/"), afterOpen);
  ok("the sidebar still highlights Academy", (await activeNav()) === "/admin/academy", String(await activeNav()));
  ok("the Back arrow points at Academy", (await backHref()) === "/admin/academy", String(await backHref()));
  await page.evaluate(() => (document.querySelector('[data-testid="button-back"]') as HTMLElement)?.click());
  await settle();
  ok("clicking Back lands on Academy", page.url().replace(BASE, "") === "/admin/academy", page.url().replace(BASE, ""));

  // ── 2. A STALE /admin/camps LINK TO A CAMP ─────────────────────────────
  // Where the global search (Cmd+K) and every old bookmark still point.
  console.log("\n  A stale /admin/camps link to a holiday camp");
  await page.goto(`${BASE}/admin/camps/${camp[0].id}`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle(3200);
  ok("it heals onto Academy rather than stranding you on a hidden section",
    page.url().replace(BASE, "") === `/admin/academy/${camp[0].id}`, page.url().replace(BASE, ""));
  ok("and something in the sidebar is highlighted", (await activeNav()) === "/admin/academy", String(await activeNav()));

  // ── 3. AN ACADEMY PROGRAMME PARKED UNDER CAMPS STILL HEALS ─────────────
  console.log("\n  A stale /admin/camps link to an academy programme");
  await page.goto(`${BASE}/admin/camps/${acad[0].id}`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle(3200);
  ok("a stale camps link to an academy programme still heals to Academy",
    page.url().replace(BASE, "") === `/admin/academy/${acad[0].id}`, page.url().replace(BASE, ""));

  // ── 4. A SUB-PAGE RETURNS THE WAY YOU CAME IN ──────────────────────────
  console.log("\n  A camp opened from Academy, then a player link");
  await page.goto(`${BASE}/admin/academy/${camp[0].id}`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle(3000);
  const playerFrom = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll("a")).map(x => x.getAttribute("href") || "");
    return a.find(h => h.includes("/admin/people/") && h.includes("from=")) ?? null;
  });
  if (playerFrom) {
    ok("a player link returns to the camp under ACADEMY, not Camps",
      decodeURIComponent(playerFrom).includes(`/admin/academy/${camp[0].id}`), decodeURIComponent(playerFrom));
  } else {
    console.log("  --   no player links on this camp's first tab (nothing to assert)");
  }

  ok("no runtime error anywhere in the run", errs.length === 0, errs.join(" | "));
  return finish();
}
async function finish() {
  if (browser) await browser.close().catch(() => {});
  if (uid) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]).catch(() => {}); await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {}); }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await finish(); });

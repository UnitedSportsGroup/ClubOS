// "Email this person" — real Chrome, as ordinary CUFC staff, on production.
//
//   npx tsx --env-file=.env script/_verify-mailer-person-link-browser.ts
//
// From the Contacts list: the Mail control on Abbas Ahmadi's row opens the
// Mailer with ONE chip — "Abbas Ahmadi · via Hafiz Ahmadi" (mum has no email,
// dad does) — on the Custom List, with the ?to= gone from the URL so a reload
// cannot put him back once removed. From a profile: the button says WHOSE
// mailbox ("Email parent" on a child, "Email" on a parent) and lands the same
// chip. Screenshots at 1440 and 390 into outputs/mailer-preflight/.
//
// 🔴 Reads data-testids, never innerText for a check that could be CSS-cased.
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WORKSPACE = "christchurch-united";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "mailer-preflight");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const ABBAS = "contact-30966", ABBAS_EMAIL = "hafizahmadi770@gmail.com";
const ALEX = "contact-7", ALEX_EMAIL = "dcamwedding@gmail.com";
const OWEN = "child-1124", OWEN_EMAIL = "lilly.kate77@gmail.com";

let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); good ? pass++ : fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const users: number[] = [];
let browser: any = null;

try {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nMailer person link — browser against ${BASE}\n`);
  const email = `_personlinkb_${Date.now()}@usg.co.nz`;
  const password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Link','Browser',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(password, 10)]);
  users.push(rows[0].id);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, 1, 'admin', NULL)`, [rows[0].id]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new Error(`login failed: HTTP ${login.status}`);
  const [cname, cvalue] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");

  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

  for (const [label, width, height, mobile] of [["desktop", 1440, 900, false], ["mobile", 390, 844, true]] as const) {
    console.log(`\n${label} (${width}×${height})`);
    const page = await browser.newPage();
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    if (mobile) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
    await page.setCookie({ name: cname, value: cvalue, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((slug: string) => {
      localStorage.setItem("clubos_workspace", slug);
      Object.keys(localStorage).filter((k) => k.startsWith("clubos-mailer-draft:")).forEach((k) => localStorage.removeItem(k));
    }, WORKSPACE);

    // ── Contacts list → the Mail control ────────────────────────────────────
    await page.goto(`${BASE}/admin/contacts?q=${encodeURIComponent("abbas ahmadi")}`, { waitUntil: "networkidle2", timeout: 60000 });
    const rowSel = `[data-testid="row-person-${ABBAS}"]`;
    await page.waitForSelector(rowSel, { timeout: 30000 }).catch(() => null);
    ok("Abbas Ahmadi's row is on the Contacts list", Boolean(await page.$(rowSel)));
    const ctl = await page.$(`[data-testid="button-email-${ABBAS}"]`);
    ok("the row carries a Mail control", Boolean(ctl));
    const ctlInfo = await page.evaluate((k: string) => {
      const el = document.querySelector(`[data-testid="button-email-${k}"]`) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), disabled: el.getAttribute("aria-disabled"), title: el.getAttribute("title") };
    }, ABBAS);
    ok("…enabled (a parent has an address)", ctlInfo?.disabled === "false", JSON.stringify(ctlInfo));
    ok("…says it goes to the parents", /parents/i.test(ctlInfo?.title ?? ""), ctlInfo?.title ?? "");
    ok("…thumb-sized (≥44px)", (ctlInfo?.w ?? 0) >= 44 && (ctlInfo?.h ?? 0) >= 44, `${ctlInfo?.w}×${ctlInfo?.h}`);
    await page.screenshot({ path: join(OUT, `person-link-contacts-${label}.png`) });
    if (ctl) await ctl.click();
    await page.waitForFunction(() => location.pathname === "/admin/mailer", { timeout: 20000 }).catch(() => null);
    ok("the click lands on the Mailer, not the profile", await page.evaluate(() => location.pathname) === "/admin/mailer", await page.evaluate(() => location.pathname));

    // ── The seeded chip ─────────────────────────────────────────────────────
    const chipSel = `[data-testid="chip-email-${ABBAS_EMAIL}"]`;
    await page.waitForSelector(chipSel, { timeout: 20000 }).catch(() => null);
    const chip = await page.evaluate((e: string) => {
      const c = document.querySelector(`[data-testid="chip-email-${e}"]`);
      return c ? {
        name: document.querySelector(`[data-testid="chip-name-${e}"]`)?.textContent?.trim() ?? null,
        via: document.querySelector(`[data-testid="chip-via-${e}"]`)?.textContent?.trim() ?? null,
        chips: document.querySelectorAll('[data-testid^="chip-email-"]').length,
        custom: (document.querySelector('[data-testid="button-segment-custom"]')?.className ?? "").includes("border-blue-500/30"),
        search: location.search,
      } : null;
    }, ABBAS_EMAIL);
    ok("ONE chip, at dad's address", Boolean(chip) && chip!.chips === 1, JSON.stringify(chip));
    ok("…the chip names the CHILD", chip?.name === "Abbas Ahmadi", String(chip?.name));
    ok("…and says via Hafiz Ahmadi", /via Hafiz Ahmadi/.test(chip?.via ?? ""), String(chip?.via));
    ok("…Custom List is the selected audience", chip?.custom === true);
    ok("…?to= is gone from the URL", !/\bto=/.test(chip?.search ?? "x"), chip?.search ?? "");
    await page.screenshot({ path: join(OUT, `person-link-mailer-${label}.png`) });

    // A removed chip stays removed on reload (the link was stripped).
    const rm = await page.$(`[data-testid="button-remove-${ABBAS_EMAIL}"]`);
    if (rm) await rm.click();
    await sleep(300);
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(1500);
    ok("removed, then reloaded: the chip does not come back", !(await page.$(chipSel)));

    // ── Profile buttons ──────────────────────────────────────────────────────
    const profile = async (key: string, expectLabel: RegExp, expectEmail: string, expectName: RegExp) => {
      await page.goto(`${BASE}/admin/people/${key}`, { waitUntil: "networkidle2", timeout: 60000 });
      await page.waitForSelector('[data-testid="button-email-from-profile"]', { timeout: 30000 }).catch(() => null);
      const btn = await page.evaluate(() => {
        const b = document.querySelector('[data-testid="button-email-from-profile"]') as HTMLButtonElement | null;
        return b ? { text: b.textContent?.trim() ?? "", disabled: b.disabled, title: b.title } : null;
      });
      ok(`${key}: profile button reads "${expectLabel.source}"`, Boolean(btn) && expectLabel.test(btn!.text) && !btn!.disabled, JSON.stringify(btn));
      await page.click('[data-testid="button-email-from-profile"]').catch(() => null);
      await page.waitForSelector(`[data-testid="chip-email-${expectEmail}"]`, { timeout: 20000 }).catch(() => null);
      const got = await page.evaluate((e: string) => ({
        chips: document.querySelectorAll('[data-testid^="chip-email-"]').length,
        name: document.querySelector(`[data-testid="chip-name-${e}"]`)?.textContent?.trim() ?? null,
        via: document.querySelector(`[data-testid="chip-via-${e}"]`)?.textContent?.trim() ?? null,
      }), expectEmail);
      ok(`${key}: lands ONE chip at ${expectEmail}`, got.chips === 1 && got.name !== null, JSON.stringify(got));
      ok(`${key}: the chip names ${expectName.source}`, expectName.test(got.name ?? ""), String(got.name));
      return got;
    };
    const ab = await profile(ABBAS, /^Email parent$/, ABBAS_EMAIL, /^Abbas Ahmadi$/);
    ok("Abbas from the profile: via Hafiz Ahmadi", /Hafiz/.test(ab.via ?? ""), String(ab.via));
    const al = await profile(ALEX, /^Email$/, ALEX_EMAIL, /^Alex Moyse$/);
    ok("Alex (own address): no via", al.via === null);
    const ow = await profile(OWEN, /^Email parent$/, OWEN_EMAIL, /^Owen/);
    ok("camp child Owen: via Lilly", /Lilly/.test(ow.via ?? ""), String(ow.via));
    if (label === "mobile") await page.screenshot({ path: join(OUT, `person-link-profile-${label}.png`) });
    else {
      await page.goto(`${BASE}/admin/people/${ABBAS}`, { waitUntil: "networkidle2", timeout: 60000 });
      await page.waitForSelector('[data-testid="button-email-from-profile"]', { timeout: 30000 }).catch(() => null);
      await page.screenshot({ path: join(OUT, `person-link-profile-${label}.png`) });
    }
    await page.close();
  }
} catch (e: any) {
  console.error("\nthrew:", e.message);
  fail++;
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const id of users) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  }
  await pool.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

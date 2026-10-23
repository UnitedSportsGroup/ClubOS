/**
 * Sponsorship Partners — real browser, as ordinary USG staff holding only the
 * sponsorship tab. Desktop 1440×900 and phone 390×844. Screenshots to
 * outputs/partners-preflight/ — LOOK at them; the assertions find overflow and
 * small tap targets, the pictures find everything else.
 *
 *   npx tsx --env-file=.env script/_verify-partners-browser.ts
 *   VERIFY_BASE=https://app.usg.co.nz (default)
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WORKSPACE = "united-sports-group";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "partners-preflight");

let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); good ? pass++ : fail++; };
const users: number[] = [];
let pool: pg.Pool | null = null;
let browser: any = null;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function staffCookie() {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const email = `_partners_ui_${Date.now()}@usg.co.nz`;
  const password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Preflight','Partners',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(password, 10)]);
  users.push(rows[0].id);
  const { rows: o } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'team_member',$3::jsonb)`, [rows[0].id, o[0].id, JSON.stringify(["sponsorship"])]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new Error(`login failed HTTP ${login.status}`);
  const [name, value] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
  return { name, value, domain: new URL(BASE).hostname };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nSponsorship Partners — browser check against ${BASE}\n`);
  const cookie = await staffCookie();
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

  for (const [label, width, height, mobile] of [["desktop", 1440, 900, false], ["mobile", 390, 844, true]] as const) {
    console.log(`\n${label} (${width}×${height})`);
    const page = await browser.newPage();
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    await page.setCookie({ ...cookie, path: "/", httpOnly: true, secure: BASE.startsWith("https") });
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), WORKSPACE);
    await page.goto(`${BASE}/admin/sponsorship#partners`, { waitUntil: "networkidle2", timeout: 90000 });
    const tabSeen = await page.waitForSelector(`[data-testid="tab-partners"]`, { timeout: 30000 }).then(() => true).catch(() => false);
    ok("Partners sub-tab is in the sub-nav", tabSeen);
    const loaded = await page.waitForSelector(`[data-testid="partners-table"], [data-testid^="partner-card-"], [data-testid="partners-empty"], [data-testid="partners-error"]`, { timeout: 60000 }).then(() => true).catch(() => false);
    ok("the list (or an honest empty/error state) renders", loaded);
    await sleep(1200);

    const m: any = await page.evaluate(`(function(){
      var WIDTH = ${width};
      var de = document.documentElement;
      var rows = document.querySelectorAll('[data-testid^="partner-row-"], [data-testid^="partner-card-"]').length;
      var small = [];
      var els = document.querySelectorAll('main button, main a[href], main [role="tab"], main [role="combobox"], [data-testid^="tab-"]');
      for (var i = 0; i < els.length; i++) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.height < 44 && r.top < window.innerHeight) small.push((els[i].innerText || els[i].getAttribute('data-testid') || els[i].tagName).trim().slice(0,30) + ' ' + Math.round(r.height) + 'px'); }
      var wide = [];
      var all = document.querySelectorAll('main *');
      for (var j = 0; j < all.length; j++) { var b = all[j].getBoundingClientRect(); if (b.right > WIDTH + 1 && !all[j].closest('.overflow-x-auto')) { wide.push(all[j].tagName + '.' + String(all[j].className).slice(0,40) + ' ' + Math.round(b.right)); if (wide.length > 4) break; } }
      var flagsText = Array.prototype.map.call(document.querySelectorAll('[data-testid^="partner-row-"] [data-flag], [data-testid^="partner-card-"] [data-flag]'), function(e){ return e.innerText.trim(); }).slice(0,3);
      return { docWidth: de.scrollWidth, winWidth: window.innerWidth, hash: location.hash, rows: rows, small: small, wide: wide, login: /Forgot password/i.test(document.body.innerText), white: document.body.innerText.trim().length < 40, flagsText: flagsText,
        hasOpen: !!document.querySelector('a[href*="/api/admin/drive/file/"]') };
    })()`);
    ok("not bounced to the login page", !m.login);
    ok("page is not blank", !m.white);
    ok("no horizontal page scroll", m.docWidth <= m.winWidth + 1, `${m.docWidth} vs ${m.winWidth}`);
    ok("nothing in main sticks out past the viewport", m.wide.length === 0, m.wide.join(" | "));
    if (mobile) ok("every visible control ≥ 44px tall", m.small.length === 0, m.small.slice(0, 6).join(" | "));
    ok("rows rendered", m.rows > 0, `${m.rows} rows`);
    ok("a signed-contract link is on the page", m.hasOpen);
    ok("hash stays #partners", String(m.hash).startsWith("#partners"), m.hash);
    await page.screenshot({ path: join(OUT, `partners-list-${label}.png`), fullPage: false });

    // open the first partner
    const first = await page.$('[data-testid^="partner-row-"], [data-testid^="partner-card-"]');
    if (first) {
      await first.click();
      const sheet = await page.waitForSelector('[data-testid="partner-sheet"]', { timeout: 20000 }).then(() => true).catch(() => false);
      ok("clicking a partner opens the sheet", sheet);
      await sleep(1500);
      const s: any = await page.evaluate(`(function(){
        var WIDTH = ${width};
        var sh = document.querySelector('[data-testid="partner-sheet"]'); if (!sh) return null;
        var r = sh.getBoundingClientRect();
        var open = sh.querySelector('[data-testid="partner-open-contract"]');
        var wide = []; var all = sh.querySelectorAll('*');
        for (var j = 0; j < all.length; j++) { var b = all[j].getBoundingClientRect(); if (b.right > WIDTH + 1 && !all[j].closest('.overflow-x-auto')) { wide.push(all[j].tagName + '.' + String(all[j].className).slice(0,40) + ' ' + Math.round(b.right)); if (wide.length > 4) break; } }
        return { right: Math.round(r.right), width: Math.round(r.width), openHref: open ? open.getAttribute('href') : null, text: sh.innerText.slice(0, 200), wide: wide, hash: location.hash,
          hasInstalments: /instalment/i.test(sh.innerText), hasDeliverables: /deliverable|promised/i.test(sh.innerText), hasIdeas: /idea/i.test(sh.innerText) };
      })()`);
      ok("sheet fits the viewport", !!s && s.right <= width + 1 && s.wide.length === 0, s ? `right ${s.right}, ${s.wide.join(" | ")}` : "no sheet");
      ok("sheet shows the Open signed contract link", !!s?.openHref && s.openHref.includes("/api/admin/drive/file/"), s?.openHref ?? "");
      ok("sheet has instalments, deliverables and ideas sections", !!s && s.hasInstalments && s.hasDeliverables && s.hasIdeas);
      ok("hash carries the partner id", /^#partners\/\d+/.test(s?.hash ?? ""), s?.hash);
      await page.screenshot({ path: join(OUT, `partners-sheet-${label}.png`), fullPage: false });
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
      await sleep(800);
      const closed = await page.$('[data-testid="partner-sheet"]');
      ok("Back closes the sheet", !closed);
    } else {
      ok("a partner row to click", false, "none rendered");
    }
    await page.close();
  }
}

main().catch(e => { console.error("\n  ✗", e.message); fail++; }).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (pool) { for (const id of users) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {}); await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {}); } await pool.end(); }
  console.log(`\n  ${fail ? "✗" : "✓"} ${pass} passed, ${fail} failed · screenshots in ${OUT}\n`);
  process.exit(fail ? 1 : 0);
});

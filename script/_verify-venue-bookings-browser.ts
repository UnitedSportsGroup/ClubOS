// UI preflight for the USC Bookings tab after the 2026-10-22 truth rebuild —
// the real live page at phone and laptop widths, as an ORDINARY USC staff
// member with the bookings tab (a super admin would not reproduce what staff
// see). Measures what a human would check and saves screenshots to look at.
//   npx tsx --env-file=.env script/_verify-venue-bookings-browser.ts
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WORKSPACE = "united-sports-centre";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "venue-bookings-preflight");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
// innerText reflects text-transform: the badges are CSS-uppercased, so every
// label comparison is case-insensitive (reference_browser_check_false_negatives).
const same = (a: string | null, b: string) => (a || "").trim().toLowerCase() === b.toLowerCase();
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); good ? pass++ : fail++; };
const users: number[] = [];
let browser: any = null;

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nUSC Bookings — browser preflight against ${BASE}\n`);
  const email = `_venueui_${Date.now()}@usg.co.nz`;
  const password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Preflight','VenueUI',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(password, 10)]);
  users.push(rows[0].id);
  const { rows: o } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'team_member',$3::jsonb)`, [rows[0].id, o[0].id, JSON.stringify(["bookings", "bookings-calendar"])]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new Error(`login failed HTTP ${login.status}`);
  const [cn, cv] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

  for (const [label, width, height, mobile] of [["bookings-laptop", 1366, 768, false], ["bookings-mobile", 390, 844, true]] as const) {
    console.log(`\n${label} (${width}×${height})`);
    const page = await browser.newPage();
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    if (mobile) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
    await page.setCookie({ name: cn, value: cv, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: BASE.startsWith("https") });
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), WORKSPACE);
    await page.goto(`${BASE}/admin/bookings`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector('[data-testid="bookings-table"], [data-testid="bookings-summary"]', { timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));

    const m: any = await page.evaluate(`(function(){
      var de = document.documentElement, body = document.body.innerText;
      var q = function(s){ var e = document.querySelector(s); return e ? e.innerText.trim() : null; };
      var small = [];
      document.querySelectorAll('button, a[href]').forEach(function(el){ var r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.height < 28 && /\\S/.test(el.innerText||'')) small.push((el.innerText||'').trim().slice(0,30) + ' ' + Math.round(r.height)); });
      return {
        login: /Sign in|Forgot password/i.test(body),
        docWidth: de.scrollWidth, winWidth: window.innerWidth,
        rows: document.querySelectorAll('[data-testid^="booking-row-"]').length,
        james: q('[data-testid="payment-state-5789"]'), jamesDetail: q('[data-testid="payment-detail-5789"]'),
        burns: q('[data-testid="payment-state-5507"]'), adib: q('[data-testid="payment-state-5434"]'),
        cory: q('[data-testid="payment-state-5791"]'), coryDetail: q('[data-testid="payment-detail-5791"]'),
        lights: q('[data-testid="addons-5792"]'),
        statesBar: !!document.querySelector('[data-testid="filter-states"]'),
        noCancelledWord: !/CANCELLED/.test(body),
        viewToggle: !!document.querySelector('[data-testid="view-player-pay"]'),
        small: small.slice(0, 8)
      };
    })()`);
    ok("the page is Bookings, not the login screen", !m.login);
    ok("rows render", m.rows > 0, `${m.rows} rows`);
    ok("#5789 James Na reads Paid", same(m.james, "Paid"), `${m.james} · ${m.jamesDetail}`);
    ok("#5789 detail names Player Pay 5 of 5", /Player Pay · 5 of 5 paid/.test(m.jamesDetail || ""), m.jamesDetail || "");
    ok("#5507 James Burns reads Paid", same(m.burns, "Paid"), m.burns || "");
    ok("#5434 adib ahlami reads Paid", same(m.adib, "Paid"), m.adib || "");
    ok("#5791 Cory Wu reads Not paid, with why", same(m.cory, "Not paid") && /closed before the squad filled/i.test(m.coryDetail || ""), `${m.cory} · ${m.coryDetail}`);
    ok("#5792 shows its floodlights", /Floodlights/.test(m.lights || ""), m.lights || "");
    ok("the word CANCELLED is gone from the page", m.noCancelledWord);
    ok("status filter and Player Pay view are there", m.statesBar && m.viewToggle);
    ok("no horizontal page overflow", m.docWidth <= m.winWidth + 1, `${m.docWidth} vs ${m.winWidth}`);
    if (m.small.length) console.log(`     (controls under 28px: ${m.small.join(" · ")})`);
    await page.screenshot({ path: join(OUT, `${label}.png`) });
    console.log(`  → ${join(OUT, `${label}.png`)}`);

    // open James Na's booking → the breakdown with five shares
    await page.click('[data-testid="booking-row-5789"]').catch(() => {});
    await page.waitForSelector('[data-testid="split-panel"]', { timeout: 20000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    const d: any = await page.evaluate(`(function(){
      var modal = document.querySelector('[data-testid="booking-detail-modal"]');
      var members = document.querySelectorAll('[data-testid^="split-member-"]').length;
      var text = modal ? modal.innerText : '';
      var box = modal ? modal.querySelector('.max-w-lg') : null; var r = box ? box.getBoundingClientRect() : null;
      return { open: !!modal, members: members, state: (document.querySelector('[data-testid="modal-payment-state"]')||{}).innerText || null,
        hasShareLink: /book\\.unitedsportscentre\\.com\\/book\\/split\\//.test((document.querySelector('[data-testid="split-share-url"]')||{}).value||''),
        hasBreakdown: !!document.querySelector('[data-testid="price-breakdown"]'), total186: /\\$186\\.88/.test(text), collected: /\\$186\\.90/.test(text),
        fits: r ? (r.right <= window.innerWidth + 1 && r.left >= -1) : false };
    })()`);
    ok("clicking the row opens the breakdown", d.open);
    ok("it lists the five Player Pay members", d.members === 5, `${d.members}`);
    ok("it reads Paid with $186.88 total and $186.90 collected", same(d.state, "Paid") && d.total186 && d.collected);
    ok("it carries the squad's share link", d.hasShareLink);
    ok("it shows what was booked", d.hasBreakdown);
    ok("the popup fits the screen", d.fits);
    await page.screenshot({ path: join(OUT, `${label}-popup.png`) });
    console.log(`  → ${join(OUT, `${label}-popup.png`)}`);
    await page.keyboard.press("Escape").catch(() => {});
    await page.click('[data-testid="booking-detail-modal"]', { offset: { x: 5, y: 5 } }).catch(() => {});

    // the Player Pay view
    await page.click('[data-testid="view-player-pay"]').catch(() => {});
    await page.waitForSelector('[data-testid="player-pay-table"]', { timeout: 20000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    const p: any = await page.evaluate(`(function(){ return { rows: document.querySelectorAll('[data-testid^="split-row-"]').length, stats: !!document.querySelector('[data-testid="player-pay-stats"]'), james: !!document.querySelector('[data-testid="split-row-50"]'), docWidth: document.documentElement.scrollWidth, winWidth: window.innerWidth }; })()`);
    ok("Player Pay view lists the splits", p.rows >= 4 && p.james, `${p.rows} splits`);
    ok("Player Pay stats render", p.stats);
    ok("Player Pay view has no page overflow", p.docWidth <= p.winWidth + 1, `${p.docWidth} vs ${p.winWidth}`);
    await page.screenshot({ path: join(OUT, `${label}-player-pay.png`) });
    console.log(`  → ${join(OUT, `${label}-player-pay.png`)}`);
    await page.close();
  }
}

main()
  .catch((e) => { console.error("\nthrew:", e.message); fail++; })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    for (const id of users) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {}); await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {}); }
    await pool.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });

// Rambo's page — the real live site, in a real browser, at laptop and phone
// size, signed in as an ORDINARY workspace admin of Christchurch United:
//   npx tsx --env-file=.env script/_verify-rambo-chat-browser.ts
//
// What it walks (Daniel, 2026-10-26): the Rambo button sits BELOW the
// workspace switcher and ABOVE "Navigation" in the sidebar; the home dashboard
// opens on his prompt box above the stats; typing a question there lands on
// Rambo's page with the chat started; ONE REAL question ("How many U4–U8
// players do we have this term?" — a paid call, cents) comes back with a
// number and the Player numbers tool named; the chat appears in the list with
// a name; it can be renamed; "1 of 50 today" moved; past the cap the next
// question is refused with the Team hint; on a phone the list is a drawer.
// Cleans up its chats and its user.
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WORKSPACE = "christchurch-united";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "rambo-preflight");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d.replace(/\s+/g, " ").slice(0, 260)}` : ""}`); good ? pass++ : fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const users: number[] = [];
let browser: any = null;

try {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nRambo — browser preflight against ${BASE}\n`);

  const email = `_rambopreflight_${Date.now()}@usg.co.nz`;
  const password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Preflight','Rambo',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(password, 10)],
  );
  users.push(rows[0].id);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, 1, 'admin', NULL)`, [rows[0].id]);

  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new Error(`login failed: HTTP ${login.status}`);
  const [cname, cvalue] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");

  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

  for (const [label, width, height, mobile] of [["rambo-desktop", 1440, 900, false], ["rambo-mobile", 390, 844, true]] as const) {
    console.log(`\n${label} (${width}×${height})`);
    const page = await browser.newPage();
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    if (mobile) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
    await page.setCookie({ name: cname, value: cvalue, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((slug: string) => localStorage.setItem("clubos_workspace", slug), WORKSPACE);
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2000);

    const body = await page.evaluate(() => document.body.innerText);
    ok("the dashboard is up, not the login screen", !/Sign in|Forgot password/i.test(body));

    if (!mobile) {
      // ── Sidebar: Rambo below the switcher, above Navigation ───────────────
      const side: any = await page.evaluate(`(function(){
        var r = document.querySelector('[data-testid="button-rambo"]');
        var w = document.querySelector('[data-testid="button-workspace-switcher"]');
        var nav = Array.from(document.querySelectorAll('*')).find(function(el){ return el.children.length === 0 && (el.textContent||'').trim() === 'Navigation'; });
        var rb = r ? r.getBoundingClientRect() : null, wb = w ? w.getBoundingClientRect() : null, nb = nav ? nav.getBoundingClientRect() : null;
        return { has: !!r, text: r ? (r.textContent||'').trim() : '', face: !!(r && r.querySelector('img')), r: rb ? rb.top : null, w: wb ? wb.bottom : null, nav: nb ? nb.top : null, h: rb ? rb.height : 0 };
      })()`);
      ok("the sidebar carries a Rambo button with his face", side.has && /Rambo/.test(side.text) && side.face, JSON.stringify(side));
      ok("…below the workspace switcher and above Navigation", side.r != null && side.w != null && side.nav != null && side.r >= side.w && side.r < side.nav, JSON.stringify({ r: side.r, w: side.w, nav: side.nav }));
      ok("…and thumb-sized", side.h >= 44, `${side.h}px`);

      // ── Home: the prompt box above the stats ──────────────────────────────
      const home: any = await page.evaluate(`(function(){
        var b = document.querySelector('[data-testid="rambo-home-prompt"]');
        var t = document.querySelector('[data-testid="text-page-title"]');
        return { has: !!b, aboveTitle: !!(b && t && b.getBoundingClientRect().top < t.getBoundingClientRect().top), starters: document.querySelectorAll('[data-testid="rambo-home-starter"]').length, text: b ? (b.textContent||'').slice(0, 120) : '' };
      })()`);
      ok("the home dashboard opens on Rambo's prompt box, above the stats", home.has && home.aboveTitle && home.starters >= 3, JSON.stringify(home));
      await page.screenshot({ path: join(OUT, `${label}-home.png`) });
      console.log(`  → ${join(OUT, `${label}-home.png`)}`);

      // ── Ask from home → lands on Rambo's page with the answer ─────────────
      const homeInput = await page.$('[data-testid="rambo-home-input"]');
      if (homeInput) { await homeInput.click(); await page.keyboard.type("How many U4–U8 players do we have this term?"); await page.keyboard.press("Enter"); }
      let answered: any = null;
      for (let i = 0; i < 90; i++) {
        await sleep(1000);
        answered = await page.evaluate(`(function(){
          var a = document.querySelector('[data-testid="rambo-message-assistant"], [data-testid="rambo-error"]');
          if (!a) return null;
          var u = document.querySelector('[data-testid="rambo-usage"]');
          return { error: a.getAttribute('data-testid') === 'rambo-error', text: (a.textContent||'').trim().slice(0, 400), url: location.pathname, usage: u ? (u.textContent||'').trim() : '', titles: Array.from(document.querySelectorAll('[data-testid="rambo-thread-title"]')).map(function(x){ return (x.textContent||'').trim(); }) };
        })()`);
        if (answered) break;
      }
      ok("the question lands on Rambo's page in its own chat", !!answered && /^\/admin\/rambo\/\d+$/.test(answered.url), answered ? answered.url : "no answer");
      ok("Rambo answers with a number and names the tool he looked at", !!answered && !answered.error && /\d+/.test(answered.text) && /Looked at:.*Player numbers/.test(answered.text), answered ? answered.text : "no answer");
      ok("the chat is in the list, named after the question", !!answered && answered.titles.some((t: string) => /U4–U8 players/.test(t)), answered ? answered.titles.join(" | ") : "");
      ok("…and the count moved to 1 of N today", !!answered && /^1 of \d+ today$/.test(answered.usage), answered ? answered.usage : "");
      await page.screenshot({ path: join(OUT, `${label}-chat.png`) });
      console.log(`  → ${join(OUT, `${label}-chat.png`)}`);

      // ── Follow-up in the same chat ────────────────────────────────────────
      const box = await page.$('[data-testid="rambo-input"]');
      if (box) { await box.click(); await page.keyboard.type("Break that down by age."); await page.keyboard.press("Enter"); }
      let second: any = null;
      for (let i = 0; i < 90; i++) {
        await sleep(1000);
        second = await page.evaluate(`(function(){ var all = document.querySelectorAll('[data-testid="rambo-message-assistant"], [data-testid="rambo-error"]'); if (all.length < 2) return null; var a = all[all.length - 1]; return { error: a.getAttribute('data-testid') === 'rambo-error', text: (a.textContent||'').trim().slice(0, 300) }; })()`);
        if (second) break;
      }
      ok("a follow-up in the same chat answers with ages", !!second && !second.error && /\d\s*(yrs|year)/i.test(second.text), second ? second.text : "no second answer");

      // ── Rename ─────────────────────────────────────────────────────────────
      const renameBtn = await page.$('[data-testid="rambo-thread"][data-active="1"] [data-testid="rambo-thread-menu-rename"]');
      if (renameBtn) await renameBtn.click();
      await sleep(300);
      const renameInput = await page.$('[data-testid="rambo-rename-input"]');
      if (renameInput) { await renameInput.click({ clickCount: 3 }); await page.keyboard.type("Term 4 numbers"); await page.keyboard.press("Enter"); }
      await sleep(1200);
      const renamed: any = await page.evaluate(`(function(){ return Array.from(document.querySelectorAll('[data-testid="rambo-thread-title"]')).map(function(x){ return (x.textContent||'').trim(); }); })()`);
      ok("a chat can be renamed from the list", renamed.includes("Term 4 numbers"), renamed.join(" | "));

      // ── The cap ───────────────────────────────────────────────────────────
      await pool.query(`UPDATE users SET mailer_ai_daily_limit = 2 WHERE id = $1`, [users[0]]);
      await page.reload({ waitUntil: "networkidle2" });
      await sleep(1500);
      const cappedUi: any = await page.evaluate(`(function(){ var c = document.querySelector('[data-testid="rambo-capped"]'); var i = document.querySelector('[data-testid="rambo-input"]'); return { box: !!c, text: c ? (c.textContent||'').trim() : '', disabled: !!(i && i.disabled) }; })()`);
      ok("past the daily cap the page says so, names Team, and the box is closed", cappedUi.box && /Team/.test(cappedUi.text) && cappedUi.disabled, JSON.stringify(cappedUi));
      const capped429: any = await page.evaluate(`(async function(){ var r = await fetch(location.pathname.replace(/^\\/admin\\/rambo\\//, '/api/admin/rambo/threads/') + '/ask', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Workspace-Slug': ${JSON.stringify(WORKSPACE)} }, body: JSON.stringify({ question: 'one more' }) }); var j = await r.json().catch(function(){ return {}; }); return { status: r.status, message: j.message || '' }; })()`);
      ok("…and the server refuses with 429 BEFORE calling the model", capped429.status === 429 && /Team/.test(capped429.message), JSON.stringify(capped429));
      await pool.query(`UPDATE users SET mailer_ai_daily_limit = NULL WHERE id = $1`, [users[0]]);
    } else {
      // ── Phone ─────────────────────────────────────────────────────────────
      await page.goto(`${BASE}/admin/rambo`, { waitUntil: "networkidle2", timeout: 60000 });
      await sleep(1500);
      const ph: any = await page.evaluate(`(function(){
        var input = document.querySelector('[data-testid="rambo-input"]');
        var toggle = document.querySelector('[data-testid="rambo-chats-toggle"]');
        var ib = input ? input.getBoundingClientRect() : null;
        return { input: !!input && ib.bottom <= window.innerHeight && ib.width > 200, toggle: !!toggle && toggle.getBoundingClientRect().height >= 44, starters: document.querySelectorAll('[data-testid="rambo-starter"]').length, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
      })()`);
      ok("on a phone the page fits: composer on screen, chats behind a thumb-sized button, no sideways scroll", ph.input && ph.toggle && ph.starters >= 3 && !ph.overflow, JSON.stringify(ph));
      const toggle = await page.$('[data-testid="rambo-chats-toggle"]');
      if (toggle) await toggle.click();
      await sleep(500);
      const drawer: any = await page.evaluate(`(function(){ var d = document.querySelector('[data-testid="rambo-thread-drawer"]'); return { open: !!d, titles: d ? d.querySelectorAll('[data-testid="rambo-thread-title"]').length : 0 }; })()`);
      ok("the chats drawer opens and lists the chat from the laptop run", drawer.open && drawer.titles >= 1, JSON.stringify(drawer));
      await page.screenshot({ path: join(OUT, `${label}-drawer.png`) });
      console.log(`  → ${join(OUT, `${label}-drawer.png`)}`);
    }
    await page.close();
  }
} catch (e: any) {
  console.error("\nHARNESS ERROR:", e?.message || e);
  fail++;
} finally {
  try { if (browser) await browser.close(); } catch { /* closed */ }
  for (const id of users) {
    await pool.query(`DELETE FROM kb_chat_sessions WHERE user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  }
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// Content Studio in a real browser on PRODUCTION, at laptop and phone size,
// signed in as an ORDINARY workspace admin.
//   npx tsx --env-file=.env script/_verify-studio-browser.ts
//
// Laptop: the front door, the sidebar link, a graphic made from one prompt
// (one Opus call), the artboard drawn, a word changed and saved as a new
// version with no prompt, the PNG exported and given a link, the pictures
// and the settings. Phone: the same piece opens, fits, every new control is
// thumb-sized. Pieces and the account are removed afterwards.
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WORKSPACE = "christchurch-united";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "studio-preflight");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d.replace(/\s+/g, " ").slice(0, 220)}` : ""}`); good ? pass++ : fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const users: number[] = [];
let browser: any = null;
let pieceId: number | null = null;

const SMALL = `(function () {
  var small = [];
  var nodes = document.querySelectorAll('[data-testid^="studio-"] button, [data-testid^="studio-"] input:not([type=file]), [data-testid^="studio-"] textarea, [data-testid^="studio-"] a[href], button[data-testid^="studio-"], a[data-testid^="studio-"]');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (el.type === "checkbox" && el.closest("label")) el = el.closest("label");
    var b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0 && b.height < 44) small.push((nodes[i].getAttribute("data-testid") || nodes[i].tagName) + ":" + Math.round(b.height));
  }
  return small;
})()`;

try {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nContent Studio — browser preflight against ${BASE}\n`);
  const email = `_studiopreflight_${Date.now()}@usg.co.nz`;
  const password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Preflight','Studio',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(password, 10)]);
  users.push(rows[0].id);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, 1, 'admin', NULL)`, [rows[0].id]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new Error(`login failed: HTTP ${login.status}`);
  const [cname, cvalue] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

  for (const [label, width, height, mobile] of [["studio-desktop", 1440, 900, false], ["studio-mobile", 390, 844, true]] as const) {
    console.log(`\n${label} (${width}×${height})`);
    const page = await browser.newPage();
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    if (mobile) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
    await page.setCookie({ name: cname, value: cvalue, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
    await page.evaluateOnNewDocument(() => { window.confirm = () => true; });
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((slug: string) => { localStorage.setItem("clubos_workspace", slug); }, WORKSPACE);
    await page.goto(`${BASE}/admin/content-studio`, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2000);

    const home: any = await page.evaluate(`(function(){
      var t = document.querySelector('[data-testid="studio-title"]');
      var u = document.querySelector('[data-testid="studio-usage"]');
      var cards = document.querySelectorAll('[data-testid^="studio-make-"]').length;
      var side = Array.prototype.slice.call(document.querySelectorAll('a[href="/admin/content-studio"]')).length;
      return { title: t ? t.textContent.trim() : null, usage: u ? u.textContent.trim() : '', cards: cards, side: side, docWidth: document.documentElement.scrollWidth, winWidth: window.innerWidth };
    })()`);
    ok("the Studio page opens with its title and the shared allowance", home.title === "Content Studio" && /of \d+/.test(home.usage), JSON.stringify(home));
    ok("four ways to make something are offered (graphic, page, video, email)", home.cards === 4, String(home.cards));
    if (!mobile) ok("Studio has its own link in the sidebar", home.side >= 1, String(home.side));
    ok("no horizontal overflow on the front door", home.docWidth <= home.winWidth + 1, `${home.docWidth} vs ${home.winWidth}`);

    if (!mobile) {
      // ── Make a graphic from one prompt ────────────────────────────────────
      const card = await page.$('[data-testid="studio-make-graphic"]');
      if (card) await card.click();
      await sleep(400);
      const brief = await page.$('[data-testid="studio-brief"]');
      ok("the composer opens with a brief box and the four sizes", !!brief && (await page.$$('[data-testid^="studio-size-"]')).length === 4);
      if (brief) { await brief.click(); await page.keyboard.type("A square post: our October holiday camp for 4 to 8 year olds has a few spots left. Use the real dates and the day price from the facts. Point people to cufc.co.nz/camps."); }
      const story = await page.$('[data-testid="studio-size-story"]');
      if (story) await story.click();
      const go = await page.$('[data-testid="studio-make-go"]');
      ok("Make it is enabled with a brief typed", !!go && !(await page.evaluate((el: any) => el.disabled, go)));
      if (go) await go.click();
      let opened = "";
      for (let i = 0; i < 90 && !opened; i++) {
        await sleep(1000);
        const loc = await page.evaluate(() => location.pathname);
        if (/^\/admin\/content-studio\/\d+$/.test(loc)) opened = loc;
      }
      ok("Rambo made it and the piece opened", /^\/admin\/content-studio\/\d+$/.test(opened), opened);
      pieceId = opened ? Number(opened.split("/").pop()) : null;
      await sleep(2500);
      const piece: any = await page.evaluate(`(function(){
        var art = document.querySelector('[data-testid="studio-artboard"] .sgx');
        var title = document.querySelector('[data-testid="studio-piece-title"]');
        var fields = document.querySelectorAll('[data-testid^="studio-field-"]').length;
        var h = document.querySelector('[data-testid="studio-field-headline"]');
        var fonts = !!document.querySelector('link[data-studio-fonts]');
        return { art: !!art, layout: art ? art.getAttribute('data-layout') : null, w: art ? art.offsetWidth : 0, h: art ? art.offsetHeight : 0, title: title ? title.textContent.trim() : '', fields: fields, headline: h ? h.value : null, fonts: fonts, crest: art ? !!art.querySelector('.sgx-crest') : false };
      })()`);
      ok("the artboard is drawn at the story's real size with the crest, the brand's fonts loaded", piece.art && piece.w === 1080 && piece.h === 1920 && piece.crest && piece.fonts, JSON.stringify(piece));
      ok("the words are editable boxes, headline first", piece.fields >= 3 && typeof piece.headline === "string" && piece.headline.length > 0, `${piece.fields} fields: ${piece.headline}`);
      await page.screenshot({ path: join(OUT, `${label}-piece.png`), fullPage: true });

      // ── Change a word, save: a new version, no prompt ─────────────────────
      const hField = await page.$('[data-testid="studio-field-headline"]');
      if (hField) { await hField.click({ clickCount: 3 }); await page.keyboard.type("Last spots for October"); }
      await sleep(300);
      const live: any = await page.evaluate(`(function(){ var art = document.querySelector('[data-testid="studio-artboard"] .sgx'); return art ? art.textContent : ''; })()`);
      ok("the preview follows the keystrokes before saving", /Last spots for October/.test(live));
      // Record what the save request actually answered, so a miss names its cause.
      const saved: { status: number; body: string }[] = [];
      const onResp = async (r: any) => { try { if (r.request().method() === "PATCH" && /content-studio\/pieces\//.test(r.url())) saved.push({ status: r.status(), body: (await r.text()).slice(0, 300) }); } catch { /* gone */ } };
      page.on("response", onResp);
      const save = await page.$('[data-testid="studio-save-words"]');
      const saveState = save ? await page.evaluate((el: any) => ({ disabled: el.disabled, top: Math.round(el.getBoundingClientRect().top) }), save) : null;
      if (save) { await page.evaluate((el: any) => el.scrollIntoView({ block: "center" }), save); await save.click(); }
      let afterSave: any = { meta: "" };
      for (let i = 0; i < 16 && !/v2/.test(afterSave.meta); i++) {
        await sleep(500);
        afterSave = await page.evaluate(`(function(){ var t = document.querySelector('[data-testid="studio-piece-title"]'); var meta = t ? t.parentElement.textContent : ''; return { meta: meta }; })()`);
      }
      page.off("response", onResp);
      ok("saving made version 2 (no model, no wait)", /v2/.test(afterSave.meta), `${afterSave.meta} · button ${JSON.stringify(saveState)} · PATCH ${JSON.stringify(saved)}`);

      // ── Export the PNG; the link appears ──────────────────────────────────
      const dl = await page.$('[data-testid="studio-download"]');
      if (dl) await dl.click();
      let link = false;
      for (let i = 0; i < 30 && !link; i++) { await sleep(1000); link = !!(await page.$('[data-testid="studio-copy-link"]')); }
      ok("Download PNG exports in the browser and comes back with a shareable link", link);
      const render = pieceId ? (await pool.query(`SELECT width, height, bytes FROM studio_renders WHERE piece_id = $1 ORDER BY id DESC LIMIT 1`, [pieceId])).rows[0] : null;
      ok("…the PNG kept on the server is 1080×1920 and a real size", !!render && render.width === 1080 && render.height === 1920 && render.bytes > 20000, JSON.stringify(render));

      // ── Pictures and settings ─────────────────────────────────────────────
      const picTab = await page.$('[data-testid="studio-tab-pictures"]');
      if (picTab) await picTab.click();
      await sleep(1500);
      const pics = await page.$$('[data-testid="studio-picture"]');
      ok("the Pictures tab lists the club's library", pics.length >= 10, String(pics.length));
      const setTab = await page.$('[data-testid="studio-tab-settings"]');
      if (setTab) await setTab.click();
      await sleep(400);
      ok("Settings offers the four sizes and Duplicate", (await page.$$('[data-testid^="studio-settings-size-"]')).length === 4 && !!(await page.$('[data-testid="studio-settings-duplicate"]')));
      const verTab = await page.$('[data-testid="studio-tab-versions"]');
      if (verTab) await verTab.click();
      await sleep(400);
      const versions: string = await page.evaluate(`(function(){ var v = document.querySelector('[data-testid="studio-versions"]'); return v ? v.textContent : ''; })()`) as string;
      ok("Versions lists v2 (words edited) and v1 (made by Rambo)", /v2 · words edited/.test(versions) && /v1 · made by Rambo/.test(versions), versions.slice(0, 160));
    } else if (pieceId) {
      await page.goto(`${BASE}/admin/content-studio/${pieceId}`, { waitUntil: "networkidle2", timeout: 60000 });
      await sleep(2500);
      const m: any = await page.evaluate(`(function(){ var art = document.querySelector('[data-testid="studio-artboard"] .sgx'); var wrap = art ? art.parentElement.parentElement : null; return { art: !!art, shown: wrap ? wrap.getBoundingClientRect().width : 0, docWidth: document.documentElement.scrollWidth, winWidth: window.innerWidth }; })()`);
      ok("the piece opens on a phone with the artboard scaled to fit", m.art && m.shown > 200 && m.shown <= 390, JSON.stringify(m));
      ok("no horizontal overflow on the piece", m.docWidth <= m.winWidth + 1, `${m.docWidth} vs ${m.winWidth}`);
      const small: string[] = await page.evaluate(SMALL) as string[];
      ok("every Studio control is thumb-sized on a phone", small.length === 0, small.join(", "));
      await page.screenshot({ path: join(OUT, `${label}-piece.png`), fullPage: true });
    }
    await page.screenshot({ path: join(OUT, `${label}-home.png`), fullPage: true });
    console.log(`  → ${join(OUT, `${label}-home.png`)}`);
    await page.close();
  }
} catch (e: any) {
  console.error("\npreflight threw:", e.message);
  fail++;
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const id of users) {
    await pool.query(`DELETE FROM studio_generations WHERE user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM studio_pieces WHERE created_by_user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  }
  await pool.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

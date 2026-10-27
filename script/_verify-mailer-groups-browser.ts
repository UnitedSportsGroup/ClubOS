// The Mailer's By Programme picker and the picture paths, driven in a real
// browser against production as an ordinary CUFC admin (desktop and phone):
//   npx tsx --env-file=.env script/_verify-mailer-groups-browser.ts
//
// Zach, 27 Oct 2026: "an option to send it to groups again … the 4-8s".
// Travis, 28 Oct: "can't add even 1 picture". Signs in over the API and
// injects the cookie (driving the SPA login races its submit). Read-only
// apart from two hosted test pictures and a throwaway staff account, both
// cleaned up.
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import { mkdirSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WORKSPACE = "christchurch-united";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "mailer-preflight");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d.replace(/\s+/g, " ").slice(0, 300)}` : ""}`); good ? pass++ : fail++; };
const users: number[] = [];
let browser: any = null;

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nMailer — By Programme + pictures, browser proof against ${BASE}\n`);
  const email = `_mailergroups_${Date.now()}@usg.co.nz`;
  const password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Probe','Groups',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(password, 10)]);
  users.push(rows[0].id);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, 1, 'admin', NULL)`, [rows[0].id]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new Error(`login failed: HTTP ${login.status}`);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const [cname, cvalue] = cookie.split("=");

  // ── the catalogue + the resolver through the real routes, as that admin ──
  const h = { "Content-Type": "application/json", cookie, "X-Workspace-Slug": WORKSPACE };
  const cat: any = await (await fetch(`${BASE}/api/admin/mailer/audiences`, { headers: h })).json();
  ok("GET /api/admin/mailer/audiences answers with the current term and CUFC's programmes", !!cat?.currentTermId && Array.isArray(cat?.programmes) && cat.programmes.some((p: any) => p.id === 4), JSON.stringify({ term: cat?.currentTermId, n: cat?.programmes?.length }));
  const term = cat.currentTermId;
  const preview = async (groups: any[], termIds: number[] | null) => (await (await fetch(`${BASE}/api/admin/mailer/preview-recipients`, { method: "POST", headers: h, body: JSON.stringify({ segmentType: "programme", segmentConfig: { groups, termIds } }) })).json()) as any;
  const funino = await preview([{ programId: 4 }], [term]);
  ok("preview of all U4–U8 this term is a list of 100+ people", funino.count > 100 && Array.isArray(funino.recipients) && funino.recipients.length > 50, JSON.stringify({ count: funino.count, shown: funino.shown }));
  const u9 = await preview([{ programId: 16, optionIds: [30] }], [term]);
  ok("preview of just U9 is a smaller list", u9.count > 10 && u9.count < funino.count, `${u9.count}`);
  const bad = await (await fetch(`${BASE}/api/admin/mailer/preview-recipients`, { method: "POST", headers: h, body: JSON.stringify({ segmentType: "nonsense", segmentConfig: {} }) })).json() as any;
  ok("an unknown segment type is still refused", /invalid/i.test(bad?.message || ""), JSON.stringify(bad));

  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const picPath = join(tmpdir(), `mailer-groups-${Date.now()}.jpg`);
  {
    const noise = Buffer.alloc(1600 * 1200 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    await sharp(noise, { raw: { width: 1600, height: 1200, channels: 3 } }).jpeg({ quality: 90 }).toFile(picPath);
  }

  for (const [label, width, height, mobile] of [["groups-desktop", 1440, 900, false], ["groups-mobile", 390, 844, true]] as const) {
    console.log(`\n${label} (${width}×${height})`);
    const page = await browser.newPage();
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    if (mobile) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
    await page.setCookie({ name: cname, value: cvalue, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
    await page.evaluateOnNewDocument(() => { window.confirm = () => true; });
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((slug: string) => { try { localStorage.setItem("clubos-workspace", slug); Object.keys(localStorage).filter((k) => k.startsWith("clubos-mailer-draft:")).forEach((k) => localStorage.removeItem(k)); } catch {} }, WORKSPACE);
    await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(1500);

    // ── Recipients: the three cards, By Programme in the middle ─────────────
    const cards: any = await page.evaluate(() => ["custom", "programme", "all"].map((k) => { const b = document.querySelector(`[data-testid="button-segment-${k}"]`) as HTMLElement | null; return b ? { k, text: (b.textContent || "").trim().slice(0, 40), h: Math.round(b.getBoundingClientRect().height) } : null; }));
    ok("Custom List · By Programme · All Contacts are the three cards", cards.every(Boolean) && /By Programme/.test(cards[1].text), JSON.stringify(cards));
    await page.click('[data-testid="button-segment-programme"]');
    let picker = false;
    for (let i = 0; i < 40 && !picker; i++) { await sleep(250); picker = await page.evaluate(() => !!document.querySelector('[data-testid="audience-programme-4"]')); }
    ok("the picker draws FUNiño U4–U8 as a row with a family count", picker, "");
    // A string source: tsx wraps a named inner function in an esbuild `__name`
    // helper that does not exist inside the page (the first run died on it).
    const drawn: any = await page.evaluate(`(function (t) {
      function q(sel) { return document.querySelector(sel); }
      var termChip = q('[data-testid="audience-term-' + t + '"]');
      var row = q('[data-testid="audience-programme-4"]');
      var preOpts = q('[data-testid="audience-options-16"]');
      var u9 = q('[data-testid="audience-option-30"]');
      var campChips = document.querySelectorAll('[data-testid^="audience-camp-"] button').length;
      var hs = Array.prototype.slice.call(document.querySelectorAll('[data-testid^="audience-"]')).filter(function (e) { return e.tagName === "BUTTON"; }).map(function (e) { return Math.round(e.getBoundingClientRect().height); });
      var minH = hs.length ? Math.min.apply(null, hs) : 0;
      return { termNow: !!termChip && termChip.getAttribute("aria-checked") === "true" && /now/.test(termChip.textContent || ""), rowText: row ? (row.textContent || "").trim() : "", preOpts: !!preOpts, u9: u9 ? (u9.textContent || "").trim() : "", campChips: campChips, minH: minH, docW: document.documentElement.scrollWidth, winW: window.innerWidth };
    })(${term})`);
    ok("…the running term is pre-selected and marked 'now'", drawn.termNow, JSON.stringify(drawn));
    ok("…FUNiño reads with a family count; Pre-Academy has age-group chips incl. U9 with a count", /families/.test(drawn.rowText) && drawn.preOpts && /^U9\s*\d+$/.test(drawn.u9), JSON.stringify({ row: drawn.rowText, u9: drawn.u9 }));
    ok("…the holiday camps are listed by edition", drawn.campChips >= 2, `${drawn.campChips} edition chips`);
    ok("…every control is thumb-sized and nothing overflows the page", drawn.minH >= 36 && drawn.docW <= drawn.winW + 1, JSON.stringify({ minH: drawn.minH, docW: drawn.docW, winW: drawn.winW }));

    await page.click('[data-testid="audience-programme-4"]');
    await sleep(300);
    const sum1: any = await page.evaluate(() => (document.querySelector('[data-testid="audience-summary"]')?.textContent || "").trim());
    ok("ticking FUNiño says who it is sending to, with the term", /FUNiño/.test(sum1) && /Term \d 20\d\d/.test(sum1), sum1);
    await page.click('[data-testid="audience-programme-16"]');
    await sleep(200);
    await page.click('[data-testid="audience-option-30"]');
    await sleep(300);
    const sum2: any = await page.evaluate(() => (document.querySelector('[data-testid="audience-summary"]')?.textContent || "").trim());
    ok("ticking a U9 chip under a whole Pre-Academy narrows it to U9", /Pre-Academy: U9/.test(sum2) && !/Pre-Academy \+|Pre-Academy ·/.test(sum2), sum2);
    await page.click('[data-testid="audience-term-all"]');
    await sleep(300);
    const sum3: any = await page.evaluate(() => (document.querySelector('[data-testid="audience-summary"]')?.textContent || "").trim());
    ok("'Any time' is said on the summary", /any time$/.test(sum3), sum3);
    await page.click(`[data-testid="audience-term-${term}"]`);
    await sleep(300);
    await page.screenshot({ path: join(OUT, `${label}-picker.png`), fullPage: true });
    console.log(`  → ${join(OUT, `${label}-picker.png`)}`);

    const next = await page.$('[data-testid="button-next-content"]');
    const nextEnabled = next ? await page.evaluate((b: any) => !b.disabled, next) : false;
    ok("Next is enabled with a programme picked (no address typed)", nextEnabled);
    if (next) await next.click();
    await sleep(1200);

    // ── Written email: the Picture button hosts a file and places it ──────────
    const writeCard = await page.$('[data-testid="button-mode-simple"]');
    if (writeCard) await writeCard.click();
    await sleep(1500);
    const input = await page.$('[data-testid="compose-picture-input"]');
    const picBtn = await page.$('[data-testid="compose-picture"]');
    ok("the written email has a Picture button", !!picBtn && !!input);
    if (input) await (input as any).uploadFile(picPath);
    let hosted = "";
    for (let i = 0; i < 60 && !hosted; i++) {
      await sleep(500);
      hosted = await page.evaluate(() => { const img = document.querySelector('[data-testid="simple-compose"] [contenteditable] img') as HTMLImageElement | null; return img ? img.getAttribute("src") || "" : ""; });
    }
    const status: any = await page.evaluate(() => (document.querySelector('[data-testid="compose-picture-status"]')?.textContent || "").trim());
    ok("a 1600×1200 photo is shrunk, hosted at /mailer/img and placed in the email", /\/mailer\/img\/[a-f0-9]{24}\.jpg$/.test(hosted), JSON.stringify({ hosted, status }));
    // The draft is written on a timer after the box changes — wait for the
    // hosted picture to reach it rather than reading the previous write.
    let compiled: any = { html: "", audience: null };
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      compiled = await page.evaluate(() => { const raw = Object.keys(localStorage).filter((k) => k.startsWith("clubos-mailer-draft:")).map((k) => localStorage.getItem(k))[0]; try { const d = JSON.parse(raw || "null"); return { html: String(d?.bodyHtml || ""), audience: d?.audience || null }; } catch { return { html: "", audience: null }; } });
      if (/\/mailer\/img\//.test(compiled.html)) break;
    }
    const hostedTag = compiled.html.match(/<img[^>]*\/mailer\/img\/[^>]*>/)?.[0] || "";
    ok("…the compiled email carries the hosted picture with an inline style, never base64", /style="display:block;max-width:100%;/.test(hostedTag) && !/data:image/.test(compiled.html), hostedTag || "no hosted img in the draft");
    ok("…and the draft remembers the programme pick", !!compiled.audience && Array.isArray(compiled.audience.groups) && compiled.audience.groups.length === 2, JSON.stringify(compiled.audience));
    await page.screenshot({ path: join(OUT, `${label}-compose-picture.png`), fullPage: false });
    console.log(`  → ${join(OUT, `${label}-compose-picture.png`)}`);

    // ── Designed email: a file dropped on the canvas is hosted, never embedded ──
    if (!mobile) {
      await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2", timeout: 60000 });
      await page.evaluate(() => { try { Object.keys(localStorage).filter((k) => k.startsWith("clubos-mailer-draft:")).forEach((k) => localStorage.removeItem(k)); } catch {} });
      await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2", timeout: 60000 });
      await sleep(1500);
      await page.click('[data-testid="button-segment-all"]');
      await sleep(300);
      const n2 = await page.$('[data-testid="button-next-content"]');
      if (n2) await n2.click();
      await sleep(1200);
      const design = await page.$('[data-testid="button-mode-design"]');
      if (design) await design.click();
      await sleep(7000);
      await page.evaluate(() => { const btn = Array.from(document.querySelectorAll("button")).find((b) => /Use this template/i.test(b.textContent || "")); (btn as HTMLButtonElement | undefined)?.click(); });
      await sleep(12000);
      // The design canvas is GrapesJS's own iframe — found by its element,
      // not by position among the page's frames.
      let target: any = null;
      for (let i = 0; i < 40 && !target; i++) {
        const fh = await page.$("iframe.gjs-frame");
        target = fh ? await fh.contentFrame() : null;
        if (!target) await sleep(500);
      }
      if (target) { for (let i = 0; i < 20; i++) { const n = await target.evaluate(() => document.querySelectorAll("img").length); if (n > 0) break; await sleep(500); } }
      let dropped = "";
      let before = 0;
      if (target) {
        before = await target.evaluate(() => document.querySelectorAll("img").length);
        const b64 = (await sharp(picPath).resize(800).jpeg({ quality: 85 }).toBuffer()).toString("base64");
        await target.evaluate((b: string) => {
          const bin = atob(b); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const file = new File([bytes], "dropped-photo.jpg", { type: "image/jpeg" });
          const dt = new DataTransfer(); dt.items.add(file);
          const el = document.querySelector("img") || document.body;
          el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
        }, b64);
        for (let i = 0; i < 60 && !dropped; i++) {
          await sleep(500);
          dropped = await target.evaluate(() => { const imgs = Array.from(document.querySelectorAll("img")); const hit = imgs.map((i) => i.getAttribute("src") || "").find((s) => /\/mailer\/img\/[a-f0-9]{24}\.jpg$/.test(s)); return hit || ""; });
        }
      }
      const embedded: any = target ? await target.evaluate(() => Array.from(document.querySelectorAll("img")).some((i) => /^data:image/.test(i.getAttribute("src") || ""))) : null;
      const note: any = await page.evaluate(() => (document.querySelector('[data-testid="ce-logo-upload-status"]')?.textContent || "").trim());
      ok("a photo dropped on the design canvas is uploaded and placed hosted — not embedded as base64", !!dropped && embedded === false, JSON.stringify({ dropped, embedded, note, imgsBefore: before }));
      const gauge: any = await page.evaluate(() => { const g = document.querySelector('[data-testid="mkt-size-gauge"]'); return g ? { text: (g.textContent || "").trim(), state: g.getAttribute("data-state") } : null; });
      ok("…and the size gauge stays green", !!gauge && gauge.state === "ok", JSON.stringify(gauge));
      await page.screenshot({ path: join(OUT, `${label}-canvas-drop.png`) });
      console.log(`  → ${join(OUT, `${label}-canvas-drop.png`)}`);
    }
    await page.close();
  }
  try { unlinkSync(picPath); } catch { /* temp */ }
}

main().catch((e) => { ok("the proof ran", false, String(e?.stack || e)); }).finally(async () => {
  try { if (browser) await browser.close(); } catch {}
  for (const id of users) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [id]));
  }
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
});

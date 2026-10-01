// Zach's Mailer flow on PRODUCTION, as an ordinary CUFC workspace admin, in a
// real browser at 1440×900: open the builder, paste + type a long letter, and
// prove Save stays on screen; then save it as a template, reload (the unsent
// email is offered back), and start a new email from the template.
//   npx tsx --env-file=.env script/_verify-mailer-zach-live.ts
// SENDS NOTHING. Removes its user, its template and its browser draft.
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = "https://app.usg.co.nz";
const WORKSPACE = "christchurch-united";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.OUT || join(process.cwd(), "outputs", "mailer-preflight");
const TPL = `_verify zach ${Date.now()}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (good: boolean, l: string, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); good ? pass++ : fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clickText = (page: any, re: string) => page.evaluate((src: string) => {
  const rx = new RegExp(src, "i");
  const b = [...document.querySelectorAll("button")].find((x) => rx.test((x.textContent || "").trim()));
  if (b) { (b as HTMLButtonElement).click(); return true; } return false;
}, re);
let userId: number | null = null;
let browser: any = null;
try {
  mkdirSync(OUT, { recursive: true });
  const email = `_mailerzach_${Date.now()}@usg.co.nz`;
  const password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Verify','Mailer',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(password, 10)]);
  userId = rows[0].id;
  const org = (await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE])).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`, [userId, org]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new Error(`login ${login.status}`);
  const [cname, cvalue] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");

  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ name: cname, value: cvalue, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await page.evaluate((s: string) => { localStorage.setItem("clubos_workspace", s); localStorage.removeItem("clubos-mailer-draft:" + s); }, WORKSPACE);
  await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(2000);

  // Setup → Content
  await clickText(page, "^Next");
  await page.waitForSelector("[data-testid=mailer-templates-bar]", { timeout: 20000 });
  ok(true, "Content step shows the 'Your templates' bar");
  await page.type("[data-testid=input-subject]", "Verify — Term 4 letter");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Use this template/.test(b.textContent || "")), { timeout: 30000 });
  const picked = await clickText(page, "Use this template");
  await sleep(1500);
  await page.screenshot({ path: join(OUT, "zach-after-pick.png") });
  if (!(await page.$(".gjs-frame"))) {
    const btns = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 40).join(" | "));
    console.log("picked:", picked, "buttons:", btns);
  }
  await page.waitForSelector(".gjs-frame", { timeout: 40000 });
  await sleep(3000);
  const frame = await (await page.$(".gjs-frame")).contentFrame();
  const fr = await (await page.$(".gjs-frame")).boundingBox();
  const target = await frame.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.textContent || "").trim().length > 25 && e.getBoundingClientRect().height > 0);
    const r = el!.getBoundingClientRect(); return { x: r.left + 20, y: r.top + 10 };
  });
  await page.mouse.click(fr.x + target.x, fr.y + target.y);
  await sleep(500);
  await frame.evaluate(() => (document.querySelector(".gjs-selected") as HTMLElement)?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  await sleep(800);
  await frame.evaluate(() => {
    const el = document.querySelector("[contenteditable=true]") as HTMLElement; el.focus();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
  });
  // A Google-Docs paste (goes through the real paste handler), then typing.
  await frame.evaluate(() => {
    const h = Array.from({ length: 30 }, (_, i) => `<p style="font-family:Arial;background:#fff">Para ${i + 1} — boots, shin pads, water. <b>Pick-up 5:45pm.</b></p>`).join("");
    const dt = new DataTransfer(); dt.setData("text/html", h); dt.setData("text/plain", "x");
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const cdp = await page.target().createCDPSession();
  for (let i = 0; i < 20; i++) { await cdp.send("Input.insertText", { text: `Line ${i + 1} please arrive early.` }); await page.keyboard.press("Enter"); }
  await sleep(1000);
  const pos = await page.evaluate(() => {
    const save = document.querySelector("[data-testid=mkt-builder-save]") as HTMLElement;
    const r = save.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const box = document.querySelector("[data-testid=email-builder]") as HTMLElement;
    return { top: Math.round(r.top), clickable: !!hit && (hit === save || save.contains(hit)), boxScroll: box.scrollTop };
  });
  ok(pos.clickable && pos.top > 0 && pos.boxScroll === 0, "after a long paste + typing, Save is on screen and clickable", JSON.stringify(pos));
  const leaked = await frame.evaluate(() => /font-family|background/i.test(document.querySelector("[contenteditable=true]")?.innerHTML || ""));
  ok(!leaked, "the paste brought no fonts or backgrounds with it");
  await page.screenshot({ path: join(OUT, "zach-after-paste.png") });
  // Finish with the block the way a person does — click elsewhere on the page.
  // (the Design card's own heading — not a link)
  const h = await page.evaluate(() => { const el = [...document.querySelectorAll("h2")].find((x) => /design/i.test(x.textContent || ""))!; const r = el.getBoundingClientRect(); return { x: r.left + 10, y: r.top + 5 }; });
  await page.mouse.click(h.x, h.y);
  await sleep(3500);
  const auto = await page.$eval("[data-testid=mkt-autosave-status]", (e: any) => e.textContent).catch(() => "");
  ok(/Saved automatically/.test(auto), "it saved on its own once the block was finished", auto);
  ok(await page.evaluate(() => !document.querySelector("[data-testid=text-design-unsaved]")), "no 'not saved' warning");

  // Save as template
  await page.click("[data-testid=button-save-as-template]");
  await page.type("[data-testid=input-template-name]", TPL);
  await page.click("[data-testid=button-template-save]");
  await sleep(2500);
  const listed = await page.evaluate((n: string) => document.querySelector("[data-testid=mailer-templates-bar]")!.textContent!.includes(n), TPL);
  ok(listed, "'Save as template' — it appears in Your templates");
  const row = (await pool.query(`SELECT id, length(body_html) n, body_html LIKE '%Line 20%' has FROM mailer_templates WHERE name=$1 AND archived_at IS NULL`, [TPL])).rows[0];
  ok(!!row && row.has, "the stored template holds the whole letter", row ? `${row.n} bytes` : "missing");

  // Reload: the unsent email is offered back
  await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2" });
  await sleep(2000);
  const offer = await page.$("[data-testid=mailer-draft-recover]");
  ok(!!offer, "after a reload, 'You have an email you didn't send' is offered");
  await page.screenshot({ path: join(OUT, "zach-draft-offer.png") });
  await page.click("[data-testid=button-draft-discard]");
  await sleep(500);

  // Start a new email from the template
  await clickText(page, "^Next");
  await page.waitForSelector(`[data-testid=button-template-${row.id}]`, { timeout: 30000 });
  await page.click(`[data-testid=button-template-${row.id}]`);
  await page.waitForSelector(".gjs-frame", { timeout: 40000 });
  await sleep(3500);
  const f2 = await (await page.$(".gjs-frame")).contentFrame();
  const hasText = await f2.evaluate(() => document.body.innerText.includes("Line 20"));
  ok(hasText, "starting from the template opens the saved letter in the builder");
  const subj = await page.$eval("[data-testid=input-subject]", (e: any) => e.value);
  ok(subj === "Verify — Term 4 letter", "…with its subject", subj);
  await page.screenshot({ path: join(OUT, "zach-from-template.png") });
} catch (e: any) {
  ok(false, "run completed", e?.message);
} finally {
  if (browser) {
    try { const p = (await browser.pages())[0]; await p?.evaluate((s: string) => localStorage.removeItem("clubos-mailer-draft:" + s), WORKSPACE); } catch {}
    await browser.close();
  }
  await pool.query(`DELETE FROM mailer_templates WHERE name=$1`, [TPL]);
  if (userId) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [userId]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [userId]));
  }
  await pool.end();
}
console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);

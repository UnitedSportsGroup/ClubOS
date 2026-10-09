// Live check for the 2026-10-09 Mailer changes, as an ORDINARY CUFC admin:
// Send-as dropdown · opens on a blank WHITE page (no template screen) · plain
// "+ First name" tags · Letterhead picker · Attach a file.
//   npx tsx --env-file=.env script/_verify-mailer-simple-browser.ts
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = "https://app.usg.co.nz";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.OUT_DIR || join(process.cwd(), "outputs", "mailer-simple");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); g ? pass++ : fail++; };
let uid: number | null = null; let browser: any = null;
try {
  mkdirSync(OUT, { recursive: true });
  const email = `_mailersimple_${Date.now()}@usg.co.nz`;
  const password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Preflight','Mailer',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(password, 10)]);
  uid = rows[0].id;
  const org = (await pool.query(`SELECT id FROM organizations WHERE slug='christchurch-united'`)).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`, [uid, org]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const [cn, cv] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.setCookie({ name: cn, value: cv, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("clubos_workspace", "christchurch-united"));
  await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  const sel = await page.$('[data-testid="select-sender"]');
  ok("Send as dropdown is on the page", !!sel);
  const from = await page.$eval('[data-testid="input-from-email"]', (e: any) => e.value).catch(() => "");
  ok("From defaults to the club's info@ for someone with no linked sender", /info@cufc\.co\.nz/.test(from), from);
  await page.evaluate(() => document.querySelector('[data-testid="select-sender"]')?.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: join(OUT, "1-setup.png") });
  // open the dropdown and pick Grassroots
  await sel?.click(); await new Promise((r) => setTimeout(r, 500));
  const opt = await page.$$("xpath/.//*[contains(text(),'Grassroots (Zach)')]");
  if (opt.length) { await opt[opt.length - 1].click(); await new Promise((r) => setTimeout(r, 400)); }
  const from2 = await page.$eval('[data-testid="input-from-email"]', (e: any) => e.value).catch(() => "");
  const reply2 = await page.$eval('[data-testid="input-reply-to"]', (e: any) => e.value).catch(() => "");
  ok("choosing Grassroots sets From and Reply-to", /grassroots@cufc\.co\.nz/.test(from2) && reply2 === "grassroots@cufc.co.nz", `${from2} / ${reply2}`);
  await page.screenshot({ path: join(OUT, "2-sender-picked.png") });
  // go to content
  const next = await page.$$("xpath/.//button[contains(., 'Next: Content')]");
  if (next.length) { await next[0].click(); }
  await new Promise((r) => setTimeout(r, 6000));
  const body = await page.evaluate(() => document.body.innerText);
  ok("opens straight on the builder, not a template screen", !/Start from a template|Choose a starting point/i.test(body) && /Insert:/.test(body));
  ok("tags read as words", /\+ First name/.test(body) && /\+ Player first name/.test(body));
  ok("Letterhead picker present", !!(await page.$('[data-testid="mkt-letterhead"]')));
  ok("Attach a file present", !!(await page.$('[data-testid="button-add-attachment"]')));
  const frameBg = await page.evaluate(() => {
    const f = document.querySelector("iframe.gjs-frame, .gjs-frame") as HTMLIFrameElement | null;
    const d = f?.contentDocument; const el = d?.querySelector("table, div[style*='background']") as HTMLElement | null;
    return d ? getComputedStyle(d.body).backgroundColor + " | " + (d.body.innerText || "").slice(0, 120) : "no frame";
  });
  ok("blank page says 'Hi {{first_name}}'", /Hi \{\{first_name\}\}/.test(frameBg), frameBg);
  // pick a letterhead
  const lh = await page.$('[data-testid="mkt-letterhead"]'); await lh?.click(); await new Promise((r) => setTimeout(r, 500));
  const lo = await page.$$("xpath/.//*[normalize-space(text())='Christchurch United FC']");
  if (lo.length) { await lo[lo.length - 1].click(); await new Promise((r) => setTimeout(r, 1500)); }
  const hasLogo = await page.evaluate(() => { const f = document.querySelector("iframe.gjs-frame") as HTMLIFrameElement | null; return !!f?.contentDocument?.querySelector("img[src*='christchurch-united.png']"); });
  ok("choosing a letterhead puts the crest at the top", hasLogo);
  await page.evaluate(() => document.querySelector('[data-testid="mailer-attachments-bar"]')?.scrollIntoView({ block: "start" }));
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: join(OUT, "3-builder.png") });
} catch (e: any) { ok("run", false, e?.message); }
finally {
  try { await browser?.close(); } catch {}
  if (uid) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]); await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [uid])); }
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}

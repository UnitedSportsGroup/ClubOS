/**
 * Xero Invoices — real Chrome on production as ORDINARY USG staff (not a super admin, who short-circuits every
 * permission check and so cannot reproduce what staff see). Throwaway account, deleted after.
 *   npx tsx --env-file=.env script/_verify-xero-invoices-browser.ts
 */
import puppeteer from "puppeteer-core";
import pg from "pg";
import bcrypt from "bcryptjs";
import { mkdirSync, readFileSync } from "fs";
import { join } from "path";
const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/outputs/ui-preflight/xero-invoices"; mkdirSync(OUT, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); g ? pass++ : fail++; };

async function main() {
  const email = `_xi_${Date.now()}@usg.co.nz`, pw = `X${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Xero','Browser',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  const uid = rows[0].id;
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug='united-sports-group'`);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'team_member',$3)`, [uid, org[0].id, JSON.stringify(["dashboard", "xero-invoices"])]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const [cn, cv] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  try {
    for (const vp of [{ label: "desktop", width: 1440, height: 900 }, { label: "mobile", width: 390, height: 844 }]) {
      const page = await browser.newPage();
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 2 });
      const errors: string[] = []; page.on("pageerror", (e) => errors.push(String(e)));
      await page.setCookie({ name: cn, value: cv, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
      await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluate(() => localStorage.setItem("clubos_workspace", "united-sports-group"));
      await page.goto(`${BASE}/admin/xero-invoices`, { waitUntil: "networkidle2", timeout: 60000 });
      const loaded = await page.waitForFunction(() => document.querySelectorAll('[data-testid="xi-list"] > div').length > 5, { timeout: 40000 }).then(() => true).catch(() => false);
      ok(`${vp.label}: the list loads for ordinary staff`, loaded);
      const money = await page.evaluate(() => /\$[\d,]+/.test(document.body.innerText));
      ok(`${vp.label}: the tiles carry real money`, money);
      const n = await page.$$eval('[data-testid="xi-list"] > div', (d) => d.length);
      ok(`${vp.label}: anything-owing shows the 185 unpaid/part-paid invoices`, n >= 150 && n <= 200, `${n} rows`);
      // filter to Sponsors and check it narrows
      await page.evaluate(() => { const s = document.querySelectorAll("select")[0] as HTMLSelectElement; const o = Array.from(s.options).find((x) => x.value === "Sponsors"); if (o) { s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); } });
      const narrowed = await page.waitForFunction(() => { const d = document.querySelectorAll('[data-testid="xi-list"] > div'); return d.length > 0 && d.length < 30; }, { timeout: 20000 }).then(() => true).catch(() => false);
      ok(`${vp.label}: filtering by category narrows the list`, narrowed);
      // open one and check the detail is there
      await page.evaluate(() => (document.querySelector('[data-testid="xi-list"] button') as HTMLButtonElement).click());
      const detail = await page.waitForFunction(() => /Open it in Xero/i.test(document.body.innerText) && /Who to chase/i.test(document.body.innerText), { timeout: 15000 }).then(() => true).catch(() => false);
      ok(`${vp.label}: an invoice opens into its detail and a Xero link`, detail);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(`${vp.label}: no horizontal overflow`, overflow <= 1, `${overflow}px`);
      await page.screenshot({ path: join(OUT, `${vp.label}.png`), fullPage: vp.label === "desktop" });
      ok(`${vp.label}: no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
      await page.close();
    }
    // the gate: a USG member WITHOUT the tab must be refused
    const e2 = `_xi2_${Date.now()}@usg.co.nz`, p2 = `Y${Math.random().toString(36).slice(2)}!aA9`;
    const { rows: u2 } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'No','Tab',$2,'team_member',true) RETURNING id`, [e2, await bcrypt.hash(p2, 10)]);
    await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'team_member',$3)`, [u2[0].id, org[0].id, JSON.stringify(["dashboard"])]);
    const l2 = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e2, password: p2 }) });
    const c2 = (l2.headers.get("set-cookie") || "").split(";")[0];
    const gated = await fetch(`${BASE}/api/admin/xero-invoices`, { headers: { cookie: c2, "X-Workspace-Slug": "united-sports-group" } });
    ok(`a USG member WITHOUT the tab is refused`, gated.status === 403 || gated.status === 404, `HTTP ${gated.status}`);
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [u2[0].id]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [u2[0].id]);
    // the push refuses a short snapshot
    // 🔴 the upload token lives in the ROOT .env, not apps/clubos/.env — reading the wrong one gives a 401 and a
    // check that reports a working guard as broken (it did, first run).
    const tok = (readFileSync("/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/.env", "utf8")
      .split("\n").find((l) => l.startsWith("FINANCE_INSIGHT_UPLOAD_TOKEN=")) || "").split("=").slice(1).join("=").trim();
    ok(`the verifier found the upload token`, tok.length > 20, `${tok.length} chars`);
    const short = await fetch(`${BASE}/api/internal/xero-invoices/snapshot`, { method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ invoices: [{ invoiceId: "probe", number: "PROBE", issued: "2026-01-01" }] }) });
    ok(`a snapshot far smaller than the mirror is REFUSED`, short.status === 409, `HTTP ${short.status}`);
  } finally {
    await browser.close();
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [uid]);
    await pool.end();
  }
  console.log(`\n  ${pass} passed · ${fail} failed · screenshots in ${OUT}\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

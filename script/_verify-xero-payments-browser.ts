// Xero payments page + the server's own shadow sweep. Real Chrome, ORDINARY CUFC
// staff. Read-only: no child is assigned, nothing dismissed.
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.SHOTS || "/tmp";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let fail = 0; const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); if (!g) fail++; };
let uid: number | null = null, browser: any;
const settle = (ms = 2500) => new Promise(r => setTimeout(r, ms));
try {
  const st = (await pool.query(`select last_ok_at, last_error, last_counts from xero_registration_sync_state where organization_id=1`)).rows[0];
  ok("the server's own sweep has run", !!st?.last_ok_at, JSON.stringify(st?.last_counts ?? st?.last_error));
  const live = st?.last_counts?.mode === "live";
  ok("it ran in shadow or live", live || st?.last_counts?.mode === "shadow", st?.last_counts?.mode);
  if (!live) {
    const made = (await pool.query(`select count(*)::int n from registrations where legacy_source='xero' and source='xero' and registered_at > now() - interval '1 day'`)).rows[0].n;
    ok("shadow wrote no registrations", made === 0, String(made));
  }

  const email = `_xp_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  uid = (await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Xp','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)])).rows[0].id;
  const org = (await pool.query(`SELECT id FROM organizations WHERE slug='christchurch-united'`)).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [uid, org]);
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const [n, v] = (res.headers.get("set-cookie") || "").split(";")[0].split("=");
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage(); await page.setViewport({ width: w, height: h });
    const errors: string[] = []; page.on("pageerror", (e: any) => errors.push(String(e.message).slice(0, 120)));
    await page.setCookie({ name: n, value: v, domain: new URL(BASE).hostname, path: "/" });
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("clubos_workspace", "christchurch-united"));
    await page.goto(`${BASE}/admin/xero-payments`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="xero-sync-status"]', { timeout: 30000 }).catch(() => {});
    await settle();
    const status = await page.$eval('[data-testid="xero-sync-status"]', (e: any) => e.innerText).catch(() => "");
    ok(`${w}px status names the mode`, live ? !/Watching only/i.test(status) : /Watching only/i.test(status), status.slice(0, 120));
    const rows = await page.$$('[data-testid="xero-invoice"]');
    ok(`${w}px review queue lists invoices`, rows.length > 0, String(rows.length));
    const cands = await page.$$('[data-testid="xero-candidate"]');
    ok(`${w}px candidates are offered to pick from`, cands.length > 0, String(cands.length));
    await page.screenshot({ path: `${OUT}/xero-review-${w}.png`, fullPage: false });
    if (!live) {
      await page.click('[data-testid="xero-view-would_register"]'); await settle(1500);
      const wr = await page.$$('[data-testid="xero-invoice"]');
      ok(`${w}px "Would add" lists the paid Term 4 invoices`, wr.length >= 10, String(wr.length));
    }
    await page.click('[data-testid="xero-view-awaiting_payment"]'); await settle(1500);
    ok(`${w}px "Awaiting payment" lists unpaid invoices`, (await page.$$('[data-testid="xero-invoice"]')).length > 0);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`${w}px no sideways scroll`, sw <= 1, String(sw));
    // the sidebar link exists for a human to find (desktop)
    if (w === 1440) ok("sidebar has Xero payments", !!(await page.$('a[href="/admin/xero-payments"]')));
    ok(`${w}px no page errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
} finally {
  await browser?.close();
  if (uid) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]); await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [uid])); }
  await pool.end();
  console.log(fail ? `${fail} FAILED` : "all passed"); process.exit(fail ? 1 : 0);
}

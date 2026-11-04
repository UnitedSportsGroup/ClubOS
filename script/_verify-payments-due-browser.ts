// Payments due — real Chrome on production as ORDINARY CUFC staff (team_member holding
// only the Registrations tab — never a super admin), desktop + phone. Read-only: opens
// the page, clicks group-bys/filters, fetches one PDF. Also proves the gate.
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.SHOTS || "/tmp";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let fail = 0; const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); if (!g) fail++; };
let uid: number | null = null, browser: any;
const settle = (ms = 700) => new Promise(r => setTimeout(r, ms));
try {
  ok("signed out → 401", (await fetch(`${BASE}/api/admin/payments-due`)).status === 401);
  const email = `_pd_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  uid = (await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Pd','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)])).rows[0].id;
  const org = (await pool.query(`SELECT id FROM organizations WHERE slug='christchurch-united'`)).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'team_member',$3)`, [uid, org, JSON.stringify(["registrations"])]);
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  const eq = cookie.indexOf("="); const n = cookie.slice(0, eq), v = cookie.slice(eq + 1);
  const other = await fetch(`${BASE}/api/admin/payments-due`, { headers: { cookie, "x-workspace-slug": "mini-football-leagues" } });
  ok("another workspace → 403/404, never data", [403, 404].includes(other.status), String(other.status));
  const api = await fetch(`${BASE}/api/admin/payments-due`, { headers: { cookie, "x-workspace-slug": "christchurch-united" } });
  const snap: any = await api.json();
  ok("CUFC staff with the Registrations tab get the snapshot", api.status === 200 && Array.isArray(snap.rows), String(api.status));
  const owed = snap.rows.reduce((s: number, r: any) => s + r.owedCents, 0);
  ok("money is owed and every row owes something", owed > 0 && snap.rows.every((r: any) => r.owedCents > 0), `$${owed / 100} on ${snap.rows.length}`);
  ok("only CUFC family contacts", snap.rows.every((r: any) => /^\((FS|A)[ _)]/i.test(r.xeroContactName)));
  ok("overdue = due date before today", snap.rows.every((r: any) => (r.status === "overdue") === (!!r.due && r.due < snap.today)));

  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage(); await page.setViewport({ width: w, height: h });
    const errors: string[] = []; page.on("pageerror", (e: any) => errors.push(String(e.message).slice(0, 120)));
    await page.setCookie({ name: n, value: v, domain: new URL(BASE).hostname, path: "/" });
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("clubos_workspace", "christchurch-united"));
    await page.goto(`${BASE}/admin/payments-due`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="payments-due-tiles"]', { timeout: 45000 }).catch(() => {});
    const tiles = await page.$eval('[data-testid="payments-due-tiles"]', (e: any) => e.innerText).catch(() => "");
    ok(`${w}px tiles render with a dollar figure`, /\$\d/.test(tiles), tiles.replace(/\s+/g, " ").slice(0, 160));
    const groupCount = async () => (await page.$$('[data-testid="due-group"]')).length;
    ok(`${w}px grouped by programme`, (await groupCount()) >= 2, String(await groupCount()));
    await page.screenshot({ path: `${OUT}/payments-due-${w}.png`, fullPage: false });
    for (const g of ["age", "family", "term", "ageing"]) {
      await page.click(`[data-testid="group-${g}"]`); await settle();
      ok(`${w}px group by ${g} draws groups`, (await groupCount()) >= 1, String(await groupCount()));
      ok(`${w}px URL carries group=${g}`, page.url().includes(`group=${g}`));
    }
    await page.click('[data-testid="status-overdue"]'); await settle();
    await page.click('[data-testid="group-none"]'); await settle();
    const rowsOverdue: string[] = await page.$$eval('[data-testid="due-row"]', (els: any[]) => els.map((e) => e.innerText));
    ok(`${w}px Overdue shows only overdue rows`, rowsOverdue.length > 0 && rowsOverdue.every((t) => /overdue/i.test(t)), String(rowsOverdue.length));
    await page.screenshot({ path: `${OUT}/payments-due-${w}-rows.png`, fullPage: false });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`${w}px no sideways scroll`, sw <= 1, String(sw));
    if (w === 1440) {
      ok("sidebar has Payments due", !!(await page.$('a[href="/admin/payments-due"]')));
      const id = snap.rows[0].invoiceId;
      const pdf = await page.evaluate(async (id: string) => { const r = await fetch(`/api/admin/payments-due/${id}/pdf`, { headers: { "x-workspace-slug": "christchurch-united" } }); return [r.status, r.headers.get("content-type")]; }, id);
      ok("invoice PDF opens", pdf[0] === 200 && String(pdf[1]).includes("pdf"), JSON.stringify(pdf));
      const bad = await page.evaluate(async () => (await fetch(`/api/admin/payments-due/00000000-0000-0000-0000-000000000000/pdf`, { headers: { "x-workspace-slug": "christchurch-united" } })).status);
      ok("PDF of an invoice not on the page → 404", bad === 404, String(bad));
    }
    ok(`${w}px no page errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
} finally {
  await browser?.close();
  if (uid) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]); await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [uid])); }
  await pool.end();
  console.log(fail ? `${fail} FAILED` : "all passed"); process.exit(fail ? 1 : 0);
}

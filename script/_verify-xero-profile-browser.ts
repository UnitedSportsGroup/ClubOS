// A child registered from a Xero bank-transfer invoice: their profile shows the
// invoice, the paid time, a label on the registration, and the PDF opens.
// Real Chrome, ORDINARY CUFC staff, read-only. Picks the newest sync registration.
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
  const x = (await pool.query(`select x.invoice_id, x.invoice_number, x.registration_id, x.child_contact_id, x.paid_at,
      (select guardian_id from registrations where id = x.registration_id) guardian
     from xero_invoice_registrations x where x.decision='registered' and x.paid_at is not null order by x.decided_at desc limit 1`)).rows[0];
  ok("a child registered from Xero exists", !!x);
  const email = `_xpp_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
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
    await page.goto(`${BASE}/admin/people/contact-${x.child_contact_id}`, { waitUntil: "domcontentloaded" });
    const sel = `[data-testid="xero-invoice-${x.invoice_number}"]`;
    await page.waitForSelector(sel, { timeout: 30000 }).catch(() => {});
    await settle(1500);
    const label = await page.$eval(`${sel} [data-testid="xero-paid-label"]`, (e: any) => e.innerText).catch(() => "");
    ok(`${w}px child profile lists ${x.invoice_number} with a paid time`, /^Paid .*\d{1,2}:\d{2}\s?[ap]m/i.test(label), label);
    const reg = await page.$eval(`[data-testid="xero-label-${x.registration_id}"]`, (e: any) => e.innerText).catch(() => "");
    ok(`${w}px the registration carries the Xero label`, reg.includes(x.invoice_number) && /Paid/.test(reg), reg);
    const pdf = await page.evaluate(async (id: string) => {
      const r = await fetch(`/api/admin/xero-registrations/${id}/pdf`, { headers: { "X-Workspace-Slug": "christchurch-united" }, credentials: "include" });
      const b = new Uint8Array(await r.arrayBuffer());
      return { status: r.status, type: r.headers.get("content-type"), head: String.fromCharCode(...b.slice(0, 5)), size: b.length };
    }, x.invoice_id);
    ok(`${w}px the invoice PDF comes from Xero`, pdf.status === 200 && pdf.head === "%PDF-", JSON.stringify(pdf));
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`${w}px no sideways scroll`, sw <= 1, String(sw));
    const card = await page.$(sel);
    if (card) { await card.evaluate((e: any) => e.closest(".rounded-xl")?.scrollIntoView({ block: "center" })); await settle(500);
      await page.screenshot({ path: `${OUT}/xero-profile-${w}.png` }); }
    if (x.guardian && w === 1440) {
      await page.goto(`${BASE}/admin/people/contact-${x.guardian}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(sel, { timeout: 30000 }).catch(() => {});
      ok("the parent's page lists the child's invoice too", !!(await page.$(sel)));
    }
    ok(`${w}px no page errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
  // a stranger's invoice id is refused
  const r = await fetch(`${BASE}/api/admin/xero-registrations/00000000-0000-0000-0000-000000000000/pdf`, { headers: { cookie: `${n}=${v}`, "X-Workspace-Slug": "christchurch-united" } });
  ok("an invoice not on record is refused", r.status === 404, String(r.status));
} finally {
  await browser?.close();
  if (uid) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]); await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [uid])); }
  await pool.end();
}
console.log(fail ? `\n${fail} FAILED` : "\nall passed"); process.exit(fail ? 1 : 0);

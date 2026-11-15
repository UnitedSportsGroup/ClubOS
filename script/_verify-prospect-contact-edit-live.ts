// Sales → prospect "Edit contact" (Dima, 2 Nov 2026) — live check as an ORDINARY
// United Prints admin holding the Sales tab the way Dima does (unlocked_tabs).
// Works on a throwaway prospect it creates and deletes; no real prospect is touched.
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "https://app.usg.co.nz";
const OUT = process.env.SHOTS_DIR || "/tmp";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let failed = 0;
const ok = (m: string) => console.log(`  ok   ${m}`);
const bad = (m: string) => { failed++; console.log(`  FAIL ${m}`); };
let uid: number | null = null; let pid: number | null = null; let browser: any = null;
try {
  const email = `_salesprobe_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Sales','Probe',$2,'admin',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  uid = rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs,unlocked_tabs) VALUES ($1,8,'admin',NULL,'["sales"]'::jsonb)`, [uid]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  if (!login.ok) throw new Error(`login ${login.status}`);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const api = (p: string, init: RequestInit = {}) => fetch(`${BASE}${p}`, { ...init, headers: { cookie, "X-Workspace-Slug": "united-prints", "Content-Type": "application/json", ...(init.headers || {}) } });

  const c = await api("/api/admin/sales/prospects", { method: "POST", body: JSON.stringify({ name: "ZZ Probe Contact Edit Ltd" }) });
  const cj: any = await c.json();
  pid = cj.prospect?.id ?? null;
  pid ? ok(`throwaway prospect #${pid} created`) : bad(`create → ${c.status} ${JSON.stringify(cj).slice(0, 120)}`);

  const b = await api(`/api/admin/sales/prospects/${pid}`, { method: "PATCH", body: JSON.stringify({ email: "not-an-email" }) });
  b.status === 400 ? ok("malformed email refused (400)") : bad(`malformed email → ${b.status}`);

  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  for (const [w, h, name] of [[390, 844, "phone"], [1440, 900, "desktop"]] as const) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    const [cn, cv] = cookie.split("=");
    await page.setCookie({ name: cn, value: cv, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
    await page.evaluate(() => localStorage.setItem("clubos_workspace", "united-prints"));
    await page.goto(`${BASE}/admin/print-sales`, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => /ZZ Probe Contact Edit/.test(document.body.innerText), { timeout: 20000 }).catch(() => {});
    const clicked = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("*")).reverse().find((e) => (e as HTMLElement).innerText?.trim() === "ZZ Probe Contact Edit Ltd") as HTMLElement | undefined;
      (el?.closest("tr, button, [role=button], div[class*=cursor]") as HTMLElement | null ?? el)?.click();
      return !!el;
    });
    if (!clicked) { bad(`${name}: probe prospect not in the list`); await page.close(); continue; }
    const addEmail = await page.waitForSelector('[data-testid="detail-add-email"]', { timeout: 15000 }).catch(() => null);
    addEmail ? ok(`${name}: "no email on file · add email" shows`) : bad(`${name}: no add-email link`);
    if (name === "phone") {
      await page.click('[data-testid="detail-edit-contact"]');
      await page.waitForSelector('[data-testid="contact-editor"]');
      const ov = await page.evaluate(() => { const d = document.querySelector('[data-testid="contact-editor"]')!.getBoundingClientRect(); return d.right > window.innerWidth + 1 || d.left < -1; });
      !ov ? ok("phone: editor fits the screen") : bad("phone: editor spills off screen");
      await page.screenshot({ path: `${OUT}/prospect-contact-edit-phone.png` });
    } else {
      await addEmail!.click();
      await page.waitForSelector('[data-testid="contact-editor"]');
      await page.type('[data-testid="contact-email"]', "hello@probe-company.co.nz");
      await page.type('[data-testid="contact-contactName"]', "Pat Probe");
      await page.screenshot({ path: `${OUT}/prospect-contact-edit-desktop.png` });
      await page.click('[data-testid="contact-save"]');
      const shown = await page.waitForFunction(() => /hello@probe-company\.co\.nz/.test(document.body.innerText) && !document.querySelector('[data-testid="contact-editor"]'), { timeout: 15000 }).then(() => true).catch(() => false);
      shown ? ok("desktop: saved email shows on the card, with Write email") : bad("desktop: saved email not shown");
      await page.screenshot({ path: `${OUT}/prospect-contact-saved-desktop.png` });
      const { rows: r } = await pool.query(`SELECT email, contact_name FROM sales_prospects WHERE id=$1`, [pid]);
      r[0]?.email === "hello@probe-company.co.nz" && r[0]?.contact_name === "Pat Probe" ? ok("database holds the new email + contact name") : bad(`db row ${JSON.stringify(r[0])}`);
    }
    await page.close();
  }
} catch (e) { bad(String(e)); }
finally {
  if (browser) await browser.close();
  if (pid) { await pool.query(`DELETE FROM sales_activities WHERE prospect_id=$1`, [pid]); await pool.query(`DELETE FROM sales_prospects WHERE id=$1`, [pid]); }
  if (uid) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]); await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [uid])); }
  await pool.end();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
}

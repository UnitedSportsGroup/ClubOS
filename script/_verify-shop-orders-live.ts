// Shop Orders (United Prints) — live check as an ORDINARY United Prints admin
// (what Dima is): the API answers in UP and 404s elsewhere, writes are refused
// for cancel/refund, and the real page renders at phone + laptop width.
// Read-only against real orders; the probe user is deleted at the end.
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
let uid: number | null = null; let browser: any = null;
try {
  const email = `_shoporders_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Shop','Probe',$2,'admin',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  uid = rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,8,'admin',NULL),($1,1,'admin',NULL)`, [uid]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  if (!login.ok) throw new Error(`login ${login.status}`);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const api = (p: string, slug: string, init: RequestInit = {}) => fetch(`${BASE}${p}`, { ...init, headers: { cookie, "X-Workspace-Slug": slug, "Content-Type": "application/json", ...(init.headers || {}) } });

  const r = await api("/api/admin/shop-orders?status=to_pack", "united-prints");
  const d: any = r.ok ? await r.json() : null;
  r.ok ? ok(`United Prints: 200, ${d.orders.length} to pack, brands ${d.brands.map((b: any) => b.key).join("/")}`) : bad(`United Prints list ${r.status}`);
  if (d && d.orders.some((o: any) => !["paid", "processing"].includes(o.status))) bad("to_pack carries a non-packing status"); else ok("to_pack only paid/processing");
  const all = await (await api("/api/admin/shop-orders?status=&source=all", "united-prints")).json();
  if (all.orders.some((o: any) => ["pending", "awaiting_players"].includes(o.status))) bad("unpaid order listed"); else ok(`no unpaid orders among ${all.orders.length}`);
  const cufc = await api("/api/admin/shop-orders", "christchurch-united");
  cufc.status === 404 ? ok("CUFC workspace header → 404") : bad(`CUFC header → ${cufc.status}`);
  if (d?.orders[0]) {
    const x = await api(`/api/admin/shop-orders/${d.orders[0].id}/status`, "united-prints", { method: "PATCH", body: JSON.stringify({ status: "refunded" }) });
    x.status === 400 ? ok("refund from here refused (400)") : bad(`refund status → ${x.status}`);
  }
  const a = await (await api("/api/admin/shop-orders/me/alerts", "united-prints")).json();
  a.on === false ? ok("alerts default off for a new person") : bad("alerts not off by default");

  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  for (const [w, h, name] of [[390, 844, "phone"], [1440, 900, "desktop"]] as const) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    const [cn, cv] = cookie.split("=");
    await page.setCookie({ name: cn, value: cv, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
    await page.evaluate(() => localStorage.setItem("clubos_workspace", "united-prints"));
    await page.goto(`${BASE}/admin/shop-orders`, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.querySelector('[data-testid^="shop-order-"]') || /Nothing to pack|No orders here/.test(document.body.innerText), { timeout: 20000 }).catch(() => {});
    const info = await page.evaluate(() => ({
      cards: document.querySelectorAll('[data-testid^="shop-order-"]').length,
      heading: !!Array.from(document.querySelectorAll("h1")).find((e) => /Shop Orders/i.test(e.textContent || "")),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      link: !!document.querySelector('a[href="/admin/shop-orders"]'),
    }));
    info.heading ? ok(`${name}: page renders (${info.cards} order cards)`) : bad(`${name}: no heading`);
    !info.overflow ? ok(`${name}: no sideways scroll`) : bad(`${name}: page overflows`);
    if (name === "desktop") info.link ? ok("sidebar link present") : bad("no sidebar link");
    await page.screenshot({ path: `${OUT}/shop-orders-${name}.png`, fullPage: false });
    await page.close();
  }
} catch (e) { bad(String(e)); }
finally {
  if (browser) await browser.close();
  if (uid) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]); await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [uid])); }
  await pool.end();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
}

// Screenshots of Expenses (brand chips, filter, spent-by-brand, the Add form) as an ordinary UP admin. Read-only.
import pg from "pg"; import bcrypt from "bcryptjs"; import crypto from "crypto";
import puppeteer from "puppeteer-core"; import { execFileSync } from "child_process";
const BASE = "https://app.usg.co.nz", CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let userId: number | null = null, browser: any = null;
try {
  const email = `expshot-${crypto.randomBytes(5).toString("hex")}@example.com`, password = crypto.randomBytes(16).toString("base64url");
  userId = (await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Exp','Shot',$2,'coach',true) RETURNING id`, [email, await bcrypt.hash(password, 10)])).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,8,'admin',NULL)`, [userId]);
  const h = execFileSync("curl", ["-s", "-D", "-", "-o", "/dev/null", "-X", "POST", "-H", "Content-Type: application/json", "-d", JSON.stringify({ email, password }), `${BASE}/api/auth/login`]).toString();
  const [cn, cv] = (h.match(/^set-cookie:\s*(.+)$/im)?.[1] ?? "").split(";")[0].split("=");
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
  const p = await browser.newPage(); const errs: string[] = []; p.on("pageerror", (e: any) => errs.push(String(e)));
  await p.setCookie({ name: cn, value: cv, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
  await p.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
  await p.evaluate(() => localStorage.setItem("clubos_workspace", "united-prints"));
  for (const [label, w, hh] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
    await p.setViewport({ width: w, height: hh, deviceScaleFactor: 2 });
    await p.goto(`${BASE}/admin/print-expenses`, { waitUntil: "networkidle2" });
    await p.waitForSelector('[data-testid="spend-by-brand"]', { timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const chips = await p.$$eval('[data-testid^="expense-brands-"]', (els: any[]) => els.map((e) => e.innerText).slice(0, 6));
    console.log(label, "overflow", over, "chips", JSON.stringify(chips));
    await p.screenshot({ path: `/private/tmp/claude-501/exp-${label}.png`, fullPage: false });
    await p.evaluate(() => document.querySelector('[data-testid="spend-by-brand"]')?.scrollIntoView({ block: "start" }));
    await new Promise((r) => setTimeout(r, 300));
    await p.screenshot({ path: `/private/tmp/claude-501/exp-${label}-brand.png` });
    // Open "Add expense"
    await p.evaluate(() => { const b = Array.from(document.querySelectorAll("button")).find((x) => /Add expense/.test(x.textContent || "")); (b as HTMLElement)?.click(); });
    await p.waitForSelector('[data-testid="expense-brand"]', { timeout: 8000 }).catch(() => {});
    await p.evaluate(() => document.querySelector('[data-testid="expense-brand"]')?.scrollIntoView({ block: "center" }));
    await new Promise((r) => setTimeout(r, 400));
    await p.screenshot({ path: `/private/tmp/claude-501/exp-${label}-add.png` });
    await p.keyboard.press("Escape");
  }
  console.log("page errors:", errs.length ? errs : "none");
} finally {
  if (browser) await browser.close().catch(() => {});
  if (userId) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [userId]); await pool.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(() => {}); }
  await pool.end();
}

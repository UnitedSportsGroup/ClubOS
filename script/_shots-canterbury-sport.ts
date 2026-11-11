// Read-only screenshots of the Canterbury Sport tab as user 1 (the only named user).
// Mints a short-lived session row for user 1, signs it, screenshots, deletes it.
import { Pool } from "pg";
import crypto from "crypto";
import puppeteer from "puppeteer-core";
const OUT = process.argv[2];
const BASE = "https://app.usg.co.nz";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sid = "shot-" + crypto.randomBytes(18).toString("hex");
const expire = new Date(Date.now() + 15 * 60 * 1000);
await pool.query(`INSERT INTO session (sid, sess, expire) VALUES ($1,$2,$3)`,
  [sid, JSON.stringify({ cookie: { originalMaxAge: 900000, expires: expire.toISOString(), httpOnly: true, path: "/" }, userId: 1 }), expire]);
const sig = crypto.createHmac("sha256", process.env.SESSION_SECRET!).update(sid).digest("base64").replace(/=+$/, "");
const cookie = { name: "connect.sid", value: encodeURIComponent("s:" + sid + "." + sig), domain: "app.usg.co.nz", path: "/" };
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const problems: string[] = [];
try {
  for (const [w, h, tag] of [[1440, 900, "desktop"], [390, 844, "phone"]] as const) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.setCookie(cookie);
    page.on("pageerror", (e) => problems.push(`${tag} pageerror: ${e.message}`));
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem("clubos_workspace", "sandbox"); } catch {} });
    for (const view of ["overview", "costs", "ongoing", "loans", "breakeven", "cash", "club"]) {
      await page.goto(`${BASE}/admin/canterbury-sport#${view}`, { waitUntil: "networkidle2" });
      await new Promise((r) => setTimeout(r, 2500));
      const info = await page.evaluate(() => ({
        text: document.body.innerText.length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        err: /something went wrong|not found|404/i.test(document.body.innerText.slice(0, 2000)),
      }));
      if (info.text < 300 || info.err || info.overflow > 1) problems.push(`${tag} ${view}: text=${info.text} overflow=${info.overflow} err=${info.err}`);
      await page.screenshot({ path: `${OUT}/${tag}-${view}.png`, fullPage: false });
    }
    await page.close();
    // USG dashboard: Rambo only (fresh page, so the sandbox preset does not reapply)
    const page2 = await browser.newPage();
    await page2.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page2.setCookie(cookie);
    await page2.evaluateOnNewDocument(() => { try { localStorage.setItem("clubos_workspace", "united-sports-group"); } catch {} });
    await page2.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 2500));
    await page2.screenshot({ path: `${OUT}/${tag}-usg-dashboard.png` });
    await page2.close();
  }
} finally {
  await browser.close();
  await pool.query(`DELETE FROM session WHERE sid = $1`, [sid]);
  await pool.end();
}
console.log(problems.length ? problems.join("\n") : "no problems detected");

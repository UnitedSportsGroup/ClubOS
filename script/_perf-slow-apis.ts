/**
 * _perf-slow-apis.ts — which data calls make which ClubOS pages slow?
 * Opens the main admin pages on production as a throwaway CUFC workspace admin
 * and lists every /api call that took > 500ms, slowest first. Deletes the user.
 *   npx tsx --env-file=.env script/_perf-slow-apis.ts
 */
import puppeteer from "puppeteer-core";
import pg from "pg";
import bcrypt from "bcryptjs";
const BASE = "https://app.usg.co.nz";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const email = `_perf_${Date.now()}@usg.co.nz`;
const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
const { rows } = await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Perf','Check',$2,'admin',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
const uid = rows[0].id;
await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,1,'admin',NULL)`, [uid]);
const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
const [cn, cv] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
const { rows: pr } = await pool.query(`select id from contacts where type='guardian' order by id desc limit 1`);
const PAGES = ["/admin", "/admin/registrations", "/admin/contacts", `/admin/people/contact-${pr[0]?.id}`, "/admin/academy", "/admin/camps", "/admin/mailer", "/admin/chat", "/admin/task-tracker", "/admin/knowledge-base", "/admin/squads", "/admin/programs", "/admin/club-events", "/admin/store"];
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox"] });
const slow: { page: string; api: string; ms: number; kb: number }[] = [];
const pageTimes: string[] = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ name: cn, value: cv, domain: "app.usg.co.nz", path: "/", secure: true, httpOnly: true });
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  const starts = new Map<string, { url: string; t: number }>();
  let current = "";
  cdp.on("Network.requestWillBeSent", (e: any) => { if (e.request.url.includes("/api/")) starts.set(e.requestId, { url: e.request.url, t: e.timestamp }); });
  cdp.on("Network.loadingFinished", (e: any) => {
    const s = starts.get(e.requestId);
    if (!s) return;
    const ms = Math.round((e.timestamp - s.t) * 1000);
    if (ms > 500) slow.push({ page: current, api: s.url.replace(BASE, "").slice(0, 90), ms, kb: Math.round(e.encodedDataLength / 1024) });
  });
  for (const p of PAGES) {
    current = p;
    const t0 = Date.now();
    await page.goto(BASE + p, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => undefined);
    pageTimes.push(`${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(5)}s  ${p}`);
  }
} finally {
  await browser.close();
  await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]);
  await pool.query(`DELETE FROM users WHERE id=$1`, [uid]);
  await pool.end();
}
console.log("Page until network quiet (desktop, no throttle):");
pageTimes.forEach((l) => console.log("  " + l));
console.log("\nData calls over 500ms, slowest first:");
slow.sort((a, b) => b.ms - a.ms).slice(0, 25).forEach((s) => console.log(`  ${String(s.ms).padStart(6)}ms ${String(s.kb).padStart(6)}KB  ${s.api}   ← ${s.page}`));

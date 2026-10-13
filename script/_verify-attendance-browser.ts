// Attendance tab (coaches' roll, live from coach.cufc.co.nz), the reshaped
// programme tabs, and Price history — Daniel, 2026-10-14. Real Chrome, as an
// ORDINARY CUFC admin (not a super admin). Read-only; the probe user is deleted.
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
  const email = `_att_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  uid = (await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Att','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)])).rows[0].id;
  const org = (await pool.query(`SELECT id FROM organizations WHERE slug='christchurch-united'`)).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [uid, org]);
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const [n, v] = (res.headers.get("set-cookie") || "").split(";")[0].split("=");
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const errors: string[] = [];
  const open = async (path: string, w = 1440, h = 900) => {
    const page = await browser.newPage(); await page.setViewport({ width: w, height: h });
    page.on("pageerror", (e: any) => errors.push(String(e.message).slice(0, 140)));
    await page.setCookie({ name: n, value: v, domain: new URL(BASE).hostname, path: "/" });
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
    return page;
  };
  const tabs = async (page: any) => page.$$eval('[data-testid^="tab-"]', (els: any[]) => els.map(e => e.textContent.trim()));

  for (const [w, h] of [[1440, 900], [390, 844]]) {
    // Pre-Academy: Attendance replaces Sessions, team first, training groups only.
    let p = await open(`/admin/academy/16#sessions`, w, h);
    await p.waitForSelector('[data-testid="attendance-teams"]', { timeout: 30000 }).catch(() => {});
    await settle();
    const t16 = await tabs(p);
    ok(`${w}px Pre-Academy tabs: Attendance, no Sessions/Content/Discounts`, t16.includes("Attendance") && !t16.includes("Sessions") && !t16.includes("Content") && !t16.includes("Discounts"), t16.join(" · "));
    const cards = await p.$$eval('[data-testid^="attendance-team-"]', (els: any[]) => els.map(e => e.textContent));
    ok(`${w}px Pre-Academy Term 4 shows only training groups`, cards.length >= 3 && cards.every((c: string) => /Training Group/.test(c)), `${cards.length}: ${cards.map((c: string) => c.slice(0, 18)).join(" | ")}`);
    ok(`${w}px follow-up list shows`, !!(await p.$('[data-testid="attendance-followups"]')));
    await p.screenshot({ path: `${OUT}/att-pre-teams-${w}.png`, fullPage: true });
    const first = await p.$('[data-testid^="attendance-team-"]'); await first?.click(); await settle(1200);
    await p.click('[data-testid="attendance-mode-sessions"]').catch(() => {});
    const pastBtn = await p.$$('[data-testid="attendance-when"] button'); await pastBtn[1]?.click(); await settle(600);
    const sessions = await p.$$('[data-testid="attendance-session"]');
    ok(`${w}px team → Sessions lists past sessions`, sessions.length > 0, String(sessions.length));
    await p.screenshot({ path: `${OUT}/att-pre-sessions-${w}.png`, fullPage: true });
    await p.click('[data-testid="attendance-mode-players"]'); await settle(800);
    ok(`${w}px team → Players · history grid`, !!(await p.$('[data-testid="attendance-team"] table')));
    await p.screenshot({ path: `${OUT}/att-pre-players-${w}.png`, fullPage: true });
    const sw = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`${w}px no sideways page scroll`, sw <= 1, String(sw));
    await p.close();

    // Academy: Term 4 squads appear even with no ClubOS registrations.
    p = await open(`/admin/academy/17#sessions`, w, h);
    await p.waitForSelector('[data-testid="attendance-teams"]', { timeout: 30000 }).catch(() => {});
    await settle();
    const a = await p.$$eval('[data-testid^="attendance-team-"]', (els: any[]) => els.map(e => e.textContent));
    ok(`${w}px Academy Term 4 lists its squads`, a.some((c: string) => /U13 Blue/.test(c)) && a.some((c: string) => /U15 Academy/.test(c)), a.map((c: string) => c.slice(0, 14)).join(" | "));
    ok(`${w}px Academy says Term 4 regs aren't in ClubOS`, !!(await p.$('[data-testid="attendance-no-regs"]')));
    await p.close();

    // FUNiño: Sessions renamed Attendance, still the ClubOS session list.
    p = await open(`/admin/academy/4#sessions`, w, h);
    await p.waitForSelector('[data-testid="sessions-filter-terms"]', { timeout: 30000 }).catch(() => {});
    const t4 = await tabs(p);
    ok(`${w}px FUNiño tab reads Attendance and shows its session list`, t4.includes("Attendance") && !t4.includes("Sessions") && !!(await p.$('[data-testid="sessions-filter-terms"]')), t4.join(" · "));
    await p.close();

    // Price history under Pricing.
    p = await open(`/admin/academy/4#pricing`, w, h);
    await p.waitForSelector('[data-testid="price-history"]', { timeout: 30000 }).catch(() => {});
    await settle(800);
    await p.click('[data-testid="price-year-all"]').catch(() => {}); await settle(500);
    const txt = await p.$eval('[data-testid="price-history"]', (e: any) => e.innerText).catch(() => "");
    ok(`${w}px FUNiño price history: $130 → $150 → $160`, /\$130/.test(txt) && /\$150/.test(txt) && /\$160/.test(txt));
    await p.screenshot({ path: `${OUT}/price-history-${w}.png`, fullPage: true });
    await p.close();
  }

  // Mailer: no send history list, a link instead.
  const m = await open(`/admin/mailer`);
  await settle(3000);
  ok("Mailer: no Send History list on the main page", !(await m.$('[data-testid="input-search-campaigns"]')));

  await m.close();
  ok("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser?.close();
  if (uid) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]); await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [uid])); }
  await pool.end();
  console.log(fail ? `${fail} FAILED` : "all passed"); process.exit(fail ? 1 : 0);
}

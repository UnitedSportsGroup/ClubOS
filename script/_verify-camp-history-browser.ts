// The holiday camp History tab, in a real browser on production.
//   npx tsx --env-file=.env script/_verify-camp-history-browser.ts
// Throwaway super-admin in the CUFC workspace, deleted in `finally`.
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import puppeteer from "puppeteer-core";
import { execFileSync } from "child_process";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = "https://app.usg.co.nz";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0; const fails: string[] = [];
const ok = (l: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fails.push(l); console.log(`  ✗ ${l} ${d}`); } };
let userId: number | null = null; let browser: any = null;
try {
  const camp = (await pool.query(`SELECT id, organization_id FROM programs WHERE type='holiday_camp' AND name ILIKE 'World Cup Holiday Camp%' ORDER BY start_date DESC LIMIT 1`)).rows[0];
  const org = (await pool.query(`SELECT slug FROM organizations WHERE id=$1`, [camp.organization_id])).rows[0];
  const email = `historyprobe-${crypto.randomBytes(5).toString("hex")}@example.com`;
  const password = crypto.randomBytes(16).toString("base64url");
  userId = (await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'History','Probe',$2,'super_admin',true) RETURNING id`, [email, await bcrypt.hash(password, 10)])).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`, [userId, camp.organization_id]);
  const headers = execFileSync("curl", ["-s", "-D", "-", "-o", "/dev/null", "--max-time", "30", "-X", "POST", "-H", "Content-Type: application/json", "-d", JSON.stringify({ email, password }), `${BASE}/api/auth/login`]).toString();
  const [cname, cvalue] = (headers.match(/^set-cookie:\s*(.+)$/im)?.[1] ?? "").split(";")[0].split("=");
  ok("logged in", !!cname);
  const outDir = join(process.cwd(), "..", "..", "..", "..", "outputs", "ui-preflight", "clubos-camp-history");
  mkdirSync(outDir, { recursive: true });
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  for (const [label, w, h] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
    const page = await browser.newPage();
    const errors: string[] = []; page.on("pageerror", (e: any) => errors.push(String(e)));
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    await page.setCookie({ name: cname, value: cvalue, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), org.slug);
    await page.goto(`${BASE}/admin/camps/${camp.id}#history`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector('[data-testid="history-table"]', { timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    const d = await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-testid^="history-row-"]');
      const years = document.querySelectorAll('[data-testid="history-years"] tbody tr');
      const bars = document.querySelectorAll('[data-testid="history-chart"] .recharts-bar-rectangle').length;
      return { rows: rows.length, first: (rows[0] as HTMLElement)?.innerText ?? "", years: years.length, bars,
        doc: document.documentElement.scrollWidth, vw: window.innerWidth, text: document.body.innerText };
    });
    ok(`${label}: no page errors`, errors.length === 0, errors.join(" | "));
    ok(`${label}: History tab opens from #history`, /Every holiday camp we have records for/.test(d.text));
    ok(`${label}: opens on this camp's series (World Cup)`, !!(await page.$('[data-testid="history-filter-world_cup"].font-semibold')));
    ok(`${label}: World Cup holidays listed`, d.rows >= 4, String(d.rows));
    ok(`${label}: newest first, still-selling marked`, /Sep–Oct 2026[\s\S]*still selling/i.test(d.first), d.first.slice(0, 60));
    ok(`${label}: chart draws bars`, d.bars >= 4, String(d.bars));
    ok(`${label}: yearly Xero check has rows`, d.years >= 8, String(d.years));
    ok(`${label}: no sideways scroll`, d.doc <= d.vw + 1, `${d.doc} vs ${d.vw}`);
    await page.click('[data-testid="history-filter-all"]');
    await new Promise((r) => setTimeout(r, 600));
    const all = await page.evaluate(() => document.querySelectorAll('[data-testid^="history-row-"]').length);
    ok(`${label}: All holiday camps reaches back further`, all > d.rows, `${all} vs ${d.rows}`);
    const oldest = await page.evaluate(() => { const r = document.querySelectorAll('[data-testid^="history-row-"]'); return (r[r.length - 1] as HTMLElement)?.innerText ?? ""; });
    ok(`${label}: oldest holiday is 2017`, /2017/.test(oldest), oldest.slice(0, 30));
    await page.evaluate(() => (document.querySelector('[data-testid="history-method"]') as HTMLDetailsElement).open = true);
    await page.screenshot({ path: join(outDir, `${label}.png`), fullPage: label === "desktop" });
    await page.close();
  }
} catch (e: any) { fails.push(`threw ${e?.message}`); console.log(e); }
finally {
  if (browser) await browser.close().catch(() => {});
  if (userId) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [userId]); await pool.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [userId])); }
  await pool.end(); console.log(`\n${pass} passed, ${fails.length} failed`); if (fails.length) process.exit(1);
}

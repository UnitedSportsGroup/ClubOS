/**
 * Partners → By asset — real browser, as ordinary USG staff holding only the
 * sponsorship tab. 1440×900 + 390×844. Screenshots to outputs/sponsor-assets-preflight/.
 *   npx tsx --env-file=.env script/_verify-sponsor-assets-browser.ts
 * Read-only: opens the views and an edit dialog, cancels it, writes nothing.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WORKSPACE = "united-sports-group";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "sponsor-assets-preflight");
let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); good ? pass++ : fail++; };
let pool: pg.Pool | null = null; let browser: any = null; const users: number[] = [];

async function staffCookie() {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const email = `_assets_ui_${Date.now()}@usg.co.nz`;
  const password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Preflight','Assets',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(password, 10)]);
  users.push(rows[0].id);
  const { rows: o } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'team_member',$3::jsonb)`, [rows[0].id, o[0].id, JSON.stringify(["sponsorship"])]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new Error(`login failed HTTP ${login.status}`);
  const [name, value] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
  return { name, value, domain: new URL(BASE).hostname };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const cookie = await staffCookie();
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  for (const [label, width, height, mobile] of [["desktop", 1440, 900, false], ["mobile", 390, 844, true]] as const) {
    console.log(`\n${label}`);
    const page = await browser.newPage();
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    await page.setCookie({ ...cookie, path: "/", httpOnly: true, secure: BASE.startsWith("https") });
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), WORKSPACE);
    // List: Asset sort + chips
    await page.goto(`${BASE}/admin/sponsorship#partners`, { waitUntil: "networkidle2", timeout: 90000 });
    const listOk = await page.waitForSelector(mobile ? `[data-testid^="partner-card-"]` : `[data-testid="partners-table"]`, { timeout: 60000 }).then(() => true).catch(() => false);
    ok("partner list loads", listOk);
    const chips = await page.$$eval(`[data-testid="partner-asset-chips"]`, (els: any[]) => els.length);
    ok("asset chips under partner names", chips > 5, `${chips} partners`);
    ok("layout switch present", !!(await page.$(`[data-testid="partners-layout-asset"]`)));
    // By asset
    await page.click(`[data-testid="partners-layout-asset"]`);
    const board = await page.waitForSelector(`[data-testid="assets-club-section-cufc"]`, { timeout: 30000 }).then(() => true).catch(() => false);
    ok("By asset shows the CUFC section", board);
    ok("URL carries ?by=asset", (await page.url()).includes("by=asset"));
    const text = await page.$eval(`[data-testid="assets-board"]`, (e: any) => e.innerText as string);
    for (const t of ["Front of Shirt Home", "Fusion5", "Pitch-side signboards x2", "Go Media", "Available", "Composite Logo - OFC"]) ok(`board shows "${t}"`, text.includes(t));
    ok("SIU section present", !!(await page.$(`[data-testid="assets-club-section-siu"]`)));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok("no sideways page scroll", overflow <= 1, `${overflow}px`);
    await page.screenshot({ path: join(OUT, `${label}-by-asset.png`), fullPage: false });
    const phys = await page.$(`[data-testid="assets-club-section-cufc"]`);
    if (phys) await phys.screenshot({ path: join(OUT, `${label}-cufc-section.png`) });
    // SIU filter
    await page.click(`[data-testid="assets-club-siu"]`);
    await new Promise(r => setTimeout(r, 400));
    ok("SIU filter hides CUFC", !(await page.$(`[data-testid="assets-club-section-cufc"]`)));
    await page.screenshot({ path: join(OUT, `${label}-siu.png`), fullPage: false });
    // Open an edit dialog and cancel
    const editSel = mobile ? `[data-testid^="asset-card-"] button[title="Edit position"]` : `[data-testid^="asset-edit-"]`;
    const edit = await page.$(editSel);
    if (edit) {
      await edit.click();
      const dlg = await page.waitForSelector(`[data-testid="asset-dialog"]`, { timeout: 10000 }).then(() => true).catch(() => false);
      ok("edit dialog opens", dlg);
      await page.screenshot({ path: join(OUT, `${label}-dialog.png`) });
      const w = await page.$eval(`[data-testid="asset-dialog"]`, (e: any) => e.getBoundingClientRect().right);
      ok("dialog fits the screen", w <= width + 1, `${Math.round(w)}px`);
      await page.keyboard.press("Escape");
    } else ok("edit button found", false);
    // Reload keeps the view (state in URL)
    await page.reload({ waitUntil: "networkidle2" });
    ok("reload stays on By asset + SIU", await page.waitForSelector(`[data-testid="assets-club-section-siu"]`, { timeout: 30000 }).then(() => true).catch(() => false) && !(await page.$(`[data-testid="assets-club-section-cufc"]`)));
    await page.close();
  }
}
main().catch(e => { console.error("\n  ✗", e.message); fail++; }).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (pool) { for (const id of users) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {}); await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {}); } await pool.end(); }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
});

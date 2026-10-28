/**
 * Registrations → Remove + Removed entries, on the LIVE site, as ordinary staff
 * shaped like Travis (CUFC admin, tabs NULL, NOT a super admin).
 *
 *   npx tsx --env-file=.env script/_verify-registration-removal-browser.ts [removedRegId] [cardPaidRegId]
 *
 * 🔴 It WRITES NOTHING to a registration. Removal events are append-only and
 * RESTRICT their user and registration, so a probe removal would leave a
 * permanent row in the club's audit trail. Every server check below is one the
 * server must REFUSE; the browser opens the remove panel and cancels it.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "https://app.usg.co.nz";
const EMAIL = "reg-removal-probe@example.com"; // RFC 2606, undeliverable
const PASSWORD = crypto.randomBytes(24).toString("base64url");
const WORKSPACE = "christchurch-united";
const REMOVED_ID = Number(process.argv[2] ?? 3023);
const CARD_ID = Number(process.argv[3] ?? 25);
const OFFICE_ID = Number(process.argv[4] ?? 3021); // opened and CANCELLED, never removed

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "✓" : "✗"} ${l}${d ? ` — ${d}` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let userId: number | null = null;
let browser: any = null;

try {
  const before = (await pool.query(`SELECT count(*)::int n FROM registration_removal_events`)).rows[0].n;
  const statusBefore = (await pool.query(`SELECT id, status::text FROM registrations WHERE id = ANY($1) ORDER BY id`, [[REMOVED_ID, CARD_ID]])).rows;

  const hash = await bcrypt.hash(PASSWORD, 10);
  userId = (await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'Removal','Probe',$2,'admin',true) RETURNING id`, [EMAIL, hash])).rows[0].id;
  const org = (await pool.query(`SELECT id FROM organizations WHERE slug = $1`, [WORKSPACE])).rows[0];
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`, [userId, org.id]);
  console.log(`\nthrowaway user #${userId} — CUFC admin, tabs NULL, NOT a super admin\n`);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`login failed: HTTP ${login.status}`);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const api = (method: string, path: string, body?: unknown) => fetch(`${BASE}${path}`, {
    method, headers: { Cookie: cookie, "Content-Type": "application/json", "X-Workspace-Slug": WORKSPACE },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  console.log("  server — every one of these must be REFUSED");
  let r = await api("DELETE", `/api/admin/registrations/${REMOVED_ID}`, {});
  ok("no reason → 400", r.status === 400, `HTTP ${r.status}`);
  r = await api("DELETE", `/api/admin/registrations/${REMOVED_ID}`, { reason: "probe — must be refused" });
  ok("already removed → 409", r.status === 409, `HTTP ${r.status} ${(await r.json().catch(() => ({}))).message ?? ""}`);
  r = await api("DELETE", `/api/admin/registrations/${CARD_ID}`, { reason: "probe — must be refused" });
  ok("card-paid online registration → 409 (refund instead)", r.status === 409, `HTTP ${r.status}`);
  r = await api("DELETE", `/api/admin/registrations/999999999`, { reason: "probe — must be refused" });
  ok("unknown id → 404", r.status === 404, `HTTP ${r.status}`);
  r = await api("GET", `/api/admin/registrations/removed`);
  const trail: any[] = r.ok ? await r.json() : [];
  ok("staff can read the trail", r.status === 200, `HTTP ${r.status}, ${trail.length} event(s)`);
  ok("the trail names who removed it", trail.some((e) => e.registration_id === REMOVED_ID && e.action === "removed" && e.user_name),
    trail.find((e) => e.registration_id === REMOVED_ID)?.user_name ?? "missing");
  r = await fetch(`${BASE}/api/admin/registrations/removed`, { headers: { "X-Workspace-Slug": WORKSPACE } });
  ok("signed out → 401", r.status === 401, `HTTP ${r.status}`);

  const outDir = join(process.cwd(), "..", "..", "..", "..", "outputs", "ui-preflight", "clubos-registration-removal");
  mkdirSync(outDir, { recursive: true });
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const [cname, cvalue] = cookie.split("=");

  for (const [label, width, height, mobile] of [["desktop", 1440, 900, false], ["mobile", 390, 844, true]] as const) {
    console.log(`\n  browser ${label} (${width}×${height})`);
    const page = await browser.newPage();
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    const errors: string[] = [];
    page.on("pageerror", (e: any) => errors.push(String(e?.message ?? e)));
    await page.setCookie({ name: cname, value: cvalue, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((slug: string) => localStorage.setItem("clubos_workspace", slug), WORKSPACE);
    await page.goto(`${BASE}/admin/registrations`, { waitUntil: "networkidle2", timeout: 90000 });
    await page.waitForSelector('[data-testid="button-open-removed-entries"]', { timeout: 30000 });

    // The Removed entries dialog
    await page.click('[data-testid="button-open-removed-entries"]');
    await page.waitForSelector('[data-testid="list-removed-entries"], [data-testid="text-removed-empty"]', { timeout: 20000 });
    const dialog = await page.evaluate(() => (document.querySelector('[role="dialog"]') as HTMLElement)?.innerText ?? "");
    ok("dialog shows the removed child", /Eliezer Siu/.test(dialog), dialog.slice(0, 120).replace(/\n/g, " | "));
    ok("dialog shows who removed it", /Removed\s+by\s+Daniel Meyn/i.test(dialog));
    ok("dialog shows the reason", /Entered twice by mistake/.test(dialog));
    ok("dialog offers Put back", !!(await page.$(`[data-testid="button-restore-reg-${REMOVED_ID}"]`)));
    const dlgBox = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]') as HTMLElement; const b = d.getBoundingClientRect(); return { l: b.left, r: b.right, w: window.innerWidth }; });
    ok("dialog fits the screen", dlgBox.l >= 0 && dlgBox.r <= dlgBox.w + 0.5, JSON.stringify(dlgBox));
    await sleep(700); // let the dialog's open animation finish before the picture
    await page.screenshot({ path: join(outDir, `${label}-removed-dialog.png`) });
    await page.keyboard.press("Escape");
    await sleep(600);

    // Expand the first registration and open the remove panel — then CANCEL.
    const officeRow = await page.waitForSelector(`[data-testid="row-registration-${OFFICE_ID}"]`, { timeout: 30000 }).catch(() => null);
    ok(`office registration #${OFFICE_ID} is on the page`, !!officeRow);
    if (officeRow) { await officeRow.evaluate((el: any) => el.scrollIntoView({ block: "center" })); await officeRow.click(); }
    await sleep(1200);
    const removeBtn = await page.$(`[data-testid="button-delete-reg-${OFFICE_ID}"]`);
    ok("an office EFTPOS registration offers Remove", !!removeBtn);
    if (removeBtn) {
      await removeBtn.click();
      await page.waitForSelector('[data-testid^="panel-remove-reg-"]', { timeout: 5000 });
      const confirmDisabled = await page.$eval('[data-testid^="button-confirm-delete-reg-"]', (b: any) => b.disabled);
      ok("Remove is disabled until a reason is given", confirmDisabled === true);
      await page.click('[data-testid="chip-remove-reason-entered"]');
      const nowEnabled = await page.$eval('[data-testid^="button-confirm-delete-reg-"]', (b: any) => !b.disabled);
      ok("picking a reason enables Remove", nowEnabled === true);
      const panel = await page.$eval('[data-testid^="panel-remove-reg-"]', (el: any) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, w: window.innerWidth }; });
      ok("the panel fits the screen", panel.l >= 0 && panel.r <= panel.w + 0.5, JSON.stringify(panel));
      await page.evaluate(() => (document.querySelector('[data-testid^="panel-remove-reg-"]') as HTMLElement)?.scrollIntoView({ block: "center" }));
      await sleep(300);
      await page.screenshot({ path: join(outDir, `${label}-remove-panel.png`) });
      await page.click('[data-testid^="button-cancel-delete-reg-"]'); // never submit
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok("no sideways scroll", overflow <= 1, `${overflow}px`);
    ok("no runtime errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
  }

  const after = (await pool.query(`SELECT count(*)::int n FROM registration_removal_events`)).rows[0].n;
  const statusAfter = (await pool.query(`SELECT id, status::text FROM registrations WHERE id = ANY($1) ORDER BY id`, [[REMOVED_ID, CARD_ID]])).rows;
  console.log("");
  ok("nothing was written to the trail", after === before, `${before} → ${after}`);
  ok("no registration changed", JSON.stringify(statusBefore) === JSON.stringify(statusAfter), JSON.stringify(statusAfter));
  console.log(`\nscreenshots → outputs/ui-preflight/clubos-registration-removal/`);
} finally {
  if (browser) await browser.close();
  if (userId) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    console.log(`cleaned up throwaway user #${userId}`);
  }
  await pool.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

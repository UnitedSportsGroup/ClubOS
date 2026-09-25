/**
 * Football in Schools pipeline — live checks against production.
 *
 *   npx tsx --env-file=.env script/_verify-fis-pipeline-live.ts
 *
 * 🔴 Signs in as a user shaped EXACTLY like Connor — team_member in CUFC with
 * only the football-in-schools tab — never a super admin, plus a CUFC admin (the
 * Academy row) and a Mini Football admin (the gate). Tests run on a throwaway
 * lead, deleted on the way out with the users, pass or fail.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";

const BASE = process.env.FIS_CHECK_BASE || "https://app.usg.co.nz";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CUFC = "christchurch-united";
const USG = "united-sports-group";
const SHOTS = "../../../../outputs/ui-preflight";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let failed = 0;
const is = (good: boolean, m: string, d = "") => {
  if (!good) failed++;
  console.log(`  ${good ? "ok  " : "FAIL"} ${m}${d ? ` — ${d}` : ""}`);
};
const users: number[] = [];
let leadId: number | null = null;
let browser: any = null;

async function makeUser(label: string, orgSlug: string, role: string, tabs: string[] | null) {
  const email = `_fis_${label}_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows: u } = await pool.query(
    `INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Verify',$2,$3,'team_member',true) RETURNING id`,
    [email, label, await bcrypt.hash(pw, 10)]);
  users.push(u[0].id);
  const { rows: o } = await pool.query(`SELECT id FROM organizations WHERE slug = $1`, [orgSlug]);
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,$3,$4)`,
    [u[0].id, o[0].id, role, tabs === null ? null : JSON.stringify(tabs)]);
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  return { id: u[0].id as number, ok: login.ok, cookie: (login.headers.get("set-cookie") || "").split(";")[0] };
}

async function shoot(cookie: string, path: string, ready: string, size: { w: number; h: number }, ws = CUFC) {
  const page = await browser.newPage();
  await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 2, isMobile: size.w < 500 });
  const [cn, cv] = cookie.split("=");
  await page.setCookie({ name: cn, value: cv, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
  await page.evaluateOnNewDocument((ws: string) => { try { localStorage.setItem("clubos_workspace", ws); } catch {} }, ws);
  const errors: string[] = [];
  page.on("pageerror", (e: any) => errors.push(String(e)));
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
  await page.waitForSelector(ready, { timeout: 20000 }).catch(() => {});
  return { page, errors };
}

try {
  console.log(`\nFootball in Schools pipeline — live against ${BASE}\n`);
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [CUFC]);
  const { rows: tl } = await pool.query(`INSERT INTO fis_leads (organization_id,kind,slug,name,suburb,phone,email,contact_name)
    VALUES ($1,'school','__verify_${Date.now()}','VERIFY Test School','Nowhere','03 000 0000','verify@footvault.com','Test Person') RETURNING id`, [org[0].id]);
  leadId = tl[0].id;

  const anon = await fetch(`${BASE}/api/admin/fis/leads`);
  is(anon.status === 401, "anonymous caller refused", String(anon.status));

  // Connor's real shape: USG team_member holding only this tab, NO CUFC seat.
  const connor = await makeUser("connorshape", USG, "team_member", ["football-in-schools"]);
  is(connor.ok, "a Connor-shaped account (USG, only this tab) can sign in");
  const WS = { cookie: connor.cookie, "X-Workspace-Slug": USG, "Content-Type": "application/json" };
  const asCufc = await fetch(`${BASE}/api/admin/fis/leads`, { headers: { cookie: connor.cookie, "X-Workspace-Slug": CUFC } });
  is(asCufc.status === 403, "…and holds no CUFC seat (claiming CUFC is refused)", String(asCufc.status));
  const regs = await fetch(`${BASE}/api/admin/registrations`, { headers: WS });
  is((await regs.text()).length < 100, "…so the CUFC registrations list stays out of reach");

  const mfl = await makeUser("mfl", "mini-football-leagues", "admin", null);
  const mflOwn = await fetch(`${BASE}/api/admin/fis/leads`, { headers: { cookie: mfl.cookie, "X-Workspace-Slug": "mini-football-leagues" } });
  is(mflOwn.status === 404, "an MFL admin in their own workspace gets 404", String(mflOwn.status));
  const mflCufc = await fetch(`${BASE}/api/admin/fis/leads`, { headers: { cookie: mfl.cookie, "X-Workspace-Slug": CUFC } });
  is(mflCufc.status === 403, "an MFL admin claiming CUFC gets 403", String(mflCufc.status));

  const board = await fetch(`${BASE}/api/admin/fis/leads`, { headers: WS });
  const body: any = await board.json().catch(() => ({}));
  is(board.status === 200, "Connor-shaped staff can read the pipeline", String(board.status));
  const real = (body?.leads || []).filter((l: any) => !String(l.slug).startsWith("__verify"));
  is(real.filter((l: any) => l.kind === "school").length === 44, "all 44 schools are there", String(real.filter((l: any) => l.kind === "school").length));
  is(real.filter((l: any) => l.kind === "elc").length === 115, "all 115 early learning centres are there", String(real.filter((l: any) => l.kind === "elc").length));
  is(body?.team?.some((t: any) => t.id === connor.id), "Connor-shaped user can be an owner");


  const patch = (j: any) => fetch(`${BASE}/api/admin/fis/leads/${leadId}`, { method: "PATCH", headers: WS, body: JSON.stringify(j) });
  const log = (j: any) => fetch(`${BASE}/api/admin/fis/leads/${leadId}/activities`, { method: "POST", headers: WS, body: JSON.stringify(j) });
  let r = await log({ quick: "emailed" });
  is(r.status === 200, "log 'Emailed the page'", String(r.status));
  let { rows: s } = await pool.query(`SELECT status, next_follow_up_on FROM fis_leads WHERE id=$1`, [leadId]);
  is(s[0].status === "contacted" && !!s[0].next_follow_up_on, "…moves New → Contacted and sets a follow-up", `${s[0].status} ${s[0].next_follow_up_on}`);
  r = await patch({ stage: "trial" });
  is(r.status === 200, "move to Free session", String(r.status));
  r = await log({ quick: "no_answer" });
  ({ rows: s } = await pool.query(`SELECT status FROM fis_leads WHERE id=$1`, [leadId]));
  is(s[0].status === "trial", "a quick log never moves a lead backwards", s[0].status);
  r = await patch({ stage: "not_now" });
  is(r.status === 400, "closing without a reason is refused", String(r.status));
  r = await patch({ stage: "not_now", closedReason: "has_provider" });
  is(r.status === 200, "Not now — happy with their provider", String(r.status));
  r = await patch({ contactName: "New Coordinator", ownerUserId: connor.id, priority: "hot" });
  is(r.status === 200, "contact, owner and priority can be edited", String(r.status));
  r = await log({ type: "note", note: "Principal wants Term 1" });
  const tlr = await fetch(`${BASE}/api/admin/fis/leads/${leadId}/activities`, { headers: WS });
  const acts: any[] = await tlr.json().catch(() => []);
  is(acts.length >= 5 && acts.every((a) => a.byName), "every touch is in the history with a name", `${acts.length}`);
  await patch({ stage: "new" });

  // ── in a real browser ─────────────────────────────────────────────────────
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  for (const size of [{ w: 1440, h: 900, label: "desktop" }, { w: 390, h: 844, label: "phone" }]) {
    const { page, errors } = await shoot(connor.cookie, "/admin/football-in-schools", '[data-testid^="fis-card-"]', size, USG);
    const cols = await page.$$eval('[data-testid^="fis-col-"]', (els: any[]) => els.length);
    is(cols === 7, `[${size.label}] seven open stages shown`, String(cols));
    const cards = await page.$$eval('[data-testid^="fis-card-"]', (els: any[]) => els.length);
    is(cards >= 150, `[${size.label}] the schools and centres are VISIBLE`, `${cards} cards`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    is(!overflow, `[${size.label}] no sideways page overflow`);
    // The phone's sidebar is a closed sheet, so only the desktop can see the link.
    if (size.label === "desktop") is(!!(await page.$('a[href="/admin/football-in-schools"]')), "[desktop] a sidebar link reaches it");
    await page.screenshot({ path: `${SHOTS}/fis-pipeline-${size.label}.png` });

    await page.click('[data-testid="fis-kind-elc"]');
    await new Promise((res) => setTimeout(res, 300));
    const elcCards = await page.$$eval('[data-testid^="fis-card-"]', (els: any[]) => els.length);
    is(elcCards > 100 && elcCards < cards, `[${size.label}] Early learning switch filters`, `${elcCards}`);
    await page.click('[data-testid="fis-kind-all"]');
    await page.type('[data-testid="fis-search"]', "VERIFY Test");
    await new Promise((res) => setTimeout(res, 400));
    const card = await page.$(`[data-testid="fis-card-${leadId}"]`);
    is(!!card, `[${size.label}] search finds the test school`);
    if (card) {
      await card.click();
      await page.waitForSelector('[data-testid="fis-timeline"]', { timeout: 10000 }).catch(() => {});
      await new Promise((res) => setTimeout(res, 700));
      const txt = await page.evaluate(() => (document.querySelector('[data-testid="fis-drawer"]') as HTMLElement)?.innerText || "");
      is(/Principal wants Term 1/.test(txt), `[${size.label}] the drawer shows the history`);
      is(/football-in-schools\//i.test(txt), `[${size.label}] the drawer shows their proposal page link`);
      const wide = await page.evaluate(() => {
        const d = document.querySelector('[data-testid="fis-drawer"]')!.getBoundingClientRect();
        return d.right > window.innerWidth + 1 ? `${Math.round(d.right)}>${window.innerWidth}` : "";
      });
      is(!wide, `[${size.label}] the drawer fits the screen`, wide);
      await page.screenshot({ path: `${SHOTS}/fis-pipeline-drawer-${size.label}.png` });
    }
    is(errors.length === 0, `[${size.label}] no runtime errors`, errors.join(" | "));
    await page.close();
  }

  // The Academy row, as a CUFC admin.
  const admin = await makeUser("cufcadmin", CUFC, "admin", null);
  const { page, errors } = await shoot(admin.cookie, "/admin/academy", '[data-testid="row-academy-football-in-schools"]', { w: 1440, h: 900 });
  const row = await page.$('[data-testid="row-academy-football-in-schools"]');
  is(!!row, "Academy → Additional Programs shows Football in Schools");
  if (row) {
    await row.evaluate((el: any) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${SHOTS}/fis-academy-row.png` });
    await row.click();
    await page.waitForSelector('[data-testid="fis-pipeline"]', { timeout: 10000 }).catch(() => {});
    is(page.url().endsWith("/admin/football-in-schools"), "clicking it opens the pipeline", page.url());
  }
  is(errors.length === 0, "no runtime errors on Academy", errors.join(" | "));
} catch (e: any) {
  is(false, "threw", e?.message || String(e));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (leadId) await pool.query(`DELETE FROM fis_leads WHERE id=$1`, [leadId]).catch(() => {});
  for (const id of users) {
    await pool.query(`UPDATE fis_leads SET owner_user_id=NULL WHERE owner_user_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  }
  await pool.end();
  console.log(`\n${failed ? `${failed} FAILED` : "all checks passed"}\n`);
  process.exit(failed ? 1 : 0);
}

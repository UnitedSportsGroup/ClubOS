/**
 * CIC lead pipeline — live checks against production.
 *
 *   npx tsx --env-file=.env script/_verify-cic-leads-live.ts
 *
 * 🔴 Signs in as an ORDINARY CIC workspace admin (what Isaac is), never a super
 * admin, and as a Mini Football admin to prove the gate holds across
 * workspaces. Test leads are INSERTED directly (the public form would email
 * info@cicyouth.com) and everything is deleted on the way out, pass or fail.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";

const BASE = process.env.CIC_CHECK_BASE || "https://app.usg.co.nz";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CIC = "christchurch-international-cup";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let failed = 0;
const is = (good: boolean, m: string, d = "") => {
  if (!good) failed++;
  console.log(`  ${good ? "ok  " : "FAIL"} ${m}${d ? ` — ${d}` : ""}`);
};
const users: number[] = [];
const leads: number[] = [];
let browser: any = null;

async function makeUser(label: string, orgSlug: string) {
  const email = `_cicleads_${label}_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows: u } = await pool.query(
    `INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Verify',$2,$3,'admin',true) RETURNING id`,
    [email, label, await bcrypt.hash(pw, 10)]);
  users.push(u[0].id);
  const { rows: o } = await pool.query(`SELECT id FROM organizations WHERE slug = $1`, [orgSlug]);
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [u[0].id, o[0].id]);
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  return { id: u[0].id as number, ok: login.ok, cookie: (login.headers.get("set-cookie") || "").split(";")[0] };
}

async function makeLead(club: string, email: string, phone = "+64 21 000 0000") {
  const { rows: o } = await pool.query(`SELECT id FROM organizations WHERE slug = $1`, [CIC]);
  const { rows } = await pool.query(
    `INSERT INTO cic_interest_registrations (organization_id,first_name,last_name,email,phone,club,location,age_groups,source_url,status)
     VALUES ($1,'Verify','Script',$2,$3,$4,'Christchurch, New Zealand',ARRAY['U12','U13'],'VERIFY — safe to delete','new') RETURNING id`,
    [o[0].id, email, phone, club]);
  leads.push(rows[0].id);
  return rows[0].id as number;
}

try {
  console.log(`\nCIC lead pipeline — live against ${BASE}\n`);
  const stamp = Date.now();
  const a = await makeLead("VERIFY Pipeline FC", `verify_a_${stamp}@footvault.com`);
  const b = await makeLead("VERIFY Pipeline FC", `verify_a_${stamp}@footvault.com`); // a duplicate of a
  const c = await makeLead("VERIFY Spam Row", `verify_c_${stamp}@footvault.com`);

  const anon = await fetch(`${BASE}/api/admin/cic/leads`);
  is(anon.status === 401, "anonymous caller refused", String(anon.status));

  const staff = await makeUser("cic", CIC);
  is(staff.ok, "ordinary CIC staff can sign in");
  const WS = { cookie: staff.cookie, "X-Workspace-Slug": CIC, "Content-Type": "application/json" };

  const noWs = await fetch(`${BASE}/api/admin/cic/leads`, { headers: { cookie: staff.cookie } });
  is(noWs.status === 400, "no workspace header is refused, not guessed", String(noWs.status));

  // 🔴 The cross-workspace hole this closes: an admin elsewhere must NOT reach it.
  const mfl = await makeUser("mfl", "mini-football-leagues");
  const mflOwn = await fetch(`${BASE}/api/admin/cic/leads`, { headers: { cookie: mfl.cookie, "X-Workspace-Slug": "mini-football-leagues" } });
  is(mflOwn.status === 404, "an MFL admin in their own workspace gets 404", String(mflOwn.status));
  const mflCic = await fetch(`${BASE}/api/admin/cic/leads`, { headers: { cookie: mfl.cookie, "X-Workspace-Slug": CIC } });
  is(mflCic.status === 403, "an MFL admin claiming the CIC workspace gets 403", String(mflCic.status));
  const mflLegacy = await fetch(`${BASE}/api/admin/cic/registrations`, { headers: { cookie: mfl.cookie, "X-Workspace-Slug": "mini-football-leagues" } });
  is(mflLegacy.status === 404, "…and the legacy list is closed to them too (was requireAuth only)", String(mflLegacy.status));

  const board = await fetch(`${BASE}/api/admin/cic/leads`, { headers: WS });
  const body: any = await board.json().catch(() => ({}));
  is(board.status === 200, "staff can read the pipeline", String(board.status));
  is(/^\d{4}-\d{2}-\d{2}$/.test(body?.today || ""), "the server supplies NZ today", body?.today);
  is(Array.isArray(body?.team) && body.team.some((t: any) => t.id === staff.id), "the team list includes CIC staff");
  is(body?.leads?.some((l: any) => l.id === a && l.stage === "new"), "a new lead appears in the New stage");

  const patch = (id: number, j: any) => fetch(`${BASE}/api/admin/cic/leads/${id}`, { method: "PATCH", headers: WS, body: JSON.stringify(j) });
  let r = await patch(a, { stage: "contacted" });
  is(r.status === 200, "move a lead to Contacted", String(r.status));
  const { rows: act } = await pool.query(`SELECT * FROM cic_interest_activities WHERE registration_id = $1 AND type='stage_change'`, [a]);
  is(act.length === 1 && act[0].from_stage === "new" && act[0].to_stage === "contacted" && act[0].created_by === staff.id,
    "the move is recorded with WHO made it", JSON.stringify(act.map((x: any) => [x.from_stage, x.to_stage, x.created_by])));

  r = await patch(a, { stage: "flying" });
  is(r.status === 400, "an unknown stage is refused", String(r.status));
  r = await patch(c, { stage: "disqualified" });
  is(r.status === 400, "disqualifying without a reason is refused", String(r.status));
  r = await patch(c, { stage: "disqualified", closedReason: "cost" });
  is(r.status === 400, "a reason that belongs to the other closed stage is refused", String(r.status));
  await patch(c, { nextFollowUpOn: "2030-01-01" });
  r = await patch(c, { stage: "disqualified", closedReason: "spam" });
  is(r.status === 200, "disqualify as spam", String(r.status));
  const { rows: cr } = await pool.query(`SELECT status, closed_reason, next_follow_up_on FROM cic_interest_registrations WHERE id=$1`, [c]);
  is(cr[0].status === "disqualified" && cr[0].closed_reason === "spam" && cr[0].next_follow_up_on === null,
    "…stored with its reason and nothing left to follow up", JSON.stringify(cr[0]));

  r = await patch(a, { ownerUserId: mfl.id });
  is(r.status === 400, "an owner outside the CIC workspace is refused", String(r.status));
  r = await patch(a, { ownerUserId: staff.id, priority: "hot" });
  is(r.status === 200, "assign an owner and mark hot", String(r.status));
  r = await patch(99999999, { priority: "hot" });
  is(r.status === 404, "a lead that isn't ours answers 404", String(r.status));

  // Quick log: moves New forward and sets the follow-up by itself.
  const log = (id: number, j: any) => fetch(`${BASE}/api/admin/cic/leads/${id}/activities`, { method: "POST", headers: WS, body: JSON.stringify(j) });
  r = await log(b, { quick: "no_answer" });
  is(r.status === 200, "log 'called — no answer'", String(r.status));
  const { rows: br } = await pool.query(`SELECT status, next_follow_up_on::text f FROM cic_interest_registrations WHERE id=$1`, [b]);
  is(br[0].status === "contacted" && !!br[0].f, "…the New lead moved to Contacted with a follow-up set", JSON.stringify(br[0]));
  r = await log(a, { quick: "no_answer" });
  const { rows: ar } = await pool.query(`SELECT status FROM cic_interest_registrations WHERE id=$1`, [a]);
  is(ar[0].status === "contacted", "a quick log never moves a lead backwards");
  r = await log(a, { type: "note", note: "   " });
  is(r.status === 400, "an empty note is refused", String(r.status));
  r = await log(a, { type: "note", note: "Squad of 14, flying via Sydney" });
  is(r.status === 200, "a note is saved", String(r.status));
  const tl = await fetch(`${BASE}/api/admin/cic/leads/${a}/activities`, { headers: WS });
  const tlBody: any[] = await tl.json().catch(() => []);
  is(tlBody.length >= 3 && tlBody.every((x) => x.byName), "the timeline shows every touch with a name", `${tlBody.length} items`);

  // Bulk.
  const bulk = await fetch(`${BASE}/api/admin/cic/leads/bulk`, { method: "POST", headers: WS, body: JSON.stringify({ ids: [a, b], stage: "disqualified", closedReason: "duplicate" }) });
  const bulkBody: any = await bulk.json().catch(() => ({}));
  is(bulk.status === 200 && bulkBody.moved === 2, "bulk-disqualify two duplicates", JSON.stringify(bulkBody));
  r = await patch(a, { stage: "new" });
  is(r.status === 200, "a disqualified lead can be re-opened", String(r.status));
  const { rows: reo } = await pool.query(`SELECT closed_reason FROM cic_interest_registrations WHERE id=$1`, [a]);
  is(reo[0].closed_reason === null, "…and re-opening clears the reason");

  // Legacy route the staff app still calls.
  const leg = await fetch(`${BASE}/api/admin/cic/registrations/${a}/status`, { method: "POST", headers: WS, body: JSON.stringify({ status: "confirmed" }) });
  const { rows: lr } = await pool.query(`SELECT status FROM cic_interest_registrations WHERE id=$1`, [a]);
  is(leg.status === 200 && lr[0].status === "entered", "the app's old 'confirm' still works and lands as Entered", lr[0].status);
  await patch(a, { stage: "new" });

  // ── the page, in a real browser, as ordinary staff ─────────────────────────
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const [cn, cv] = staff.cookie.split("=");
  for (const size of [{ w: 1440, h: 900, label: "desktop" }, { w: 390, h: 844, label: "phone" }]) {
    const page = await browser.newPage();
    await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 2, isMobile: size.w < 500 });
    await page.setCookie({ name: cn, value: cv, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem("clubos_workspace", "christchurch-international-cup"); } catch {} });
    const errors: string[] = [];
    page.on("pageerror", (e: any) => errors.push(String(e)));
    await page.goto(`${BASE}/admin/cic-registrations`, { waitUntil: "networkidle0" });
    await page.waitForSelector('[data-testid="cic-lead-pipeline"]', { timeout: 20000 }).catch(() => {});
    is(!!(await page.$('[data-testid="cic-lead-pipeline"]')), `[${size.label}] the pipeline is the page's first view`);
    const cols = await page.$$eval('[data-testid^="lead-col-"]', (els: any[]) => els.map((e) => e.getAttribute("data-testid")));
    is(cols.length === 6, `[${size.label}] six open stages shown, closed ones hidden`, cols.join(","));
    // The real 243 are there — the board is not an empty state.
    const count = await page.$$eval('[data-testid^="lead-card-"]', (els: any[]) => els.length);
    is(count > 200, `[${size.label}] the real leads are VISIBLE`, `${count} cards`);
    await page.screenshot({ path: `../../../../outputs/ui-preflight/cic-leads-${size.label}.png` });

    await page.type('[data-testid="lead-search"]', "VERIFY Pipeline");
    await new Promise((res) => setTimeout(res, 500));
    const found = await page.$(`[data-testid="lead-card-${a}"]`);
    is(!!found, `[${size.label}] search finds the test lead`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    is(!overflow, `[${size.label}] no sideways page overflow`);
    if (found) {
      await found.click();
      await page.waitForSelector('[data-testid="lead-drawer"]', { timeout: 8000 }).catch(() => {});
      // The sheet slides in; measure once it has landed and the history has loaded.
      await page.waitForSelector('[data-testid="lead-timeline"]', { timeout: 10000 }).catch(() => {});
      await new Promise((res) => setTimeout(res, 700));
      const drawer = await page.$('[data-testid="lead-drawer"]');
      is(!!drawer, `[${size.label}] clicking a card opens the lead`);
      const txt = await page.evaluate(() => (document.querySelector('[data-testid="lead-drawer"]') as HTMLElement)?.innerText || "");
      is(/flying via Sydney/.test(txt), `[${size.label}] the drawer shows the history`);
      const wide = await page.evaluate(() => {
        const d = document.querySelector('[data-testid="lead-drawer"]')!.getBoundingClientRect();
        return d.right > window.innerWidth + 1 ? `${Math.round(d.right)}>${window.innerWidth}` : "";
      });
      is(!wide, `[${size.label}] the drawer fits the screen`, wide);
      await page.screenshot({ path: `../../../../outputs/ui-preflight/cic-leads-drawer-${size.label}.png` });
    }
    is(errors.length === 0, `[${size.label}] no runtime errors`, errors.join(" | "));
    await page.close();
  }
} catch (e: any) {
  is(false, "threw", e?.message || String(e));
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const id of leads) await pool.query(`DELETE FROM cic_interest_registrations WHERE id = $1`, [id]).catch(() => {});
  for (const id of users) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  }
  await pool.end();
  console.log(`\n${failed ? `${failed} FAILED` : "all checks passed"}\n`);
  process.exit(failed ? 1 : 0);
}

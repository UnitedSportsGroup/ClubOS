/**
 * SIU check-in FORMS — end to end against PRODUCTION, as ordinary granted staff
 * and as a throwaway player, then a real browser at desktop + phone. Cleans up.
 *
 *   npx tsx --env-file=.env script/_verify-perf-forms-live.ts
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";
import { addDays, nzToday } from "../shared/performance";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const ATHLETE = process.env.VERIFY_ATHLETE_BASE || "https://join.southislandunited.com";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "siu-performance-preflight");
const TS = Date.now();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, g: boolean, d: unknown = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d !== "" && !g ? ` — ${typeof d === "string" ? d : JSON.stringify(d).slice(0, 300)}` : ""}`); g ? pass++ : fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let userId: number | null = null, outsiderId: number | null = null, squadId: number | null = null, contactId: number | null = null;
let staffCookie = "", athleteCookie = "";

async function makeUser(tabs: string[], unlocked: string[]) {
  const email = `_perf_forms_${TS}_${Math.random().toString(36).slice(2, 6)}@usg.co.nz`, password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`insert into users (email, first_name, last_name, password, role, active) values ($1,'Preflight','Forms',$2,'team_member',true) returning id`, [email, await bcrypt.hash(password, 10)]);
  await pool.query(`insert into user_organizations (user_id, organization_id, role, tabs, unlocked_tabs) values ($1,2,'team_member',$2::jsonb,$3::jsonb)`, [rows[0].id, JSON.stringify(tabs), JSON.stringify(unlocked)]);
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`login ${r.status}`);
  return { id: rows[0].id as number, cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}
const staff = (path: string, init: RequestInit = {}, cookie = staffCookie) => fetch(`${BASE}/api/admin/performance${path}`, {
  ...init, headers: { "Content-Type": "application/json", "X-Workspace-Slug": "south-island-united", Cookie: cookie, ...(init.headers ?? {}) },
});
const player = (path: string, init: RequestInit = {}) => fetch(`${ATHLETE}/api/public/athlete${path}`, {
  ...init, headers: { "Content-Type": "application/json", Cookie: athleteCookie, ...(init.headers ?? {}) },
});

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nSIU check-in forms — live on ${BASE}\n`);
  const today = nzToday();
  const u = await makeUser([], ["performance"]); userId = u.id; staffCookie = u.cookie;
  const o = await makeUser([], []); outsiderId = o.id;

  // a throwaway squad + player with a session
  const { rows: [sq] } = await pool.query(`insert into club_squads (organization_id, name, slug, season_year, is_active, notes) values (2,$1,$2,2026,true,'forms probe') returning id`, [`_Forms ${TS}`, `_forms-${TS}`]);
  squadId = sq.id;
  const { rows: [c] } = await pool.query(`insert into contacts (type, first_name, last_name, email) values ('player','Probe','Forms',$1) returning id`, [`delivered+perfforms${TS}@resend.dev`]);
  contactId = c.id;
  await pool.query(`insert into club_squad_members (squad_id, contact_id, role, position) values ($1,$2,'player','Striker')`, [squadId, contactId]);
  const { rows: [a] } = await pool.query(`insert into perf_athlete_accounts (organization_id, contact_id, email, invited_by, password_hash) values (2,$1,$2,$3,'s1$x$00') returning id`, [contactId, `delivered+perfforms${TS}@resend.dev`, userId]);
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(`insert into perf_athlete_sessions (account_id, token_hash, expires_at) values ($1,$2,now() + interval '1 hour')`, [a.id, crypto.createHash("sha256").update(token).digest("hex")]);
  athleteCookie = `__Host-siu_athlete=${token}`;

  console.log("gates");
  ok("outsider (no performance grant) gets 404 on the report", (await staff("/checkins", {}, o.cookie)).status === 404);
  ok("signed-out player gets 401 on the form", (await fetch(`${ATHLETE}/api/public/athlete/form`)).status === 401);
  const demo = await fetch(`${ATHLETE}/api/public/athlete/demo-form`);
  const demoJ = await demo.json();
  ok("the no-login demo serves the form wording", demo.status === 200 && demoJ.form?.definition?.title === "SI United Check In", demoJ);
  ok("the demo carries no player data", !("todays" in demoJ) && !("history" in demoJ));

  console.log("\nplayer");
  const f = await (await player("/form")).json();
  ok("player gets the daily form", f.form?.definition?.sections?.length === 2, f);
  ok("nothing answered yet today", f.todays === null);
  let r = await player("/checkin", { method: "POST", body: JSON.stringify({ answers: { am_well: "yes", ready: 7 } }) });
  let j = await r.json();
  ok("missing required sleep answer is refused, naming the question", r.status === 400 && j.questionId === "sleep_job", j);
  r = await player("/checkin", { method: "POST", body: JSON.stringify({ answers: {
    am_well: "no", illness_symptoms: "Sore throat", ready: 5, sleep_job: "below", sleep_modification: "Late flight",
    areas: ["right_pelvis", "left_posterior_upper_leg", "right_posterior_lower_leg_foot"], yesterday: ["football"],
    session_rpe: 8, session_minutes: 60, football_load: 1, help_others: "more_recovery",
  } }) });
  ok("player submits Rowan's form", r.status === 200, await r.text());
  const row = (await pool.query(`select * from perf_form_responses where contact_id = $1 and entry_date = $2 and not is_test`, [contactId, today])).rows[0];
  ok("stored once, today, entered by the player", !!row && row.entered_by_athlete === true && row.entered_by === null);
  ok("football load worked out by the server (8 × 60 = 480, not the phone's 1)", row?.answers?.football_load === 480, row?.answers);
  ok("flagged take care with the reasons", row?.flag_level === "amber" && row.flag_reasons.includes("Not well") && row.flag_reasons.includes("Ready 5/10"), row?.flag_reasons);
  const rpe = (await pool.query(`select * from perf_rpe where form_response_id = $1`, [row?.id])).rows;
  ok("the session fed the load engine on YESTERDAY", rpe.length === 1 && rpe[0].rpe === 8 && rpe[0].minutes === 60 && String(rpe[0].date.getFullYear()) && rpe[0].kind === "training", rpe);
  const rpeDate = rpe[0] ? `${rpe[0].date.getFullYear()}-${String(rpe[0].date.getMonth() + 1).padStart(2, "0")}-${String(rpe[0].date.getDate()).padStart(2, "0")}` : "";
  ok("…dated the day before the check-in", rpeDate === addDays(today, -1), rpeDate);
  r = await player("/checkin", { method: "POST", body: JSON.stringify({ answers: { am_well: "yes", ready: 8, sleep_job: "normal", yesterday: ["rest"] } }) });
  ok("player edits today's answers", r.status === 200);
  const n = (await pool.query(`select count(*)::int n from perf_form_responses where contact_id = $1 and not is_test`, [contactId])).rows[0].n;
  ok("…still one response for the day", n === 1);
  ok("…the old session came back out of the load engine", (await pool.query(`select count(*)::int n from perf_rpe where contact_id = $1`, [contactId])).rows[0].n === 0);
  const f2 = await (await player("/form")).json();
  ok("player sees their own answers back", f2.todays?.ready === 8 && f2.history?.length === 1, f2.todays);

  console.log("\nstaff");
  let rep = await (await staff("/checkins?range=today")).json();
  const mine = rep.rows?.find((x: any) => x.contactId === contactId);
  ok("the report shows the player's check-in", !!mine && mine.answers.ready === 8 && mine.enteredBy === "Player", mine);
  ok("…with this week's entry count", mine?.entriesThisWeek === 1);
  ok("…and the rest of the squad listed as not checked in", Array.isArray(rep.missing) && !rep.missing.some((m: any) => m.contactId === contactId));
  const ov = await (await staff("/overview")).json();
  const bp = ov.players?.find((p: any) => p.contactId === contactId);
  ok("the board shows the check-in", !!bp?.checkIn && bp.checkIn.summary.length > 0, bp?.checkIn);
  ok("…and readiness reads it (no longer 'No reading')", bp?.readiness?.level === "green" && bp.readiness.used.includes("wellness"), bp?.readiness);
  r = await staff("/checkins", { method: "POST", body: JSON.stringify({ contactId, date: addDays(today, -1), answers: { am_well: "yes", ready: 6, sleep_job: "above" } }) });
  ok("staff enter a check-in for the player (yesterday)", r.status === 200, await r.text());
  const byStaff = (await pool.query(`select entered_by from perf_form_responses where contact_id = $1 and entry_date = $2`, [contactId, addDays(today, -1)])).rows[0];
  ok("…saved under the staff member's name", byStaff?.entered_by === userId);
  rep = await (await staff("/checkins?range=7d&mostRecent=0")).json();
  ok("a 7-day range with every entry shows both days", rep.rows.filter((x: any) => x.contactId === contactId).length === 2);
  rep = await (await staff("/checkins?range=7d")).json();
  ok("'most recent' keeps one row per player (today's)", rep.rows.filter((x: any) => x.contactId === contactId).length === 1 && rep.rows.find((x: any) => x.contactId === contactId).date === today);
  r = await staff("/checkins", { method: "POST", body: JSON.stringify({ contactId: 999999999, answers: { am_well: "yes", ready: 6, sleep_job: "above" } }) });
  ok("staff can't enter for someone off the squad", r.status === 404);
  r = await staff("/checkins", { method: "POST", body: JSON.stringify({ contactId, date: addDays(today, 2), answers: { am_well: "yes", ready: 6, sleep_job: "above" } }) });
  ok("…or for a day that hasn't happened", r.status === 400);

  console.log("\ntry the player app (test entries)");
  r = await staff("/checkins", { method: "POST", body: JSON.stringify({ test: true, answers: { am_well: "yes", ready: 2, sleep_job: "normal" } }) });
  j = await r.json();
  ok("a test entry saves and returns its flag", r.status === 200 && j.flag === "red", j);
  rep = await (await staff("/checkins?range=today")).json();
  ok("test entries are hidden from the report by default", !rep.rows.some((x: any) => x.isTest));
  rep = await (await staff("/checkins?range=today&tests=1")).json();
  const t = rep.rows.find((x: any) => x.isTest && x.id === j.id);
  ok("…and shown when asked for", !!t);
  const ov2 = await (await staff("/overview")).json();
  ok("a test never changes the board's counts", ov2.counts.checkedIn === ov.counts.checkedIn);
  ok("a real response can't be deleted", (await staff(`/checkins/${row?.id}`, { method: "DELETE" })).status === 404);
  ok("a test entry can", (await staff(`/checkins/${j.id}`, { method: "DELETE" })).status === 200);

  console.log("\nsaved reports + forms");
  r = await staff("/reports", { method: "POST", body: JSON.stringify({ name: `_probe ${TS}`, config: { range: "today", mostRecent: true, includeMissing: true, tests: false, fields: null, filters: [], sort: null } }) });
  ok("a report saves", r.status === 200);
  const reps = await (await staff("/reports")).json();
  const saved = reps.reports.find((x: any) => x.name === `_probe ${TS}`);
  ok("…and keeps 'today' as a relative date", saved?.config?.range === "today");
  ok("…and deletes", (await staff(`/reports/${saved?.id}`, { method: "DELETE" })).status === 200);
  const forms = await (await staff("/forms")).json();
  const daily = forms.forms.find((x: any) => x.isDaily);
  ok("the SI United Check In is the daily form", daily?.title === "SI United Check In", forms);
  const fd = await (await staff(`/forms/${daily.id}`)).json();
  ok("the form knows which questions have answers", fd.answered.includes("ready"));
  const dropped = { ...fd.definition, sections: fd.definition.sections.map((s: any) => ({ ...s, questions: s.questions.filter((q: any) => q.id !== "ready") })) };
  r = await staff(`/forms/${daily.id}`, { method: "PATCH", body: JSON.stringify({ definition: dropped, version: fd.version }) });
  ok("deleting an answered question is refused (hide it instead)", r.status === 409 && /Hide it/.test((await r.json()).message));
  r = await staff(`/forms/${daily.id}`, { method: "PATCH", body: JSON.stringify({ definition: fd.definition, version: fd.version - 1 }) });
  ok("a stale save (someone else saved first) is refused", r.status === 409);

  // ── browser ──
  console.log("\nbrowser");
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    const [cn, cv] = staffCookie.split("=");
    for (const [label, width, height, mobile] of [["desktop", 1440, 900, false], ["mobile", 390, 844, true]] as const) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      await page.setCookie({ name: cn, value: cv, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
      await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluate(() => localStorage.setItem("clubos_workspace", "south-island-united"));
      for (const [name, path, must] of [["checkins", "/admin/performance/checkins", /Check-ins/], ["forms", "/admin/performance/forms", /Am I well\?/], ["try", "/admin/performance/try", /How ready am I to perform/]] as const) {
        await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: 90000 }).catch(() => {});
        await sleep(1800);
        const m: any = await page.evaluate(`(function(){ var t=document.body.innerText||''; return { t: t.slice(0,4000), docW: document.documentElement.scrollWidth, crash: /Something went wrong|Minified React error/i.test(t) }; })()`);
        ok(`${label} ${name}: renders its content`, must.test(m.t) && !m.crash, m.t.slice(0, 160));
        ok(`${label} ${name}: nothing wider than the screen`, m.docW <= width + 1, `doc ${m.docW}`);
        await page.screenshot({ path: join(OUT, `forms-${label}-${name}.png`), fullPage: true });
      }
      await page.close();
    }
    // the public demo on a phone, filled in and submitted (nothing saved)
    const ph = await browser.newPage();
    await ph.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ph.goto(`${ATHLETE}/athlete?demo=1`, { waitUntil: "networkidle2", timeout: 90000 });
    await sleep(1500);
    const before = (await pool.query(`select count(*)::int n from perf_form_responses`)).rows[0].n;
    let txt: string = await ph.evaluate(() => document.body.innerText);
    ok("phone demo: no sign-in, the real form", /Demo\./.test(txt) && /Did sleep do its job\?/.test(txt), txt.slice(0, 200));
    await ph.screenshot({ path: join(OUT, "forms-phone-demo.png"), fullPage: true });
    await ph.click('[data-testid="checkin-submit"]'); await sleep(500);
    txt = await ph.evaluate(() => document.body.innerText);
    ok("phone demo: submitting empty names the required question", /"Am I well\?" is required/.test(txt));
    const clickText = async (t: string) => ph.evaluate((x) => { const b = Array.from(document.querySelectorAll("button")).find((e) => e.textContent?.trim() === x); (b as HTMLElement | undefined)?.click(); return !!b; }, t);
    await clickText("Yes"); await clickText("7"); await clickText("Normal"); await clickText("Football");
    await ph.evaluate(() => (document.querySelector('[aria-label="Right Pelvis"]') as any)?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await sleep(300);
    await ph.screenshot({ path: join(OUT, "forms-phone-demo-filled.png"), fullPage: true });
    await ph.click('[data-testid="checkin-submit"]'); await sleep(800);
    txt = await ph.evaluate(() => document.body.innerText);
    ok("phone demo: submits and shows the done screen with the answers", /Done for today/.test(txt) && /Right Pelvis/.test(txt), txt.slice(0, 300));
    const docW = await ph.evaluate(() => document.documentElement.scrollWidth);
    ok("phone demo: nothing wider than the phone", docW <= 391, `doc ${docW}`);
    await ph.screenshot({ path: join(OUT, "forms-phone-demo-done.png"), fullPage: true });
    ok("phone demo: nothing was saved", (await pool.query(`select count(*)::int n from perf_form_responses`)).rows[0].n === before);
    // the signed-in player sees today's answers
    await ph.setCookie({ name: "__Host-siu_athlete", value: token, domain: new URL(ATHLETE).hostname, path: "/", httpOnly: true, secure: true });
    await ph.goto(`${ATHLETE}/athlete`, { waitUntil: "networkidle2", timeout: 90000 });
    await sleep(1800);
    txt = await ph.evaluate(() => document.body.innerText);
    ok("signed-in player: today's check-in shows as done", /Done for today/.test(txt) && /Kia ora Probe/.test(txt), txt.slice(0, 200));
    await ph.screenshot({ path: join(OUT, "forms-phone-player-done.png"), fullPage: true });
  } finally { await browser.close(); }
}

async function cleanup() {
  try {
    if (contactId) {
      await pool.query(`delete from perf_rpe where contact_id = $1`, [contactId]);
      await pool.query(`delete from perf_form_responses where contact_id = $1`, [contactId]);
      await pool.query(`delete from perf_athlete_accounts where contact_id = $1`, [contactId]);
      await pool.query(`delete from club_squad_members where contact_id = $1`, [contactId]);
      await pool.query(`delete from contacts where id = $1`, [contactId]);
    }
    if (squadId) await pool.query(`delete from club_squads where id = $1`, [squadId]);
    for (const id of [userId, outsiderId]) if (id) {
      await pool.query(`delete from perf_form_responses where entered_by = $1 and is_test`, [id]);
      await pool.query(`delete from perf_saved_reports where user_id = $1`, [id]);
      await pool.query(`delete from user_organizations where user_id = $1`, [id]);
      await pool.query(`delete from users where id = $1`, [id]).catch(() => pool.query(`update users set active=false where id=$1`, [id]));
    }
  } catch (e: any) { console.error("cleanup", e.message); fail++; }
}

main().catch((e) => { console.error("\n  ✗", e.message); fail++; }).finally(async () => {
  await cleanup(); console.log(`\n  ${pass} passed, ${fail} failed\n  screenshots: ${OUT}\n`); await pool.end(); process.exit(fail ? 1 : 0);
});

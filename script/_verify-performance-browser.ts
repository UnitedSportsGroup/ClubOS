/**
 * SIU Performance Hub — real Chrome against production, as ORDINARY granted SIU
 * staff and as a throwaway player. Screenshots every screen at 1440 and 390 into
 * outputs/siu-performance-preflight/, and fails on a blank page, a sign-in wall,
 * a React error, or anything wider than the screen.
 *
 *   npx tsx --env-file=.env script/_verify-performance-browser.ts
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const ATHLETE = process.env.VERIFY_ATHLETE_BASE || "https://join.southislandunited.com";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "siu-performance-preflight");
const TS = Date.now();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); g ? pass++ : fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let userId: number | null = null, squadId: number | null = null, contactId: number | null = null;

async function staffCookie() {
  const email = `_perf_ui_${TS}@usg.co.nz`, password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`insert into users (email, first_name, last_name, password, role, active) values ($1,'Preflight','Performance',$2,'team_member',true) returning id`, [email, await bcrypt.hash(password, 10)]);
  userId = rows[0].id;
  await pool.query(`insert into user_organizations (user_id, organization_id, role, tabs, unlocked_tabs) values ($1,2,'team_member','[]'::jsonb,'["performance"]'::jsonb)`, [userId]);
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`login ${r.status}`);
  const [name, value] = (r.headers.get("set-cookie") || "").split(";")[0].split("=");
  return { name, value, domain: new URL(BASE).hostname };
}

async function athleteCookie() {
  const { rows: [sq] } = await pool.query(`insert into club_squads (organization_id, name, slug, season_year, is_active, notes) values (2,$1,$2,2026,true,'browser probe') returning id`, [`_UI ${TS}`, `_ui-${TS}`]);
  squadId = sq.id;
  const { rows: [c] } = await pool.query(`insert into contacts (type, first_name, last_name, email) values ('player','Probe','Player',$1) returning id`, [`delivered+perfui${TS}@resend.dev`]);
  contactId = c.id;
  await pool.query(`insert into club_squad_members (squad_id, contact_id, role, position) values ($1,$2,'player','Striker')`, [squadId, contactId]);
  const { rows: [a] } = await pool.query(`insert into perf_athlete_accounts (organization_id, contact_id, email, invited_by, password_hash) values (2,$1,$2,$3,'s1$x$00') returning id`, [contactId, `delivered+perfui${TS}@resend.dev`, userId]);
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(`insert into perf_athlete_sessions (account_id, token_hash, expires_at) values ($1,$2,now() + interval '1 hour')`, [a.id, crypto.createHash("sha256").update(token).digest("hex")]);
  return { name: "__Host-siu_athlete", value: token, domain: new URL(ATHLETE).hostname };
}

async function measure(page: any, width: number) {
  return page.evaluate(`(function(){
    var W=${width}, wide=[];
    var all=document.querySelectorAll('body *');
    for (var i=0;i<all.length;i++){ var b=all[i].getBoundingClientRect(); if (b.width>0 && b.right>W+1 && !all[i].closest('.overflow-x-auto,[data-radix-scroll-area-viewport],.recharts-wrapper')) { wide.push(all[i].tagName+'.'+String(all[i].className).slice(0,50)+' '+Math.round(b.right)); if (wide.length>4) break; } }
    var t=document.body.innerText||'';
    return { docW: document.documentElement.scrollWidth, wide: wide, chars: t.trim().length, login: /Forgot password|Sign in to ClubOS/i.test(t) && !/check-in/i.test(t), crash: /Something went wrong|Unexpected Application Error|Minified React error/i.test(t), sample: t.replace(/\\s+/g,' ').slice(0,160) };
  })()`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nSIU Performance — browser check on ${BASE}\n`);
  const cookie = await staffCookie();
  const { rows: [first] } = await pool.query(`select m.contact_id from club_squads s join club_squad_members m on m.squad_id = s.id where s.organization_id = 2 and s.slug = 'siu-first-team' and m.left_at is null order by m.id limit 1`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  try {
    const screens = [
      ["dashboard", "/admin/performance"], ["players", "/admin/performance/players"], ["player", `/admin/performance/players/${first.contact_id}`],
      ["wellness", "/admin/performance/wellness"], ["load", "/admin/performance/load"], ["availability", "/admin/performance/availability"],
      ["testing", "/admin/performance/testing"], ["video", "/admin/performance/video"], ["import", "/admin/performance/import"], ["sources", "/admin/performance/sources"],
    ];
    for (const [label, width, height, mobile] of [["desktop", 1440, 900, false], ["mobile", 390, 844, true]] as const) {
      console.log(`\n${label} ${width}×${height}`);
      const page = await browser.newPage();
      await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      await page.setCookie({ ...cookie, path: "/", httpOnly: true, secure: true });
      await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluate(() => localStorage.setItem("clubos_workspace", "south-island-united"));
      for (const [name, path] of screens) {
        await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: 90000 }).catch(() => {});
        await sleep(1500);
        const m: any = await measure(page, width);
        ok(`${name}: renders (${m.chars} chars), no crash, not a sign-in wall`, m.chars > 80 && !m.crash && !m.login, m.sample);
        ok(`${name}: nothing wider than the screen`, m.docW <= width + 1 && m.wide.length === 0, `doc ${m.docW} ${m.wide.join(" | ")}`);
        await page.screenshot({ path: join(OUT, `${label}-${name}.png`), fullPage: true });
      }
      if (label === "desktop") {
        const link = await page.evaluate(() => Array.from(document.querySelectorAll("a")).some((a) => (a.getAttribute("href") || "") === "/admin/performance"));
        ok("the sidebar carries a Performance link", link);
      }
      await page.close();
    }

    console.log(`\nplayer phone 390×844`);
    const ph = await browser.newPage();
    await ph.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ph.goto(`${ATHLETE}/athlete`, { waitUntil: "networkidle2", timeout: 90000 });
    await sleep(1200);
    let m: any = await measure(ph, 390);
    ok("signed-out player sees the sign-in screen", /sign in/i.test(m.sample) && !m.crash, m.sample);
    ok("…nothing wider than the phone", m.docW <= 391 && m.wide.length === 0, `doc ${m.docW} ${m.wide.join(" | ")}`);
    await ph.screenshot({ path: join(OUT, "phone-signin.png"), fullPage: true });
    await ph.setCookie({ ...(await athleteCookie()), path: "/", httpOnly: true, secure: true });
    await ph.goto(`${ATHLETE}/athlete`, { waitUntil: "networkidle2", timeout: 90000 });
    await sleep(1500);
    m = await measure(ph, 390);
    ok("signed-in player sees their check-in", /kia ora probe/i.test(m.sample) && !m.crash, m.sample);
    ok("…nothing wider than the phone", m.docW <= 391 && m.wide.length === 0, `doc ${m.docW} ${m.wide.join(" | ")}`);
    await ph.screenshot({ path: join(OUT, "phone-checkin.png"), fullPage: true });
  } finally { await browser.close(); }
}

async function cleanup() {
  try {
    if (contactId) {
      await pool.query(`delete from perf_wellness where contact_id = $1`, [contactId]);
      await pool.query(`delete from perf_rpe where contact_id = $1`, [contactId]);
      await pool.query(`delete from perf_athlete_accounts where contact_id = $1`, [contactId]);
      await pool.query(`delete from club_squad_members where contact_id = $1`, [contactId]);
      await pool.query(`delete from contacts where id = $1`, [contactId]);
    }
    if (squadId) await pool.query(`delete from club_squads where id = $1`, [squadId]);
    if (userId) { await pool.query(`delete from user_organizations where user_id = $1`, [userId]); await pool.query(`delete from users where id = $1`, [userId]).catch(() => pool.query(`update users set active=false where id=$1`, [userId])); }
  } catch (e: any) { console.error("cleanup", e.message); fail++; }
}

main().catch((e) => { console.error("\n  ✗", e.message); fail++; }).finally(async () => {
  await cleanup(); console.log(`\n  ${pass} passed, ${fail} failed\n  screenshots: ${OUT}\n`); await pool.end(); process.exit(fail ? 1 : 0);
});

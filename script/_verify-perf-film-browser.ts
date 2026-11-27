/**
 * SIU session film (Performance → Video) — real Chrome against production, as
 * ORDINARY granted SIU staff, at 1440 and 390, plus the share link with no login.
 * Needs at least one film with a share link on. Adds one probe note and removes it.
 *
 *   npx tsx --env-file=.env script/_verify-perf-film-browser.ts
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const SHARE_BASE = process.env.VERIFY_ATHLETE_BASE || "https://join.southislandunited.com";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "siu-film-preflight");
const TS = Date.now();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); g ? pass++ : fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const users: number[] = [];

async function login(unlocked: string[]) {
  const email = `_film_ui_${TS}_${users.length}@usg.co.nz`, password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`insert into users (email, first_name, last_name, password, role, active) values ($1,'Preflight','Film',$2,'team_member',true) returning id`, [email, await bcrypt.hash(password, 10)]);
  users.push(rows[0].id);
  await pool.query(`insert into user_organizations (user_id, organization_id, role, tabs, unlocked_tabs) values ($1,2,'team_member','[]'::jsonb,$2::jsonb)`, [rows[0].id, JSON.stringify(unlocked)]);
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`login ${r.status}`);
  const [name, value] = (r.headers.get("set-cookie") || "").split(";")[0].split("=");
  return { name, value, domain: new URL(BASE).hostname };
}
const WS = { "X-Workspace-Slug": "south-island-united" };

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nSIU session film — browser check on ${BASE}\n`);
  const { rows: [film] } = await pool.query(`select f.id, f.title, f.share_token from perf_films f where f.organization_id = 2 and f.archived_at is null and f.share_enabled order by f.id desc limit 1`);
  if (!film) throw new Error("no shared film to check against");
  const staff = await login(["performance"]);
  const outsider = await login([]);
  const cookieOf = (c: { name: string; value: string }) => `${c.name}=${c.value}`;

  // The gate, over HTTP.
  const asStaff = await fetch(`${BASE}/api/admin/performance/films`, { headers: { ...WS, cookie: cookieOf(staff) } });
  const list = asStaff.ok ? await asStaff.json() : null;
  ok("granted staff can list films", asStaff.status === 200 && list.films.some((f: any) => f.id === film.id), `${asStaff.status}`);
  ok("film storage is switched on", !!list?.storageOn);
  const noHeader = await fetch(`${BASE}/api/admin/performance/films`, { headers: { cookie: cookieOf(staff) } });
  ok("no workspace header → 404", noHeader.status === 404, `${noHeader.status}`);
  const asOutsider = await fetch(`${BASE}/api/admin/performance/films`, { headers: { ...WS, cookie: cookieOf(outsider) } });
  ok("staff without the Performance tab → 404", asOutsider.status === 404, `${asOutsider.status}`);
  const det = await (await fetch(`${BASE}/api/admin/performance/films/${film.id}`, { headers: { ...WS, cookie: cookieOf(staff) } })).json();
  const f0 = det.film.files[0];
  const signed = await fetch(`${BASE}${f0.videoUrl}`, { headers: { cookie: cookieOf(staff), range: "bytes=0-99" } });
  ok("a signed file address plays for signed-in staff", signed.status === 206, `${signed.status}`);
  const noCookie = await fetch(`${BASE}${f0.videoUrl}`, { headers: { range: "bytes=0-99" }, redirect: "manual" });
  ok("the same address without a staff session is refused", noCookie.status === 401 || noCookie.status === 403, `${noCookie.status}`);
  const forged = await fetch(`${BASE}${f0.videoUrl.replace(/s=[^&]+/, "s=AAAA")}`, { headers: { cookie: cookieOf(staff), range: "bytes=0-99" } });
  ok("a forged signature → 404", forged.status === 404, `${forged.status}`);
  const other = det.film.files[1] ? await fetch(`${BASE}${f0.videoUrl.replace(`/film-file/${f0.id}/`, `/film-file/${det.film.files[1].id}/`)}`, { headers: { cookie: cookieOf(staff), range: "bytes=0-99" } }) : null;
  if (other) ok("a signature does not open a different file", other.status === 404, `${other.status}`);
  const pub = await fetch(`${SHARE_BASE}/api/public/film/${film.share_token}`);
  const pubJson = pub.ok ? await pub.json() : null;
  ok("the share link answers with no login", pub.status === 200 && pubJson.film.files.length === det.film.files.length, `${pub.status}`);
  ok("the share link carries no staff names", pubJson ? !JSON.stringify(pubJson).includes("author") : false);
  const wrong = await fetch(`${SHARE_BASE}/api/public/film/${film.share_token.slice(0, -2)}zz`);
  ok("a near-miss token → 404", wrong.status === 404, `${wrong.status}`);
  const crossed = await fetch(`${SHARE_BASE}/api/public/film/${film.share_token}/file/999999/video`);
  ok("a file that isn't on the film → 404", crossed.status === 404, `${crossed.status}`);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  try {
    for (const [label, width, height, mobile] of [["desktop", 1440, 900, false], ["mobile", 390, 844, true]] as const) {
      console.log(`\n${label} ${width}×${height}`);
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      await page.setCookie(staff as any);
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => localStorage.setItem("clubos_workspace", "south-island-united"));
      await page.goto(`${BASE}/admin/performance/video`, { waitUntil: "networkidle2", timeout: 60000 });
      const card = await page.waitForSelector(`[data-testid="perf-film-${film.id}"]`, { timeout: 30000 }).catch(() => null);
      ok("the film is listed on Performance → Video", !!card);
      await page.screenshot({ path: join(OUT, `${label}-list.png`), fullPage: true });
      if (!card) { await page.close(); continue; }
      await card.click();
      await page.waitForSelector('[data-testid="film-video"]', { timeout: 30000 });
      ok("opening a film puts it in the address", new URL(page.url()).searchParams.get("film") === String(film.id), page.url().replace(BASE, ""));
      const v: any = await page.evaluate(`(async function(){
        var v=document.querySelector('[data-testid="film-video"]'); v.muted=true;
        for (var i=0;i<60 && v.readyState<1;i++) await new Promise(function(r){setTimeout(r,250)});
        try { await v.play(); } catch(e) {}
        await new Promise(function(r){setTimeout(r,2000)});
        v.pause();
        var W=${width}, wide=[]; var all=document.querySelectorAll('body *');
        for (var j=0;j<all.length;j++){ var b=all[j].getBoundingClientRect(); if (b.width>0 && b.right>W+1 && !all[j].closest('.overflow-x-auto,[data-radix-scroll-area-viewport]')) wide.push(all[j].tagName+'.'+String(all[j].className).slice(0,40)); }
        var small=[]; var bs=document.querySelectorAll('[data-testid="film-viewer"] button,[data-testid="film-viewer"] a');
        for (var k=0;k<bs.length;k++){ var r=bs[k].getBoundingClientRect(); if (r.height>0 && r.height<${mobile ? 44 : 30}) small.push(bs[k].textContent.trim().slice(0,16)+':'+Math.round(r.height)); }
        return { ready: v.readyState, dur: v.duration, t: v.currentTime, docW: document.documentElement.scrollWidth, wide: wide.slice(0,5), small: small, share: (document.querySelector('[data-testid="film-share-url"]')||{}).value || null, downloads: document.querySelectorAll('[data-testid^="film-download-"]').length };
      })()`);
      ok("the video loads and plays for staff", v.ready >= 2 && v.dur > 10 && v.t > 0, `ready ${v.ready}, ${Math.round(v.dur)}s, played to ${v.t.toFixed(1)}s`);
      ok("the share link is shown", typeof v.share === "string" && v.share.endsWith(`/film/${film.share_token}`));
      ok("every file has a download button", v.downloads === det.film.files.length, `${v.downloads}`);
      ok("nothing wider than the screen", v.docW <= width + 1 && v.wide.length === 0, v.wide.join(", "));
      ok("every control is big enough to tap", v.small.length === 0, v.small.join(", "));
      if (!mobile) {
        const text = `Probe note ${TS}`;
        await page.type('[data-testid="film-note-input"]', text);
        await page.click('[data-testid="film-note-add"]');
        await page.waitForFunction((t: string) => (document.querySelector('[data-testid="film-notes"]')?.textContent || "").includes(t), { timeout: 15000 }, text).catch(() => {});
        const { rows: [n] } = await pool.query(`select id, at_seconds from perf_film_notes where film_id = $1 and body = $2`, [film.id, text]);
        ok("a note saves at the moment the film is paused on", !!n && Number(n.at_seconds) > 0, n ? `${n.at_seconds}s` : "not saved");
        const pubNotes = await (await fetch(`${SHARE_BASE}/api/public/film/${film.share_token}`)).json();
        ok("the note shows on the share link", pubNotes.film.notes.some((x: any) => x.body === text));
      }
      ok("no page errors", errors.length === 0, errors.join(" | "));
      await page.screenshot({ path: join(OUT, `${label}-film.png`), fullPage: true });
      await page.close();

      const anon = await browser.newPage();
      await anon.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      await anon.goto(`${SHARE_BASE}/film/${film.share_token}`, { waitUntil: "networkidle2", timeout: 60000 });
      await anon.waitForSelector('[data-testid="film-video"]', { timeout: 30000 });
      const a: any = await anon.evaluate(`(async function(){ var v=document.querySelector('[data-testid="film-video"]'); for (var i=0;i<60 && v.readyState<1;i++) await new Promise(function(r){setTimeout(r,250)}); return { ready: v.readyState, docW: document.documentElement.scrollWidth, title: (document.querySelector('[data-testid="film-title"]')||{}).textContent }; })()`);
      ok("the share page loads the video with no login", a.ready >= 1 && a.title === film.title && a.docW <= width + 1, `ready ${a.ready}`);
      await anon.screenshot({ path: join(OUT, `${label}-share.png`), fullPage: true });
      await anon.close();
    }
  } finally { await browser.close(); }
}

main().catch((e) => { console.error("\n  ✗", e.message); fail++; }).finally(async () => {
  try {
    await pool.query(`delete from perf_film_notes where body like 'Probe note %' and created_by = any($1::int[])`, [users]);
    for (const id of users) { await pool.query(`delete from user_organizations where user_id = $1`, [id]); await pool.query(`delete from users where id = $1`, [id]).catch(() => pool.query(`update users set active = false where id = $1`, [id])); }
  } catch (e: any) { console.error("  cleanup:", e.message); }
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed · screenshots in ${OUT}\n`);
  process.exit(fail ? 1 : 0);
});

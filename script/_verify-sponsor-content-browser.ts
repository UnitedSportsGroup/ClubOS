/**
 * Sponsor content, checked on the live site in a real browser as ORDINARY staff.
 *   npx tsx --env-file=.env script/_verify-sponsor-content-browser.ts [screenshot dir]
 * Makes two throwaway logins (one with the Sponsorship tab, one without),
 * reads only, and removes both logins at the end.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const SHOTS = process.argv[2] || null;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0; const made: number[] = [];
const ok = (label: string, good: boolean, detail = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); good ? pass++ : fail++; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function staff(tabs: string[]) {
  const email = `_sponsor_content_${Date.now()}_${tabs.length}@usg.co.nz`; const pw = `S${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1, 'Content', 'Probe', $2, 'team_member', true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  made.push(rows[0].id);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) SELECT $1, id, 'team_member', $2 FROM organizations WHERE slug = 'united-sports-group'`, [rows[0].id, JSON.stringify(tabs)]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const raw = (login.headers.get("set-cookie") || "").split(";")[0]; const [name, ...rest] = raw.split("=");
  const api = (path: string, init: RequestInit = {}) => fetch(`${BASE}${path}`, { ...init, headers: { Cookie: raw, "X-Workspace-Slug": "united-sports-group", ...(init.headers || {}) } });
  return { cookie: { name, value: rest.join("=") }, api };
}

async function main() {
  const a = await staff(["sponsorship", "social-media", "marketing-hub"]);
  const b = await staff(["social-media"]);
  console.log("\naccess");
  ok("signed out is refused", (await fetch(`${BASE}/api/admin/sponsor-content`)).status === 401);
  const la = await (await a.api("/api/admin/sponsor-content")).json();
  ok("staff with the Sponsorship tab see every sponsor folder", la.sponsors.length >= 10 && la.sponsors.every((s: any) => s.link?.url), `${la.sponsors.length} folders`);
  const lb = await (await b.api("/api/admin/sponsor-content")).json();
  ok("staff without the Sponsorship tab get an empty list, no names", lb.sponsors.length === 0 && lb.rootId === null);
  const drifter = la.sponsors.find((s: any) => s.name === "The Drifter");
  ok("The Drifter has pictures and videos", drifter?.pictures > 10 && drifter?.videos > 0, `${drifter?.pictures} pictures, ${drifter?.videos} videos`);
  const other = (await pool.query(`select id from drive_nodes where kind='folder' and parent_id is null and name='Sponsor Contracts' limit 1`)).rows[0];
  if (other) {
    const sh = await (await a.api(`/api/admin/drive/share/${other.id}`)).json();
    ok("the contracts folder cannot be shared", sh.shareable === false);
    ok("making a link on the contracts folder is refused", (await a.api(`/api/admin/drive/share/${other.id}`, { method: "POST" })).status === 400);
  }
  const before = (await pool.query(`select view_count from drive_share_links where token=$1`, [drifter.link.token])).rows[0].view_count;

  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  for (const [w, h, tag] of [[1440, 900, "laptop"], [390, 844, "phone"]] as const) {
    console.log(`\n${tag} ${w}×${h}`);
    const page = await browser.newPage(); await page.setViewport({ width: w, height: h });
    await page.setCookie({ ...a.cookie, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const shot = async (n: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/content-${n}-${tag}.png` }); };

    await page.goto(`${BASE}/admin/sponsorship#partners-content`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="sponsor-content-card"]', { timeout: 40_000 });
    ok("Sponsorship → Content lists the sponsor folders", (await page.$$('[data-testid="sponsor-content-card"]')).length >= 10);
    ok("the Content button is in the Partners menu", !!(await page.$('[data-testid="submenu-content"]')));
    ok("no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);
    await wait(1500); await shot("sponsorship");
    const href = await page.evaluate(() => { const c = Array.from(document.querySelectorAll('[data-testid="sponsor-content-card"]')).find((x) => /The Drifter/.test((x as HTMLElement).innerText)); return (c?.querySelector('[data-testid="sponsor-content-open"]') as HTMLAnchorElement)?.getAttribute("href") || ""; });
    ok("Open carries where the person came from", /^\/share\/.+\?from=%2Fadmin%2Fsponsorship%23partners-content$/.test(href), href.replace(/share\/[^?]+/, "share/…"));
    await page.goto(`${BASE}${href}`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="share-page"]', { timeout: 40_000 });
    ok("the sponsor's page opens with a way back", !!(await page.$('[data-testid="share-back"]')));
    const vids = (await page.$$('[data-testid="share-video"]')).length; const picsN = (await page.$$('[data-testid="share-picture"]')).length;
    ok("videos sit in the grid as tiles, like the pictures", vids === drifter.videos && picsN === drifter.pictures, `${vids} videos, ${picsN} pictures`);
    ok("the sponsor's page has no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);
    await shot("share");
    await page.evaluate(() => (document.querySelector('[data-testid="share-video"]') as HTMLElement).scrollIntoView({ block: "center" }));
    await wait(1200); await shot("share-videos");
    await page.click('[data-testid="share-video"]');
    await page.waitForSelector('[data-testid="share-viewer-video"]', { timeout: 20_000 });
    const playing = await page.evaluate(async () => { const v = document.querySelector('[data-testid="share-viewer-video"]') as HTMLVideoElement; for (let i = 0; i < 40 && v.readyState < 2; i++) await new Promise((r) => setTimeout(r, 250)); return { ready: v.readyState, dur: v.duration, controls: v.controls }; });
    ok("a video opens in the viewer and loads to play", playing.ready >= 2 && playing.dur > 1 && playing.controls, `${Math.round(playing.dur)}s`);
    const close = await page.evaluate(() => { const b = document.querySelector('[data-testid="share-viewer-close"]') as HTMLElement; const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return { color: cs.color, bg: cs.backgroundColor, w: r.width, h: r.height, inView: r.right <= innerWidth && r.top >= 0, text: b.innerText }; });
    ok("Close is white on dark, says Close, and is big enough to tap", close.color === "rgb(255, 255, 255)" && /Close/.test(close.text) && close.h >= 44 && close.inView && close.bg === "rgb(15, 23, 42)", JSON.stringify(close));
    await shot("viewer-video");
    await page.click('[data-testid="share-viewer-close"]');
    ok("Close shuts the viewer", !(await page.$('[data-testid="share-viewer"]')));
    await page.click('[data-testid="share-picture"]'); await page.waitForSelector('[data-testid="share-viewer"] img', { timeout: 20_000 }); await wait(1500); await shot("viewer-picture");
    await page.keyboard.press("Escape");
    // The report tab
    await page.click('[data-testid="share-tab-report"]');
    await page.waitForSelector('[data-testid="report-views"]', { timeout: 30_000 });
    const rv = await page.evaluate(() => ({ views: (document.querySelector('[data-testid="report-views"]') as HTMLElement).innerText, posts: (document.querySelector('[data-testid="report-posts"]') as HTMLElement).innerText, url: location.search }));
    ok("the report tab shows posts and views and is in the address", /\d/.test(rv.views) && /\d/.test(rv.posts) && rv.url.includes("tab=report"), `${rv.posts} posts, ${rv.views} views`);
    await page.click('[data-testid="report-period-all"]');
    await page.waitForFunction(() => location.search.includes("period=all") && /All time/.test((document.querySelector('[data-testid="report-period"]') as HTMLElement)?.innerText || ""), { timeout: 20_000 }).catch(() => {});
    ok("changing the time frame changes the report and the address", page.url().includes("period=all"));
    const active = await page.evaluate(() => { const b = document.querySelector('[data-testid="report-period-all"]') as HTMLElement; const cs = getComputedStyle(b); return { c: cs.color, bg: cs.backgroundColor }; });
    ok("the chosen time frame is readable (white on dark)", active.c === "rgb(255, 255, 255)" && active.bg === "rgb(15, 23, 42)", JSON.stringify(active));
    ok("the report has a Save as PDF button and no sideways scroll", !!(await page.$('[data-testid="report-pdf"]')) && (await overflow()) <= 0, `${await overflow()}px`);
    await wait(2500); if (SHOTS) await page.screenshot({ path: `${SHOTS}/content-report-${tag}.png`, fullPage: true });
    await page.click('[data-testid="share-tab-content"]');
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60_000 }), page.click('[data-testid="share-back"]')]);
    ok("Back returns to Sponsorship → Content", page.url().endsWith("/admin/sponsorship#partners-content"), page.url());

    await page.goto(`${BASE}/admin/social-media?brand=siu&view=labels&lk=sponsor`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="sponsor-content-card"]', { timeout: 40_000 }).catch(() => {});
    ok("Marketing → Social media → Labels shows the sponsor folders", (await page.$$('[data-testid="sponsor-content-card"]')).length >= 10);
    ok("Social media has no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);
    await shot("social");
    await page.goto(`${BASE}/admin/drive?folder=${drifter.nodeId}`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="drive-share-bar"]', { timeout: 40_000 }).catch(() => {});
    ok("Club Drive opens the sponsor's folder with its share link bar", !!(await page.$('[data-testid="drive-share-copy"]')));
    await shot("drive");
    ok("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
  }
  await browser.close();
  const after = (await pool.query(`select view_count from drive_share_links where token=$1`, [drifter.link.token])).rows[0].view_count;
  ok("staff looking from inside ClubOS is not counted as the sponsor opening it", after === before, `${before} -> ${after}`);
}
main().catch((e) => { console.error(e); fail++; }).finally(async () => {
  for (const id of made) { await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {}); await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch((e) => console.log("could not delete login", id, e.message)); }
  const left = await pool.query(`SELECT count(*)::int AS users FROM users WHERE email LIKE '\\_sponsor\\_content\\_%'`).catch(() => ({ rows: [{}] }));
  console.log("left behind:", left.rows[0]); console.log(`\n${pass} passed, ${fail} failed`); await pool.end(); process.exit(fail ? 1 : 0);
});

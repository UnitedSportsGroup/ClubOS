// The DOM contract the ClubOS staff APP depends on, asserted in the repo that
// can break it.
//
// apps/clubos-mobile renders any tab without a native screen as the real admin
// page inside a WebView, and to make that feel like the app rather than an
// embedded browser it injects two things:
//
//   1. localStorage `clubos_workspace`, BEFORE the page's own scripts run —
//      otherwise the page renders whichever workspace was last used, which may
//      not be the one the app's header says you are in.
//   2. a chrome strip that finds the shell header by walking up from
//      [data-sidebar="trigger"] — deliberately NOT `document.querySelector
//      ("header")`, because a page is free to render its own <header> and a
//      blunt rule would delete the page's title along with the chrome.
//
// Both are contracts with THIS repo's markup. A web refactor that renames the
// trigger, or moves it out of a <header>, silently gives every phone user a
// doubled header — so it fails here instead.
//
//   npx tsx --env-file=.env script/_verify-mobile-webview-contract.ts
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`);
  good ? pass++ : fail++;
};

// Kept byte-identical in spirit to STRIP_CHROME in
// apps/clubos-mobile/src/components/AdminWebView.tsx.
const STRIP = `(function () {
  function strip() {
    var trigger = document.querySelector('[data-sidebar="trigger"]');
    var shell = trigger && trigger.closest('header');
    if (shell) shell.style.display = 'none';
    var main = document.querySelector('main');
    if (main) { main.style.paddingTop = '0px'; }
  }
  strip();
  return !!document.querySelector('[data-sidebar="trigger"]');
})()`;

const users: number[] = [];
let browser: any = null;

async function main() {
  console.log(`\nMobile WebView DOM contract — against ${BASE}\n`);
  const email = `_wvcontract_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email,first_name,last_name,password,role,active)
     VALUES ($1,'WebView','Contract',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)]);
  users.push(rows[0].id);
  const { rows: o } = await pool.query(`SELECT id, slug FROM organizations WHERE slug='united-sports-group'`);
  await pool.query(
    `INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`,
    [rows[0].id, o[0].id]);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }) });
  if (!login.ok) throw new Error(`login HTTP ${login.status}`);
  const [cn, cv] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");

  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");

  // 1. The cookie alone must authenticate a page load — the app sends exactly
  //    this and nothing else.
  await page.setCookie({ name: cn, value: cv, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });

  // 2. The workspace preload, injected before any page script — same moment
  //    injectedJavaScriptBeforeContentLoaded fires.
  await page.evaluateOnNewDocument((slug: string) => {
    try { window.localStorage.setItem("clubos_workspace", slug); } catch {}
  }, "united-sports-group");

  await page.goto(`${BASE}/admin/payouts`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3500));

  const body = await page.evaluate(() => document.body.innerText);
  ok("the session cookie alone loads the page (not the login screen)", !/Sign in|Forgot password/i.test(body));
  ok("the preload selected the workspace before the page booted",
    await page.evaluate(() => localStorage.getItem("clubos_workspace")) === "united-sports-group");
  ok("the page rendered the tab it was asked for", /Stripe Payouts/i.test(body));

  const before = await page.evaluate(`(function(){
    var t = document.querySelector('[data-sidebar="trigger"]');
    var h = t && t.closest('header');
    return { hasTrigger: !!t, triggerInHeader: !!h, headerH: h ? Math.round(h.getBoundingClientRect().height) : 0,
             headerCount: document.querySelectorAll('header').length, hasMain: !!document.querySelector('main') };
  })()`) as any;

  ok("the sidebar trigger the strip keys on still exists", before.hasTrigger);
  ok("that trigger still sits inside a <header>", before.triggerInHeader);
  ok("the shell header has real height to remove", before.headerH > 0, `${before.headerH}px`);
  ok("there is a <main> to reclaim the space", before.hasMain);

  const found = await page.evaluate(STRIP);
  ok("the strip runs and finds its anchor", found === true);

  const after = await page.evaluate(`(function(){
    var t = document.querySelector('[data-sidebar="trigger"]');
    var h = t && t.closest('header');
    return { headerVisible: h ? getComputedStyle(h).display !== 'none' : false,
             bodyText: document.body.innerText.length,
             stillHasContent: /Stripe Payouts/i.test(document.body.innerText),
             noSideScroll: document.documentElement.scrollWidth <= window.innerWidth + 1 };
  })()`) as any;

  ok("the shell header is hidden after the strip", after.headerVisible === false);
  // 🔴 The failure this guards: a blunt `header{display:none}` would also take
  // the page's own title. The page must still be fully there.
  ok("the PAGE's own content survives the strip", after.stillHasContent);
  ok("no sideways scroll at 390px", after.noSideScroll);

  // ── The off-origin gate ───────────────────────────────────────────────────
  // A pure function of the URL, mirrored from isClubOsUrl() in
  // apps/clubos-mobile/src/components/AdminWebView.tsx.
  //
  // 🔴 This started life as `url.startsWith(ORIGIN)` and that is a real hole:
  // "https://app.usg.co.nz.evil.test/" genuinely starts with
  // "https://app.usg.co.nz", so a lookalike host would have been handed a
  // WebView carrying a live staff cookie. Origin comparison, not prefix.
  const gate = (u: string) => {
    if (u.startsWith("about:")) return true;
    try { return new URL(u).origin === new URL(BASE).origin; } catch { return false; }
  };
  ok("a ClubOS url is allowed", gate(`${BASE}/admin/invoices`));
  ok("an off-origin url is refused", !gate("https://example.com/anything"));
  ok("a LOOKALIKE host is refused (the startsWith hole)", !gate("https://app.usg.co.nz.evil.test/x"));
  ok("a userinfo trick is refused", !gate("https://app.usg.co.nz@evil.test/x"));
  ok("an unparseable url is refused", !gate("not a url"));
  ok("a javascript: url is refused", !gate("javascript:alert(1)"));

  // Look at it, do not just measure it: this is what a staff member sees when
  // they open a tab that has no native screen yet.
  const { mkdirSync } = await import("fs");
  const { join } = await import("path");
  const OUT = join(process.cwd(), "outputs", "mobile-webview");
  mkdirSync(OUT, { recursive: true });
  for (const [label, path] of [
    ["invoices", "/admin/invoices"],
    ["equipment", "/admin/equipment"],
  ] as const) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 3000));
    await page.evaluate(STRIP);
    await new Promise((r) => setTimeout(r, 400));
    const shot = join(OUT, `${label}.png`);
    await page.screenshot({ path: shot });
    console.log(`  → ${shot}`);
  }
}

main()
  .catch((e) => { console.error("\nthrew:", e.message); fail++; })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    for (const id of users) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {});
    }
    await pool.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });

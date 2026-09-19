/**
 * Football Fest — live checks against production.
 *
 *   npx tsx --env-file=.env script/_verify-football-fest-live.ts
 *
 * 🔴 Signs in as an ORDINARY CIC workspace admin, not a super admin. A super
 * admin short-circuits every permission check, so "it works when Daniel looks
 * at it" proves nothing about the people who actually use this. The page that
 * renders a permission failure as an empty state passes every other check ever
 * written for it — only opening it as staff catches that.
 *
 * Everything it creates (a throwaway account, any enquiry it posts) is deleted
 * on the way out, including when it fails.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";

const BASE = process.env.FF_CHECK_BASE || "https://app.usg.co.nz";
const SITE = "https://footballfest.co.nz";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let failed = 0;
const ok = (m: string, d = "") => console.log(`  ok   ${m}${d ? ` — ${d}` : ""}`);
const bad = (m: string, d = "") => { failed++; console.log(`  FAIL ${m}${d ? ` — ${d}` : ""}`); };
const is = (good: boolean, m: string, d = "") => (good ? ok(m, d) : bad(m, d));

const users: number[] = [];
const rows: number[] = [];
let browser: any = null;

try {
  console.log(`\nFootball Fest — live against ${BASE}\n`);

  // ── the public form ──────────────────────────────────────────────────────
  const opt = await fetch(`${BASE}/api/public/football-fest/register-interest`, {
    method: "OPTIONS", headers: { Origin: SITE },
  });
  is(opt.status === 204, "the form answers a preflight", String(opt.status));
  is(opt.headers.get("access-control-allow-origin") === SITE,
     "CORS names footballfest.co.nz", String(opt.headers.get("access-control-allow-origin")));

  const evil = await fetch(`${BASE}/api/public/football-fest/register-interest`, {
    method: "OPTIONS", headers: { Origin: "https://evil.example.com" },
  });
  is(!evil.headers.get("access-control-allow-origin"),
     "CORS refuses an origin that is not ours",
     String(evil.headers.get("access-control-allow-origin")));

  const post = (body: Record<string, unknown>) =>
    fetch(`${BASE}/api/public/football-fest/register-interest`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: SITE },
      body: JSON.stringify(body),
    });

  const good = await post({
    businessName: "VERIFY Kaikoura Coffee Co", contactName: "Verify Script",
    email: `verify_ff_${Date.now()}@footvault.com`, phone: "021 000 0000",
    days: "Both days", about: "Mobile espresso cart",
    message: "AUTOMATED VERIFICATION — safe to delete.", sourceUrl: SITE,
  });
  const goodBody: any = await good.json().catch(() => ({}));
  is(good.status === 200 && goodBody?.ok === true, "a real enquiry is accepted", String(good.status));
  if (goodBody?.id) rows.push(goodBody.id);

  for (const [label, body] of [
    ["no business name", { contactName: "A", email: "a@b.co" }],
    ["no contact name", { businessName: "A", email: "a@b.co" }],
    ["a malformed address", { businessName: "A", contactName: "B", email: "nope" }],
  ] as [string, Record<string, unknown>][]) {
    const r = await post(body);
    is(r.status === 400, `refuses ${label}`, String(r.status));
  }

  /* 🔴 The honeypot submission must be ACCEPTED and then HELD — not refused.
   * An identical answer either way is the point: a bot that can tell it was
   * caught tunes itself until it passes. */
  const potRes = await post({
    businessName: "VERIFY Honeypot Ltd", contactName: "Bot",
    email: `verify_pot_${Date.now()}@footvault.com`, website: "http://spam.example",
    message: "AUTOMATED VERIFICATION — safe to delete.", sourceUrl: SITE,
  });
  const potBody: any = await potRes.json().catch(() => ({}));
  is(potRes.status === 200 && potBody?.ok === true,
     "a honeypot submission gets the SAME answer as a real one", String(potRes.status));
  is(JSON.stringify(potBody) === JSON.stringify({ ok: true, id: potBody?.id }),
     "…and the body leaks nothing about the verdict", JSON.stringify(potBody));
  if (potBody?.id) rows.push(potBody.id);
  if (potBody?.id) {
    const { rows: hp } = await pool.query(
      `SELECT held, held_reasons FROM football_fest_registrations WHERE id = $1`, [potBody.id]);
    is(hp[0]?.held === true, "…but it is stored HELD", JSON.stringify(hp[0]?.held_reasons));
  }

  // ── the admin API, as ordinary staff ─────────────────────────────────────
  const anon = await fetch(`${BASE}/api/admin/football-fest/registrations`);
  is(anon.status === 401, "the board refuses an anonymous caller", String(anon.status));

  const email = `_ff_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows: u } = await pool.query(
    `INSERT INTO users (email,first_name,last_name,password,role,active)
     VALUES ($1,'Football','Fest',$2,'admin',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  users.push(u[0].id);
  const { rows: cic } = await pool.query(
    `SELECT id FROM organizations WHERE slug = 'christchurch-international-cup'`);
  // An ordinary workspace admin of CIC — what Isaac is. NOT a super admin.
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs)
                    VALUES ($1,$2,'admin',NULL)`, [u[0].id, cic[0].id]);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }) });
  is(login.ok, "ordinary CIC staff can sign in", String(login.status));
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];

  /* 🔴 The workspace header, which the real page sends via workspaceFetch.
   * requireTab() demands it of EVERYONE — super admins included — and answers
   * 400 rather than guessing which workspace a bare call meant. A check that
   * omits it is testing its own omission, not the feature. */
  const WS = { cookie, "X-Workspace-Slug": "christchurch-international-cup" };

  const noWs = await fetch(`${BASE}/api/admin/football-fest/registrations`, { headers: { cookie } });
  is(noWs.status === 400, "a call with no workspace header is refused, not guessed", String(noWs.status));

  const board = await fetch(`${BASE}/api/admin/football-fest/registrations`, { headers: WS });
  const boardBody: any = await board.json().catch(() => ({}));
  is(board.status === 200, "ordinary staff can read the board", String(board.status));
  is(Array.isArray(boardBody?.rows), "the board returns rows");
  is(boardBody?.counts?.total === boardBody?.rows?.length,
     "the total is derived from the rows it returned",
     `${boardBody?.counts?.total} vs ${boardBody?.rows?.length}`);
  is(Array.isArray(boardBody?.statuses) && boardBody.statuses.includes("contacted"),
     "the statuses come from the server, not the page");

  if (goodBody?.id) {
    const patch = await fetch(`${BASE}/api/admin/football-fest/registrations/${goodBody.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...WS },
      body: JSON.stringify({ status: "contacted", notes: "VERIFY note" }) });
    is(patch.status === 200, "staff can move one to contacted", String(patch.status));

    const junk = await fetch(`${BASE}/api/admin/football-fest/registrations/${goodBody.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...WS },
      body: JSON.stringify({ status: "not-a-real-status" }) });
    is(junk.status === 400, "an unknown status is refused", String(junk.status));

    const missing = await fetch(`${BASE}/api/admin/football-fest/registrations/99999999`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...WS },
      body: JSON.stringify({ status: "contacted" }) });
    is(missing.status === 404, "a row that is not ours answers 404", String(missing.status));
  }

  // ── the page itself, in a real browser, as that same ordinary staffer ─────
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const [cn, cv] = cookie.split("=");
  for (const size of [{ w: 1440, h: 900, label: "desktop" }, { w: 390, h: 844, label: "phone" }]) {
    const page = await browser.newPage();
    await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 1, isMobile: size.w < 500 });
    await page.setCookie({ name: cn, value: cv, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
    /* The SPA reads its workspace from localStorage; without it every
     * workspace-scoped route renders as if it were empty, which screenshots
     * like a working page with no data. */
    await page.evaluateOnNewDocument(() => {
      try { localStorage.setItem("clubos_workspace", "christchurch-international-cup"); } catch {}
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}/admin/football-fest`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 1800));
    const seen = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="page-football-fest"]');
      const de = document.documentElement;
      return {
        mounted: !!root,
        text: (document.body.innerText || "").slice(0, 4000),
        overflow: de.scrollWidth > de.clientWidth ? `${de.scrollWidth}>${de.clientWidth}` : "",
      };
    });
    is(seen.mounted, `[${size.label}] the page mounts for ordinary staff`);
    is(errors.length === 0, `[${size.label}] no runtime errors`, errors.join(" | "));
    is(!seen.overflow, `[${size.label}] no sideways overflow`, seen.overflow);
    is(/Registrations of interest/i.test(seen.text), `[${size.label}] the interest section is on the page`);
    /* 🔴 The row must actually APPEAR. A page that renders a permission failure
     * as an empty state passes every other check ever written for it. */
    is(seen.text.includes("VERIFY Kaikoura Coffee Co"),
       `[${size.label}] a real enquiry is VISIBLE, not an empty state`);
    // 🔴 No price, anywhere. That is the whole point of the change.
    is(!/\$\s?200|200 a day/i.test(seen.text), `[${size.label}] no stall price on the board`);
    await page.screenshot({ path: `../../../../outputs/ui-preflight/football-fest-admin-${size.label}.png` });

    /* 🔴 A tab lives in FOUR places, and app-sidebar.tsx's per-workspace nav
     * array is the one that actually renders the link. Verifying by navigating
     * to the URL proves the route resolves and NOTHING about whether a human
     * can find it. So: switch to the Ethnic view the way a person does, and
     * click the link. */
    if (size.label === "desktop") {
      await page.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 1200));
      const clickedEthnic = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((e) => /^ethnic$/i.test((e.textContent || "").trim()));
        if (!b) return false;
        (b as HTMLElement).click();
        return true;
      });
      is(clickedEthnic, "the Ethnic view switcher exists");
      await new Promise((r) => setTimeout(r, 1200));
      const link = await page.evaluate(() => {
        const a = [...document.querySelectorAll("a")].find((e) => /football fest/i.test(e.textContent || ""));
        return a ? (a as HTMLAnchorElement).getAttribute("href") : null;
      });
      is(link === "/admin/football-fest", "a Football Fest link is VISIBLE in the Ethnic sidebar", String(link));
      if (link) {
        await page.evaluate(() => {
          const a = [...document.querySelectorAll("a")].find((e) => /football fest/i.test(e.textContent || ""));
          (a as HTMLElement)?.click();
        });
        await new Promise((r) => setTimeout(r, 1800));
        const landed = await page.evaluate(() =>
          !!document.querySelector('[data-testid="page-football-fest"]') && location.pathname);
        is(landed === "/admin/football-fest", "clicking it lands on the page", String(landed));
        await page.screenshot({ path: "../../../../outputs/ui-preflight/football-fest-sidebar.png" });
      }
    }
    await page.close();
  }
} catch (e: any) {
  bad("threw", e?.message || String(e));
} finally {
  if (browser) await browser.close().catch(() => {});
  // Clean up whatever this run created, pass or fail.
  for (const id of rows) await pool.query(`DELETE FROM football_fest_registrations WHERE id = $1`, [id]).catch(() => {});
  for (const id of users) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  }
  await pool.end();
  console.log(`\n${failed ? `${failed} FAILED` : "all checks passed"}\n`);
  process.exit(failed ? 1 : 0);
}

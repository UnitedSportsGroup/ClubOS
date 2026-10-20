/**
 * MFL Analytics — Lifetime + Acquisition, in a REAL browser, as ORDINARY MFL
 * staff (never the super admin), at 1440×900 and 390×844.
 *
 *   npx tsx --env-file=.env script/_verify-league-analytics-browser.ts
 *   VERIFY_BASE=https://app.usg.co.nz (default) — or any deployed ClubOS
 *
 * Creates one throwaway MFL team_member holding ONLY the analytics tab, signs
 * in through the real login, and deletes the account at the end.
 *
 *   VERIFY_PREVIEW_URL=http://localhost:5207/ltv.html
 * skips the account entirely and runs the same checks against the preview
 * harness (preview/ltv.*, fixtures from the live compute, no server booted).
 *
 * Checks, per width and per sub-tab: real numbers render (not a dash, not a
 * spinner, not an error), no horizontal page overflow, every button / tab /
 * select is at least 44px tall, the URL hash follows the tab. Screenshots go to
 * outputs/mfl-analytics-preflight/.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const PREVIEW = process.env.VERIFY_PREVIEW_URL || "";
const WORKSPACE = "mini-football-leagues";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "mfl-analytics-preflight");

let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`);
  good ? pass++ : fail++;
};
const users: number[] = [];
let pool: pg.Pool | null = null;
let browser: any = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function staffCookie(): Promise<{ name: string; value: string; domain: string }> {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const email = `_mflltv_ui_${Date.now()}@usg.co.nz`;
  const password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'Preflight','MFLAnalytics',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(password, 10)],
  );
  users.push(rows[0].id);
  const { rows: o } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'team_member',$3::jsonb)`,
    [rows[0].id, o[0].id, JSON.stringify(["analytics"])]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new Error(`login failed HTTP ${login.status}`);
  const [name, value] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
  return { name, value, domain: new URL(BASE).hostname };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nMFL Analytics Lifetime / Acquisition — browser check against ${PREVIEW || BASE}\n`);
  const cookie = PREVIEW ? null : await staffCookie();
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

  for (const [label, width, height, mobile] of [["desktop", 1440, 900, false], ["mobile", 390, 844, true]] as const) {
    for (const tab of ["lifetime", "acquisition"] as const) {
      console.log(`\n${tab} · ${label} (${width}×${height})`);
      const page = await browser.newPage();
      await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
      if (cookie) {
        await page.setCookie({ ...cookie, path: "/", httpOnly: true, secure: BASE.startsWith("https") });
        await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), WORKSPACE);
      }
      // Open the page on Overview, then CLICK the sub-tab, like a person would.
      await page.goto(PREVIEW ? PREVIEW : `${BASE}/admin/analytics`, { waitUntil: "networkidle2", timeout: 90000 });
      await page.waitForSelector(`[data-testid="tab-${tab}"]`, { timeout: 30000 });
      await page.click(`[data-testid="tab-${tab}"]`);
      // Wait for the view itself (the first build can take ~20s on a cold cache).
      const loaded = await page.waitForSelector(`[data-testid="view-${tab}"], [data-testid="lifetime-error"]`, { timeout: 60000 }).then(() => true).catch(() => false);
      await sleep(1200);

      const m: any = await page.evaluate(`(function(){
        var WIDTH = ${width};
        var de = document.documentElement;
        var q = function(s){ var e = document.querySelector(s); return e ? e.innerText.trim() : null; };
        var small = [];
        var els = document.querySelectorAll('main button, main [role="tab"], main [role="combobox"], [data-testid^="tab-"], [data-testid^="scenario-"], [data-testid="analytics-ltv-term"]');
        for (var i = 0; i < els.length; i++) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.height < 44) small.push((els[i].innerText || els[i].getAttribute('data-testid') || els[i].tagName).trim().slice(0,30) + ' ' + Math.round(r.height) + 'px'); }
        var wide = [];
        var all = document.querySelectorAll('[data-testid^="view-"] *');
        for (var j = 0; j < all.length; j++) { var b = all[j].getBoundingClientRect(); if (b.right > WIDTH + 1 && !all[j].closest('.overflow-x-auto')) { wide.push(all[j].tagName + '.' + String(all[j].className).slice(0,40) + ' ' + Math.round(b.right)); if (wide.length > 4) break; } }
        return {
          docWidth: de.scrollWidth, winWidth: window.innerWidth, hash: location.hash,
          error: q('[data-testid="lifetime-error"]'),
          login: /Forgot password/i.test(document.body.innerText),
          meanTerms: q('[data-testid="ltv-mean-terms-value"]'),
          ltgp: q('[data-testid="ltv-ltgp-value"]'),
          paid5: q('[data-testid="format-paid-5s"]'), paid7: q('[data-testid="format-paid-7s"]'),
          retRows: document.querySelectorAll('[data-testid^="retention-row-"]').length,
          survivors: q('[data-testid="card-survivors"]'),
          cac: q('[data-testid="acq-cac-value"]'), ratio: q('[data-testid="acq-ratio-value"]'),
          acqRows: document.querySelectorAll('[data-testid^="acq-row-"]').length,
          explainer: !!document.querySelector('[data-testid="blended-explainer"]'),
          mixFirst: q('[data-testid="mix-first-touch"]'),
          small: small, wide: wide
        };
      })()`);

      ok("signed in as staff, not the login screen", !m.login);
      ok("the view rendered (no error, no endless spinner)", loaded && !m.error, m.error ?? "");
      ok(`URL hash follows the tab (#${tab})`, m.hash === `#${tab}`, m.hash);
      const real = (v: string | null) => !!v && v !== "—" && /\d/.test(v);
      if (tab === "lifetime") {
        ok("mean terms per team is a number", real(m.meanTerms), m.meanTerms ?? "");
        ok("LTGP is a dollar figure", real(m.ltgp) && m.ltgp.startsWith("$"), m.ltgp ?? "");
        ok("5-a-side and 7-a-side paid-per-entry render", real(m.paid5) && real(m.paid7), `${m.paid5} / ${m.paid7}`);
        ok("retention table has a row per term", m.retRows >= 18, String(m.retRows));
        ok("survivors card names teams", !!m.survivors && /of \d+ teams/.test(m.survivors));
      } else {
        ok("blended CAC is a dollar figure", real(m.cac) && m.cac.startsWith("$"), m.cac ?? "");
        ok("LTGP : CAC is a ratio", real(m.ratio) && /: 1$/.test(m.ratio), m.ratio ?? "");
        ok("per-term table lists every term with data", m.acqRows >= 18, String(m.acqRows));
        ok("the blended-CAC explanation is on screen", m.explainer);
        ok("first-touch mix renders", !!m.mixFirst && /\d/.test(m.mixFirst));
      }
      // Compare with the width we SET: on a phone the layout viewport grows to fit
      // wide content, so innerWidth alone reads "455 vs 455" and passes an overflow.
      ok("no horizontal page overflow", m.docWidth <= width + 1 && m.winWidth <= width + 1, `${m.docWidth} / ${m.winWidth} vs ${width}${m.wide.length ? " · " + m.wide.join(" | ") : ""}`);
      ok("every control is at least 44px tall", m.small.length === 0, m.small.join(", "));

      const shot = join(OUT, `${tab}-${label}.png`);
      await page.screenshot({ path: shot, fullPage: !mobile });
      if (mobile) {
        // Phone: shoot viewport by viewport (a full-page phone capture wraps past 16k device px).
        const h = await page.evaluate("document.documentElement.scrollHeight");
        for (let y = 0, n = 0; y < Math.min(h as number, height * 6); y += height, n++) {
          await page.evaluate(`window.scrollTo(0, ${y})`);
          await sleep(250);
          await page.screenshot({ path: join(OUT, `${tab}-${label}-${n}.png`) });
        }
      }
      console.log(`  → ${shot}`);
      await page.close();
    }
  }
}

main()
  .catch((e) => { console.error("\nthrew:", e.message); fail++; })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    if (pool) {
      for (const id of users) {
        await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {});
        await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {});
      }
      await pool.end();
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });

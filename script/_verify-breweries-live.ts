/**
 * Sponsorship → Breweries — live checks against production.
 *
 *   npx tsx --env-file=.env script/_verify-breweries-live.ts
 *
 * 🔴 Signs in as ORDINARY staff (a USG workspace admin), never a super admin —
 *    a super admin short-circuits every check and proves nothing about staff.
 * 🔴 Asserts the offers are NOT in the public client bundle (a brewer's
 *    confidential volume and every rival's pricing live server-side only).
 * Throwaway accounts are deleted on the way out, pass or fail.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BREW_CHECK_BASE || "https://app.usg.co.nz";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const URL_API = `${BASE}/api/admin/sponsorship/breweries`;

let failed = 0;
const ok = (m: string, d = "") => console.log(`  ok   ${m}${d ? ` — ${d}` : ""}`);
const bad = (m: string, d = "") => { failed++; console.log(`  FAIL ${m}${d ? ` — ${d}` : ""}`); };
const is = (good: boolean, m: string, d = "") => (good ? ok(m, d) : bad(m, d));
const users: number[] = [];
let browser: any = null;

async function staff(slug: string, label: string) {
  const email = `_brew_${label}_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows: u } = await pool.query(
    `INSERT INTO users (email,first_name,last_name,password,role,active)
     VALUES ($1,'Brewery','Check',$2,'admin',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  users.push(u[0].id);
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug = $1`, [slug]);
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [u[0].id, org[0].id]);
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  is(login.ok, `${label} staff can sign in`, String(login.status));
  return (login.headers.get("set-cookie") || "").split(";")[0];
}

try {
  console.log(`\nBreweries — live against ${BASE}\n`);

  const anon = await fetch(URL_API);
  is(anon.status === 401, "refuses an anonymous caller", String(anon.status));

  const usg = await staff("united-sports-group", "usg");
  const r = await fetch(URL_API, { headers: { cookie: usg, "X-Workspace-Slug": "united-sports-group" } });
  const body: any = await r.json().catch(() => ({}));
  is(r.status === 200, "ordinary USG staff can read it", String(r.status));
  is(body?.offers?.length === 4, "four offers", String(body?.offers?.length));
  is(["moa", "renaissance", "db"].every(k => (body?.submissions?.[k]?.text || "").length > 500),
     "three submissions come back word for word");
  is(/0\.80c per litre/.test(body?.submissions?.moa?.text || ""), "Moa's text is verbatim (\"0.80c per litre\")");
  is(r.headers.get("cache-control")?.includes("no-store") === true, "not cached", String(r.headers.get("cache-control")));

  const other = await fetch(URL_API, { headers: { cookie: usg, "X-Workspace-Slug": "christchurch-united" } });
  is(other.status === 403 || other.status === 404, "not served under another workspace header", String(other.status));

  const cufc = await staff("christchurch-united", "cufc");
  const cross = await fetch(URL_API, { headers: { cookie: cufc, "X-Workspace-Slug": "christchurch-united" } });
  is(cross.status === 404 || cross.status === 403, "a CUFC admin cannot read it from CUFC", String(cross.status));
  const spoof = await fetch(URL_API, { headers: { cookie: cufc, "X-Workspace-Slug": "united-sports-group" } });
  is(spoof.status === 403 || spoof.status === 404, "…nor by claiming the USG header", String(spoof.status));

  // 🔴 None of it may ship in the public bundle.
  const html = await (await fetch(`${BASE}/admin/sponsorship`)).text();
  const js = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
  let bundle = "";
  for (const p of js) bundle += await (await fetch(`${BASE}${p}`)).text();
  const lazy = [...bundle.matchAll(/"(\.?\/?assets\/[^"]+\.js)"/g)].map(m => m[1].replace(/^\.?\/?/, "/"));
  for (const p of [...new Set(lazy)].slice(0, 200)) bundle += await (await fetch(`${BASE}${p}`)).text().catch(() => "");
  is(bundle.length > 100_000, "read the live bundle", `${Math.round(bundle.length / 1024)} KB`);
  is(/Breweries/.test(bundle), "the Breweries tab ships");
  for (const secret of ["casselsbrewery", "65,000", "0.80c per litre", "rosie.osullivan", "jason@brandhouse"]) {
    is(!bundle.includes(secret), `bundle does not contain "${secret}"`);
  }

  // ── the page, in a real browser, as that same ordinary USG staffer ───────
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const [cn, cv] = usg.split("=");
  const VIEWS = ["overview", "compare", "value", "volume", "terms", "submissions", "timeline", "issues"];
  for (const size of [{ w: 1440, h: 900, label: "desktop" }, { w: 390, h: 844, label: "phone" }]) {
    const page = await browser.newPage();
    await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 1, isMobile: size.w < 500 });
    await page.setCookie({ name: cn, value: cv, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem("clubos_workspace", "united-sports-group"); } catch {} });
    const errors: string[] = [];
    page.on("pageerror", (e: any) => errors.push(String(e)));
    await page.goto(`${BASE}/admin/sponsorship`, { waitUntil: "networkidle0" });
    await new Promise(r => setTimeout(r, 1500));
    // Click the tab the way a person does.
    const clicked = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="tab-breweries"]') as HTMLElement | null;
      if (!b) return false; b.click(); return true;
    });
    is(clicked, `[${size.label}] the Breweries tab is up top`);
    await page.waitForSelector('[data-testid="breweries-view"], [data-testid="breweries-error"]', { timeout: 15000 }).catch(() => {});
    for (const v of VIEWS) {
      await page.evaluate((k: string) => (document.querySelector(`[data-testid="breweries-view-${k}"]`) as HTMLElement)?.click(), v);
      await new Promise(r => setTimeout(r, 500));
      const seen = await page.evaluate(() => {
        const de = document.documentElement;
        return {
          ok: !!document.querySelector('[data-testid="breweries-view"]'),
          err: document.querySelector('[data-testid="breweries-error"]')?.textContent || "",
          text: document.body.innerText || "",
          overflow: de.scrollWidth > de.clientWidth ? `${de.scrollWidth}>${de.clientWidth}` : "",
        };
      });
      is(seen.ok && !seen.err, `[${size.label}] ${v} renders`, seen.err);
      is(!seen.overflow, `[${size.label}] ${v}: no sideways page overflow`, seen.overflow);
      if (v === "overview") is(/Moa Brewing/i.test(seen.text) && /DB Breweries/i.test(seen.text), `[${size.label}] offers are VISIBLE, not an empty state`);
      if (v === "submissions") is(/Southern Alps Brewing & Moa Brewing/i.test(seen.text), `[${size.label}] a submission reads word for word`);
      if (v === "value") is(/\$45,400/.test(seen.text) || /\$22,600/.test(seen.text), `[${size.label}] the calculator prices the offers`);
      await page.screenshot({ path: `../../../../outputs/ui-preflight/breweries-${v}-${size.label}.png`, fullPage: size.label === "desktop" });
    }
    is(errors.length === 0, `[${size.label}] no runtime errors`, errors.join(" | "));
    await page.close();
  }
} catch (e: any) {
  bad("threw", e?.message || String(e));
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const id of users) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  }
  await pool.end();
  console.log(`\n${failed ? `${failed} FAILED` : "all checks passed"}\n`);
  process.exit(failed ? 1 : 0);
}

// Back from a session roll returns you to SESSIONS, and the roll's search box
// is not a black bar on a white page.
//
// Daniel, 2026-09-10: "when i go back from that sessions page it takes me back
// to players not sessions tab — we've had this issue before with other areas of
// software, really need this fixed now and forever more" and, of the roll's
// search field, "fix this formatting shitty".
//
// 🔴 One cause behind the navigation half: the programme page read its tab from
// the URL hash ON MOUNT and never wrote it back, so the URL never knew which
// tab you were on. Every consequence looked like its own bug — a sub-page could
// not send you back to the right tab, browser Back could not step between tabs,
// and a tab could not be linked to once you had clicked off it.
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WORKSPACE = "christchurch-united";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); g ? pass++ : fail++; };
const users: number[] = [];
let browser: any = null;

async function main() {
  console.log(`\nSession roll — navigation and ink — ${BASE}\n`);

  // A real term session on the FUNiño programme.
  const { rows: sess } = await pool.query(`
    SELECT cd.id AS date_id, cd.camp_id FROM camp_dates cd
    JOIN programs p ON p.id = cd.camp_id
    WHERE p.organization_id = 1 AND cd.start_time IS NOT NULL
    ORDER BY cd.date DESC LIMIT 1`);
  if (!sess.length) throw new Error("no term session found to open");
  const rollPath = `/admin/academy/${sess[0].camp_id}/session/${sess[0].date_id}/SESSION`;

  const email = `_roll_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Roll','Probe',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)]);
  users.push(rows[0].id);
  const { rows: o } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [rows[0].id, o[0].id]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }) });
  const [cn, cv] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");

  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.setCookie({ name: cn, value: cv, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), WORKSPACE);
  await page.goto(`${BASE}${rollPath}`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));

  ok("the roll opens", /Session/i.test(await page.evaluate(() => document.body.innerText)));

  // ── The ink ───────────────────────────────────────────────────────────────
  // 🔴 Measured, not eyeballed: a dark box on a light page is a computed
  // luminance, and reading the class list would only tell us what we wrote.
  // 🔴 Composite the ancestors. A 3% translucent background computes as
  // "rgba(59,130,246,0.03)" whatever it is sitting on, so reading one element's
  // backgroundColor cannot tell you whether the box looks black — the very
  // thing being asserted. Walk up until an opaque colour is found and blend.
  const ink: any = await page.evaluate(`(function(){
    var el = document.querySelector('input[placeholder*="Search"]');
    if (!el) return null;
    function parse(c){
      var m = (c.match(/[\d.]+/g)||[]).map(Number);
      if (m.length < 3) return null;
      return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
    }
    function effectiveBg(node){
      var stack = [];
      for (var n = node; n; n = n.parentElement) {
        var c = parse(getComputedStyle(n).backgroundColor);
        if (!c || c.a === 0) continue;
        stack.push(c);
        if (c.a === 1) break;
      }
      var base = { r: 255, g: 255, b: 255 };
      for (var i = stack.length - 1; i >= 0; i--) {
        var c2 = stack[i];
        base = {
          r: c2.r * c2.a + base.r * (1 - c2.a),
          g: c2.g * c2.a + base.g * (1 - c2.a),
          b: c2.b * c2.a + base.b * (1 - c2.a)
        };
      }
      return base;
    }
    var bg = effectiveBg(el);
    var fg = parse(getComputedStyle(el).color) || { r: 0, g: 0, b: 0, a: 1 };
    var L = function(c){ return (0.2126*c.r + 0.7152*c.g + 0.0722*c.b) / 255; };
    return {
      bg: "rgb(" + Math.round(bg.r) + "," + Math.round(bg.g) + "," + Math.round(bg.b) + ")",
      fg: getComputedStyle(el).color,
      bgLum: L(bg),
      fgLum: L(fg)
    };
  })()`);

  ok("the search box exists", ink !== null);
  if (ink) {
    ok("its background is LIGHT, not a black bar", (ink.bgLum ?? 1) > 0.6, `${ink.bg} lum=${(ink.bgLum ?? -1).toFixed(2)}`);
    ok("its text is DARK enough to read on that", (ink.fgLum ?? 0) < 0.5, `${ink.fg} lum=${(ink.fgLum ?? -1).toFixed(2)}`);
  }

  {
    const { mkdirSync } = await import("fs");
    const { join } = await import("path");
    const OUT = join(process.cwd(), "outputs", "roll-preflight");
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, "roll.png") });
    console.log(`  → ${join(OUT, "roll.png")}`);
  }

  // ── The navigation ────────────────────────────────────────────────────────
  await page.click('[data-testid="link-back-to-camp"]');
  await new Promise((r) => setTimeout(r, 2500));
  const after: any = await page.evaluate(`(function(){
    var active = Array.from(document.querySelectorAll('button')).filter(function(b){
      return /^(Players|Sessions|Coaches|Content|Schedule|Pricing|Discounts)$/i.test(b.innerText.trim());
    }).map(function(b){ return { t: b.innerText.trim(), on: b.className.indexOf('blue') >= 0 }; });
    return { hash: location.hash, active: active, body: document.body.innerText.slice(0, 200) };
  })()`);
  ok("back lands on the programme page", /academy|camps/.test(await page.evaluate(() => location.pathname)));
  ok("the URL names the tab", after.hash === "#sessions", after.hash || "(no hash)");
  const on = after.active.filter((a: any) => a.on).map((a: any) => a.t);
  ok("SESSIONS is the tab showing, not Players", on.includes("Sessions") && !on.includes("Players"), on.join(",") || "none highlighted");

  // Switching a tab must write the URL, or none of the above can hold.
  const players = await page.$x ? null : null;
  await page.evaluate(`(function(){
    var b = Array.from(document.querySelectorAll('button')).find(function(x){ return x.innerText.trim() === 'Coaches'; });
    if (b) b.click();
  })()`);
  await new Promise((r) => setTimeout(r, 900));
  ok("switching a tab writes it to the URL",
    (await page.evaluate(() => location.hash)) === "#coaches",
    await page.evaluate(() => location.hash) || "(no hash)");
}

main().catch((e) => { console.error("\nthrew:", e.message); fail++; }).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  for (const id of users) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {});
  }
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});

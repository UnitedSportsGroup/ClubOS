// The dashboards, in a real browser, as an ordinary staff member.
import pg from "pg"; import bcrypt from "bcryptjs"; import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs"; import { join } from "path";
const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "dashboards");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0; const users: number[] = []; let browser: any = null;
const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); g ? pass++ : fail++; };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const email = `_dash_${Date.now()}@usg.co.nz`; const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Dash','Probe',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)]);
  users.push(rows[0].id);
  const { rows: orgs } = await pool.query(
    `SELECT id, slug FROM organizations WHERE slug IN ('christchurch-united','mini-football-leagues','christchurch-international-cup')`);
  for (const o of orgs) await pool.query(
    `INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [rows[0].id, o.id]);

  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }) });
  const [cn, cv] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");

  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.setCookie({ name: cn, value: cv, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });

  for (const [label, slug, cic] of [
    ["cufc", "christchurch-united", null],
    ["mfl", "mini-football-leagues", null],
    ["cic-youth", "christchurch-international-cup", "youth"],
    ["cic-7s", "christchurch-international-cup", "7s"],
  ] as const) {
    console.log(`\n${label}`);
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((s: string, v: string | null) => {
      localStorage.setItem("clubos_workspace", s);
      if (v) localStorage.setItem("clubos_cic_view", v);
    }, slug, cic);
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 4000));
    const m: any = await page.evaluate(`(function(){
      var b = document.body.innerText;
      return {
        title: (document.querySelector('[data-testid="text-page-title"]')||{}).innerText || null,
        cardTitles: Array.from(document.querySelectorAll('h2')).map(function(e){return e.innerText.trim();}).filter(Boolean),
        axisTicks: Array.from(document.querySelectorAll('.recharts-yAxis text')).map(function(e){return e.textContent;}),
        countAxisHasDollars: (function(){
          var heads = Array.from(document.querySelectorAll('h2')).map(function(e){return e.innerText.trim();});
          if (!heads.some(function(h){return /interest/i.test(h);})) return false;
          return Array.from(document.querySelectorAll('.recharts-yAxis text')).some(function(e){return /\$/.test(e.textContent||"");});
        })(),
        totals: Array.from(document.querySelectorAll('[data-testid="text-revenue-total"]')).map(function(e){return e.innerText;}),
        hasPicker: !!document.querySelector('button, [role="tablist"]') && /Last 30 days/.test(b),
        headings: (b.match(/Revenue|Registrations of interest|Sales revenue|Nothing charted here yet/g)||[]),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        text: b.slice(0, 260)
      };
    })()`);
    ok("the dashboard renders", m.title === "Dashboard", String(m.title));
    ok("a timeframe selector is present", m.hasPicker);
    ok("at least one number is charted", m.totals.length > 0, m.totals.join(" | "));
    console.log(`     cards: ${[...new Set(m.headings)].join(", ") || "(none)"}`);
    ok("no horizontal overflow", m.overflow <= 1, String(m.overflow));
    // 🔴 Two cards on one dashboard must not carry the same title, and a count
    // must not be described in money.
    const titles = m.cardTitles as string[];
    ok("every card has its own title", new Set(titles).size === titles.length, titles.join(" | "));
    ok("a count card is not titled Revenue",
      !(label.startsWith("cic") && titles.includes("Revenue")), titles.join(" | "));
    ok("no dollar signs on a count chart's axis",
      !m.countAxisHasDollars, m.axisTicks?.slice(0, 4).join(" ") ?? "");
    await page.screenshot({ path: join(OUT, `${label}.png`) });
    console.log(`  → ${join(OUT, `${label}.png`)}`);
  }
}
main().catch((e) => { console.error("threw:", e.message); fail++; }).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  for (const id of users) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {});
  }
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});

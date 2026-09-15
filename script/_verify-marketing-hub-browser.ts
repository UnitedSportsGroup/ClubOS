/**
 * Marketing hub — every section, in a real browser, as an ORDINARY staff member,
 * at laptop and phone widths.
 *
 *   npx tsx --env-file=.env script/_verify-marketing-hub-browser.ts
 *
 * A tsc pass and a 200 from every endpoint still allow a white screen (a hook
 * below an early return, an un-imported icon), so this opens the page the way a
 * person does and fails on: a React error, a blank body, "NaN"/"undefined" in
 * the text, a missing section, the page scrolling sideways, or no sidebar link
 * to click. Screenshots land in outputs/marketing-hub/ — LOOK at them; the
 * measurements have missed things a screenshot showed before.
 *
 * 🔴 Waits for CONTENT, never for the clock: a fixed delay once called a working
 * layout broken because the fetch had not landed.
 * 🔴 innerText reflects CSS text-transform, so every text match is case-insensitive.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "marketing-hub");
const USG = "united-sports-group";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0;
let fail = 0;
const users: number[] = [];
let browser: any = null;
const ok = (l: string, g: boolean, d = "") => {
  console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`);
  g ? pass++ : fail++;
};

// What must be on screen once each section's data has arrived.
const SECTIONS: { hash: string; expect: RegExp }[] = [
  { hash: "overview", expect: /by workspace/i },
  { hash: "websites", expect: /clubos tracking/i },
  { hash: "forms", expect: /submissions/i },
  { hash: "ads", expect: /spend/i },
  { hash: "social", expect: /followers/i },
  { hash: "sources", expect: /automatic pulls/i },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const email = `_mhub_browser_${Date.now()}@usg.co.nz`;
  const pw = `B${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1, 'Marketing', 'Browser', $2, 'team_member', true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)],
  );
  users.push(rows[0].id);
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug = $1`, [USG]);
  // The realistic grant: an ordinary team member given the Marketing tab and nothing else.
  await pool.query(
    `INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, $2, 'team_member', $3)`,
    [rows[0].id, org[0].id, JSON.stringify(["marketing-hub"])],
  );
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  if (!login.ok) throw new Error(`login HTTP ${login.status}`);
  const [cn, cv] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");

  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

  for (const viewport of [
    { label: "laptop", width: 1440, height: 900 },
    { label: "phone", width: 390, height: 844 },
  ]) {
    console.log(`\n${viewport.label} (${viewport.width}×${viewport.height})`);
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 2 });
    await page.setCookie({ name: cn, value: cv, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), USG);

    if (viewport.label === "laptop") {
      // A route that resolves proves nothing about whether a person can FIND it.
      await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 60000 });
      const link = await page.waitForSelector('a[href="/admin/marketing-hub"]', { timeout: 20000 }).catch(() => null);
      ok("the sidebar has a Marketing link", Boolean(link));
      if (link) {
        await link.click();
        await page.waitForFunction(() => location.pathname === "/admin/marketing-hub", { timeout: 15000 }).catch(() => {});
        ok("clicking it opens the Marketing page", page.url().includes("/admin/marketing-hub"), page.url());
      }
    }

    for (const s of SECTIONS) {
      await page.goto(`${BASE}/admin/marketing-hub?period=30d#${s.hash}`, { waitUntil: "networkidle2", timeout: 60000 });
      const loaded = await page
        .waitForFunction(
          (src: string) =>
            new RegExp(src, "i").test(document.body.innerText) && !document.querySelector(".animate-pulse"),
          { timeout: 45000 },
          s.expect.source,
        )
        .then(() => true)
        .catch(() => false);
      const m: any = await page.evaluate(() => ({
        text: document.body.innerText,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        heading: (document.querySelector("h1") as HTMLElement | null)?.innerText ?? null,
      }));
      ok(`${s.hash}: its content appears`, loaded);
      ok(`${s.hash}: the page title reads Marketing`, /marketing/i.test(m.heading ?? ""), String(m.heading));
      ok(`${s.hash}: no NaN or undefined on screen`, !/\bNaN\b|\bundefined\b/.test(m.text));
      ok(`${s.hash}: no error message`, !/couldn't load|something went wrong/i.test(m.text));
      ok(`${s.hash}: nothing scrolls sideways`, m.overflow <= 1, `${m.overflow}px`);
      await page.screenshot({ path: join(OUT, `${viewport.label}-${s.hash}.png`), fullPage: false });
    }

    // One workspace: the table narrows to it.
    await page.goto(`${BASE}/admin/marketing-hub?period=30d&workspace=mini-football-leagues#overview`, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    const narrowed = await page
      .waitForFunction(() => /by workspace/i.test(document.body.innerText) && !document.querySelector(".animate-pulse"), { timeout: 45000 })
      .then(() => true)
      .catch(() => false);
    const rowsShown: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll("tbody tr")).map((r) => (r as HTMLElement).innerText.split("\n")[0].trim()),
    );
    ok("choosing Mini Football narrows the workspace table to it", narrowed && rowsShown.length === 1 && /mini football/i.test(rowsShown[0] ?? ""), rowsShown.join(" | "));
    await page.screenshot({ path: join(OUT, `${viewport.label}-overview-mfl.png`) });

    ok("no uncaught errors in the page", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.close();
  }
  console.log(`\nScreenshots: ${OUT}`);
}

main()
  .catch((e) => {
    console.error("threw:", e.message);
    fail++;
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    for (const id of users) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
    }
    await pool.end();
    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
  });

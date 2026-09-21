// Holiday camps: ONE row per camp on the Academy list, and inside it the
// timeframe chips for every run of that camp — checked in a REAL browser as
// ORDINARY staff.
//
// Daniel, 2026-09-21: "We have two options: World Cup Holiday Camp,
// Fundamentals Holiday Camp. When you click inside, you've got the option to
// view the January camps, the April camps, the September/October camps…"
//
// 🔴 Expectations come from the DATABASE through the same decider the pages
// use (@shared/programme-series) — never a hardcoded "two rows".
//
//   npx tsx --env-file=.env script/_verify-camp-editions-browser.ts
//   SHOTS=/some/dir … writes screenshots there (read them by eye).
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { groupCampSeries, seriesName } from "../shared/programme-series";
import { nzTodayIso } from "../shared/management";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WORKSPACE = "christchurch-united";
const SHOTS = process.env.SHOTS || "";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};
let userId: number | null = null;
let browser: any = null;
const settle = (ms = 2400) => new Promise((r) => setTimeout(r, ms));
const lc = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

async function staffCookie() {
  const email = `_camps_probe_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'Camps','Probe',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)]);
  userId = rows[0].id;
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`, [userId, org[0].id]);
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }),
  });
  if (!res.ok) throw new Error(`login HTTP ${res.status}`);
  const [n, v] = (res.headers.get("set-cookie") || "").split(";")[0].split("=");
  return { name: n, value: v, orgId: org[0].id as number };
}
async function shot(page: any, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}
async function editionStrip(page: any) {
  return page.evaluate(() => ({
    // 🔴 innerText runs the inline spans together ("open109$11,870.00"), so the
    // count is read from its OWN span, never parsed out of the joined text.
    chips: Array.from(document.querySelectorAll('[data-testid^="filter-edition-"]')).map((el) => {
      const spans = Array.from(el.querySelectorAll("span")).map((x) => (x as HTMLElement).innerText.trim());
      return {
        id: Number((el.getAttribute("data-testid") || "").replace("filter-edition-", "")),
        text: (el as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
        count: spans.find((t) => /^\d+$/.test(t)) ?? null,
        money: spans.find((t) => /^\$[\d,]+\.\d{2}$/.test(t)) ?? null,
        current: el.getAttribute("aria-current") === "true",
      };
    }),
    title: (document.querySelector('[data-testid="text-camp-name"]') as HTMLElement | null)?.innerText.trim() ?? "",
    url: location.href,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

async function main() {
  const cookie = await staffCookie();
  const { rows: camps } = await pool.query(
    `SELECT id, name, slug, start_date::text AS "startDate", end_date::text AS "endDate", is_active AS "isActive"
     FROM programs WHERE organization_id = $1 AND type = 'holiday_camp'`, [cookie.orgId]);
  const series = groupCampSeries(camps as any[], nzTodayIso());
  console.log(`\n${camps.length} holiday-camp rows → ${series.length} camps: ${series.map((s) => `${s.name} (${s.editions.length})`).join(" · ")}`);
  ok("there is a camp with more than one run to test the chips on", series.some((s) => s.editions.length > 1));
  const multi = series.find((s) => s.editions.length > 1) ?? series[0];

  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: any) => errors.push(String(e.message).slice(0, 120)));
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ name: cookie.name, value: cookie.value, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), WORKSPACE);

  // ── The list: one row per camp ────────────────────────────────────────────
  console.log(`\nAcademy → Holiday Camps  (desktop 1440)\n`);
  await page.goto(`${BASE}/admin/academy`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle(3000);
  await shot(page, "01-academy-list-desktop");
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="row-camp-series-"]')).map((r) => ({
      id: r.getAttribute("data-testid") || "",
      name: (r.querySelector('[data-testid^="text-camp-series-"]') as HTMLElement | null)?.innerText.trim() ?? "",
      text: (r as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
    })));
  ok("one row per CAMP, not per school holiday", rows.length === series.length, `${rows.length} rows for ${camps.length} programme rows`);
  ok("every row is named as the camp, no edition suffix",
    rows.length > 0 && rows.every((r) => series.some((s) => lc(s.name) === lc(r.name))) && !rows.some((r) => /term \d/i.test(r.name)),
    rows.map((r) => r.name).join(" | "));
  ok("a camp with several runs says how many", rows.some((r) => new RegExp(`${multi.editions.length} camps`).test(r.text)),
    rows.map((r) => r.text.slice(0, 60)).join(" | "));
  const stale = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="row-academy-"]')).map((r) => (r as HTMLElement).innerText).filter((t) => /holiday camp/i.test(t)));
  ok("no holiday camp is still listed as a plain programme row", stale.length === 0, stale.join(" | "));

  // Click the multi-run camp → its CURRENT edition, with the chips.
  const rowId = `row-camp-series-${multi.key.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
  await page.click(`[data-testid="${rowId}"]`);
  await settle(3200);
  let s = await editionStrip(page);
  await shot(page, "02-camp-page-desktop");
  ok("the row opens the camp's CURRENT run", new RegExp(`/admin/academy/${multi.current.id}(?:[?#]|$)`).test(s.url), s.url.replace(BASE, ""));
  ok("the page title is the camp, not this run's name", lc(s.title) === lc(multi.name), `"${s.title}"`);
  ok("a chip per run of this camp", s.chips.length === multi.editions.length, `${s.chips.length} chips vs ${multi.editions.length} runs`);
  ok("the chips are in date order, oldest first", s.chips.map((c) => c.id).join(",") === multi.editions.map((e) => e.id).join(","), s.chips.map((c) => c.id).join(","));
  ok("exactly one chip is current, and it is this run", s.chips.filter((c) => c.current).length === 1 && s.chips.find((c) => c.current)?.id === multi.current.id);
  ok("chips are labelled by DATES (Apr 2026 / Sep–Oct 2026), not by name", s.chips.every((c) => /^[A-Z][a-z]{2}(?:[–-][A-Z][a-z]{2})? \d{4}/.test(c.text)), s.chips.map((c) => c.text).join(" | "));
  ok("every chip carries its registrations and money", s.chips.every((c) => c.count != null && c.money != null), s.chips.map((c) => `${c.count} · ${c.money}`).join(" | "));
  {
    const { rows: n } = await pool.query(`SELECT count(*)::int AS n FROM registrations WHERE program_id=$1 AND status IN ('confirmed','refunded','partially_refunded')`, [multi.current.id]);
    const chip = s.chips.find((c) => c.id === multi.current.id);
    ok("the current chip's count matches the database", !!chip && Number(chip.count) === n[0].n, `${chip?.count} vs ${n[0].n}`);
  }

  // Switch run on a non-default tab → the tab survives.
  const other = multi.editions.find((e) => e.id !== multi.current.id)!;
  await page.goto(`${BASE}/admin/academy/${multi.current.id}#sessions`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle(2600);
  await page.click(`[data-testid="filter-edition-${other.id}"]`);
  await settle(3200);
  s = await editionStrip(page);
  await shot(page, "03-camp-other-run-desktop");
  ok("choosing another run opens THAT run", new RegExp(`/admin/academy/${other.id}(?:[?#]|$)`).test(s.url), s.url.replace(BASE, ""));
  ok("…on the SAME tab", /#sessions$/.test(s.url), s.url.replace(BASE, ""));
  ok("…still under the camp's own title", lc(s.title) === lc(multi.name), `"${s.title}"`);
  ok("…with the chips still there and the new run current", s.chips.find((c) => c.current)?.id === other.id);
  ok("Back returns to the run you came from", (await page.goBack({ waitUntil: "networkidle2" }), await settle(2000), new RegExp(`/admin/academy/${multi.current.id}`).test(page.url())), page.url().replace(BASE, ""));

  // A camp's Players tab: age headings without academy wording.
  await page.goto(`${BASE}/admin/academy/${multi.current.id}#players`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle(3000);
  const headings = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="group-heading-"]')).map((el) => (el as HTMLElement).innerText.trim()));
  ok("a camp's age headings are plain grades, not 'Training Group'", headings.length === 0 || headings.every((h) => !/training group/i.test(h)), headings.slice(0, 4).join(" | "));

  // ── Phone ─────────────────────────────────────────────────────────────────
  console.log(`\nOn a phone (390)\n`);
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/admin/academy/${multi.current.id}`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle(3000);
  s = await editionStrip(page);
  await shot(page, "04-camp-page-phone");
  ok("the chips wrap — no sideways scroll", s.scrollWidth <= s.innerWidth + 1, `scrollWidth ${s.scrollWidth} / ${s.innerWidth}`);
  ok("every run's chip is on the phone too", s.chips.length === multi.editions.length);
  await page.goto(`${BASE}/admin/academy`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle(2600);
  await shot(page, "05-academy-list-phone");
  const phoneRows = await page.evaluate(() => document.querySelectorAll('[data-testid^="row-camp-series-"]').length);
  ok("the list groups the same way on a phone", phoneRows === series.length, `${phoneRows}`);

  ok("no React error on any page", errors.length === 0, errors.slice(0, 2).join(" · "));
  await page.close();
}

main()
  .catch((e) => { console.error("\nthrew:", e.message); fail++; })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    if (userId) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [userId]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(() => {});
    }
    await pool.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });

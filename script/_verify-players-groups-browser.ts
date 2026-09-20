// The Academy Players tab, checked in a REAL browser as ORDINARY staff.
//
// Daniel, 2026-09-21: "there need to be selectors at the top… similar to how
// you have the selectors for Term 4, Term 3, Term 2, and Term 1… a focused view
// of 'This is the age group I'm viewing.' … perfect for Term 4 and Term 1 …
// In Term 2 and Term 3, you need to change it to have it by team … At the
// bottom … 'Not currently assigned to a team'."
//
// 🔴 Signs in as a NORMAL staff member — a super admin short-circuits every
// permission check, so Daniel clicking it proves nothing about Olga.
// 🔴 Reads the programme and its terms from the database, and reads every
// expected count off the CHIP rather than hardcoding this week's numbers.
//
//   npx tsx --env-file=.env script/_verify-players-groups-browser.ts
//   SHOTS=/some/dir … writes screenshots there (read them by eye).
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WORKSPACE = "christchurch-united";
const SLUG = process.env.PROGRAMME_SLUG || "pre-academy-u9-u12";
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

async function staffCookie() {
  const email = `_players_probe_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'Players','Probe',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)]);
  userId = rows[0].id;
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`, [userId, org[0].id]);
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }),
  });
  if (!res.ok) throw new Error(`login HTTP ${res.status}`);
  const [n, v] = (res.headers.get("set-cookie") || "").split(";")[0].split("=");
  return { name: n, value: v };
}

type Snapshot = {
  groupBy: string | null; chips: { id: string; text: string; count: number }[];
  headings: string[]; rows: number; selects: number; url: string; scrollWidth: number; innerWidth: number;
};
async function snapshot(page: any): Promise<Snapshot> {
  return page.evaluate(() => {
    const strip = document.querySelector('[data-testid="filter-groups"]') as HTMLElement | null;
    const chips = Array.from(document.querySelectorAll('[data-testid^="filter-group-"]')).map((el) => {
      const text = (el as HTMLElement).innerText.replace(/\s+/g, " ").trim();
      const m = /(\d+)$/.exec(text);
      return { id: el.getAttribute("data-testid") || "", text, count: m ? Number(m[1]) : NaN };
    });
    return {
      groupBy: strip?.getAttribute("data-group-by") ?? null,
      chips,
      // 🔴 innerText reflects CSS text-transform (the headings are uppercased), so
      // the data-testid carries the real label and every text check is case-insensitive.
      headings: Array.from(document.querySelectorAll('[data-testid^="group-heading-"]')).map((el) => (el.getAttribute("data-testid") || "").replace(/^group-heading-/, "")),
      rows: document.querySelectorAll('[data-testid^="row-player-"]').length,
      selects: document.querySelectorAll('[data-testid^="select-group-"]').length,
      url: location.href,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
}
async function shot(page: any, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function main() {
  const { rows: progRows } = await pool.query(`SELECT id, name FROM programs WHERE slug=$1`, [SLUG]);
  if (!progRows.length) throw new Error(`no programme with slug ${SLUG}`);
  const prog = progRows[0];
  const { rows: termRows } = await pool.query(
    `SELECT DISTINCT t.id, t.term_number AS n, t.year FROM registrations r JOIN terms t ON t.id = r.term_id
     WHERE r.program_id = $1 AND r.status IN ('confirmed','refunded','partially_refunded') ORDER BY t.year DESC, n`, [prog.id]);
  const byN = (n: number) => termRows.find((t) => Number(t.n) === n);
  const winter = byN(3) ?? byN(2), summer = byN(4) ?? byN(1);
  console.log(`\n${prog.name} (#${prog.id}) — terms with registrations: ${termRows.map((t) => `T${t.n} ${t.year} (#${t.id})`).join(", ")}`);
  ok("a winter term (2 or 3) and a summer term (4 or 1) both have registrations to test against", !!winter && !!summer);
  if (!winter || !summer) return;

  const cookie = await staffCookie();
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: any) => errors.push(String(e.message).slice(0, 120)));
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ ...cookie, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), WORKSPACE);
  const open = async (termId: number, extra = "") => {
    await page.goto(`${BASE}/admin/academy/${prog.id}?term=${termId}${extra}#players`, { waitUntil: "networkidle2", timeout: 60000 });
    await settle(3000);
    return snapshot(page);
  };

  // ── Winter term: by TEAM ──────────────────────────────────────────────────
  console.log(`\nTerm ${winter.n} → by team  (desktop 1440)\n`);
  let s = await open(winter.id);
  await shot(page, `01-term${winter.n}-by-team-desktop`);
  ok("the players table renders", s.rows > 0, `${s.rows} rows`);
  ok("a group selector strip is drawn under the term picker", s.chips.length > 1, `${s.chips.length} chips`);
  ok("in a winter term the strip is BY TEAM", s.groupBy === "team", `data-group-by=${s.groupBy}`);
  ok("the first chip is All teams and its count is every player", /^All teams/.test(s.chips[0]?.text ?? "") && s.chips[0]?.count === s.rows,
    `${s.chips[0]?.text} vs ${s.rows} rows`);
  const teamChips = s.chips.slice(1);
  ok("every team chip carries a count", teamChips.every((c) => Number.isFinite(c.count) && c.count > 0));
  ok("the chip counts add up to the players on screen", teamChips.reduce((a, c) => a + c.count, 0) === s.rows,
    `${teamChips.reduce((a, c) => a + c.count, 0)} vs ${s.rows}`);
  ok("a heading per team on the table, one per chip", s.headings.length === teamChips.length, `${s.headings.length} headings / ${teamChips.length} chips`);
  ok("the headings are team NAMES, not training groups", s.headings.some((h) => /^U\d+(\/\d+)? [A-Za-z]/.test(h)) && !s.headings.some((h) => /training group/i.test(h)),
    s.headings.slice(0, 4).join(" | "));
  ok("'Not currently assigned to a team' is the LAST section", /^not currently assigned to a team/i.test(s.headings[s.headings.length - 1] ?? ""),
    s.headings[s.headings.length - 1] ?? "no headings");
  const gradeOf = (h: string) => { const m = /^U(\d+)(?:\/(\d+))?/.exec(h); return m ? Number(m[2] ?? m[1]) : null; };
  ok("teams read youngest first (U9 before U12)", (() => {
    const grades = s.headings.map(gradeOf).filter((g): g is number => g != null);
    return grades.every((g, i) => i === 0 || g >= grades[i - 1]);
  })(), s.headings.map((h) => h.split(" ")[0]).join(","));
  ok("no move-a-child control when the list is by team (teams come from the Squads tab)", s.selects === 0, `${s.selects} selects`);

  // Click a team chip → the focused view.
  const pick = teamChips.find((c) => !/not-currently-assigned/.test(c.id)) ?? teamChips[0];
  console.log(`\nClick the "${pick.text}" chip\n`);
  await page.click(`[data-testid="${pick.id}"]`);
  await settle(1800);
  s = await snapshot(page);
  await shot(page, `02-term${winter.n}-one-team-desktop`);
  ok("the chip is in the URL as ?group=, so this view is a link", /[?&]group=/.test(s.url), s.url.replace(BASE, ""));
  ok("the list narrows to that team's players", s.rows === pick.count, `${s.rows} rows vs chip ${pick.count}`);
  ok("one heading, naming the team — 'this is the group I'm viewing'", s.headings.length === 1 && pick.text.toLowerCase().startsWith(s.headings[0].toLowerCase()),
    s.headings.join(" | "));
  await page.click(`[data-testid="${pick.id}"]`);
  await settle(1500);
  s = await snapshot(page);
  ok("tapping the same chip again returns to All", !/[?&]group=/.test(s.url) && s.headings.length === teamChips.length, `${s.headings.length} headings`);

  // Choose a summer term from the strip → the group choice is forgotten.
  await page.click(`[data-testid="${pick.id}"]`);
  await settle(1200);
  await page.click(`[data-testid="filter-term-${summer.id}"]`);
  await settle(3000);
  s = await snapshot(page);
  ok("changing the term forgets the team that was picked", !/[?&]group=/.test(s.url), s.url.replace(BASE, ""));

  // ── Summer term: by TRAINING GROUP ────────────────────────────────────────
  console.log(`\nTerm ${summer.n} → by training group  (desktop 1440)\n`);
  s = await open(summer.id);
  await shot(page, `03-term${summer.n}-by-group-desktop`);
  ok("in a summer term the strip is BY TRAINING GROUP", s.groupBy === "training" || (s.chips.length === 0 && s.headings.length <= 1), `data-group-by=${s.groupBy}`);
  if (s.chips.length > 1) {
    ok("the first chip is All groups", /^All groups/.test(s.chips[0]?.text ?? ""), s.chips[0]?.text);
    ok("the headings are age grades (U9, U10…), drawn as 'U9 Training Group'", s.headings.length > 0 && s.headings.every((h) => /^U\d+$|^not graded$/i.test(h)), s.headings.join(" | "));
    ok("groups read youngest first (U9 before U10, never alphabetical)", (() => {
      const grades = s.headings.map(gradeOf).filter((g): g is number => g != null);
      return grades.every((g, i) => i === 0 || g > grades[i - 1]);
    })(), s.headings.map((h) => h.split(" ")[0]).join(","));
    ok("the move-a-child control is back when grouping by training group", s.selects > 0, `${s.selects} selects`);
    const g = s.chips[1];
    await page.click(`[data-testid="${g.id}"]`);
    await settle(1800);
    s = await snapshot(page);
    ok("a training-group chip narrows the list to that group", s.rows === g.count && s.headings.length === 1, `${s.rows} rows vs chip ${g.count}; ${s.headings.join("|")}`);
  }

  // A Term 1 with teams on file still reads by training group (Daniel: "perfect for Term 4 and Term 1").
  const t1 = byN(1);
  if (t1) {
    s = await open(t1.id);
    ok("Term 1 groups by training group even though the season's teams exist", s.groupBy !== "team", `data-group-by=${s.groupBy}`);
  }

  // ── Phone ─────────────────────────────────────────────────────────────────
  console.log(`\nTerm ${winter.n} on a phone (390)\n`);
  await page.setViewport({ width: 390, height: 844 });
  s = await open(winter.id);
  await shot(page, `04-term${winter.n}-by-team-phone`);
  ok("the strip wraps — the page does not scroll sideways", s.scrollWidth <= s.innerWidth + 1, `scrollWidth ${s.scrollWidth} / ${s.innerWidth}`);
  ok("every chip is still there on a phone", s.chips.length === teamChips.length + 1, `${s.chips.length}`);
  const tapTargets = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="filter-group-"]')).map((el) => (el as HTMLElement).getBoundingClientRect().height));
  ok("chips are tall enough to tap (≥ 30px, same as the term chips)", tapTargets.every((h) => h >= 30), `min ${Math.min(...tapTargets).toFixed(0)}px`);

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

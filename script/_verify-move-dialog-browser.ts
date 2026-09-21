// The Move dialog on a child's profile, in a REAL browser as ordinary staff —
// previewed on Jack Zhu (registration #619: one $600 payment, two children),
// then CANCELLED. It never moves him.
//
//   npx tsx --env-file=.env script/_verify-move-dialog-browser.ts
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WORKSPACE = "christchurch-united";
const OUT = process.env.SHOT_DIR || "../../outputs/clubos-move/2026-09-22";
const CHILD = 380, REG = 619;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); good ? pass++ : fail++; };
let userId: number | null = null;
let browser: any = null;

async function staffCookie() {
  const email = `_move_probe_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Move','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  userId = rows[0].id;
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`, [userId, org[0].id]);
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  if (!res.ok) throw new Error(`login HTTP ${res.status}`);
  const [n, v] = (res.headers.get("set-cookie") || "").split(";")[0].split("=");
  return { name: n, value: v };
}
const settle = (ms = 2200) => new Promise((r) => setTimeout(r, ms));
const text = (page: any, sel: string) => page.$eval(sel, (el: any) => el.innerText || "").catch(() => "");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const before = (await pool.query(`SELECT program_id, total_cents, status FROM registrations WHERE id=$1`, [REG])).rows[0];
  const cookie = await staffCookie();
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ ...cookie, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
  const errors: string[] = [];
  page.on("pageerror", (e: any) => errors.push(String(e.message).slice(0, 120)));

  // Land on /admin first so the workspace resolves before a deep link fires its queries.
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), WORKSPACE);
  await settle(1200);

  console.log(`\nMove dialog on Jack Zhu's profile (${BASE})\n`);
  await page.goto(`${BASE}/admin/people/child-${CHILD}`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle(2600);
  const body = await page.evaluate(() => document.body.innerText || "");
  ok("Jack's profile renders", body.includes("Jack") && body.includes("Zhu"), `${body.length} chars`);

  const moveBtn = await page.$(`[data-testid="button-move-${REG}"]`);
  ok("the Move button is on his FUNdamentals row", !!moveBtn);
  if (!moveBtn) return;
  await moveBtn.click();
  await page.waitForSelector('[data-testid="dialog-move-programme"]', { timeout: 15000 });
  await page.waitForSelector('[data-testid="move-session-row"]', { timeout: 15000 });
  await settle(800);

  const dlg = await text(page, '[data-testid="dialog-move-programme"]');
  ok("the dialog is about JACK, not the registration", /Jack Zhu is on/.test(dlg), dlg.split("\n")[1]);
  const rows = await page.$$('[data-testid="move-session-row"]');
  ok("all 10 of his booked sessions are listed", rows.length === 10, String(rows.length));
  ok("the heading counts them", /10 sessions/.test(dlg));
  ok("his already-refunded day is marked", /refunded/.test(dlg));
  ok("the sibling is named and stays", /also covers Eden Li/.test(dlg) && /Only Jack Zhu moves/.test(dlg));
  ok("no 'Who is moving?' question — the profile already said who", !(await page.$('[data-testid="move-who"]')));
  await page.screenshot({ path: `${OUT}/01-jack-sessions.png` });

  // A real click on the Radix trigger, then a real click on the option — by EXACT name.
  // There are two World Cup camps: April's (programme 2, no session in October) and this one.
  const pick = async (name: string) => {
    await page.click('[data-testid="select-move-programme"]');
    await page.waitForSelector('[role="option"]', { timeout: 10000 });
    for (const o of await page.$$('[role="option"]')) {
      const t = (await page.evaluate((el: any) => el.innerText || "", o)).trim();
      if (t === name) { await o.click(); return true; }
    }
    await page.keyboard.press("Escape");
    return false;
  };

  // First the WRONG World Cup — April's camp — to see the unmatched-day warning in the browser.
  ok("April's World Cup camp is offered", await pick("World Cup Holiday Camp"));
  await page.waitForSelector('[data-testid="move-unmatched"]', { timeout: 15000 });
  const warn = await text(page, '[data-testid="move-unmatched"]');
  ok("…and every one of his ten days is named as having no session there", /no session on these days/.test(warn) && (warn.match(/\d{1,2} \w{3}/g) || []).length >= 10, warn.split("\n")[0].slice(0, 90));
  const dropBtn = await text(page, '[data-testid="button-move-confirm-drop"]');
  ok("the button becomes a deliberate 'Move and drop 10 days'", dropBtn.trim() === "Move and drop 10 days", dropBtn.trim());
  await page.screenshot({ path: `${OUT}/02a-wrong-camp-warns.png` });

  // Then the RIGHT one.
  ok("this October's World Cup camp is offered and picked", await pick("World Cup Holiday Camp Term 3 2026"));
  await page.waitForSelector('[data-testid="move-split-money"]', { timeout: 15000 });
  await settle(600);

  const dlg2 = await text(page, '[data-testid="dialog-move-programme"]');
  const arrows = await page.$$eval('[data-testid="move-session-row"] svg', (els: any[]) => els.length);
  ok("every session now shows its World Cup day beside it (from → to)", arrows === 10, `${arrows} arrows`);
  ok("no unmatched-day warning — World Cup runs the same ten days", !(await page.$('[data-testid="move-unmatched"]')));
  const money = await text(page, '[data-testid="move-split-money"]');
  ok("Jack's share: $300.00 incl. his $30.00 refund", /Jack Zhu's share, \$300\.00 \(incl\. \$30\.00 already refunded\)/.test(money), money.split("\n")[0]);
  ok("Eden's $300.00 stays", /Eden Li's \$300\.00/.test(money), money.split("\n")[1]);
  ok("it says nothing is charged or refunded, adding back to $600.00", /Nothing is charged or refunded/.test(money) && /\$600\.00/.test(money));
  const btn = await text(page, '[data-testid="button-move-confirm"]');
  ok("the button says what it does", btn.trim() === "Move Jack Zhu — all 10 sessions", btn.trim());
  ok("the heading shows the shift", /FUNdamentals.*→.*World Cup/i.test(dlg2.replace(/\n/g, " ")));
  await page.screenshot({ path: `${OUT}/02-jack-to-worldcup.png` });

  // Phone.
  await page.setViewport({ width: 390, height: 844 });
  await settle(800);
  // 🔴 A fixed dialog never widens the document, so scrollWidth says nothing —
  // measure the DIALOG's own box against the viewport, and name what pushed it.
  const fit = await page.evaluate(() => {
    const dlg = document.querySelector('[data-testid="dialog-move-programme"]') as HTMLElement;
    const r = dlg.getBoundingClientRect();
    const vw = window.innerWidth;
    const offenders: string[] = [];
    dlg.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.right > vw + 1 && b.width > 40) offenders.push(`${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}.${String(el.className).split(" ").slice(0, 3).join(".")} right=${Math.round(b.right)} w=${Math.round(b.width)}`);
    });
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), vw, offenders: offenders.slice(0, 8) };
  });
  ok("the dialog fits inside a 390px phone", fit.right <= fit.vw + 1 && fit.left >= -1, `dialog ${fit.left}→${fit.right} of ${fit.vw}${fit.offenders.length ? "\n         " + fit.offenders.join("\n         ") : ""}`);
  const btnBox = await (await page.$('[data-testid="button-move-confirm"]'))!.boundingBox();
  ok("the confirm button is reachable on a phone", !!btnBox && btnBox.y + btnBox.height <= 844 + 1, btnBox ? `bottom ${Math.round(btnBox.y + btnBox.height)}` : "none");
  await page.screenshot({ path: `${OUT}/03-phone.png` });
  await page.setViewport({ width: 1440, height: 900 });

  // Cancel — Jack is NOT moved.
  const cancel = await page.$$('[data-testid="dialog-move-programme"] button');
  for (const c of cancel) { const t = await page.evaluate((el: any) => el.innerText, c); if (t.trim() === "Cancel") { await c.click(); break; } }
  await settle(800);
  ok("Cancel closes it", !(await page.$('[data-testid="dialog-move-programme"]')));
  const after = (await pool.query(`SELECT program_id, total_cents, status FROM registrations WHERE id=$1`, [REG])).rows[0];
  ok("🔴 registration #619 untouched — still FUNdamentals, $600, partially_refunded", JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after));
  ok("no runtime errors on the page", errors.length === 0, errors.join(" | "));
}

main()
  .catch((e) => { console.error("\nERROR", e); fail++; })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    if (userId) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [userId]); await pool.query(`UPDATE users SET active=false, password='!' WHERE id=$1`, [userId]); }
    await pool.end();
    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
  });

/**
 * Looks at the office registration form in a REAL browser, signed in as
 * ORDINARY STAFF, and drives it to the moment Olga was in: a $150 programme
 * quoting $30 because Term 3 is nearly over, and a staff member typing $135.
 *
 * A measurement alone would not have found this. The old Apply button was
 * ENABLED for an unusable price, and clicking it collapsed the panel and took
 * the warning with it — everything after that looked perfectly normal.
 *
 *   npx tsx --env-file=.env script/_verify-office-price-browser.ts
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WORKSPACE = "christchurch-united";
const SHOTS = "/tmp/office-price-shots";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};

let tempUserId: number | null = null;
let browser: any = null;

/** A real staff account, signed in the way the app does it. */
async function staffCookie() {
  const email = `_ui_probe_${Date.now()}@usg.co.nz`;
  const pw = `U${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'UI','Probe',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)]);
  tempUserId = rows[0].id;
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`,
    [tempUserId, org[0].id]);
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  if (!res.ok) throw new Error(`login HTTP ${res.status}`);
  const [n, v] = (res.headers.get("set-cookie") || "").split(";")[0].split("=");
  return { name: n, value: v };
}

const settle = (ms = 2200) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const fs = await import("fs");
  fs.mkdirSync(SHOTS, { recursive: true });
  const cookie = await staffCookie();

  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ ...cookie, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });

  const errors: string[] = [];
  page.on("pageerror", (e: any) => errors.push(String(e.message).slice(0, 160)));

  console.log(`\nThe office form, in a real browser — ${BASE}\n`);

  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((w: string) => localStorage.setItem("clubos_workspace", w), WORKSPACE);
  await page.goto(`${BASE}/admin/registrations`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle(2600);
  ok("the Registrations page renders for ordinary staff",
    (await page.evaluate(() => document.body.innerText.length)) > 200);

  const openBtn = await page.$('[data-testid="button-open-office-registration"]');
  ok("\"Register at the office\" is there for ordinary staff", openBtn !== null);
  if (!openBtn) { await page.screenshot({ path: `${SHOTS}/00-no-button.png`, fullPage: true }); return finish(page, errors); }
  await openBtn.click();
  await settle(1800);

  // 🔴 Everything from here is read INSIDE the modal. Reading document.body
  // was a false pass: the registrations list behind it is full of dollar
  // amounts, so "$150.00 is on screen" was true before this fix ever shipped.
  // The screenshot is what caught it — the text assertions all went green.
  const MODAL = '[data-testid="modal-register-player"]';
  const modalText = () => page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    return el ? (el as HTMLElement).innerText : "";
  }, MODAL);
  // 🔴 A tap must PROVE it landed. The first version reported success for a
  // click that never took: the age group stayed unselected, both terms read
  // "Pick an age group above to price this term", and the run carried on as if
  // the form were primed. Re-query fresh each attempt — the list re-renders
  // when the quote resolves, and a click on a detached node goes nowhere.
  const isSelected = (testid: string) => page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    return el ? /bg-blue-500\/10|bg-blue-500\/15/.test(el.className || "") : false;
  }, `${MODAL} [data-testid="${testid}"]`);

  // 🔴 A DOM click, not puppeteer's coordinate click. Measured on this very
  // form: the age-group button sits at y≈827 in a 900px viewport, INSIDE the
  // modal's own scroll container, and puppeteer's scroll-into-view mis-lands —
  // the click silently hits nothing and the className never changes. The same
  // button responds immediately to `el.click()` in the page. (Radix tabs are
  // the opposite way round and still need a real click; these are plain
  // buttons with an onClick, so the synthetic event is enough.)
  const tap = async (testid: string, mustSelect = false) => {
    for (let i = 0; i < 4; i++) {
      const hit = await page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return false;
        el.click();
        return true;
      }, `${MODAL} [data-testid="${testid}"]`);
      await settle(mustSelect ? 1100 : 600);
      if (!hit) continue;
      if (!mustSelect) return true;
      if (await isSelected(testid)) return true;
    }
    return mustSelect ? await isSelected(testid) : (await page.$(`${MODAL} [data-testid="${testid}"]`)) !== null;
  };
  const typeIn = async (testid: string, value: string) => {
    const sel = `${MODAL} [data-testid="${testid}"]`;
    const el = await page.$(sel);
    if (!el) return false;
    // Focus via the DOM for the same reason as `tap`, then type for real so
    // React's onChange fires exactly as it does under a person's fingers.
    await page.evaluate((s: string) => {
      const i = document.querySelector(s) as HTMLInputElement | null;
      if (i) { i.focus(); i.select?.(); }
    }, sel);
    await page.keyboard.down("Meta"); await page.keyboard.press("a"); await page.keyboard.up("Meta");
    await page.keyboard.type(value);
    return true;
  };

  ok("the form opened", (await page.$(MODAL)) !== null);

  // ── Olga's exact position: Technification, U9–U10, Term 3 ─────────────────
  ok("Technification can be chosen, and STAYS chosen", await tap("option-programme-5", true));
  await settle(1600);
  ok("the U9–U10 age group can be chosen, and STAYS chosen", await tap("option-academy-13", true));
  await settle(1800);
  ok("Term 3 can be chosen, and STAYS chosen", await tap("option-term-7", true));
  await settle(2200);
  await page.screenshot({ path: `${SHOTS}/02-programme-picked.png` });

  const step1 = await modalText();
  ok("the form quotes the pro-rated $30, exactly as it did for her",
    step1.includes("$30.00"), step1.split("\n").filter((l: string) => l.includes("$")).slice(0, 4).join(" / "));

  // ── Through the family step ───────────────────────────────────────────────
  ok("Next moves on", await tap("button-next"));
  await settle(1600);
  const stamp = Date.now();
  await typeIn("input-player-first", "Probe");
  await typeIn("input-player-last", `Child${stamp}`);
  // 🔴 Date of birth is OUR control, not the browser's (standing rule: every
  // control is drawn by us), so there is nothing to type into — it is a
  // Popover + Calendar. With fromYear/toYear set it renders month and year
  // dropdowns, which is the only sane way to reach 2016 from here. A native
  // <select> needs React's own value setter, or the change event is ignored.
  await tap("input-player-dob");
  await settle(900);
  // 🔴 No named helper inside page.evaluate — esbuild's keepNames injects a
  // `__name` call the page has never heard of and the whole evaluate throws.
  // Bitten twice writing this file; it fails loudly, which is the only mercy.
  const dobSet = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll(".rdp select")) as HTMLSelectElement[];
    if (selects.length < 2) return `only ${selects.length} dropdown(s)`;
    const year = selects.find((x) => Array.from(x.options).some((o) => o.value === "2016"));
    const month = selects.find((x) => x !== year);
    if (!year || !month) return "no year/month dropdown";
    for (const [el, v] of [[year, "2016"], [month, "7"]] as [HTMLSelectElement, string][]) {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      desc?.set?.call(el, v);              // React ignores a plain el.value = …
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return "ok";
  });
  ok("the date-of-birth calendar can be driven to August 2016", dobSet === "ok", String(dobSet));
  await settle(1100);
  // 🔴 Not `.rdp-day`: the form overrides react-day-picker's classNames
  // wholesale, so its default day class is not in the DOM at all. Find the day
  // by what a person sees — the number on the button inside the calendar.
  const dayClicked = await page.evaluate(() => {
    const cal = document.querySelector(".rdp");
    if (!cal) return "no calendar";
    const days = Array.from(cal.querySelectorAll("button")).filter(
      (b) => (b.textContent || "").trim() === "22" && !/outside|disabled/.test(b.className) && !(b as HTMLButtonElement).disabled);
    if (!days.length) return "no 22";
    (days[0] as HTMLElement).click();
    return "ok";
  });
  ok("a date of birth can be picked", dayClicked === "ok", String(dayClicked));
  await settle(900);
  await typeIn("input-parent-first", "Price");
  await typeIn("input-parent-last", `Probe${stamp}`);
  await typeIn("input-parent-email", `_ui_probe_${stamp}@usg.co.nz`);
  await typeIn("input-parent-phone", "0200000000");
  // Skip the NZ Football details — the tick that had never worked. It needs a
  // reason, and the form says so rather than failing silently.
  await tap("checkbox-defer-nzf");
  await settle(1000);
  const reasonSet = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="select-defer-reason"]') as HTMLElement | null;
    if (!t) return false;
    t.click();
    return true;
  });
  await settle(800);
  if (reasonSet) {
    await page.evaluate(() => {
      const opt = Array.from(document.querySelectorAll("[role=option]"))
        .find((o) => /other/i.test(o.textContent || ""));
      if (opt) (opt as HTMLElement).click();
    });
    await settle(700);
    await typeIn("input-defer-note", "verification probe");
  }
  ok("a reason for skipping the NZ Football details can be given", reasonSet);
  await settle(900);
  await page.screenshot({ path: `${SHOTS}/03-family.png` });
  await tap("button-next");
  await settle(1800);

  // ── The payment step: the bug ─────────────────────────────────────────────
  const onPayment = (await page.$(`${MODAL} [data-testid="text-total-owing"]`)) !== null;
  ok("the payment step is reached", onPayment);
  if (!onPayment) {
    await page.screenshot({ path: `${SHOTS}/04-stuck.png`, fullPage: true });
    console.log("        modal says:", (await modalText()).slice(0, 400));
    return finish(page, errors);
  }
  const owing = () => page.evaluate((sel: string) =>
    (document.querySelector(`${sel} [data-testid="text-total-owing"]`) as HTMLElement)?.innerText ?? "", MODAL);
  ok("it opens at the pro-rated $30", (await owing()).includes("$30.00"), await owing());

  ok("the agreed-price control is there", await tap("button-adjust-price"));
  await settle(700);
  const hint = await modalText();
  ok("the hint no longer says \"You can only go lower\"", !/only go lower/i.test(hint));
  ok("…and it names the programme's full $150 fee as the ceiling", hint.includes("$150.00"));
  await page.screenshot({ path: `${SHOTS}/05-price-panel.png` });

  // 🔴 THE REGRESSION, at the keyboard. $135 on a $150 term.
  await typeIn("input-agreed-price", "135");
  await typeIn("input-price-reason", "Attended all term, settling up");
  await settle(700);
  const applyDisabled = await page.evaluate((sel: string) =>
    (document.querySelector(`${sel} [data-testid="button-price-apply"]`) as HTMLButtonElement)?.disabled ?? null, MODAL);
  ok("Apply is ENABLED for $135", applyDisabled === false, String(applyDisabled));
  ok("no error is shown for $135",
    (await page.$(`${MODAL} [data-testid="text-price-problem"]`)) === null);
  await tap("button-price-apply");
  await settle(900);
  await page.screenshot({ path: `${SHOTS}/06-applied.png` });
  ok("the total owing now reads $135.00 — her number, kept", (await owing()).includes("$135.00"), await owing());

  // ── And the ceiling still holds ───────────────────────────────────────────
  await tap("button-adjust-price");
  await settle(600);
  await typeIn("input-agreed-price", "151");
  await settle(700);
  const overDisabled = await page.evaluate((sel: string) =>
    (document.querySelector(`${sel} [data-testid="button-price-apply"]`) as HTMLButtonElement)?.disabled ?? null, MODAL);
  ok("Apply is REFUSED above the $150 fee — it used to accept anything", overDisabled === true, String(overDisabled));
  const problem = await page.evaluate((sel: string) =>
    (document.querySelector(`${sel} [data-testid="text-price-problem"]`) as HTMLElement)?.innerText ?? "", MODAL);
  ok("…and says why, on screen, in red", problem.includes("$150.00"), problem);
  await page.screenshot({ path: `${SHOTS}/07-refused.png` });

  ok("nothing threw a runtime error (a white screen is invisible to every other check)",
    errors.length === 0, errors.join(" | "));
  console.log(`\n  screenshots → ${SHOTS}`);
  return finish(page, errors);
}

async function finish(page: any, _errors: string[]) {
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  if (tempUserId) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [tempUserId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id=$1`, [tempUserId]).catch(() => {});
  }
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  if (browser) await browser.close().catch(() => {});
  if (tempUserId) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [tempUserId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id=$1`, [tempUserId]).catch(() => {});
  }
  await pool.end().catch(() => {});
  process.exit(1);
});

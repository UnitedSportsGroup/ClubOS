// The typed date-of-birth field, on the three public checkouts, in a real
// browser, at phone and desktop widths — against production.
//
//   npx tsx --env-file=.env script/_verify-dob-input-browser.ts
//   SHOTS=/path/to/dir … to keep the screenshots somewhere else
//
// What it holds to, per page: no browser-drawn date control is left; the
// three boxes are there and at least 44px tall on a phone; typing "11" moves
// on to the month by itself, "7" moves on to the year, "2018" makes the age
// (or the academy's eligibility line) appear; "31/02" says it is not a real
// date; nothing scrolls sideways. The screenshots are for LOOKING at — a
// measurement passed every check the day the legend swatch was invisible.
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || "/tmp/dob-input-shots";
let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`);
  good ? pass++ : fail++;
};

type Page = {
  label: string;
  /** short, for screenshot names */
  key: string;
  url: string;
  /** data-testid of the DobInput group */
  testid: string;
  /** what a valid 11/07/2018 should produce under the field */
  expectStatus: RegExp;
  /** Clicks that reach the child form: each a data-testid, or text:… for a
   *  button found by its words. A wizard's first step is not the form. */
  advance?: string[];
};

const PAGES: Page[] = [
  {
    label: "camp booking (FUNdamentals)",
    key: "camp",
    url: "https://join.cufc.co.nz/fundamentals/book",
    testid: "input-child-dob-0",
    expectStatus: /8 years old/,
    // Step 1 is the session picker; the child form is step 2.
    advance: [
      "text:Full Day", "button-next-step-2",
      "fill:input-parent-first=Verify", "fill:input-parent-last=Probe",
      "fill:input-parent-email=dob-verify@example.com", "fill:input-parent-phone=0210000000",
      "button-next-step-3",
    ],
  },
  {
    label: "academy checkout (Pre-Academy, Term 4)",
    key: "academy",
    url: "https://join.cufc.co.nz/academy/pre-academy-u9-u12?option=30",
    testid: "input-child-dob",
    // Born 2018 → U8 in 2026 → the Term 4 lead-in line, not a refusal.
    expectStatus: /U9 from 2027/,
    advance: ["button-new-family", "text:Continue"],
  },
  {
    label: "class booking (Ballers U9)",
    key: "class",
    url: "https://join.minifootball.co.nz/ballers-u9/class-book",
    testid: "input-child-dob",
    expectStatus: /8 years old/,
  },
  {
    label: "cufc.co.nz Open Training",
    key: "open-training",
    url: "https://cufc.co.nz/open-training",
    testid: "open-training-dob",
    expectStatus: /8 years old/,
  },
  {
    label: "cugc.co.nz Register",
    key: "cugc-register",
    url: "https://cugc.co.nz/register",
    testid: "lead-dob",
    expectStatus: /8 years old/,
  },
];

mkdirSync(SHOTS, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

try {
  for (const p of PAGES) {
    for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
      console.log(`\n${p.label} — ${w}×${h}`);
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
      if (mobile) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(p.url, { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 1500));

      const sel = (box: string) => `[data-testid="${p.testid}-${box}"]`;
      for (const step of p.advance ?? []) {
        if (await page.$(sel("day"))) break; // already on the form
        if (step.startsWith("fill:")) {
          const [tid, val] = step.slice(5).split("=");
          const el = await page.$(`[data-testid="${tid}"]`);
          if (el) { await el.click({ clickCount: 3 }); await page.keyboard.type(val); } else console.log(`     (no ${tid} to fill — skipping)`);
          continue;
        }
        if (step.startsWith("text:")) {
          const want = step.slice(5);
          const hit = await page.evaluate((t) => {
            const b = Array.from(document.querySelectorAll("button")).find((e) => (e.textContent || "").trim().includes(t) && !(e as HTMLButtonElement).disabled);
            if (!b) return false; (b as HTMLElement).click(); return true;
          }, want);
          if (!hit) console.log(`     (no enabled button "${want}" to click — skipping)`);
        } else {
          const el = await page.$(`[data-testid="${step}"]`);
          if (el) await el.click(); else console.log(`     (no ${step} on this step — skipping)`);
        }
        await new Promise((r) => setTimeout(r, 900));
      }
      // The form itself is the readiness check — placeholder text is not in innerText.
      const day = await page.waitForSelector(sel("day"), { timeout: 15000 }).catch(() => null);
      if (!day) {
        ok(`${p.label}: the child form is reachable`, false, "no DOB field after stepping through");
        await page.screenshot({ path: `${SHOTS}/${p.key}-${w}-notready.png` });
        await page.close();
        continue;
      }
      ok("the three typed boxes are on the page", !!day && !!(await page.$(sel("month"))) && !!(await page.$(sel("year"))));
      const nativeDates = await page.$$eval('input[type="date"]', (els) => els.length);
      ok("no browser-drawn date control is left", nativeDates === 0, `${nativeDates} found`);
      if (!day) { await page.close(); continue; }

      await day.evaluate((el) => (el as HTMLElement).scrollIntoView({ block: "center" }));
      const heights = await page.$$eval(`[data-testid="${p.testid}"] input`, (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
      ok(`every box is at least 44px tall (${heights.join("/")})`, heights.every((x) => x >= 44 - 1) || !mobile, mobile ? "" : "desktop — informational");

      // Type like a parent would: 11, 7, 2018 — and let focus move itself.
      await day.click();
      await page.keyboard.type("11");
      let focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-testid"));
      ok('"11" in Day moves focus to Month by itself', focused === `${p.testid}-month`, String(focused));
      await page.keyboard.type("7");
      focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-testid"));
      ok('"7" in Month (only July) moves focus to Year', focused === `${p.testid}-year`, String(focused));
      const monthVal = await page.$eval(sel("month"), (e) => (e as HTMLInputElement).value);
      ok('…and Month reads "07"', monthVal === "07", monthVal);
      // The screenshot that found the stale-blur bug: "11" had become "01".
      const dayVal = await page.$eval(sel("day"), (e) => (e as HTMLInputElement).value);
      ok('…and Day still reads "11" after focus moved on', dayVal === "11", dayVal);
      await page.keyboard.type("2018");
      await new Promise((r) => setTimeout(r, 300));
      const after = await page.evaluate(() => document.body.innerText);
      ok(`a valid date shows its status (${p.expectStatus})`, p.expectStatus.test(after));
      const msg = await page.$(`[data-testid="${p.testid}-message"]`);
      ok("…and no error message", !msg);

      await page.screenshot({ path: `${SHOTS}/${p.key}-${w}.png` });

      // Now a date that is not a date.
      const dayEl = (await page.$(sel("day")))!;
      await dayEl.click({ clickCount: 3 });
      await page.keyboard.type("31");
      const monthEl = (await page.$(sel("month")))!;
      await monthEl.click({ clickCount: 3 });
      await page.keyboard.type("02");
      await page.keyboard.press("Tab");
      await new Promise((r) => setTimeout(r, 300));
      const msgText = await page.$eval(`[data-testid="${p.testid}-message"]`, (e) => e.textContent || "").catch(() => "");
      ok('31/02/2018 says "That isn\'t a real date"', /real date/i.test(msgText), msgText || "no message");

      // Backspace in an empty Year steps back to Month.
      const yearEl = (await page.$(sel("year")))!;
      await yearEl.click({ clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");
      focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-testid"));
      ok("Backspace in an empty Year steps back to Month", focused === `${p.testid}-month`, String(focused));

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok("nothing scrolls sideways", overflow <= 0, `${overflow}px`);
      ok("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
      await page.close();
    }
  }
} finally {
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed — screenshots in ${SHOTS}`);
  process.exit(fail ? 1 : 0);
}

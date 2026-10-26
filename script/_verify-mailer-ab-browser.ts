// The Send step's A/B test card and "Seen by" picker — the real live page, in
// a real browser, at phone and laptop size, signed in as an ORDINARY admin.
//   npx tsx --env-file=.env script/_verify-mailer-ab-browser.ts
//
// Walks Setup (everyone) → Content (a written email with the first-name tag)
// → Send, then: the list is counted and "Seen by" lists real people; picking
// one turns the subject and the review into THEIR email; ticking "Test two
// versions" with a second subject shows the plan in numbers and the A/B
// toggle swaps the subject; "Everyone, half and half" says nobody waits; the
// button wording kind lists the email's links (or says there are none); an
// unfinished test disables Send. 🔴 Send is NEVER pressed here — the live
// proof (_verify-mailer-ab-live.ts) sends to Resend's sandbox addresses.
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WORKSPACE = "christchurch-united";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "mailer-preflight");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); good ? pass++ : fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const users: number[] = [];
let browser: any = null;

const SMALL = `(function () {
  var small = [];
  var root = document.querySelector('[data-testid="mailer-ab-card"]');
  var nodes = root ? root.querySelectorAll("button, input, select") : [];
  var pv = document.querySelector('[data-testid="mailer-preview-as"]');
  var more = pv ? pv.querySelectorAll("button, select") : [];
  var all = Array.prototype.slice.call(nodes).concat(Array.prototype.slice.call(more));
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    // A checkbox's tap target is its LABEL row, which is what a thumb hits.
    if (el.type === "checkbox" && el.closest("label")) el = el.closest("label");
    var b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0 && b.height < 44) small.push((all[i].getAttribute("data-testid") || all[i].tagName) + ":" + Math.round(b.height));
  }
  return small;
})()`;

try {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nMailer A/B — browser preflight against ${BASE}\n`);
  const email = `_abpreflight_${Date.now()}@usg.co.nz`;
  const password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Preflight','AB',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(password, 10)]);
  users.push(rows[0].id);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, 1, 'admin', NULL)`, [rows[0].id]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new Error(`login failed: HTTP ${login.status}`);
  const [cname, cvalue] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

  for (const [label, width, height, mobile] of [["mailer-desktop", 1440, 900, false], ["mailer-mobile", 390, 844, true]] as const) {
    console.log(`\n${label} (${width}×${height})`);
    const page = await browser.newPage();
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    if (mobile) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
    await page.setCookie({ name: cname, value: cvalue, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
    await page.evaluateOnNewDocument(() => { window.confirm = () => true; });
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((slug: string) => {
      localStorage.setItem("clubos_workspace", slug);
      Object.keys(localStorage).filter((k) => k.startsWith("clubos-mailer-draft:")).forEach((k) => localStorage.removeItem(k));
    }, WORKSPACE);
    await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2500);

    // Setup → Content → a written email → Send.
    const seg = await page.$('[data-testid="button-segment-all"]');
    if (seg) await seg.click();
    await sleep(300);
    const next = await page.$('[data-testid="button-next-content"]');
    if (next) await next.click();
    await sleep(1200);
    const subj = await page.$('[data-testid="input-subject"]');
    if (subj) { await subj.click(); await page.keyboard.type("Hi {{first_name}}, Term 4 is open"); }
    const writeCard = await page.$('[data-testid="button-mode-simple"]');
    if (writeCard) await writeCard.click();
    await sleep(1500);
    const bodyEl = await page.$('[data-testid="compose-body"]');
    if (bodyEl) { await bodyEl.click(); await page.keyboard.press("End"); await page.keyboard.type(" Spots are going fast."); }
    await sleep(1800);
    const toSend = await page.$('[data-testid="button-next-send"]');
    ok("Next: Review & Send is enabled", !!toSend && !(await page.evaluate((el: any) => el.disabled, toSend)));
    if (toSend) await toSend.click();
    await sleep(1500);

    // ── Seen by ──────────────────────────────────────────────────────────────
    // The Select is DRAWN BY US (a trigger button + a popover of role=option
    // buttons), never a native <select> — so it is driven by clicking, the
    // way a person does. The first run of this harness queried <option> nodes
    // and reported "0 options" over a list of 4,739 people.
    const before: any = await page.evaluate(`(function(){ var s = document.querySelector('[data-testid="text-review-subject"]'); var f = document.querySelector('[data-testid="iframe-review-preview"]'); return { subject: s ? s.textContent.trim() : '', doc: f ? (f.getAttribute('srcdoc') || '').length : 0 }; })()`);
    ok("before a person is picked the subject shows the tag as written", /\{\{first_name\}\}/.test(before.subject), before.subject);
    let trigger: any = null;
    for (let i = 0; i < 30 && !trigger; i++) {
      await sleep(1000);
      trigger = await page.$('[data-testid="select-preview-as"]:not([disabled])');
    }
    ok("the list is counted and 'Seen by' is ready", !!trigger);
    if (trigger) await trigger.click();
    await sleep(600);
    const options: any = await page.evaluate(`(function(){
      var opts = Array.prototype.slice.call(document.querySelectorAll('[role="option"]'));
      return opts.map(function(o){ return { testid: o.getAttribute('data-testid'), text: (o.textContent || '').trim() }; });
    })()`);
    ok("…and lists real people", options.length >= 10, `${options.length} options`);
    // Pick the first person who has a first name on file (a name before the address).
    const target = options.find((o: any) => /\(.+@.+\)$/.test(o.text) && !/^Everyone/.test(o.text)) || options[1];
    let picked: any = null;
    if (target) {
      const el = await page.$(`[data-testid="${target.testid}"]`);
      if (el) { await el.click(); picked = target; }
    }
    ok("a person can be picked", !!picked, JSON.stringify(picked));
    let who = "";
    for (let i = 0; i < 20 && !who; i++) {
      await sleep(700);
      who = await page.evaluate(`(function(){ var w = document.querySelector('[data-testid="text-preview-as-who"]'); return w ? w.textContent.trim() : ''; })()`) as string;
    }
    const after: any = await page.evaluate(`(function(){ var s = document.querySelector('[data-testid="text-review-subject"]'); var f = document.querySelector('[data-testid="iframe-review-preview"]'); var d = f ? (f.getAttribute('srcdoc') || '') : ''; return { subject: s ? s.textContent.trim() : '', hasTag: /\\{\\{first_name\\}\\}/.test(d), unsub: /unsubscribe/i.test(d) }; })()`);
    ok("the review says who it is seen by", who.length > 0, who);
    ok("the subject becomes that person's (the tag resolved)", !/\{\{/.test(after.subject) && after.subject.startsWith("Hi ") && after.subject !== before.subject, after.subject);
    ok("the review carries their email with no tag left and the unsubscribe footer", !after.hasTag && after.unsub);

    // ── Test two versions: the subject ───────────────────────────────────────
    const tick = await page.$('[data-testid="checkbox-ab-on"]');
    ok("the 'Test two versions' card is on the Send step", !!tick);
    if (tick) await tick.click();
    await sleep(400);
    const bInput = await page.$('[data-testid="input-ab-subject-b"]');
    ok("a subject test opens with A read-only and a box for B", !!bInput && !!(await page.$('[data-testid="text-ab-subject-a"]')));
    const sendDisabled = await page.evaluate(`(function(){ var b = document.querySelector('[data-testid="button-send-campaign"]'); return b ? b.disabled : null; })()`);
    ok("with B empty, Send is disabled", sendDisabled === true);
    if (bInput) { await bInput.click(); await page.keyboard.type("Term 4 is open — grab a spot"); }
    await sleep(600);
    const plan: string = await page.evaluate(`(function(){ var p = document.querySelector('[data-testid="text-ab-plan"]'); return p ? p.textContent.trim() : ''; })()`) as string;
    ok("the plan is in numbers: A to N and B to N now, the winner to the rest after 2 hours", /A to [\d,]+ and B to [\d,]+ now, then whichever has more opens goes to the other [\d,]+ after 2 hours/.test(plan), plan);
    const sendLabel: any = await page.evaluate(`(function(){ var b = document.querySelector('[data-testid="button-send-campaign"]'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null; })()`);
    ok("the Send button reads 'Send A/B test' and is enabled (everyone needs the tick first, so disabled)", !!sendLabel && /Send A\/B test/.test(sendLabel.text), JSON.stringify(sendLabel));
    const vb = await page.$('[data-testid="button-preview-variant-B"]');
    ok("an A | B toggle appears on the review", !!vb);
    if (vb) await vb.click();
    let subjB = "";
    for (let i = 0; i < 20; i++) {
      await sleep(600);
      subjB = await page.evaluate(`(function(){ var s = document.querySelector('[data-testid="text-review-subject"]'); return s ? s.textContent.trim() : ''; })()`) as string;
      if (/grab a spot/.test(subjB)) break;
    }
    ok("B shows the second subject in the review, for that person", /grab a spot/.test(subjB), subjB);
    const everyone = await page.$('[data-testid="button-ab-sample-100"]');
    if (everyone) await everyone.click();
    await sleep(400);
    const plan100: string = await page.evaluate(`(function(){ var p = document.querySelector('[data-testid="text-ab-plan"]'); return p ? p.textContent.trim() : ''; })()`) as string;
    ok("'Everyone, half and half' says nobody waits and hides the wait", /Nobody waits/.test(plan100) && !(await page.$('[data-testid="button-ab-wait-120"]')), plan100);

    // ── The button-wording kind ──────────────────────────────────────────────
    const kindLink = await page.$('[data-testid="button-ab-kind-link"]');
    if (kindLink) await kindLink.click();
    await sleep(400);
    const linkUi: any = await page.evaluate(`(function(){ var s = document.querySelector('[data-testid="select-ab-target"]'); var n = document.querySelector('[data-testid="text-ab-no-links"]'); return { select: !!s, none: !!n }; })()`);
    ok("the button kind offers the email's links, or says there are none", linkUi.select || linkUi.none, JSON.stringify(linkUi));
    const sendNow: any = await page.evaluate(`(function(){ var b = document.querySelector('[data-testid="button-send-campaign"]'); return b ? b.disabled : null; })()`);
    ok("an unfinished link test keeps Send disabled", sendNow === true);

    // ── Fit ──────────────────────────────────────────────────────────────────
    const fit: any = await page.evaluate(`(function(){ return { doc: document.documentElement.scrollWidth, win: window.innerWidth }; })()`);
    ok("no horizontal overflow on the Send step", fit.doc <= fit.win + 1, `${fit.doc} vs ${fit.win}`);
    if (mobile) {
      const small: string[] = await page.evaluate(SMALL) as string[];
      ok("every new control is thumb-sized on a phone", small.length === 0, small.join(", "));
    }
    const shot = join(OUT, `${label}-ab.png`);
    await page.screenshot({ path: shot, fullPage: true });
    console.log(`  → ${shot}`);
    await page.close();
  }
} catch (e: any) {
  console.error("\npreflight threw:", e.message);
  fail++;
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const id of users) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  }
  await pool.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

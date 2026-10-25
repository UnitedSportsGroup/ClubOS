// UI preflight for the Mailer's Content step — the real live page, in a real
// browser, at phone and laptop size, signed in as an ORDINARY workspace admin.
//
//   npx tsx --env-file=.env script/_verify-mailer-browser.ts
//
// What it walks (Daniel, 2026-10-25 — "a simple editor and the full email
// builder"): Setup → Content opens on the WRITE / DESIGN chooser; Write opens
// the Gmail-shaped compose box seeded with a greeting, the crest on top and the
// sign-off read off the From; typing saves itself and enables Next; on a phone
// the box fits, every control is thumb-sized, the Preview pane shows the real
// email and Next can be scrolled to; on a laptop the email can be handed to the
// designer and brought back with its words intact and ONE sign-off.
//
// Signs in over the API and injects the cookie: driving ClubOS's SPA login form
// races its submit and screenshots the login page, which reads exactly like a
// permissions failure.
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
const ok = (l: string, good: boolean, d = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`);
  good ? pass++ : fail++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The Mailer's OWN controls must be thumb-sized. The admin shell around it
// (sidebar toggle, global search, account menu) is every page in ClubOS, not
// this feature — reported so it stays visible, never asserted here.
const SHELL = ["button-sidebar-toggle", "input-global-search", "button-account-menu"];
const SMALL_CONTROLS = `(function () {
  var small = [];
  var nodes = document.querySelectorAll("button, a[href], input, select, textarea, [role=textbox]");
  for (var i = 0; i < nodes.length; i++) {
    var b = nodes[i].getBoundingClientRect();
    if (b.width > 0 && b.height > 0 && b.height < 44) {
      var t = nodes[i].getAttribute("data-testid");
      small.push(nodes[i].tagName.toLowerCase() + (t ? "[" + t + "]" : "") + ":" + Math.round(b.height) + "px");
    }
  }
  return small;
})()`;

const users: number[] = [];
let browser: any = null;

try {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nMailer — browser preflight against ${BASE}\n`);

  const email = `_mailerpreflight_${Date.now()}@usg.co.nz`;
  const password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'Preflight','Mailer',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(password, 10)],
  );
  users.push(rows[0].id);
  // 🔴 Org 1 is Christchurch United. Org 2 is SOUTH ISLAND UNITED — the harness
  // sat there for weeks, and the only thing that showed it was the SIU crest
  // appearing where the CUFC one was expected.
  await pool.query(
    `INSERT INTO user_organizations (user_id, organization_id, role, tabs)
     VALUES ($1, 1, 'admin', NULL)`,
    [rows[0].id],
  );

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error(`login failed: HTTP ${login.status}`);
  const [cname, cvalue] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");

  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

  for (const [label, width, height, mobile] of [
    ["mailer-desktop", 1440, 900, false],
    ["mailer-mobile", 390, 844, true],
  ] as const) {
    console.log(`\n${label} (${width}×${height})`);
    const page = await browser.newPage();
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    if (mobile) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
    await page.setCookie({ name: cname, value: cvalue, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
    // The round trip asks "are you sure?" — answered yes here, never shown.
    await page.evaluateOnNewDocument(() => { window.confirm = () => true; });

    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((slug: string) => {
      localStorage.setItem("clubos_workspace", slug);
      // A draft left by an earlier run would skip the chooser.
      Object.keys(localStorage).filter((k) => k.startsWith("clubos-mailer-draft:")).forEach((k) => localStorage.removeItem(k));
    }, WORKSPACE);
    await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2500);

    const body = await page.evaluate(() => document.body.innerText);
    ok("the page is the Mailer, not the login screen", !/Sign in|Forgot password/i.test(body));

    // Setup → Content. "All Contacts" then Next.
    const seg = await page.$('[data-testid="button-segment-all"]');
    ok("the audience picker is present", Boolean(seg));
    if (seg) await seg.click();
    await sleep(400);
    const next = await page.$('[data-testid="button-next-content"]');
    if (next) await next.click();
    await sleep(1200);

    // ── The Content step: subject on one row, then the chooser ───────────────
    const subj = await page.$('[data-testid="input-subject"]');
    ok("the Content step opened (subject field visible)", Boolean(subj));
    if (subj) { await subj.click(); await page.keyboard.type("Preflight — everything happening this week"); }
    const top: any = await page.evaluate(`(function () {
      var s = document.querySelector('[data-testid="input-subject"]');
      var chip = document.querySelector('[data-testid="button-subject-tag-first_name"]');
      var sr = s ? s.getBoundingClientRect() : null, cr = chip ? chip.getBoundingClientRect() : null;
      return {
        chooser: !!document.querySelector('[data-testid="mailer-mode-chooser"]'),
        simpleCard: !!document.querySelector('[data-testid="button-mode-simple"]'),
        designCard: !!document.querySelector('[data-testid="button-mode-design"]'),
        builderMounted: !!document.querySelector('[data-testid="email-builder"]'),
        composeMounted: !!document.querySelector('[data-testid="simple-compose"]'),
        templates: !!document.querySelector('[data-testid="mailer-templates-bar"]'),
        designBlurb: /Drag a section in from the left/.test(document.body.innerText),
        chipBesideSubject: !!(sr && cr) && Math.abs((sr.top + sr.bottom) / 2 - (cr.top + cr.bottom) / 2) < sr.height,
        docWidth: document.documentElement.scrollWidth, winWidth: window.innerWidth
      };
    })()`);
    ok("Content opens on the Write / Design chooser, nothing mounted yet",
      top.chooser && top.simpleCard && top.designCard && !top.builderMounted && !top.composeMounted,
      JSON.stringify({ chooser: top.chooser, builder: top.builderMounted, compose: top.composeMounted }));
    ok("Templates have their own section", top.templates);
    ok("the old design blurb is gone", !top.designBlurb);
    if (!mobile) ok("the subject's insert chips sit on the subject's row", top.chipBesideSubject);
    ok("no horizontal overflow on the chooser", top.docWidth <= top.winWidth + 1, `${top.docWidth} vs ${top.winWidth}`);
    await page.screenshot({ path: join(OUT, `${label}-chooser.png`) });
    console.log(`  → ${join(OUT, `${label}-chooser.png`)}`);

    // ── Write an email ───────────────────────────────────────────────────────
    const writeCard = await page.$('[data-testid="button-mode-simple"]');
    if (writeCard) await writeCard.click();
    await sleep(1500);
    const compose: any = await page.evaluate(`(function () {
      var box = document.querySelector('[data-testid="compose-body"]');
      var pv = document.querySelector('[data-testid="compose-preview"]');
      var doc = pv ? pv.getAttribute("srcdoc") || "" : "";
      return {
        mounted: !!document.querySelector('[data-testid="simple-compose"]'),
        mode: (document.querySelector('[data-testid="text-editor-mode"]') || {}).textContent,
        greeting: box ? /\\{\\{first_name\\}\\}/.test(box.innerHTML) : false,
        boxH: box ? box.getBoundingClientRect().height : 0,
        previewVisible: !!pv && pv.getBoundingClientRect().width > 0,
        letterheadInPreview: /logos\\/christchurch-united\\.png/.test(doc),
        signOffInPreview: /<strong>Christchurch United FC<\\/strong>/.test(doc),
        hasBody: /<body/.test(doc),
        attachAtFoot: !!document.querySelector('[data-testid="mailer-attachments-bar"]'),
        docWidth: document.documentElement.scrollWidth, winWidth: window.innerWidth
      };
    })()`);
    ok("Write opens the compose box as a written email", compose.mounted && compose.mode === "Written email", String(compose.mode));
    ok("it starts with a greeting that carries the first-name tag", compose.greeting);
    ok("the writing area is tall enough to work in", compose.boxH >= 300, `${Math.round(compose.boxH)}px`);
    ok("the compiled preview is a real document with the crest and the sign-off",
      compose.hasBody && compose.letterheadInPreview && compose.signOffInPreview,
      JSON.stringify({ body: compose.hasBody, crest: compose.letterheadInPreview, signOff: compose.signOffInPreview }));
    ok("Attach a file sits at the foot of the editor", compose.attachAtFoot);
    ok("no horizontal overflow with the compose box open", compose.docWidth <= compose.winWidth + 1, `${compose.docWidth} vs ${compose.winWidth}`);
    if (mobile) ok("the preview is behind the Preview switch on a phone", !compose.previewVisible);
    else ok("the preview sits beside the box on a laptop", compose.previewVisible);

    // Type, bold a word, insert a tag at the caret — then the save must land
    // on its own and Next must open.
    const bodyEl = await page.$('[data-testid="compose-body"]');
    if (bodyEl) {
      await bodyEl.click();
      await page.keyboard.press("End");
      await page.keyboard.type("Boots on by 4:15 please, ");
      const tag = await page.$('[data-testid="compose-tag-player_first_name"]');
      if (tag) await tag.click();
      await page.keyboard.type(" is in the Monday group.");
    }
    await sleep(1600);
    const typed: any = await page.evaluate(`(function () {
      var box = document.querySelector('[data-testid="compose-body"]');
      var pv = document.querySelector('[data-testid="compose-preview"]');
      var nextBtn = document.querySelector('[data-testid="button-next-send"]');
      return {
        tagInBody: box ? /\\{\\{player_first_name\\}\\} is in the Monday group/.test(box.innerHTML) : false,
        tagInPreview: pv ? /\\{\\{player_first_name\\}\\} is in the Monday group/.test(pv.getAttribute("srcdoc") || "") : false,
        saved: !!document.querySelector('[data-testid="text-design-saved"]'),
        nextEnabled: !!nextBtn && !nextBtn.disabled
      };
    })()`);
    ok("the tag went in at the caret, mid-sentence", typed.tagInBody);
    ok("the preview carries the typed words", typed.tagInPreview);
    ok("the email saved itself after typing", typed.saved);
    ok("Next: Review & Send is enabled", typed.nextEnabled);

    if (mobile) {
      const small: string[] = await page.evaluate(SMALL_CONTROLS);
      const mine = small.filter((s) => !SHELL.some((k) => s.includes(k)));
      const shell = small.filter((s) => SHELL.some((k) => s.includes(k)));
      ok("every Mailer control is at least 44px tall", mine.length === 0, mine.join(", "));
      if (shell.length) console.log(`  note  shared admin chrome under 44px (not this feature): ${shell.join(", ")}`);
      // Inside the screen, not merely present: a non-wrapping tool group hid
      // undo/redo past the right edge while every other check passed.
      const offEdge: string[] = await page.evaluate(`(function () {
        var out = [];
        var nodes = document.querySelectorAll('[data-testid^="compose-"]');
        for (var i = 0; i < nodes.length; i++) {
          var r = nodes[i].getBoundingClientRect();
          if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) out.push(nodes[i].getAttribute("data-testid") + ":" + Math.round(r.right));
        }
        return out;
      })()`);
      ok("every compose control is inside the phone's width", offEdge.length === 0, offEdge.join(", "));
      await page.screenshot({ path: join(OUT, `${label}-write.png`) });
      console.log(`  → ${join(OUT, `${label}-write.png`)}`);

      // Preview pane: the real email, inside the screen.
      const pvTab = await page.$('[data-testid="compose-pane-preview"]');
      if (pvTab) await pvTab.click();
      await sleep(600);
      const pane: any = await page.evaluate(`(function () {
        var pv = document.querySelector('[data-testid="compose-preview"]');
        var r = pv ? pv.getBoundingClientRect() : null;
        var box = document.querySelector('[data-testid="compose-body"]');
        return {
          previewShown: !!r && r.width > 0,
          insideScreen: !!r && r.left >= 0 && r.right <= window.innerWidth + 1,
          writeHidden: !box || box.getBoundingClientRect().width === 0
        };
      })()`);
      ok("the Preview pane shows the email", pane.previewShown);
      ok("the preview fits inside the phone's width", pane.insideScreen);
      ok("one pane at a time on a phone", pane.writeHidden);
      await page.screenshot({ path: join(OUT, `${label}-preview.png`) });
      console.log(`  → ${join(OUT, `${label}-preview.png`)}`);

      // Not clipped is not the same as reachable: scroll whatever scrolls and
      // the Next button has to be somewhere a thumb can get to.
      const reach: any = await page.evaluate(`(function () {
        var box = document.querySelector('[data-testid="simple-compose"]');
        var el = box ? box.parentElement : null;
        var scroller = null;
        while (el) {
          var st = getComputedStyle(el);
          if ((st.overflowY === "auto" || st.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 4) { scroller = el; break; }
          el = el.parentElement;
        }
        if (!scroller && document.scrollingElement && document.scrollingElement.scrollHeight > window.innerHeight + 4) scroller = document.scrollingElement;
        if (!scroller) return { scrolled: false };
        scroller.scrollTop = scroller.scrollHeight;
        var next = document.querySelector('[data-testid="button-next-send"]');
        var nr = next ? next.getBoundingClientRect() : null;
        return { scrolled: true, nextOnScreen: !!nr && nr.top < window.innerHeight && nr.bottom > 0, nextTop: nr ? Math.round(nr.top) : null, viewport: window.innerHeight };
      })()`);
      await sleep(400);
      ok("the page scrolls", reach.scrolled === true);
      ok("Next: Review & Send can be reached", reach.nextOnScreen === true, `top ${reach.nextTop} of ${reach.viewport}`);
      await page.screenshot({ path: join(OUT, `${label}-scrolled.png`) });
      console.log(`  → ${join(OUT, `${label}-scrolled.png`)}`);
    } else {
      await page.screenshot({ path: join(OUT, `${label}-write.png`) });
      console.log(`  → ${join(OUT, `${label}-write.png`)}`);

      // ── Written → designer → written: the words survive, the sign-off is one ──
      const sw = await page.$('[data-testid="button-switch-mode"]');
      if (sw) await sw.click();
      await sleep(9000); // the ~725KB builder chunk + MJML parse
      const designed: any = await page.evaluate(`(function () {
        var mode = (document.querySelector('[data-testid="text-editor-mode"]') || {}).textContent;
        var frame = document.querySelector('[data-testid="email-builder"] iframe');
        var text = "";
        try { text = frame && frame.contentDocument ? frame.contentDocument.body.innerText : ""; } catch (e) {}
        return { mode: mode, grapes: !!document.querySelector(".gjs-editor"), wordsInCanvas: /Boots on by 4:15 please/.test(text), crestInCanvas: !!(frame && frame.contentDocument && frame.contentDocument.querySelector('img[src*="christchurch-united.png"]')) };
      })()`);
      ok("the designer opened on the written email", designed.mode === "Designed email" && designed.grapes, JSON.stringify(designed));
      ok("the words came with it onto the canvas", designed.wordsInCanvas);
      ok("the crest came with it", designed.crestInCanvas);
      await page.screenshot({ path: join(OUT, `${label}-designer.png`) });
      console.log(`  → ${join(OUT, `${label}-designer.png`)}`);

      const back = await page.$('[data-testid="button-switch-mode"]');
      if (back) await back.click();
      await sleep(1500);
      const returned: any = await page.evaluate(`(function () {
        var box = document.querySelector('[data-testid="compose-body"]');
        var html = box ? box.innerHTML : "";
        return {
          mode: (document.querySelector('[data-testid="text-editor-mode"]') || {}).textContent,
          words: /Boots on by 4:15 please/.test(html),
          tag: /\\{\\{player_first_name\\}\\}/.test(html),
          signOffCount: (html.match(/<b>\\s*Christchurch United FC\\s*<\\/b>/g) || []).length,
          footerLeak: /receiving this because|Unsubscribe/i.test(html)
        };
      })()`);
      ok("back to a written email", returned.mode === "Written email", String(returned.mode));
      ok("the words and the tag are intact", returned.words && returned.tag);
      ok("the sign-off is not doubled into the body", returned.signOffCount === 0, `${returned.signOffCount} copies in the body`);
      ok("the designer's footer did not leak into the body", !returned.footerLeak);
      await page.screenshot({ path: join(OUT, `${label}-returned.png`) });
      console.log(`  → ${join(OUT, `${label}-returned.png`)}`);
    }

    const full = join(OUT, `${label}-full.png`);
    await page.screenshot({ path: full, fullPage: true });
    console.log(`  → ${full}`);
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

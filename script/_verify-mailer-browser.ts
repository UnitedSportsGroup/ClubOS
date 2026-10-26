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
import { mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import sharp from "sharp";

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
        letterheadInPreview: /mailer\\/crests\\/cufc\\.png|logos\\/christchurch-united\\.png/.test(doc),
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
        return { mode: mode, grapes: !!document.querySelector(".gjs-editor"), wordsInCanvas: /Boots on by 4:15 please/.test(text), crestInCanvas: !!(frame && frame.contentDocument && frame.contentDocument.querySelector('img[src*="crests/cufc.png"], img[src*="christchurch-united.png"]')) };
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

      // ── Design → gallery → Club newsletter → the builder's EXPORT keeps every word ──
      // 🔴 grapesjs-mjml drops every sibling after a void element (mj-image,
      // mj-divider) in a column: the canvas draws them, the export does not.
      // The first live save of the newsletter went out without its stories.
      // This reads what the page would SEND (the draft it keeps in this
      // browser), never the canvas.
      await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2", timeout: 60000 });
      await sleep(2000);
      await page.evaluate(() => {
        Object.keys(localStorage).filter((k) => k.startsWith("clubos-mailer-draft:")).forEach((k) => localStorage.removeItem(k));
      });
      await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2", timeout: 60000 });
      await sleep(2000);
      const seg2 = await page.$('[data-testid="button-segment-all"]');
      if (seg2) await seg2.click();
      await sleep(300);
      const next2 = await page.$('[data-testid="button-next-content"]');
      if (next2) await next2.click();
      await sleep(1000);
      const designCard = await page.$('[data-testid="button-mode-design"]');
      if (designCard) await designCard.click();
      await sleep(7000);
      const gallery: any = await page.evaluate(`(function () {
        var cards = Array.prototype.slice.call(document.querySelectorAll("button")).filter(function (b) { return /Use this template/i.test(b.textContent || ""); });
        // The first CARD's own text, not the page's (the category chips say
        // "Match day" above every card).
        var card = cards[0]; for (var i = 0; i < 3 && card && card.parentElement; i++) card = card.parentElement;
        return { count: cards.length, newsletterFirst: !!card && /Club newsletter/.test(card.textContent || "") };
      })()`);
      ok("Design opens on the gallery with the Club newsletter first", gallery.count >= 6 && gallery.newsletterFirst, JSON.stringify(gallery));
      await page.screenshot({ path: join(OUT, `${label}-gallery.png`) });
      console.log(`  → ${join(OUT, `${label}-gallery.png`)}`);
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button")).find((b) => /Use this template/i.test(b.textContent || ""));
        (btn as HTMLButtonElement | undefined)?.click();
      });
      await sleep(12000); // the builder chunk, the MJML parse, the autosave that a chosen template now triggers
      const exported: any = await page.evaluate(`(function () {
        var raw = Object.keys(localStorage).filter(function (k) { return k.indexOf("clubos-mailer-draft:") === 0; }).map(function (k) { return localStorage.getItem(k); })[0];
        var d = raw ? JSON.parse(raw) : null;
        var html = d && d.bodyHtml ? d.bodyHtml : "";
        var has = function (s) { return html.indexOf(s) > -1; };
        return {
          saved: !!document.querySelector('[data-testid="text-design-saved"]'),
          bytes: html.length,
          photos: (html.match(/mailer\\/cufc\\/[a-z0-9-]+\\.jpg/g) || []).length,
          icons: (html.match(/mailer\\/icons\\/[a-z]+\\.png/g) || []).length,
          lead: has("Everything happening across"),
          featured: has("Featured"),
          story: has("Term 4 is under way"),
          button: has("See the timetable"),
          offer: has("Partner offer"),
          nextMatch: has("Match details"),
          unsubscribe: has("{{unsubscribe_url}}"),
          mobileCss: has(".clubos-hdr-crest{text-align:center"),
          trimmedCrest: has("/mailer/crests/cufc.png")
        };
      })()`);
      ok("choosing the template saved the email on its own", exported.saved && exported.bytes > 1000, `${exported.bytes} bytes`);
      ok("the export keeps the lead story, Featured, a photo story, its button, the offer and the next match",
        exported.lead && exported.featured && exported.story && exported.button && exported.offer && exported.nextMatch, JSON.stringify(exported));
      ok("the export keeps every photograph and both social icons", exported.photos >= 4 && exported.icons >= 2, `photos ${exported.photos}, icons ${exported.icons}`);
      ok("the export carries its own unsubscribe link", exported.unsubscribe);
      ok("the export stays under Gmail's clip", exported.bytes < 95 * 1024, `${Math.round(exported.bytes / 1024)}KB`);
      ok("the export carries the phone rule that centres the header", exported.mobileCss);
      ok("the export uses the trimmed crest", exported.trimmedCrest);
      await page.screenshot({ path: join(OUT, `${label}-template-in-builder.png`) });
      console.log(`  → ${join(OUT, `${label}-template-in-builder.png`)}`);

      // ── The palette shows what you get (2026-10-26) ──────────────────────
      // Daniel: "the icons are the same, so it doesn't actually show you what
      // you're getting … you should be able to see 'oh, it's three columns'."
      // Every tile's thumbnail is its own, and the column tiles draw their
      // columns. 🔴 GrapesJS's own stylesheet fills every block SVG; measured
      // here as the rendered rect count, not the source string.
      const tiles: any = await page.evaluate(`(function () {
        var byLabel = {}; var all = [];
        document.querySelectorAll(".gjs-block").forEach(function (b) {
          var l = (b.querySelector(".gjs-block-label") || {}).textContent || ""; l = l.trim();
          var svg = b.querySelector("svg");
          all.push(svg ? svg.innerHTML.replace(/\\s+/g, "") : l);
          var r = svg ? svg.getBoundingClientRect() : { width: 0, height: 0 };
          byLabel[l] = { cols: svg ? svg.querySelectorAll(".col").length : 0, w: Math.round(r.width), h: Math.round(r.height),
            rootFill: svg ? getComputedStyle(svg).fill : "" };
        });
        return { byLabel: byLabel, total: all.length, distinct: new Set(all).size };
      })()`);
      ok("every block tile has its own thumbnail — no two alike", tiles.total >= 20 && tiles.distinct === tiles.total, `${tiles.distinct} of ${tiles.total}`);
      ok("the 2 columns and 3 columns tiles draw two and three columns, at thumbnail size",
        tiles.byLabel["2 columns"]?.cols === 2 && tiles.byLabel["3 columns"]?.cols === 3 && tiles.byLabel["Section"]?.w >= 48 && tiles.byLabel["Section"]?.h >= 30,
        JSON.stringify({ two: tiles.byLabel["2 columns"], three: tiles.byLabel["3 columns"], section: tiles.byLabel["Section"] }));
      ok("GrapesJS's fill rule no longer paints over the thumbnails", /^(none|rgba\\(0, 0, 0, 0\\))$/.test(tiles.byLabel["Section"]?.rootFill ?? ""), tiles.byLabel["Section"]?.rootFill);

      // ── Mobile preview: the header centres on a phone, desktop stays as drawn ──
      // Daniel: "the logo is centered and the menu items are centered as well.
      // It's off to the side on the desktop one, which is fine." Measured inside
      // the canvas frame — the crest's image and the nav's ink, against the
      // frame's own centre — in both device modes.
      const measureHeader = async () => {
        const fh = await page.$("iframe.gjs-frame");
        const frame = fh ? await fh.contentFrame() : null;
        if (!frame) return null;
        return frame.evaluate(`(function () {
          var w = document.documentElement.clientWidth;
          var crest = document.querySelector('img[alt="Christchurch United FC"]');
          var link = Array.prototype.slice.call(document.querySelectorAll("a")).find(function (a) { return /programmes/i.test(a.textContent || ""); });
          var nav = link ? link.parentElement : null;
          var mid = function (r) { return Math.round((r.left + r.right) / 2); };
          var navMid = null;
          if (nav) { var range = document.createRange(); range.selectNodeContents(nav); navMid = mid(range.getBoundingClientRect()); }
          return { w: w, crest: crest ? mid(crest.getBoundingClientRect()) : null, nav: navMid, crestClass: !!document.querySelector(".clubos-hdr-crest"),
            crestH: crest ? Math.round(crest.getBoundingClientRect().height) : null, crestSrc: crest ? (crest.getAttribute("src") || "") : "" };
        })()`) as Promise<{ w: number; crest: number | null; nav: number | null; crestClass: boolean; crestH: number | null; crestSrc: string } | null>;
      };
      const mobBtn = await page.$('button[title="Mobile preview"]');
      if (mobBtn) await mobBtn.click();
      await sleep(2500);
      const mob = await measureHeader();
      ok("Mobile preview centres the crest and the nav",
        !!mob && mob.w < 480 && mob.crest !== null && Math.abs(mob.crest - mob.w / 2) <= 8 && mob.nav !== null && Math.abs(mob.nav - mob.w / 2) <= 8,
        JSON.stringify(mob));
      await page.screenshot({ path: join(OUT, `${label}-template-mobile.png`) });
      console.log(`  → ${join(OUT, `${label}-template-mobile.png`)}`);
      const deskBtn = await page.$('button[title="Desktop preview"]');
      if (deskBtn) await deskBtn.click();
      await sleep(2000);
      const desk = await measureHeader();
      ok("Desktop preview keeps the crest left and the nav right",
        // The 600px device renders a 598px frame (its own border), so the width
        // floor sits below the device width — the assertion is about the SHAPE.
        !!desk && desk.w >= 560 && desk.crest !== null && desk.crest < desk.w / 2 - 60 && desk.nav !== null && desk.nav > desk.w / 2 + 60,
        JSON.stringify(desk));
      // The crest is the TRIMMED file (client/public/mailer/crests), drawn 64px
      // tall — Daniel: "less empty space around the logo, allowing it to be
      // bigger without actually taking up more space." The untrimmed original
      // drew the ram 43px wide inside a 56px box.
      ok("the crest fills its row: the trimmed file, 64px tall",
        !!desk && desk.crestH !== null && desk.crestH >= 60 && desk.crestH <= 68 && /\/mailer\/crests\/cufc\.png$/.test(desk.crestSrc),
        JSON.stringify({ h: desk?.crestH, src: desk?.crestSrc }));

      // ── Save answers the press (2026-10-26) ──────────────────────────────
      // Daniel: "nothing happening when clicking save … it can be subtle but it
      // needs that loop." Saving… is held to a visible minimum, then Saved ✓
      // in green with "Saved just now" beside it, then back to Save.
      const readSave = () => page.evaluate(`(function () {
        var b = document.querySelector('[data-testid="mkt-builder-save"]');
        var s = document.querySelector('[data-testid="mkt-autosave-status"]');
        return { btn: b ? (b.textContent || "").trim() : "", state: b ? b.getAttribute("data-state") : "", bg: b ? getComputedStyle(b).backgroundColor : "", status: s ? (s.textContent || "").trim() : "" };
      })()`) as Promise<{ btn: string; state: string; bg: string; status: string }>;
      const saveBtn = await page.$('[data-testid="mkt-builder-save"]');
      if (saveBtn) await saveBtn.click();
      await sleep(150);
      const pressed = await readSave();
      await sleep(1250);
      const flashed = await readSave();
      await sleep(2600);
      const settled = await readSave();
      ok("Save answers the press: Saving… → Saved ✓ in green with 'Saved just now' → Save",
        pressed.btn === "Saving…" && pressed.state === "saving" && /^Saved/.test(flashed.btn) && flashed.state === "saved" && flashed.status === "Saved just now" && flashed.bg === "rgb(5, 150, 105)" && settled.btn === "Save" && settled.state === "idle",
        JSON.stringify({ pressed, flashed, settled }));

      // ── The assistant (2026-10-26) ───────────────────────────────────────
      // Daniel: "make it agentic like chatbox type so i can prompt it to make
      // it modern". One REAL prompt (a paid call, cents): Ask ✦ opens the chat
      // beside Style / Settings / Layers with today's count, the words land on
      // the canvas, Undo takes them away, the count moved. Then the cap: this
      // user's limit set to 1 (the one just used) and the next prompt is
      // refused with the Team hint.
      // ── Club-logo quick picker + Rambo branding (26 Oct, 9pm) ────────────
      // Daniel: "change it to Rambo, not ask … if it's a logo section, it
      // should be a quick, easy selector where I can select quickly from our
      // brands." Select the header crest on the canvas → a tile per brand above
      // Style; tap United Gymnastics → the picture IS the CUGC crest; tap
      // Christchurch United → back. Double-click still opens the upload box.
      const fhLogo = await page.$(".clubos-gjs iframe");
      const frameLogo = fhLogo ? await fhLogo.contentFrame() : null;
      if (frameLogo) await frameLogo.click("img");
      await sleep(600);
      const pickerOpen: any = await page.evaluate(`(function () {
        var p = document.querySelector('[data-testid="ce-logo-picker"]');
        var tab = document.querySelector('[data-testid="ce-tab-ask"]');
        return { visible: !!p && p.offsetParent !== null, tiles: document.querySelectorAll('[data-testid^="ce-logo-"]').length, rambo: tab ? (tab.textContent || '').trim() : '', face: !!(tab && tab.querySelector('img.ce-tab-icon')) };
      })()`);
      ok("selecting a picture shows the club-logo picker above Style, one tile per brand", pickerOpen.visible && pickerOpen.tiles >= 7, JSON.stringify(pickerOpen));
      ok("the fourth inspector tab is Rambo with his face on it", pickerOpen.rambo === "Rambo" && pickerOpen.face, JSON.stringify({ rambo: pickerOpen.rambo, face: pickerOpen.face }));
      const srcOnCanvas = async (): Promise<string> => (frameLogo ? String(await frameLogo.evaluate(`(function(){ var i = document.querySelector('img'); return i ? (i.getAttribute('src') || '') : ''; })()`)) : "");
      const beforeSrc = await srcOnCanvas();
      const cugcTile = await page.$('[data-testid="ce-logo-cugc"]');
      if (cugcTile) await cugcTile.click();
      await sleep(600);
      const afterSrc = await srcOnCanvas();
      const activeTile: any = await page.evaluate(`(function(){ var a = document.querySelector('.ce-logo.is-active'); return a ? a.getAttribute('data-testid') : ''; })()`);
      ok("tapping United Gymnastics puts the CUGC crest on the selected picture", /\/mailer\/crests\/cugc\.png$/.test(afterSrc) && afterSrc !== beforeSrc && activeTile === "ce-logo-cugc", JSON.stringify({ beforeSrc, afterSrc, activeTile }));
      const cufcTile = await page.$('[data-testid="ce-logo-cufc"]');
      if (cufcTile) await cufcTile.click();
      await sleep(400);
      ok("…and Christchurch United puts it back", /\/mailer\/crests\/cufc\.png$/.test(await srcOnCanvas()), await srcOnCanvas());
      // A picture of your own, by link (no image home yet — R2 is the open item;
      // grapesjs-mjml's image has NO double-click upload, which a first draft of
      // this check found out). Paste a link → Use → it is on the canvas.
      const ownPic = "https://app.usg.co.nz/mailer/siu/hero.jpg";
      const linkInput = await page.$('[data-testid="ce-logo-link-input"]');
      if (linkInput) { await linkInput.click(); await page.keyboard.type(ownPic); }
      const useBtn = await page.$('[data-testid="ce-logo-link-use"]');
      if (useBtn) await useBtn.click();
      await sleep(600);
      ok("a link to a picture of your own goes on the selected picture", (await srcOnCanvas()) === ownPic, await srcOnCanvas());

      // ── Upload a picture of your own (26 Oct, late) ──────────────────────
      // Daniel: "file upload … make sure it doesn't become big and slow to
      // load." A 4000×3000 JPEG with camera EXIF goes through the file input →
      // shrunk on the server → hosted at /mailer/img/<key>.jpg → on the canvas.
      // Fetched back from the browser it is 1200 wide, progressive, EXIF-free,
      // under 250KB and cached for a year. An SVG is refused with the PNG
      // advice. The live size gauge reads KB of 102KB.
      const bigPath = join(tmpdir(), `mailer-probe-${Date.now()}.jpg`);
      {
        const noise = Buffer.alloc(4000 * 3000 * 3);
        for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
        await sharp(noise, { raw: { width: 4000, height: 3000, channels: 3 } }).jpeg({ quality: 95 }).withMetadata({ exif: { IFD0: { Make: "ProbeCam" } } }).toFile(bigPath);
      }
      const fileInput = await page.$('[data-testid="ce-logo-upload-input"]');
      if (fileInput) await (fileInput as any).uploadFile(bigPath);
      let hosted = "";
      for (let i = 0; i < 60; i++) { await sleep(500); hosted = await srcOnCanvas(); if (/\/mailer\/img\/[a-f0-9]{24}\.jpg$/.test(hosted)) break; }
      const uploadNote: any = await page.evaluate(`(function(){ var s = document.querySelector('[data-testid="ce-logo-upload-status"]'); return s ? (s.textContent || '').trim() : ''; })()`);
      ok("a 4000×3000 photo uploads, is shrunk, and lands on the canvas hosted at /mailer/img", /\/mailer\/img\/[a-f0-9]{24}\.jpg$/.test(hosted), JSON.stringify({ hosted, uploadNote }));
      const fetched: any = await page.evaluate(`(async function(u){ try { var r = await fetch(u, { cache: 'no-store' }); var b = await r.arrayBuffer(); var bytes = new Uint8Array(b); var bin = ''; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return { status: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), etag: r.headers.get('etag'), length: bytes.length, b64: btoa(bin) }; } catch (e) { return { error: String(e) }; } })(${JSON.stringify(hosted)})`);
      const got = fetched && fetched.b64 ? Buffer.from(fetched.b64, "base64") : Buffer.alloc(0);
      const gotMeta = got.length ? await sharp(got).metadata().catch(() => null) : null;
      ok("…served as image/jpeg with a year-long immutable cache", fetched.status === 200 && fetched.type === "image/jpeg" && /immutable/.test(fetched.cache || "") && !!fetched.etag, JSON.stringify({ status: fetched.status, type: fetched.type, cache: fetched.cache, error: fetched.error }));
      ok("…1200 wide, progressive, no EXIF, under 250KB", !!gotMeta && gotMeta.width === 1200 && gotMeta.height === 900 && gotMeta.isProgressive === true && !gotMeta.exif && got.length <= 250 * 1024, gotMeta ? `${gotMeta.width}×${gotMeta.height} ${Math.round(got.length / 1024)}KB exif=${!!gotMeta.exif}` : "no bytes");
      const svgRefusal: any = await page.evaluate(`(async function(){ var fd = new FormData(); fd.append('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'], { type: 'image/svg+xml' }), 'logo.svg'); var r = await fetch('/api/admin/mailer/images', { method: 'POST', body: fd, credentials: 'include', headers: { 'X-Workspace-Slug': ${JSON.stringify(WORKSPACE)} } }); var j = await r.json().catch(function(){ return {}; }); return { status: r.status, message: j.message || '' }; })()`);
      ok("an SVG upload is refused with the PNG advice", svgRefusal.status === 400 && /PNG/.test(svgRefusal.message), JSON.stringify(svgRefusal));
      const gauge: any = await page.evaluate(`(function(){ var g = document.querySelector('[data-testid="mkt-size-gauge"]'); return g ? { text: (g.textContent || '').trim(), state: g.getAttribute('data-state') } : null; })()`);
      ok("the live size gauge reads the email's KB of 102KB and is green", !!gauge && /^\d+KB of 102KB$/.test(gauge.text) && gauge.state === "ok", JSON.stringify(gauge));
      await page.screenshot({ path: join(OUT, `${label}-logo-picker.png`) });
      console.log(`  → ${join(OUT, `${label}-logo-picker.png`)}`);
      try { unlinkSync(bigPath); } catch { /* temp file */ }
      const cufcTile2 = await page.$('[data-testid="ce-logo-cufc"]');
      if (cufcTile2) await cufcTile2.click();
      await sleep(300);

      const askBtn = await page.$('[data-testid="mkt-ask-toggle"]');
      if (askBtn) await askBtn.click();
      await sleep(800);
      const askOpen: any = await page.evaluate(`(function () {
        var pane = document.querySelector('[data-testid="ce-pane-ask"]');
        var tab = document.querySelector('[data-testid="ce-tab-ask"]');
        var usage = document.querySelector('[data-testid="mailer-assistant-usage"]');
        var right = pane ? pane.closest('.ce-right') : null;
        return { visible: !!pane && pane.offsetParent !== null, tabActive: !!tab && tab.classList.contains('is-active'), usage: usage ? (usage.textContent || '').trim() : '', width: right ? Math.round(right.getBoundingClientRect().width) : 0, starters: document.querySelectorAll('[data-testid="mailer-assistant-starter"]').length };
      })()`);
      ok("the Rambo button opens the chat beside Style / Settings / Layers with today's count", askOpen.visible && askOpen.tabActive && /of \d+ today/.test(askOpen.usage) && askOpen.starters >= 3, JSON.stringify(askOpen));
      ok("…and the panel is wider than the style inspector", askOpen.width >= 340, `${askOpen.width}px`);
      const askInput = await page.$('[data-testid="mailer-assistant-input"]');
      if (askInput) { await askInput.click(); await page.keyboard.type("Change the big headline at the top so it says Hello from the harness. Nothing else."); await page.keyboard.press("Enter"); }
      let replied: any = null;
      for (let i = 0; i < 90; i++) {
        await sleep(1000);
        replied = await page.evaluate(`(function () {
          var r = document.querySelector('[data-testid="mailer-assistant-reply"], [data-testid="mailer-assistant-error"]');
          if (!r) return null;
          var f = document.querySelector('.clubos-gjs iframe');
          var canvas = f && f.contentDocument ? f.contentDocument.body.innerText : '';
          var usage = document.querySelector('[data-testid="mailer-assistant-usage"]');
          return { error: r.getAttribute('data-testid') === 'mailer-assistant-error', text: (r.textContent || '').trim().slice(0, 200), onCanvas: /Hello from the harness/.test(canvas), undo: !!document.querySelector('[data-testid="mailer-assistant-undo"]'), usage: usage ? (usage.textContent || '').trim() : '' };
        })()`);
        if (replied) break;
      }
      ok("a prompt changes the words on the canvas and offers Undo", !!replied && !replied.error && replied.onCanvas && replied.undo, JSON.stringify(replied));
      ok("…and the count moved", !!replied && /^1 of/.test(replied.usage), replied ? replied.usage : "no reply");
      await page.screenshot({ path: join(OUT, `${label}-assistant.png`) });
      console.log(`  → ${join(OUT, `${label}-assistant.png`)}`);
      const undoBtn = await page.$('[data-testid="mailer-assistant-undo"]');
      if (undoBtn) await undoBtn.click();
      await sleep(2500);
      const undone: any = await page.evaluate(`(function () {
        var f = document.querySelector('.clubos-gjs iframe');
        var canvas = f && f.contentDocument ? f.contentDocument.body.innerText : '';
        return { gone: !/Hello from the harness/.test(canvas), label: /Undone/.test(document.body.innerText), redo: !!document.querySelector('[data-testid="mailer-assistant-redo"]') };
      })()`);
      ok("Undo puts the old headline back and offers to put the change back", undone.gone && undone.label && undone.redo, JSON.stringify(undone));
      await pool.query(`UPDATE users SET mailer_ai_daily_limit = 1 WHERE id = $1`, [users[0]]);
      const askInput2 = await page.$('[data-testid="mailer-assistant-input"]');
      if (askInput2) { await askInput2.click(); await page.keyboard.type("Make the button say Join us"); await page.keyboard.press("Enter"); }
      await sleep(3000);
      const capped: any = await page.evaluate(`(function () {
        var errs = document.querySelectorAll('[data-testid="mailer-assistant-error"]');
        var last = errs[errs.length - 1];
        var input = document.querySelector('[data-testid="mailer-assistant-input"]');
        return { text: last ? (last.textContent || '').trim() : '', box: !!document.querySelector('[data-testid="mailer-assistant-capped"]'), disabled: !!(input && input.disabled) };
      })()`);
      ok("past the daily cap the next prompt is refused and names Team", /used today's 1 prompt/.test(capped.text) && capped.box && capped.disabled, JSON.stringify(capped));
      await pool.query(`UPDATE users SET mailer_ai_daily_limit = NULL WHERE id = $1`, [users[0]]);
    }

    // ── The unsent-email banner answers both buttons (2026-10-26) ─────────
    // Daniel: "carry on with it and discard doesn't actually work." Carry on
    // loaded the email into memory and left you on Setup — nothing visible —
    // and re-stamped the draft, so the banner was back on the next visit, which
    // read as Discard failing too. Now: Carry on opens the Content step with
    // the email in the box; Discard removes the draft, says so, and is still
    // gone after a reload; a draft with no subject is named by its first words.
    const DRAFT_KEY = `clubos-mailer-draft:${WORKSPACE}`;
    // 🔴 Seed from a NEUTRAL page: the Mailer flushes the email it holds on the
    // way out (pagehide included), so a draft seeded while a Mailer page is
    // still open is overwritten by that page's own email the moment we leave.
    const seedDraft = async (subject: string, doc: unknown, html: string) => {
      await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(800);
      await page.evaluate((k: string, s: string, d: unknown, h: string) => {
        localStorage.setItem(k, JSON.stringify({ subject: s, bodyDoc: d, bodyHtml: h, savedAt: new Date().toISOString() }));
      }, DRAFT_KEY, subject, doc, html);
    };
    const readBanner = () => page.evaluate(`(function () {
      var b = document.querySelector('[data-testid="mailer-draft-recover"]');
      var pills = Array.prototype.slice.call(document.querySelectorAll('[data-testid^="button-step-"]'));
      var active = pills.filter(function (x) { return /text-blue-400/.test(x.className); })[0];
      var subj = document.querySelector('[data-testid="input-subject"]');
      var mode = document.querySelector('[data-testid="text-editor-mode"]');
      var compose = document.querySelector('[data-testid="simple-compose"]');
      return {
        banner: b ? (b.textContent || "").replace(/\\s+/g, " ").trim() : null,
        step: active ? active.getAttribute("data-testid") : null,
        subject: subj ? subj.value : null,
        mode: mode ? (mode.textContent || "").trim() : null,
        composeWords: compose ? /Preflight recovered words for the roll/.test(compose.innerText || "") : false,
        builder: !!document.querySelector('[data-testid="email-builder"]'),
        draft: !!localStorage.getItem(${JSON.stringify(DRAFT_KEY)}),
        toast: /That unsent email is gone/.test(document.body.innerText)
      };
    })()`) as Promise<{ banner: string | null; step: string | null; subject: string | null; mode: string | null; composeWords: boolean; builder: boolean; draft: boolean; toast: boolean }>;
    const writtenDraft = { engine: "simple", html: "<div>Preflight recovered words for the roll</div>", letterhead: null, signature: "" };
    const writtenHtml = "<html><body><p>Preflight recovered words for the roll</p></body></html>";

    await seedDraft("Preflight — recovered subject", writtenDraft, writtenHtml);
    await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2500);
    const offered = await readBanner();
    ok("an unsent email is offered back on Setup, by its subject",
      !!offered.banner && /"Preflight — recovered subject"/.test(offered.banner) && offered.step === "button-step-setup", JSON.stringify(offered));
    const cont = await page.$('[data-testid="button-draft-continue"]');
    if (cont) await cont.click();
    await sleep(2500);
    const carried = await readBanner();
    ok("Carry on with it opens the Content step with the words in the box and the subject filled in",
      carried.banner === null && carried.step === "button-step-content" && carried.mode === "Written email" && carried.composeWords && carried.subject === "Preflight — recovered subject",
      JSON.stringify(carried));
    await page.screenshot({ path: join(OUT, `${label}-draft-carried-on.png`) });
    console.log(`  → ${join(OUT, `${label}-draft-carried-on.png`)}`);

    if (!mobile) {
      // A DESIGNED draft with no subject: named by its first words, and it
      // carries on in the builder with those words on the canvas — not on the
      // gallery, which is where a design with no doc would have opened.
      await seedDraft("", { engine: "grapesjs-mjml", version: 1, mjml: "<mjml><mj-body><mj-section><mj-column><mj-text>Preflight designed words</mj-text></mj-column></mj-section></mj-body></mjml>" }, "<html><head><style>.x{}</style></head><body><p>Preflight designed words</p></body></html>");
      await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2", timeout: 60000 });
      await sleep(2500);
      const offered2 = await readBanner();
      ok("a draft with no subject is named by its first words, not by its stylesheet",
        !!offered2.banner && /"Preflight designed words"/.test(offered2.banner) && !/\.x\{/.test(offered2.banner), JSON.stringify(offered2));
      const cont2 = await page.$('[data-testid="button-draft-continue"]');
      if (cont2) await cont2.click();
      await sleep(9000); // the builder chunk + the MJML parse
      const carried2 = await readBanner();
      const canvasWords = await page.evaluate(() => {
        const f = document.querySelector("iframe.gjs-frame") as HTMLIFrameElement | null;
        return /Preflight designed words/.test(f?.contentDocument?.body?.innerText || "");
      });
      ok("a designed draft carries on in the builder with its words on the canvas",
        carried2.step === "button-step-content" && carried2.mode === "Designed email" && carried2.builder && canvasWords, JSON.stringify({ ...carried2, canvasWords }));
    }

    await seedDraft("Preflight — to discard", writtenDraft, writtenHtml);
    await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2500);
    const disc = await page.$('[data-testid="button-draft-discard"]');
    if (disc) await disc.click();
    await sleep(800);
    const discarded = await readBanner();
    ok("Discard removes the draft, hides the banner and says so",
      discarded.banner === null && !discarded.draft && discarded.toast, JSON.stringify(discarded));
    await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2000);
    const afterReload = await readBanner();
    ok("the discarded email stays gone after a reload", afterReload.banner === null && !afterReload.draft, JSON.stringify(afterReload));

    // ── Nothing typed is lost to a click (2026-10-26) ──────────────────────
    // Daniel: Friendly Manager "if you accidentally clicked another page you
    // lost all your writing … needs to auto save as you go". Type into a
    // written email and click the sidebar INSIDE the save delay: the words,
    // and the audience chosen on Setup, must be in the draft when the page
    // comes back.
    await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2500);
    const segAll = await page.$('[data-testid="button-segment-all"]');
    if (segAll) await segAll.click();
    await sleep(300);
    const nextC = await page.$('[data-testid="button-next-content"]');
    if (nextC) await nextC.click();
    await sleep(1000);
    const writeCard2 = await page.$('[data-testid="button-mode-simple"]');
    if (writeCard2) await writeCard2.click();
    await sleep(1200);
    const flushBox = await page.$('[data-testid="compose-body"]');
    if (flushBox) { await flushBox.click(); await page.keyboard.press("End"); await page.keyboard.type(" Flushed on the way out"); }
    // Straight to the sidebar — no wait for the 500ms compile or the 400ms write.
    // On a phone the sidebar sits behind its toggle, so open it first.
    if (mobile) { const tog = await page.$('[data-testid="button-sidebar-toggle"]'); if (tog) await tog.click(); await sleep(400); }
    await page.evaluate(() => (Array.from(document.querySelectorAll("a")).find((a) => (a.textContent || "").trim() === "Dashboard") as HTMLAnchorElement | undefined)?.click());
    await sleep(1500);
    const flushed = await page.evaluate(`(function () {
      var raw = localStorage.getItem(${JSON.stringify(DRAFT_KEY)});
      var d = raw ? JSON.parse(raw) : null;
      return { path: location.pathname, words: !!d && /Flushed on the way out/.test(d.bodyHtml || ""), audience: d ? d.segmentType : null };
    })()`) as { path: string; words: boolean; audience: string | null };
    ok("words typed a moment before clicking away are in the draft, with the audience", flushed.path === "/admin" && flushed.words && flushed.audience === "all", JSON.stringify(flushed));
    await page.goto(`${BASE}/admin/mailer`, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2500);
    const back = await readBanner();
    ok("…and the Mailer offers them back by their first words", !!back.banner && /Flushed on the way out/.test(back.banner), JSON.stringify(back));

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

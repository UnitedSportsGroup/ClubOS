/**
 * Sponsor proposals & contracts — in a real browser, as ORDINARY STAFF and as
 * the sponsor, at 1440×900 and 390×844 (and the sponsor's page at 1366×768).
 *
 *   npx tsx --env-file=.env script/_verify-sponsor-proposals-browser.ts
 *   VERIFY_BASE=http://localhost:5247 DATABASE_URL=… npx tsx script/_verify-sponsor-proposals-browser.ts
 *
 * Builds a proposal through the screen (not the API), makes it live, opens it
 * signed out, accepts it, then sends the contract from the dialog. Screenshots
 * land in SHOTS (default /tmp/sponsor-proposals-shots) — LOOK at them.
 * Addresses are Resend sinks; everything made is removed at the end.
 */
import crypto from "crypto";
import { mkdirSync } from "fs";
import { join } from "path";
import bcrypt from "bcryptjs";
import pg from "pg";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const BASE = (process.env.VERIFY_BASE || "https://app.usg.co.nz").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.SHOTS || "/tmp/sponsor-proposals-shots";
const LOGO = join(process.cwd(), "client/public/logos/united-prints.png");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = crypto.randomBytes(3).toString("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const fails: string[] = [];
function ok(label: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fails.push(label); console.log(`  ✗ ${label}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); }
}

let userId = 0;
let staffEmail = "";
async function staffCookie() {
  staffEmail = `delivered+sponsorui-${tag}@resend.dev`;
  const password = crypto.randomBytes(12).toString("hex");
  const u = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1, 'Riley', 'Probe', $2, 'team_member', true) RETURNING id`, [staffEmail, await bcrypt.hash(password, 10)]);
  userId = u.rows[0].id;
  const org = await pool.query(`SELECT id FROM organizations WHERE slug = 'united-sports-group'`);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, $2, 'team_member', $3)`, [userId, org.rows[0].id, JSON.stringify(["sponsorship", "esign"])]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: staffEmail, password }) });
  if (!login.ok) throw new Error(`login failed HTTP ${login.status}`);
  const [name, ...rest] = (login.headers.getSetCookie?.()[0] || "").split(";")[0].split("=");
  return { name, value: rest.join("=") };
}

/** Measurements that say whether a person could use what is on screen. */
async function measure(page: Page, rootSel: string, width: number) {
  return page.evaluate(`(function(){
    var W = ${width};
    var root = document.querySelector(${JSON.stringify(rootSel)}) || document.body;
    var small = [];
    var els = root.querySelectorAll('button, a[href], [role="combobox"], input:not([type=hidden]):not(.sr-only), textarea');
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || els[i].getAttribute('aria-hidden') === 'true' || els[i].tabIndex === -1) continue;
      var lab = els[i].closest('label');
      var h = Math.max(r.height, lab ? lab.getBoundingClientRect().height : 0);
      if (h < 40) small.push((els[i].innerText || els[i].getAttribute('placeholder') || els[i].getAttribute('data-testid') || els[i].tagName).trim().slice(0, 28) + ' ' + Math.round(h) + 'px');
    }
    var wide = [];
    var all = root.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      var b = all[j].getBoundingClientRect();
      if (b.width > 0 && (b.right > W + 1 || b.left < -1) && getComputedStyle(all[j]).position !== 'absolute') { wide.push(all[j].tagName + ' ' + Math.round(b.left) + '→' + Math.round(b.right)); if (wide.length > 4) break; }
    }
    return { docWidth: document.documentElement.scrollWidth, small: small, wide: wide, text: document.body.innerText.length };
  })()`) as Promise<{ docWidth: number; small: string[]; wide: string[]; text: number }>;
}

async function clearAndType(page: Page, sel: string, value: string) {
  await page.waitForSelector(sel, { timeout: 20000 });
  await page.click(sel, { clickCount: 3 });
  await page.type(sel, value, { delay: 4 });
}
const gone = (page: Page, sel: string) => page.waitForFunction((s: string) => !document.querySelector(s), { timeout: 20000 }, sel);
const saved = (page: Page) => page.waitForFunction(() => document.querySelector('[data-testid="proposal-save-state"]')?.textContent === "Saved", { timeout: 20000 }).then(() => true).catch(() => false);

async function sponsorPage(browser: Browser, url: string, label: string, width: number, height: number, mobile: boolean, accept: boolean) {
  const ctx = await browser.createBrowserContext(); // signed out, like the sponsor
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 90000 });
  const drawn = await page.waitForSelector('[data-testid="proposal-h1"]', { timeout: 30000 }).then(() => true).catch(() => false);
  ok(`[${label}] the sponsor's page draws for someone signed out`, drawn);
  if (!drawn) { await page.screenshot({ path: join(OUT, `${label}-FAILED.png`) }); await ctx.close(); return; }
  await page.evaluate(() => (document as any).fonts.ready);
  await sleep(900);
  const facts: any = await page.evaluate(`(function(){
    var h1 = document.querySelector('[data-testid="proposal-h1"]');
    var logo = document.querySelector('[data-testid="proposal-sponsor-logo"]');
    var crest = document.querySelector('header img');
    var cta = document.querySelector('a[href="#accept"]');
    var body = getComputedStyle(document.querySelector('[data-testid="proposal-page"]'));
    return {
      h1: h1.innerText, h1Font: getComputedStyle(h1).fontFamily, h1Right: h1.getBoundingClientRect().right,
      roughCut: document.fonts.check("16px 'Rough Cut'"), oswald: document.fonts.check("600 16px Oswald"),
      logoLoaded: !!logo && logo.naturalWidth > 0, crestLoaded: !!crest && crest.naturalWidth > 0,
      ctaBottom: cta ? cta.getBoundingClientRect().bottom : -1, vh: window.innerHeight,
      bg: body.backgroundColor, ink: body.color, stats: document.querySelectorAll('[data-testid="proposal-stat"]').length,
      source: (document.querySelector('[data-testid="proposal-source"]') || {}).innerText || '',
      robots: (document.querySelector('meta[name="robots"]') || {}).content || '',
      theme: document.documentElement.getAttribute('data-theme'),
    };
  })()`);
  ok(`[${label}] the headline is the offer, written to them`, /^BECOME THE .+ OF (SOUTH ISLAND UNITED|CHRISTCHURCH UNITED)$/i.test(String(facts.h1).replace(/\s+/g, " ").trim()), facts.h1);
  ok(`[${label}] the club's own headline face loaded`, url.includes("cufc-") ? facts.oswald : facts.roughCut || facts.oswald, { roughCut: facts.roughCut, oswald: facts.oswald, family: facts.h1Font });
  ok(`[${label}] the sponsor's logo and the club crest are really drawn`, facts.logoLoaded && facts.crestLoaded, facts);
  ok(`[${label}] the page is dark with light ink (the admin's light theme did not repaint it)`, /rgb\((5, 5, 5|12, 22, 64)\)/.test(facts.bg) && /rgb\((244, 241, 234|255, 255, 255)\)/.test(facts.ink), { bg: facts.bg, ink: facts.ink });
  ok(`[${label}] the Accept button is on screen without scrolling`, facts.ctaBottom > 0 && facts.ctaBottom <= facts.vh, { ctaBottom: Math.round(facts.ctaBottom), vh: facts.vh });
  ok(`[${label}] the audience figures show, with their source`, facts.stats >= 2 && /Source: /.test(facts.source), { stats: facts.stats, source: facts.source });
  ok(`[${label}] search engines are told to stay away`, /noindex/.test(facts.robots), facts.robots);
  const m = await measure(page, '[data-testid="proposal-page"]', width);
  ok(`[${label}] nothing runs off the side`, m.docWidth <= width + 1 && m.wide.length === 0, { docWidth: m.docWidth, wide: m.wide });
  ok(`[${label}] every control is big enough for a thumb`, m.small.length === 0, m.small);
  ok(`[${label}] no script error on the page`, errors.length === 0, errors);
  await page.screenshot({ path: join(OUT, `${label}-top.png`) });
  await page.screenshot({ path: join(OUT, `${label}-full.png`), fullPage: true });

  if (accept) {
    await page.type('[data-testid="proposal-accept-name"]', "Sam Sponsor");
    await page.type('[data-testid="proposal-accept-role"]', "Director");
    await page.click('[data-testid="proposal-accept-submit"]');
    const complaint = await page.waitForSelector('[data-testid="proposal-accept-error"]', { timeout: 5000 }).then(() => true).catch(() => false);
    ok(`[${label}] a half-filled form says what is missing instead of sending`, complaint);
    await page.type('[data-testid="proposal-accept-email"]', `delivered+sponsorui-accept-${tag}@resend.dev`);
    await page.click('[data-testid="proposal-accept-agree"]');
    await sleep(3200); // a person takes longer than three seconds
    await page.click('[data-testid="proposal-accept-submit"]');
    const thanks = await page.waitForSelector('[data-testid="proposal-accepted-state"]', { timeout: 20000 }).then(() => true).catch(() => false);
    ok(`[${label}] accepting shows a plain thank-you`, thanks);
    await page.screenshot({ path: join(OUT, `${label}-accepted.png`) });
  }
  await ctx.close();
}

async function cleanup() {
  const rows = (await pool.query(`SELECT id, partner_id, partner_contract_id, esign_document_id FROM sponsor_proposals WHERE sponsor_company LIKE $1`, [`__ui probe ${tag}%`])).rows;
  await pool.query(`DELETE FROM sponsor_proposals WHERE sponsor_company LIKE $1`, [`__ui probe ${tag}%`]);
  for (const r of rows) {
    if (r.partner_contract_id) await pool.query(`DELETE FROM sponsorship_partner_contracts WHERE id = $1`, [r.partner_contract_id]);
    if (r.partner_id) await pool.query(`DELETE FROM sponsorship_partners WHERE id = $1 AND company LIKE '__ui probe %'`, [r.partner_id]);
    if (r.esign_document_id) await pool.query(`DELETE FROM esign_documents WHERE id = $1`, [r.esign_document_id]);
  }
  await pool.query(`DELETE FROM esign_documents WHERE created_by = $1`, [userId]).catch(() => undefined);
  await pool.query(`DELETE FROM mailer_images WHERE uploaded_by = $1`, [userId]).catch(() => undefined);
  await pool.query(`DELETE FROM public_form_submissions WHERE form = 'sponsor_proposal_accept' AND email LIKE $1`, [`%${tag}@resend.dev`]).catch(() => undefined);
  if (userId) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`\n  Sponsor proposals — browser check against ${BASE}\n  screenshots → ${OUT}\n`);
  const cookie = await staffCookie();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    for (const [label, width, height, mobile] of [["desktop", 1440, 900, false], ["phone", 390, 844, true]] as const) {
      console.log(`\n  ${label} (${width}×${height})`);
      const company = `__ui probe ${tag} ${label}`;
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e.message)));
      await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
      await page.setCookie({ ...cookie, url: BASE, path: "/", httpOnly: true, secure: BASE.startsWith("https") });
      await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluate(() => localStorage.setItem("clubos_workspace", "united-sports-group"));
      await page.goto(`${BASE}/admin/sponsorship#prospects`, { waitUntil: "networkidle2", timeout: 90000 });

      // Found the way a person finds it: the sub-menu, not a typed address.
      const item = await page.waitForSelector('[data-testid="submenu-proposals"]', { timeout: 30000 }).then(() => true).catch(() => false);
      ok(`[${label}] "Proposals & contracts" is in the Prospects menu`, item);
      if (!item) { await page.screenshot({ path: join(OUT, `${label}-admin-FAILED.png`) }); continue; }
      await page.evaluate(() => (document.querySelector('[data-testid="submenu-proposals"]') as HTMLElement).scrollIntoView({ block: "nearest", inline: "center" }));
      await page.click('[data-testid="submenu-proposals"]');
      const view = await page.waitForSelector('[data-testid="proposals-view"]', { timeout: 30000 }).then(() => true).catch(() => false);
      ok(`[${label}] the list opens (a real list or an honest empty state, never an error)`, view && !(await page.$('[data-testid="proposals-error"]')));
      ok(`[${label}] the address says where you are`, (await page.evaluate(() => location.hash)) === "#prospects-proposals");
      await page.screenshot({ path: join(OUT, `${label}-admin-list.png`) });

      await page.click('[data-testid="proposal-new"]');
      await page.waitForSelector('[data-testid="proposal-new-dialog"]', { timeout: 10000 });
      await sleep(300);
      const dlg: any = await page.evaluate(() => { const r = document.querySelector('[data-testid="proposal-new-dialog"]')!.getBoundingClientRect(); return { left: r.left, right: r.right, w: window.innerWidth }; });
      ok(`[${label}] the New proposal box fits the screen`, dlg.left >= 0 && dlg.right <= dlg.w + 1, dlg);
      await page.type('[data-testid="proposal-new-company"]', company);
      await page.click('[data-testid="proposal-new-create"]');
      const editor = await page.waitForSelector('[data-testid="proposal-editor"]', { timeout: 30000 }).then(() => true).catch(() => false);
      ok(`[${label}] creating opens the proposal`, editor);
      await gone(page, '[data-testid="proposal-new-dialog"]').catch(() => undefined);
      const hash = await page.evaluate(() => location.hash);
      ok(`[${label}] the open proposal is in the address (#prospects-proposals/<id>)`, /^#prospects-proposals\/\d+$/.test(hash), hash);
      const id = Number(hash.split("/")[1]);

      // Fill it in the way staff would.
      await clearAndType(page, '[data-testid="proposal-contact-name"]', "Sam Sponsor");
      await clearAndType(page, '[data-testid="proposal-contact-email"]', `delivered+sponsorui-signer-${tag}@resend.dev`);
      await clearAndType(page, '[data-testid="proposal-title"]', "Official Shorts Partner");
      const headline = await page.$eval('[data-testid="proposal-headline"]', (e) => (e as HTMLElement).innerText);
      ok(`[${label}] the headline is written from the title as you type`, /Become the Official Shorts Partner of South Island United/.test(headline), headline);
      await page.click('[data-testid="proposal-asset-add"]');
      await clearAndType(page, '[data-testid="proposal-asset-name"]', "Back of shorts, home and away kits");
      for (const k of ["siu_fifa_streams", "siu_match_crowds", "siu_biggest_crowd"]) await page.click(`[data-testid="proposal-audience-${k}"]`);
      await page.click('[data-testid="proposal-standard-benefits"] button');
      const file = await page.$('[data-testid="proposal-logo-file"]');
      await (file as any).uploadFile(LOGO);
      const logoUp = await page.waitForSelector('[data-testid="proposal-logo-ground-dark"]', { timeout: 30000 }).then(() => true).catch(() => false);
      ok(`[${label}] a logo uploads and is hosted by ClubOS`, logoUp);
      if (logoUp) await page.click('[data-testid="proposal-logo-ground-dark"]');
      await clearAndType(page, '[data-testid="proposal-fee"]', "15000");
      await clearAndType(page, '[data-testid="proposal-payment"]', "One payment on 20 January 2027.");
      // The drawn date picker: open it and pick a day, twice.
      for (const sel of ['[data-testid="proposal-term-start"]', '[data-testid="proposal-term-end"]']) {
        await page.click(sel);
        const day = await page.waitForSelector('[role="gridcell"] button:not([disabled]), button[name="day"]:not([disabled])', { timeout: 10000 }).catch(() => null);
        if (day) { const days = await page.$$('[role="gridcell"] button:not([disabled]), button[name="day"]:not([disabled])'); await days[sel.includes("end") ? days.length - 1 : 0].click(); }
        await page.keyboard.press("Escape");
        await sleep(250);
      }
      ok(`[${label}] it saves as you go`, await saved(page));
      const row = (await pool.query(`SELECT fee_cents, term_start::text, term_end::text, logo_url, audience_keys, partnership_title FROM sponsor_proposals WHERE id = $1`, [id])).rows[0] ?? {};
      ok(`[${label}] what was typed is what was stored ($15,000 = 1,500,000 cents, both dates, the logo, three figures)`, Number(row.fee_cents) === 1500000 && Boolean(row.term_start) && Boolean(row.term_end) && row.term_end >= row.term_start && /^\/mailer\/img\//.test(row.logo_url ?? "") && row.audience_keys?.length === 3, row);

      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(300);
      const m = await measure(page, '[data-testid="proposal-editor"]', width);
      ok(`[${label}] the builder does not run off the side`, m.docWidth <= width + 1 && m.wide.length === 0, { docWidth: m.docWidth, wide: m.wide });
      ok(`[${label}] every control in the builder is at least 40px tall`, m.small.length === 0, m.small);
      await page.screenshot({ path: join(OUT, `${label}-admin-editor.png`), fullPage: true });

      await page.click('[data-testid="proposal-publish"]');
      const liveUrl = await page.waitForSelector('[data-testid="proposal-url"]', { timeout: 20000 }).then((e) => e!.evaluate((n) => (n as HTMLElement).innerText)).catch(() => "");
      ok(`[${label}] making it live shows the link on the club's own host`, /^https:\/\/join\.southislandunited\.com\/proposal\/[A-Za-z0-9_-]{22,}$/.test(liveUrl), liveUrl);
      const token = liveUrl.split("/").pop() || "";

      // The sponsor, signed out. Locally the brand host does not point here, so the same path on this server.
      await sponsorPage(browser, `${BASE}/proposal/${token}`, `${label}-sponsor`, width, height, mobile, true);
      if (label === "desktop") await sponsorPage(browser, `${BASE}/proposal/${token}`, "laptop-1366-sponsor", 1366, 768, false, false);

      // Back in the builder: accepted, counted, locked, and the contract goes.
      await page.reload({ waitUntil: "networkidle2" });
      await page.waitForSelector('[data-testid="proposal-editor"]', { timeout: 30000 });
      const acceptedText = await page.waitForSelector('[data-testid="proposal-accepted"]', { timeout: 20000 }).then((e) => e!.evaluate((n) => (n as HTMLElement).innerText)).catch(() => "");
      ok(`[${label}] the builder shows who accepted`, /Sam Sponsor, Director, accepted/.test(acceptedText), acceptedText);
      const opens = await page.$eval('[data-testid="proposal-opens"]', (e) => (e as HTMLElement).innerText).catch(() => "");
      ok(`[${label}] the sponsor's opens are counted`, /Opened \d+ time/.test(opens), opens);
      ok(`[${label}] the accepted version is locked`, Boolean(await page.$('[data-testid="proposal-locked"]')) && (await page.$eval('[data-testid="proposal-title"]', (e) => (e as HTMLInputElement).disabled)));

      await page.click('[data-testid="proposal-send-contract"]');
      await page.waitForSelector('[data-testid="proposal-contract-dialog"]', { timeout: 15000 });
      const ready = await page.waitForFunction(() => { const b = document.querySelector('[data-testid="proposal-contract-send"]') as HTMLButtonElement | null; return b && !b.disabled; }, { timeout: 20000 }).then(() => true).catch(() => false);
      ok(`[${label}] the contract box is ready to send, with nothing missing`, ready && !(await page.$('[data-testid="proposal-contract-problems"]')));
      const box: any = await page.evaluate(() => {
        const d = document.querySelector('[data-testid="proposal-contract-dialog"]')!;
        const r = d.getBoundingClientRect();
        let worst = r.right;
        d.querySelectorAll("*").forEach((n) => { const b = n.getBoundingClientRect(); if (b.width > 0) worst = Math.max(worst, b.right); });
        return { left: r.left, right: r.right, worst, w: window.innerWidth, text: (d as HTMLElement).innerText };
      });
      ok(`[${label}] the contract box, and everything in it, fits the screen`, box.left >= 0 && box.worst <= box.w + 1, { left: box.left, worst: box.worst, w: box.w });
      ok(`[${label}] it shows the fee, the term and who it goes to`, /\$15,000 plus GST/.test(box.text) && /Sam Sponsor|signer/.test(box.text) && /resend\.dev/.test(box.text), box.text.slice(0, 300));
      await page.screenshot({ path: join(OUT, `${label}-admin-contract.png`) });
      await page.click('[data-testid="proposal-contract-send"]');
      const out = await page.waitForSelector('[data-testid="proposal-open-esign"]', { timeout: 60000 }).then(() => true).catch(() => false);
      ok(`[${label}] sending makes the agreement and the proposal reads "Contract out"`, out && /Contract out/.test(await page.$eval('[data-testid="proposal-stage"]', (e) => (e as HTMLElement).innerText)));
      const doc = (await pool.query(`SELECT d.status, d.template_id, (SELECT count(*)::int FROM esign_signers s WHERE s.document_id = d.id) AS signers FROM sponsor_proposals p JOIN esign_documents d ON d.id = p.esign_document_id WHERE p.id = $1`, [id])).rows[0] ?? {};
      ok(`[${label}] a real e-Sign document, sent, with two signers, is behind it`, doc.status === "sent" && doc.signers === 2, doc);
      await gone(page, '[data-testid="proposal-contract-dialog"]').catch(() => undefined);
      await page.screenshot({ path: join(OUT, `${label}-admin-contract-out.png`), fullPage: true });

      // Back goes to the list, and the list shows the row.
      await page.click('[data-testid="proposal-back"]');
      const listed = await page.waitForSelector(`[data-testid="proposal-row-${id}"]`, { timeout: 20000 }).then(() => true).catch(() => false);
      ok(`[${label}] Back returns to the list, which shows the proposal`, listed && (await page.evaluate(() => location.hash)) === "#prospects-proposals");
      await page.goBack();
      ok(`[${label}] the browser's own Back reopens the proposal`, await page.waitForSelector('[data-testid="proposal-editor"]', { timeout: 15000 }).then(() => true).catch(() => false));
      ok(`[${label}] no script error in the builder`, errors.length === 0, errors);
      await page.close();
    }

    // Christchurch United wears its own colours and type.
    console.log(`\n  Christchurch United`);
    const org = (await pool.query(`SELECT id FROM organizations WHERE slug = 'united-sports-group'`)).rows[0].id;
    const logo = (await pool.query(`SELECT key FROM mailer_images WHERE uploaded_by = $1 ORDER BY id DESC LIMIT 1`, [userId])).rows[0]?.key;
    const cufcToken = `cufc-${crypto.randomBytes(18).toString("base64url")}`;
    await pool.query(
      `INSERT INTO sponsor_proposals (organization_id, token, brand, sponsor_company, partnership_title, season_label, assets, benefits, audience_keys, term_start, term_end, fee_cents, payment_terms, logo_url, logo_ground, published_at, created_by)
       VALUES ($1, $2, 'cufc', $3, 'Official Academy Partner', 'Season 2027', $4::jsonb, $5::jsonb, $6, '2027-01-01', '2027-12-31', 800000, 'Two payments of $4,000 plus GST, on 20 January and 20 July 2027.', $7, 'light', now(), $8)`,
      [org, cufcToken, `__ui probe ${tag} cufc`, JSON.stringify([{ name: "Academy training kit", detail: "Logo on the front of the academy training shirt, U9 to U17.", priceCents: null }, { name: "Pitch-side sign at United Sports Centre", detail: "One sign on the main academy pitch for the season.", priceCents: null }]),
        JSON.stringify(["Logo and link on the club website", "A one-page report at the end of the year"]), ["cufc_social_followers", "cufc_web_users_2026", "cufc_cic_2026", "cufc_mfl_t4_2026"], logo ? `/mailer/img/${logo}.png` : null, userId],
    );
    await sponsorPage(browser, `${BASE}/proposal/${cufcToken}`, "cufc-desktop-sponsor", 1440, 900, false, false);
    await sponsorPage(browser, `${BASE}/proposal/${cufcToken}`, "cufc-phone-sponsor", 390, 844, true, false);

    // A dead link says so plainly.
    const dead = await browser.newPage();
    await dead.goto(`${BASE}/proposal/${"z".repeat(30)}`, { waitUntil: "networkidle2" });
    ok("a dead link shows a plain message, not a blank page", /not available/i.test(await dead.evaluate(() => document.body.innerText)));
    await dead.close();
  } finally {
    await browser.close();
  }
}

main()
  .catch((e) => { fails.push(`crashed: ${e.message}`); console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup failed:", e.message));
    await pool.end();
    console.log(`\n  ${fails.length ? "❌" : "✅"} ${pass} passed, ${fails.length} failed\n`);
    for (const f of fails) console.log(`     - ${f}`);
    process.exit(fails.length ? 1 : 0);
  });

// The Sales tab's "Send email" button, driven in a real browser on production.
//
//   npx tsx --env-file=.env script/_verify-sales-email-browser.ts
//
// Creates a throwaway super-admin and a throwaway prospect, opens the dialog at
// desktop and phone widths, checks the draft is personalised, sends ONE real
// email to Resend's test sink (never a real lead), then checks the email was
// logged, the lead moved New → Contacted, the button stepped aside, and a
// second send inside a minute is refused. Then the whole JOURNEY: a link added
// with Add link, a PDF attached, the preview, Resend's real delivered webhook,
// an open (pixel) and a click (redirect), and a throwaway quote + paid order
// that must surface as Quote submitted / Order confirmed / Paid. Everything it
// made is deleted in the `finally`, even if an assertion throws.
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import puppeteer from "puppeteer-core";
import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = "https://app.usg.co.nz";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SINK = "delivered@resend.dev";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fails.push(label); console.log(`  ✗ ${label} ${detail}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let userId: number | null = null;
let prospectId: number | null = null;
let browser: any = null;
let quoteId: number | null = null; let orderId: number | null = null;

try {
  const org = (await pool.query(`SELECT id, slug FROM organizations WHERE id = 8`)).rows[0];
  const email = `salesprobe-${crypto.randomBytes(5).toString("hex")}@example.com`;
  const password = crypto.randomBytes(16).toString("base64url");
  userId = (await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'Sales','Probe',$2,'super_admin',true) RETURNING id`,
    [email, await bcrypt.hash(password, 10)])).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`, [userId, org.id]);
  prospectId = (await pool.query(
    `INSERT INTO sales_prospects (organization_id,name,category,contact_name,contact_role,email,services_match,source,stage,total_score,tier,city)
     VALUES ($1,'ZZ PROBE Events Ltd','event-organisers','Dr Jane Probe','Organiser',$2,'["merch","trophies-medals"]','manual','new',1,'C','Christchurch')
     RETURNING id`, [org.id, SINK])).rows[0].id;

  const headers = execFileSync("curl", ["-s", "-D", "-", "-o", "/dev/null", "--max-time", "30", "-X", "POST",
    "-H", "Content-Type: application/json", "-d", JSON.stringify({ email, password }), `${BASE}/api/auth/login`]).toString();
  ok("logged in to production", /^HTTP\/[\d.]+ 200/m.test(headers));
  const [cname, cvalue] = (headers.match(/^set-cookie:\s*(.+)$/im)?.[1] ?? "").split(";")[0].split("=");

  const outDir = join(process.cwd(), "..", "..", "..", "..", "outputs", "ui-preflight", "clubos-sales-email");
  mkdirSync(outDir, { recursive: true });
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

  for (const [label, w, h] of [["mobile", 390, 844], ["desktop", 1440, 900]] as const) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    await page.setCookie({ name: cname, value: cvalue, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.evaluate((slug: string) => localStorage.setItem("clubos_workspace", slug), org.slug);
    await page.goto(`${BASE}/admin/print-sales`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector('[data-testid="input-search"]', { timeout: 30000 });
    await page.type('[data-testid="input-search"]', "ZZ PROBE");
    const btn = `[data-testid="button-email-${prospectId}"]`;
    await page.waitForSelector(btn, { timeout: 15000 }).catch(() => {});
    ok(`${label}: a New lead with an email shows Send email`, !!(await page.$(btn)));
    await page.$eval(btn, (el: any) => el.scrollIntoView({ block: "center", inline: "center" }));
    await page.click(btn);
    await page.waitForFunction(() => {
      const b = document.querySelector('[data-testid="email-body"]') as HTMLTextAreaElement | null;
      return !!b && b.value.length > 50;
    }, { timeout: 15000 }).catch(() => {});

    const d = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]') as HTMLElement | null;
      const r = dlg?.getBoundingClientRect();
      const send = document.querySelector('[data-testid="email-send"]') as HTMLElement | null;
      const sr = send?.getBoundingClientRect();
      const q = document.querySelectorAll('[data-testid="email-to"],[data-testid="email-subject"],[data-testid="email-body"]') as any;
      return { to: q[0]?.value ?? "", subject: q[1]?.value ?? "", body: q[2]?.value ?? "",
        left: r?.left ?? -1, right: r?.right ?? 99999, vw: window.innerWidth,
        sendRight: sr?.right ?? 99999, sendH: sr?.height ?? 0, text: dlg?.innerText ?? "" };
    });
    ok(`${label}: To is pre-filled`, d.to === SINK, d.to);
    ok(`${label}: subject names the business`, d.subject === "Printing for ZZ PROBE Events Ltd", d.subject);
    ok(`${label}: greeting uses the first name, title dropped`, d.body.startsWith("Hi Jane,"), d.body.slice(0, 30));
    ok(`${label}: category line for event organisers`, /finisher medals/.test(d.body));
    ok(`${label}: signed by the sender`, /Cheers,\nSales Probe\nUnited Prints/.test(d.body));
    ok(`${label}: the legal footer is shown`, /reply "unsubscribe"/.test(d.text));
    ok(`${label}: dialog fits the screen`, d.left >= 0 && d.right <= d.vw + 0.5, `${d.left}..${d.right} of ${d.vw}`);
    ok(`${label}: Send button on screen and tappable`, d.sendRight <= d.vw && d.sendH >= 32, `${d.sendRight}/${d.sendH}`);
    await sleep(800); // let the dialog's fade-in finish before judging how it looks
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('[role="dialog"]') as Element).backgroundColor);
    const op = await page.evaluate(() => getComputedStyle(document.querySelector('[role="dialog"]') as Element).opacity);
    ok(`${label}: dialog is opaque once open`, op === "1" && !/, 0\.\d+\)$/.test(bg), `${bg} opacity ${op}`);
    await page.screenshot({ path: join(outDir, `${label}-dialog.png`) });

    if (label === "mobile") { await page.close(); continue; }

    // Make it bespoke: an edit, a link added with Add link, and a PDF.
    await page.focus('[data-testid="email-body"]');
    await page.keyboard.press("End");
    await page.keyboard.type("\n\nPS — probe edit. ");
    await page.click('[data-testid="email-add-link"]');
    await page.type('[data-testid="email-link-label"]', "get an instant quote");
    await page.type('[data-testid="email-link-url"]', "unitedprints.co.nz/instant-quote");
    await page.click('[data-testid="email-link-insert"]');
    const bodyNow = await page.$eval('[data-testid="email-body"]', (el: any) => el.value);
    ok("Add link inserts [words](url) into the message", bodyNow.includes("[get an instant quote](https://unitedprints.co.nz/instant-quote)"), bodyNow.slice(-120));
    const pdf = join(outDir, "probe-price-list.pdf");
    writeFileSync(pdf, "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
    const input = await page.$('[data-testid="email-file-input"]');
    await (input as any).uploadFile(pdf);
    await page.waitForSelector('[data-testid="email-attachments"]', { timeout: 5000 }).catch(() => {});
    ok("the PDF shows as attached", /probe-price-list\.pdf/.test(await page.evaluate(() => document.body.innerText)));
    await page.click('[data-testid="email-mode-preview"]');
    const prev = await page.$eval('[data-testid="email-preview"]', (el: any) => ({ links: Array.from(el.querySelectorAll("a")).map((a: any) => a.getAttribute("href")), text: el.innerText }));
    ok("preview: the added link is clickable", prev.links.includes("https://unitedprints.co.nz/instant-quote"), JSON.stringify(prev.links));
    ok("preview: the signature's web address is clickable", prev.links.includes("https://unitedprints.co.nz/"), JSON.stringify(prev.links));
    ok("preview: the phone number is clickable", prev.links.includes("tel:0800800199"), JSON.stringify(prev.links));
    ok("preview: markdown is not shown raw", !/\]\(https/.test(prev.text));
    await page.screenshot({ path: join(outDir, `desktop-preview.png`) });
    await page.click('[data-testid="email-mode-write"]');
    await page.click('[data-testid="email-send"]');
    await page.waitForFunction((b: string) => !document.querySelector(b) && !document.querySelector('[data-testid="email-body"]'),
      { timeout: 30000 }, btn).catch(() => {});
    await sleep(1500);
    ok("after sending, the dialog closes and the button steps aside", !(await page.$(btn)) && !(await page.$('[data-testid="email-body"]')));
    await page.screenshot({ path: join(outDir, `desktop-after-send.png`) });

    const p = (await pool.query(`SELECT stage, next_follow_up_on::text f FROM sales_prospects WHERE id=$1`, [prospectId])).rows[0];
    ok("lead moved New → Contacted", p.stage === "contacted", p.stage);
    ok("follow-up date set", !!p.f, String(p.f));
    const acts = (await pool.query(`SELECT type, note, created_by FROM sales_activities WHERE prospect_id=$1 ORDER BY id`, [prospectId])).rows;
    const em = acts.find((a: any) => a.type === "email");
    ok("email logged with who sent it", !!em && em.created_by === userId);
    ok("the logged email is what was typed", !!em && em.note.includes("PS — probe edit.") && em.note.startsWith(`To: ${SINK}`));
    ok("stage change logged 'via email'", acts.some((a: any) => a.type === "stage_change" && /via email/.test(a.note)));
    const logRow = (await pool.query(`SELECT provider_message_id FROM email_logs WHERE to_email=$1 AND subject=$2 ORDER BY id DESC LIMIT 1`, [SINK, "Printing for ZZ PROBE Events Ltd"])).rows[0];
    ok("Resend accepted it (message id recorded)", !!logRow?.provider_message_id, JSON.stringify(logRow));

    // A second send inside a minute is a double-click, not a second email.
    const again = await page.evaluate(async (id: number, slug: string) => {
      const r = await fetch(`/api/admin/sales/prospects/${id}/email`, { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-Workspace-Slug": slug },
        body: JSON.stringify({ to: "delivered@resend.dev", subject: "x", body: "A second try inside the minute window." }) });
      return r.status;
    }, prospectId, org.slug);
    ok("a second send within a minute is refused (409)", again === 409, String(again));

    // ── The stored email: tracked links, UTM tags, the attachment, Resend's id.
    const se = (await pool.query(`SELECT id, token, links, attachments, provider_message_id FROM sales_emails WHERE prospect_id=$1`, [prospectId])).rows[0];
    ok("the email is stored with Resend's message id", !!se?.provider_message_id);
    ok("the attachment is recorded", Array.isArray(se?.attachments) && se.attachments[0]?.filename === "probe-price-list.pdf");
    const quoteLink = (se?.links ?? []).findIndex((l: any) => l.label === "get an instant quote");
    ok("our own links carry utm tags", quoteLink >= 0 && /utm_source=sales-email/.test(se.links[quoteLink].url), JSON.stringify(se?.links?.[quoteLink]));

    // Delivered: Resend's real webhook, signed, into production.
    let delivered = false;
    for (let i = 0; i < 30 && !delivered; i++) {
      await sleep(3000);
      delivered = (await pool.query(`SELECT 1 FROM sales_email_events WHERE sales_email_id=$1 AND type='delivered'`, [se.id])).rowCount! > 0;
    }
    ok("Resend's delivered webhook arrived and was recorded", delivered);

    // Opened + clicked, the way a person's mail app would.
    const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    execFileSync("curl", ["-s", "-o", "/dev/null", "-A", UA, `${BASE}/t/se/${se.token}/o.gif`]);
    const loc = execFileSync("curl", ["-s", "-o", "/dev/null", "-A", UA, "-w", "%{redirect_url}", `${BASE}/t/se/${se.token}/${quoteLink}`]).toString();
    ok("the tracked link lands on the real page", loc === se.links[quoteLink].url, loc);

    // Quote → order → paid, created AFTER the email, from the same address.
    quoteId = (await pool.query(`INSERT INTO print_quotes (organization_id, token, status, customer_name, customer_email, subtotal_cents, total_cents) VALUES ($1,$2,'approved','ZZ Probe',$3,43478,50000) RETURNING id`,
      [org.id, crypto.randomBytes(24).toString("hex"), SINK])).rows[0].id;
    orderId = (await pool.query(`INSERT INTO print_orders (organization_id, customer_name, customer_email, title, status, total_cents, paid_cents) VALUES ($1,'ZZ Probe',$2,'ZZ probe order','paid',50000,50000) RETURNING id`, [org.id, SINK])).rows[0].id;
    await pool.query(`INSERT INTO print_order_events (order_id, event_type) VALUES ($1,'paid')`, [orderId]);

    await page.goto(`${BASE}/admin/print-sales`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector('[data-testid="input-search"]', { timeout: 30000 });
    await page.type('[data-testid="input-search"]', "ZZ PROBE");
    await page.waitForSelector('[data-testid="outreach-chip"]', { timeout: 15000 }).catch(() => {});
    const chip = await page.$eval('[data-testid="outreach-chip"]', (el: any) => el.innerText).catch(() => "");
    ok("the prospect row reads Paid", /Paid/.test(chip), chip);
    ok("the outreach strip shows", !!(await page.$('[data-testid="outreach-strip"]')));
    // Click the NAME: the middle of the row is the email/status cell, which
    // deliberately stops a click from opening the lead.
    await page.click(`[data-testid="row-prospect-${prospectId}"] td:nth-child(3)`);
    await page.waitForSelector('[data-testid="journey-events"]', { timeout: 15000 }).catch(() => {});
    const j = await page.$eval('[data-testid="email-journeys"]', (el: any) => el.innerText).catch(() => "");
    for (const step of ["Sent", "Delivered", "Opened", "Clicked", "Quote submitted", "Order confirmed", "Paid"]) ok(`journey shows ${step}`, new RegExp(`\\b${step}\\b`).test(j), "");
    ok("journey names the link clicked", /get an instant quote/.test(j));
    ok("journey shows times", /\d{1,2}:\d{2}(am|pm)/.test(j));
    await page.screenshot({ path: join(outDir, `desktop-journey.png`) });
    await page.close();
  }
} catch (e: any) {
  fails.push(`threw: ${e?.message}`); console.log("  ✗ threw", e);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (orderId) { await pool.query(`DELETE FROM print_order_events WHERE order_id=$1`, [orderId]); await pool.query(`DELETE FROM print_orders WHERE id=$1`, [orderId]); }
  if (quoteId) await pool.query(`DELETE FROM print_quotes WHERE id=$1`, [quoteId]);
  if (prospectId) {
    await pool.query(`DELETE FROM sales_activities WHERE prospect_id=$1`, [prospectId]);
    await pool.query(`DELETE FROM sales_prospects WHERE id=$1`, [prospectId]);
  }
  if (userId) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [userId]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(async () => {
      await pool.query(`UPDATE users SET active=false WHERE id=$1`, [userId]);
    });
  }
  await pool.end();
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) process.exit(1);
}

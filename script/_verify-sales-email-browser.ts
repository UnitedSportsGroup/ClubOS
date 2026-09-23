// The Sales tab's "Send email" button, driven in a real browser on production.
//
//   npx tsx --env-file=.env script/_verify-sales-email-browser.ts
//
// Creates a throwaway super-admin and a throwaway prospect, opens the dialog at
// desktop and phone widths, checks the draft is personalised, sends ONE real
// email to Resend's test sink (never a real lead), then checks the email was
// logged, the lead moved New → Contacted, the button stepped aside, and a
// second send inside a minute is refused. Everything it made is deleted in the
// `finally`, even if an assertion throws.
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import puppeteer from "puppeteer-core";
import { execFileSync } from "child_process";
import { mkdirSync } from "fs";
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

    // Make it bespoke, then send for real — to Resend's sink.
    await page.focus('[data-testid="email-body"]');
    await page.keyboard.press("End");
    await page.keyboard.type("\n\nPS — probe edit.");
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
    await page.close();
  }
} catch (e: any) {
  fails.push(`threw: ${e?.message}`); console.log("  ✗ threw", e);
} finally {
  if (browser) await browser.close().catch(() => {});
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

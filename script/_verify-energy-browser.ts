// The Energy tab, in a real browser on production, as an ORDINARY admin of the
// United Sports Centre and United Sports Group workspaces (not a super admin —
// a super admin sees pages staff can't). Clicks the sidebar link in both.
//   npx tsx --env-file=.env script/_verify-energy-browser.ts
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import puppeteer from "puppeteer-core";
import { execFileSync } from "child_process";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = "https://app.usg.co.nz";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0; const fails: string[] = [];
const ok = (l: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fails.push(l); console.log(`  ✗ ${l} ${d}`); } };
let userId: number | null = null; let browser: any = null;
try {
  const orgs = (await pool.query(`SELECT id, slug FROM organizations WHERE id IN (4,7) ORDER BY id`)).rows;
  const email = `energyprobe-${crypto.randomBytes(5).toString("hex")}@example.com`;
  const password = crypto.randomBytes(16).toString("base64url");
  userId = (await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Energy','Probe',$2,'coach',true) RETURNING id`, [email, await bcrypt.hash(password, 10)])).rows[0].id;
  for (const o of orgs) await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`, [userId, o.id]);
  const headers = execFileSync("curl", ["-s", "-D", "-", "-o", "/dev/null", "--max-time", "30", "-X", "POST", "-H", "Content-Type: application/json", "-d", JSON.stringify({ email, password }), `${BASE}/api/auth/login`]).toString();
  const [cname, cvalue] = (headers.match(/^set-cookie:\s*(.+)$/im)?.[1] ?? "").split(";")[0].split("=");
  ok("logged in as an ordinary admin", !!cname);
  const outDir = join(process.cwd(), "..", "..", "..", "..", "outputs", "ui-preflight", "clubos-energy");
  mkdirSync(outDir, { recursive: true });
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  for (const o of orgs) {
    for (const [label, w, h] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
      const page = await browser.newPage();
      const errors: string[] = []; page.on("pageerror", (e: any) => errors.push(String(e)));
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
      await page.setCookie({ name: cname, value: cvalue, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
      await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 60000 });
      await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), o.slug);
      await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 2000));
      const tag = `${o.slug} ${label}`;
      if (label === "desktop") {
        const linked = await page.evaluate(() => !!document.querySelector('a[href="/admin/energy"]'));
        ok(`${tag}: sidebar has an Energy link`, linked);
        if (linked) await page.evaluate(() => (document.querySelector('a[href="/admin/energy"]') as HTMLElement).click());
      } else {
        await page.goto(`${BASE}/admin/energy`, { waitUntil: "networkidle2", timeout: 60000 });
      }
      await page.waitForSelector('[data-testid="energy-sites"]', { timeout: 30000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));
      const m = await page.evaluate(() => ({
        url: location.pathname, text: document.body.innerText,
        sites: document.querySelectorAll('[data-testid^="energy-site-"]').length,
        bars: document.querySelectorAll('[data-testid="energy-chart"] .recharts-bar-rectangle').length,
        doc: document.documentElement.scrollWidth, vw: innerWidth,
      }));
      ok(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
      ok(`${tag}: lands on /admin/energy`, m.url === "/admin/energy", m.url);
      ok(`${tag}: four sites`, m.sites === 4, String(m.sites));
      ok(`${tag}: chart draws`, m.bars > 10, String(m.bars));
      ok(`${tag}: owing matches Meridian ($4,136.06)`, /\$4,136\.06/.test(m.text));
      ok(`${tag}: says who pays`, /the club's own bank account/.test(m.text) && /United Sports Centre's own power and water are not here/.test(m.text));
      ok(`${tag}: shows the bounced direct debits`, /bounced/.test(m.text));
      ok(`${tag}: no sideways scroll`, m.doc <= m.vw + 1, `${m.doc} vs ${m.vw}`);
      await page.screenshot({ path: join(outDir, `${o.slug}-${label}.png`), fullPage: label === "desktop" });
      await page.close();
    }
  }
} catch (e: any) { fails.push(`threw ${e?.message}`); console.log(e); }
finally {
  if (browser) await browser.close().catch(() => {});
  if (userId) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [userId]); await pool.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [userId])); }
  await pool.end(); console.log(`\n${pass} passed, ${fails.length} failed`); if (fails.length) process.exit(1);
}

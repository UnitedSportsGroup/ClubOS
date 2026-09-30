// Quantity pricing in the Materials tab, on production, as an ORDINARY United
// Prints admin. Reads a real material's steps, then edits ONLY "test tee"
// (id 8, not offered on the website — no customer price can move) and puts it back.
//   npx tsx --env-file=.env script/_verify-qty-pricing-browser.ts
import pg from "pg"; import bcrypt from "bcryptjs"; import crypto from "crypto";
import puppeteer from "puppeteer-core"; import { execFileSync } from "child_process";
const BASE = "https://app.usg.co.nz", CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0; const fails: string[] = []; const ok = (l: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fails.push(l); console.log(`  ✗ ${l} ${d}`); } };
let userId: number | null = null, browser: any = null;
const TEST_ID = 8;
const before = (await pool.query(`SELECT qty_tiers_json, quote_on_website FROM print_materials WHERE id=$1`, [TEST_ID])).rows[0];
try {
  ok("test tee is NOT on the website", before.quote_on_website === false);
  const email = `qtyprobe-${crypto.randomBytes(5).toString("hex")}@example.com`, password = crypto.randomBytes(16).toString("base64url");
  userId = (await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Qty','Probe',$2,'coach',true) RETURNING id`, [email, await bcrypt.hash(password, 10)])).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,8,'admin',NULL)`, [userId]);
  const h = execFileSync("curl", ["-s", "-D", "-", "-o", "/dev/null", "-X", "POST", "-H", "Content-Type: application/json", "-d", JSON.stringify({ email, password }), `${BASE}/api/auth/login`]).toString();
  const [cn, cv] = (h.match(/^set-cookie:\s*(.+)$/im)?.[1] ?? "").split(";")[0].split("=");
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
  const p = await browser.newPage(); const errs: string[] = []; p.on("pageerror", (e: any) => errs.push(String(e)));
  await p.setViewport({ width: 1440, height: 900 });
  await p.setCookie({ name: cn, value: cv, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
  await p.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
  await p.evaluate(() => localStorage.setItem("clubos_workspace", "united-prints"));
  await p.goto(`${BASE}/admin/print-materials`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1500));
  // Open PVC Banner (read only) — its existing steps must show.
  const opened = await p.evaluate(() => { const el = Array.from(document.querySelectorAll("*")).find((e) => (e as HTMLElement).innerText?.trim() === "PVC Banner") as HTMLElement | undefined; el?.click(); return !!el; });
  await new Promise((r) => setTimeout(r, 1000));
  const rows = await p.$$('[data-testid^="row-qty-step-"]');
  ok("PVC Banner dialog opens", opened);
  ok("its 4 existing quantity steps are shown", rows.length === 4, String(rows.length));
  const txt = await p.$eval('[data-testid="qty-pricing"]', (e: any) => e.innerText).catch(() => "");
  ok("banner offers % off only (priced by size)", !/\$ each/.test(txt) && /priced by size/.test(txt), txt.slice(0, 120));
  ok("shows the ranges (e.g. 3–4)", /Covers 3–4/.test(txt), txt.slice(0, 200));
  await p.keyboard.press("Escape"); await new Promise((r) => setTimeout(r, 500));
  // The live preview on the real T-shirt (read only): "At 20: $29.25 → $27.79 each".
  for (const [label, w, h] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    await p.goto(`${BASE}/admin/print-materials`, { waitUntil: "networkidle2" }); await new Promise((r) => setTimeout(r, 1200));
    await p.evaluate(() => { const el = Array.from(document.querySelectorAll("*")).find((e) => (e as HTMLElement).innerText?.trim() === "Printed T-shirt (left chest logo)") as HTMLElement | undefined; el?.click(); });
    await p.waitForSelector('[data-testid="qty-preview-row"]', { timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    const prev = await p.$$eval('[data-testid="qty-preview-row"]', (els: any[]) => els.map((e) => e.innerText));
    ok(`${label}: a preview under every step`, prev.length >= 4, String(prev.length));
    ok(`${label}: 20 tees read $29.25 → $27.79 each`, prev.some((t: string) => /At 20:.*\$29\.25.*\$27\.79 each/.test(t)), prev[0]);
    ok(`${label}: over-cap steps say manual quote`, prev.some((t: string) => /over \$2,500/.test(t)));
    const wrap = await p.evaluate(() => { const s = Array.from(document.querySelectorAll("span")).find((e) => e.textContent === "% off") as HTMLElement | undefined; return s ? s.getBoundingClientRect().height : 0; });
    ok(`${label}: "% off" sits on one line`, wrap > 0 && wrap < 26, String(wrap));
    // The whole step row — every input, label and the remove button — must sit inside the dialog.
    const spill = await p.evaluate(() => {
      const d = document.querySelector('[data-testid="qty-pricing"]') as HTMLElement | null;
      if (!d) return "no quantity pricing card";
      const edge = d.getBoundingClientRect().right;
      const bad: string[] = [];
      document.querySelectorAll('[data-testid^="row-qty-step-"] *').forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width > 0 && r.right > edge + 0.5) bad.push(((el as HTMLElement).dataset.testid || el.tagName) + "@" + Math.round(r.right - edge));
      });
      return bad.slice(0, 5).join(", ");
    });
    ok(`${label}: every step row fits inside the Quantity pricing card`, spill === "", spill);
    await p.evaluate(() => document.querySelector('[data-testid="qty-pricing"]')?.scrollIntoView({ block: "start" }));
    await new Promise((r) => setTimeout(r, 400));
    await p.screenshot({ path: `/private/tmp/claude-501/qty-preview-${label}.png` });
    await p.keyboard.press("Escape"); await new Promise((r) => setTimeout(r, 400));
  }
  // Save a $ each step on test tee through the real API the tab uses.
  const res = await p.evaluate(async (id: number) => {
    const r = await fetch(`/api/admin/print-materials/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", "X-Workspace-Slug": "united-prints" },
      body: JSON.stringify({ qtyTiersJson: [{ minQty: 10, unitPriceCents: 2900 }, { minQty: 1, unitPriceCents: 3500 }] }) });
    return { s: r.status, j: await r.json() };
  }, TEST_ID);
  ok("saving $ each steps on a shirt works", res.s === 200 && res.j.qtyTiersJson?.[0]?.minQty === 1, JSON.stringify(res).slice(0, 200));
  const bad = await p.evaluate(async () => {
    const r = await fetch(`/api/admin/print-materials/1`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", "X-Workspace-Slug": "united-prints" },
      body: JSON.stringify({ qtyTiersJson: [{ minQty: 5, unitPriceCents: 100 }] }) });
    return { s: r.status, j: await r.json() };
  });
  ok("a banner refuses a $ each step (server-side)", bad.s === 400 && /priced by size/.test(bad.j.message), JSON.stringify(bad));
  ok("no page errors", errs.length === 0, errs.join(" | "));
} catch (e: any) { fails.push(`threw ${e?.message}`); console.log(e); }
finally {
  await pool.query(`UPDATE print_materials SET qty_tiers_json=$2 WHERE id=$1`, [TEST_ID, JSON.stringify(before.qty_tiers_json ?? [])]);
  const after = (await pool.query(`SELECT qty_tiers_json FROM print_materials WHERE id=1`)).rows[0];
  console.log("  (PVC Banner steps untouched:", JSON.stringify(after.qty_tiers_json), ")");
  if (browser) await browser.close().catch(() => {});
  if (userId) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [userId]); await pool.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [userId])); }
  await pool.end(); console.log(`\n${pass} passed, ${fails.length} failed`); if (fails.length) process.exit(1);
}

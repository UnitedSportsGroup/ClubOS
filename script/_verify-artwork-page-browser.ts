// The customer's artwork page + Dima's Quotes tab, on PRODUCTION, end to end:
// a probe quote (written straight to the DB — no form, no email), the customer
// uploads an image and a 60MB file on shop.unitedprints.co.nz/print/artwork/<token>,
// then an ordinary UP admin sees the image PREVIEW and downloads the big file
// through the real route, byte for byte. Everything is deleted afterwards.
import crypto from "crypto"; import pg from "pg"; import bcrypt from "bcryptjs"; import puppeteer from "puppeteer-core";
import { execFileSync } from "child_process"; import { writeFileSync, readFileSync } from "fs";
import { removeArt } from "../server/print-artwork-storage";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", BASE = "https://app.usg.co.nz";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0; const fails: string[] = []; const ok = (l: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fails.push(l); console.log(`  ✗ ${l} ${d}`); } };
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const token = crypto.randomBytes(24).toString("hex"); let quoteId: number | null = null, userId: number | null = null;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
try {
  quoteId = (await pool.query(`INSERT INTO print_quotes (organization_id, token, status, customer_name, customer_email, subtotal_cents, gst_cents, total_cents, indicative, note)
    VALUES (8,$1,'new','Probe Artwork','artpage-probe@example.com',0,0,0,true,'VERIFY PROBE') RETURNING id`, [token])).rows[0].id;
  await pool.query(`INSERT INTO print_quote_items (quote_id, design_name, material, size_label, quantity, line_ex_gst_cents, design_file_name) VALUES ($1,'Walk banner','Fence Mesh Banner','3600 × 700 mm',1,15095,'ANCOP Walk Banner.png')`, [quoteId]);
  // A real PNG to preview, and a 60MB file that must go in 2 parts.
  const p = await browser.newPage(); const errs: string[] = []; p.on("pageerror", (e: any) => errs.push(String(e)));
  await p.setViewport({ width: 600, height: 400 });
  await p.setContent(`<div style="width:600px;height:400px;background:#043bcb;color:#fff;font:bold 64px sans-serif;display:flex;align-items:center;justify-content:center">ANCOP WALK</div>`);
  writeFileSync("/tmp/ANCOP-Walk-Banner.png", await p.screenshot());
  execFileSync("sh", ["-c", "head -c 62914560 /dev/urandom > /tmp/Hi-Res-Banner.tif"]);
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await p.goto(`https://shop.unitedprints.co.nz/print/artwork/${token}`, { waitUntil: "networkidle2" });
  await p.waitForSelector('[data-testid^="artwork-input-"]', { timeout: 20000 });
  ok("the customer's page opens with their quote line", /Walk banner/.test(await p.evaluate(() => document.body.innerText)));
  const input = await p.$('[data-testid^="artwork-input-"]');
  await (input as any).uploadFile("/tmp/ANCOP-Walk-Banner.png", "/tmp/Hi-Res-Banner.tif");
  await p.waitForFunction(() => { const j = Array.from(document.querySelectorAll('[data-testid="artwork-job"]')); return j.length >= 2 && j.every((x) => x.getAttribute("data-state") !== "sending"); }, { timeout: 600000 });
  const txt = await p.evaluate(() => document.body.innerText);
  ok("both files show ✓ Received", (txt.match(/✓ Received/g) ?? []).length === 2, txt.slice(0, 400));
  ok("no horizontal scroll at 390px", (await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await p.screenshot({ path: "/private/tmp/claude-501/artwork-page-mobile.png" });
  const files = (await pool.query(`SELECT id, filename, size_bytes, parts, status FROM print_quote_files WHERE quote_id=$1 ORDER BY id`, [quoteId])).rows;
  const big = files.find((f) => f.filename === "Hi-Res-Banner.tif"), png = files.find((f) => f.filename === "ANCOP-Walk-Banner.png");
  ok("60MB file stored in 2 parts, ready", big?.parts === 2 && big?.status === "ready", JSON.stringify(files));
  // Dima's side.
  const email = `artprobe-${crypto.randomBytes(5).toString("hex")}@example.com`, password = crypto.randomBytes(16).toString("base64url");
  userId = (await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Art','Probe',$2,'coach',true) RETURNING id`, [email, await bcrypt.hash(password, 10)])).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,8,'admin',NULL)`, [userId]);
  const h = execFileSync("curl", ["-s", "-D", "-", "-o", "/dev/null", "-X", "POST", "-H", "Content-Type: application/json", "-d", JSON.stringify({ email, password }), `${BASE}/api/auth/login`]).toString();
  const cookie = h.match(/^set-cookie:\s*([^;]+)/im)?.[1] ?? "";
  execFileSync("curl", ["-s", "-L", "-o", "/tmp/_dl.tif", "-H", `Cookie: ${cookie}`, "-H", "X-Workspace-Slug: united-prints", `${BASE}/api/admin/print-quotes/${quoteId}/files/${big?.id}?download=1`]);
  ok("Dima's Download link returns the 60MB file byte for byte", sha(readFileSync("/tmp/_dl.tif")) === sha(readFileSync("/tmp/Hi-Res-Banner.tif")));
  const ask = execFileSync("curl", ["-s", "-X", "POST", "-H", `Cookie: ${cookie}`, "-H", "X-Workspace-Slug: united-prints", "-H", "Content-Type: application/json", "-d", '{"send":false}', `${BASE}/api/admin/print-quotes/${quoteId}/request-artwork`]).toString();
  ok("Copy upload link gives this customer's page", JSON.parse(ask).url === `https://shop.unitedprints.co.nz/print/artwork/${token}`, ask);
  const [cn, cv] = cookie.split("=");
  const a = await browser.newPage(); a.on("pageerror", (e: any) => errs.push(String(e)));
  await a.setViewport({ width: 1440, height: 1000 });
  await a.setCookie({ name: cn, value: cv, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
  await a.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
  await a.evaluate(() => localStorage.setItem("clubos_workspace", "united-prints"));
  await a.goto(`${BASE}/admin/print-quotes`, { waitUntil: "networkidle2" });
  await a.waitForSelector(`[data-testid="quote-file-preview-${png?.id}"]`, { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  // The preview is lazy-loaded — bring it on screen, then wait for it to decode.
  await a.evaluate((id: number) => document.querySelector(`[data-testid="quote-file-preview-${id}"]`)?.scrollIntoView({ block: "center" }), png?.id);
  await a.waitForFunction((id: number) => ((document.querySelector(`[data-testid="quote-file-preview-${id}"]`) as HTMLImageElement | null)?.naturalWidth ?? 0) > 0, { timeout: 15000 }, png?.id).catch(() => {});
  const w = await a.$eval(`[data-testid="quote-file-preview-${png?.id}"]`, (e: any) => e.naturalWidth).catch(() => 0);
  ok("the image PREVIEW renders in the Quotes tab", w > 0, String(w));
  ok("Ask for artwork + Copy upload link buttons on the card", !!(await a.$(`[data-testid="button-ask-artwork-${quoteId}"]`)) && !!(await a.$(`[data-testid="button-copy-artwork-link-${quoteId}"]`)));
  await a.evaluate((id: number) => document.querySelector(`[data-testid="card-quote-${id}"]`)?.scrollIntoView({ block: "start" }), quoteId);
  await new Promise((r) => setTimeout(r, 600));
  await a.screenshot({ path: "/private/tmp/claude-501/quotes-preview-desktop.png" });
  ok("no page errors", errs.length === 0, errs.join(" | "));
} catch (e: any) { fails.push(`threw ${e?.message}`); console.log(e); }
finally {
  if (quoteId) {
    for (const r of (await pool.query(`SELECT storage_key, parts FROM print_quote_files WHERE quote_id=$1`, [quoteId])).rows) await removeArt(r.storage_key, r.parts).catch(() => {});
    await pool.query(`DELETE FROM print_quotes WHERE id=$1 AND note='VERIFY PROBE'`, [quoteId]);
  }
  if (userId) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [userId]); await pool.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(() => {}); }
  await browser.close(); await pool.end(); console.log(`\n${pass} passed, ${fails.length} failed`); if (fails.length) process.exit(1);
}

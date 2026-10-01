// End to end on the LIVE unitedprints.co.nz Instant Quote: fill it in, attach artwork,
// submit, and prove the file reached ClubOS. The hidden honeypot is filled so the form
// guard HOLDS the quote — saved, never emailed. Everything is deleted afterwards.
import crypto from "crypto"; import pg from "pg"; import puppeteer from "puppeteer-core"; import { writeFileSync } from "fs";
import { driveStorage } from "../server/drive-storage";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const EMAIL = `upartprobe-${Date.now()}@example.com`; let pass = 0; const fails: string[] = [];
const ok = (l: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fails.push(l); console.log(`  ✗ ${l} ${d}`); } };
// A 120MB file — over storage's 50MB per-object cap, so it MUST go up in parts.
const file = "/tmp/Big-Banner-Artwork.pdf"; const BIG = (await import("fs")).readFileSync(file);
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
try {
  const p = await browser.newPage(); const errs: string[] = []; p.on("pageerror", (e: any) => errs.push(String(e)));
  await p.setViewport({ width: 1280, height: 900 });
  await p.goto("https://unitedprints.co.nz/instant-quote", { waitUntil: "networkidle2" });
  await p.waitForSelector('input[placeholder="Width"]', { timeout: 20000 });
  const type = async (sel: string, v: string) => { await p.click(sel, { clickCount: 3 }); await p.type(sel, v); };
  await type('input[placeholder="Jack Goal"]', "Probe Verify");
  await type('input[type="email"]', EMAIL);
  await type('input[placeholder="Width"]', "1000"); await type('input[placeholder="Height"]', "1000");
  const input = await p.$('input[type="file"]'); await (input as any).uploadFile(file);
  await new Promise((r) => setTimeout(r, 300));
  ok("file name shows on the form", (await p.content()).includes("Big-Banner-Artwork.pdf"));
  // Fill the honeypot the way a bot would (React-controlled input → native setter + event).
  const hp = await p.evaluate(() => {
    const el = document.querySelector('input[name="website"]') as HTMLInputElement | null; if (!el) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(el, "probe"); el.dispatchEvent(new Event("input", { bubbles: true })); return true;
  });
  ok("honeypot filled (quote will be HELD, nobody emailed)", hp);
  await p.waitForFunction(() => { const b = Array.from(document.querySelectorAll("button")).find((x) => /Request This Quote/.test(x.textContent || "")) as HTMLButtonElement | undefined; return b && !b.disabled; }, { timeout: 20000 });
  await p.evaluate(() => (Array.from(document.querySelectorAll("button")).find((x) => /Request This Quote/.test(x.textContent || "")) as HTMLButtonElement).click());
  await p.waitForFunction(() => /Quote request received/.test(document.body.innerText), { timeout: 600000 });
  const sent = await p.$eval('[data-testid="artwork-sent"]', (e: any) => e.innerText).catch(() => "");
  ok("the customer is told their artwork came through", /artwork came through \(1 file\)/.test(sent), sent);
  const failNote = await p.$eval('[data-testid="artwork-failed"]', (e: any) => e.innerText).catch(() => "");
  if (failNote) console.log("  failure note:", failNote);
  const rows = (await pool.query(`SELECT f.id, f.quote_id, f.filename, f.size_bytes, f.parts, f.status FROM print_quote_files f JOIN print_quotes q ON q.id=f.quote_id WHERE q.customer_email=$1`, [EMAIL])).rows;
  ok("the 120MB file is in ClubOS, in 3 parts, confirmed", rows.length === 1 && rows[0].filename === "Big-Banner-Artwork.pdf" && Number(rows[0].size_bytes) === BIG.length && rows[0].parts === 3 && rows[0].status === "ready", JSON.stringify(rows));
  // Download it the way Dima does (signed in) and compare every byte.
  const { streamArtParts } = await import("../server/print-artwork-storage");
  const chunks: Buffer[] = [];
  const fake: any = { setHeader() {}, write(c: any) { chunks.push(Buffer.from(c)); return true; }, end() {}, on() { return fake; }, once() { return fake; }, emit() { return true; } };
  const { Writable } = await import("stream");
  const sink: any = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } }); sink.setHeader = () => {}; sink.end = () => {};
  const key = (await pool.query(`SELECT storage_key FROM print_quote_files WHERE id=$1`, [rows[0]?.id])).rows[0]?.storage_key;
  await streamArtParts(sink, { storageKey: key, parts: 3, sizeBytes: BIG.length, filename: "x", contentType: "application/pdf" }, true);
  const back = Buffer.concat(chunks);
  ok("downloaded file is byte-for-byte the original (sha256)", back.length === BIG.length && sha(back) === sha(BIG), `${back.length} bytes`);
  console.log("  quote token for the artwork-page test:", (await pool.query(`SELECT token FROM print_quotes WHERE customer_email=$1`, [EMAIL])).rows[0]?.token);
  await p.screenshot({ path: "/private/tmp/claude-501/up-artwork-done.png" });
  ok("no page errors", errs.length === 0, errs.join(" | "));
} catch (e: any) { fails.push(`threw ${e?.message}`); console.log(String(e).slice(0, 120)); const pg2 = (await browser.pages())[1]; if (pg2) { await pg2.screenshot({ path: "/private/tmp/claude-501/up-artwork-fail.png", fullPage: true }); console.log((await pg2.evaluate(() => document.body.innerText)).slice(0, 1500)); } }
finally {
  const { removeArt } = await import("../server/print-artwork-storage");
  for (const r of (await pool.query(`SELECT f.storage_key, f.parts, f.chunked FROM print_quote_files f JOIN print_quotes q ON q.id=f.quote_id WHERE q.customer_email=$1`, [EMAIL])).rows)
    await (r.chunked ? removeArt(r.storage_key, r.parts) : driveStorage().remove(r.storage_key)).catch(() => {});
  await pool.query(`DELETE FROM print_quotes WHERE customer_email=$1`, [EMAIL]);
  await browser.close(); await pool.end(); console.log(`\n${pass} passed, ${fails.length} failed`); if (fails.length) process.exit(1);
}

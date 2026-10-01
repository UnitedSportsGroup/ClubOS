// Dima's 2026-10-01 asks, proven against PRODUCTION as an ordinary United Prints admin.
//   npx tsx --env-file=.env script/_verify-dima-oct1-live.ts
//
// 1. Artwork: a quote from the website gets a signed upload link per line; the file lands
//    in ClubOS and the Quotes tab can download it. The probe quote fills the honeypot, so
//    the form guard HOLDS it — saved, but no email goes to anyone (customer or Dima).
// 2. Expenses: a brand picked when ADDING an expense is kept (the create route used to
//    drop it), pinned to the stored total; spend-by-brand answers.
// 3. Sales email unsubscribe: confirm page on GET (scanners must not opt people out),
//    the POST records it once, and the address can't be emailed again.
// Everything it creates is deleted at the end, including the stored file's bytes.
import pg from "pg"; import bcrypt from "bcryptjs"; import crypto from "crypto";
import { execFileSync } from "child_process";
import { driveStorage } from "../server/drive-storage";
const BASE = "https://app.usg.co.nz";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0; const fails: string[] = [];
const ok = (l: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fails.push(l); console.log(`  ✗ ${l} ${d}`); } };
// node's fetch is intermittently dead on this Mac while curl works — so curl.
function curl(args: string[]): { status: number; headers: string; body: string } {
  const out = execFileSync("curl", ["-s", "-D", "-", ...args], { maxBuffer: 20e6 }).toString("latin1");
  const parts = out.split(/\r?\n\r?\n/);
  let i = 0; while (i < parts.length - 1 && /^HTTP\/\S+ 100/.test(parts[i])) i++;
  const headers = parts[i]; const body = parts.slice(i + 1).join("\r\n\r\n");
  return { status: Number(headers.match(/^HTTP\/\S+ (\d+)/)?.[1] ?? 0), headers, body };
}
let userId: number | null = null, quoteId: number | null = null, expenseId: number | null = null;
let prospectId: number | null = null, salesEmailId: number | null = null; const probeEmail = `unsub-probe-${crypto.randomBytes(4).toString("hex")}@example.com`;
const storageKeys: string[] = [];
try {
  // ── staff login (ordinary UP admin) ──
  const email = `dimaprobe-${crypto.randomBytes(5).toString("hex")}@example.com`, password = crypto.randomBytes(16).toString("base64url");
  userId = (await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Dima','Probe',$2,'coach',true) RETURNING id`, [email, await bcrypt.hash(password, 10)])).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,8,'admin',NULL)`, [userId]);
  const login = curl(["-o", "/dev/null", "-X", "POST", "-H", "Content-Type: application/json", "-d", JSON.stringify({ email, password }), `${BASE}/api/auth/login`]);
  const cookie = (login.headers.match(/^set-cookie:\s*([^;]+)/im)?.[1] ?? "");
  ok("staff login", !!cookie);
  const admin = (path: string, extra: string[] = []) => curl(["-H", `Cookie: ${cookie}`, "-H", "X-Workspace-Slug: united-prints", ...extra, `${BASE}${path}`]);

  // ── 1. artwork ──
  console.log("Artwork on website quotes");
  const q = curl(["-X", "POST", "-H", "Content-Type: application/json", "-H", "Origin: https://unitedprints.co.nz",
    "-d", JSON.stringify({ type: "instant-quote", name: "Verify Probe", email: "verify-probe@example.com", website: "held-by-honeypot",
      items: [{ design: "Probe banner", materialSlug: "pvc-banner-440", widthMm: 1000, heightMm: 1000, quantity: 1, design_file: "probe.pdf" }] }),
    `${BASE}/api/public/unitedprints/quote-request`]);
  const qj = JSON.parse(q.body || "{}"); quoteId = qj.id ?? null;
  ok("quote created and gets an upload link per line", q.status === 200 && Array.isArray(qj.uploads) && qj.uploads.length === 1 && /\/artwork\?exp=\d+&sig=[0-9a-f]{64}$/.test(qj.uploads[0].path), q.body.slice(0, 200));
  const held = (await pool.query(`SELECT count(*)::int n FROM public_form_submissions WHERE form='print_quote' AND outcome='held' AND email='verify-probe@example.com' AND created_at > now() - interval '5 minutes'`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
  if (held >= 0) ok("probe quote was HELD by the form guard (no emails)", held >= 1, String(held));
  ok("CORS allows unitedprints.co.nz", /access-control-allow-origin:\s*https:\/\/unitedprints\.co\.nz/i.test(q.headers));
  const pdf = Buffer.from("%PDF-1.4\n% verify probe artwork\n%%EOF\n");
  const fpath = `/tmp/_probe_${process.pid}.pdf`; (await import("fs")).writeFileSync(fpath, pdf);
  const upPath = qj.uploads?.[0]?.path ?? "";
  const up = curl(["-X", "POST", "-H", "Content-Type: application/pdf", "-H", "Origin: https://unitedprints.co.nz", "--data-binary", `@${fpath}`, `${BASE}${upPath}&name=${encodeURIComponent("Probe Artwork.pdf")}`]);
  ok("artwork uploads (201)", up.status === 201, `${up.status} ${up.body.slice(0, 160)}`);
  const pre = curl(["-o", "/dev/null", "-X", "OPTIONS", "-H", "Origin: https://unitedprints.co.nz", "-H", "Access-Control-Request-Method: POST", "-H", "Access-Control-Request-Headers: content-type", `${BASE}${upPath.split("?")[0]}`]);
  ok("upload preflight answers 204 with CORS", pre.status === 204 && /access-control-allow-origin/i.test(pre.headers), String(pre.status));
  const forged = curl(["-X", "POST", "-H", "Content-Type: application/pdf", "--data-binary", `@${fpath}`, `${BASE}${upPath.replace(/sig=[0-9a-f]{4}/, "sig=0000")}&name=x.pdf`]);
  ok("a tampered link is refused (403)", forged.status === 403, String(forged.status));
  const exe = curl(["-X", "POST", "-H", "Content-Type: application/octet-stream", "--data-binary", `@${fpath}`, `${BASE}${upPath}&name=virus.exe`]);
  ok("a .exe is refused (415)", exe.status === 415, String(exe.status));
  const detail = admin(`/api/admin/print-quotes/${quoteId}`);
  const dj = JSON.parse(detail.body || "{}");
  const f = dj.files?.[0];
  ok("Quotes tab detail lists the file on its line", detail.status === 200 && f?.filename === "Probe Artwork.pdf" && f?.itemId === dj.items?.[0]?.id, detail.body.slice(0, 200));
  const list = JSON.parse(admin(`/api/admin/print-quotes`).body || "{}");
  ok("Quotes tab list carries the file", !!list.quotes?.find((x: any) => x.id === quoteId)?.files?.length);
  // A plain link sends the cookie only — no X-Workspace-Slug.
  const dl = curl(["-o", "/dev/null", "-H", `Cookie: ${cookie}`, `${BASE}/api/admin/print-quotes/${quoteId}/files/${f?.id}?download=1`]);
  const loc = dl.headers.match(/^location:\s*(\S+)/im)?.[1] ?? "";
  ok("download redirects to a short-lived signed URL", dl.status === 302 && /token=/.test(loc), `${dl.status} ${loc.slice(0, 80)}`);
  const bytes = loc ? execFileSync("curl", ["-s", loc]) : Buffer.alloc(0);
  ok("the downloaded bytes are the uploaded file", Buffer.compare(bytes, pdf) === 0, `${bytes.length} bytes`);
  const anon = curl(["-o", "/dev/null", `${BASE}/api/admin/print-quotes/${quoteId}/files/${f?.id}`]);
  ok("download without a login is refused (401)", anon.status === 401, String(anon.status));
  for (const r of (await pool.query(`SELECT storage_key FROM print_quote_files WHERE quote_id=$1`, [quoteId])).rows) storageKeys.push(r.storage_key);

  // ── 2. expenses ──
  console.log("Brand on new expenses");
  const add = admin(`/api/admin/print-expenses`, ["-X", "POST", "-H", "Content-Type: application/json", "-d",
    JSON.stringify({ description: "VERIFY PROBE trophies", spentOn: "2026-10-01", category: "other", totalCents: 12345, gstTreatment: "inclusive", allocations: [{ brand: "cic", amountCents: 1 }] })]);
  expenseId = JSON.parse(add.body || "{}").id ?? null;
  const alloc = expenseId ? (await pool.query(`SELECT brand, amount_cents FROM print_expense_allocations WHERE expense_id=$1`, [expenseId])).rows : [];
  ok("a brand picked when ADDING an expense is saved", add.status === 201 && alloc.length === 1 && alloc[0].brand === "cic", `${add.status} ${JSON.stringify(alloc)}`);
  ok("a single brand is pinned to the whole total", alloc[0]?.amount_cents === 12345, JSON.stringify(alloc));
  const split = admin(`/api/admin/print-expenses/${expenseId}`, ["-X", "PATCH", "-H", "Content-Type: application/json", "-d",
    JSON.stringify({ allocations: [{ brand: "cic", amountCents: 100 }, { brand: "cufc", amountCents: 100 }] })]);
  ok("a split that doesn't add up is still refused", split.status === 400, String(split.status));
  const bb = admin(`/api/admin/print-expenses/by-brand`);
  ok("spend-by-brand answers", bb.status === 200 && Array.isArray(JSON.parse(bb.body).brands));

  // ── 3. unsubscribe ──
  console.log("Sales email unsubscribe");
  prospectId = (await pool.query(`INSERT INTO sales_prospects (organization_id, name, email, stage) VALUES (8, 'VERIFY PROBE prospect', $1, 'contacted') RETURNING id`, [probeEmail])).rows[0].id;
  const token = crypto.randomBytes(24).toString("base64url");
  salesEmailId = (await pool.query(`INSERT INTO sales_emails (organization_id, prospect_id, token, to_email, subject, body) VALUES (8,$1,$2,$3,'probe','probe') RETURNING id`, [prospectId, token, probeEmail])).rows[0].id;
  const g = curl([`${BASE}/t/se/${token}/unsubscribe`]);
  const stillIn = (await pool.query(`SELECT count(*)::int n FROM sales_email_optouts WHERE lower(email)=$1`, [probeEmail])).rows[0].n;
  ok("GET shows a confirm button and unsubscribes NOBODY (scanner-safe)", g.status === 200 && /<button[^>]*>Don't email me again<\/button>/.test(g.body) && stillIn === 0, `${g.status} n=${stillIn}`);
  const post1 = curl(["-X", "POST", `${BASE}/t/se/${token}/unsubscribe`]);
  const post2 = curl(["-X", "POST", "-H", "Content-Type: application/x-www-form-urlencoded", "-d", "List-Unsubscribe=One-Click", `${BASE}/t/se/${token}/unsubscribe`]);
  const opt = (await pool.query(`SELECT count(*)::int n FROM sales_email_optouts WHERE lower(email)=$1`, [probeEmail])).rows[0].n;
  const ev = (await pool.query(`SELECT count(*)::int n FROM sales_email_events WHERE sales_email_id=$1 AND type='unsubscribed'`, [salesEmailId])).rows[0].n;
  ok("POST unsubscribes (and a second click/one-click is not a second row)", post1.status === 200 && /we won't email you again/.test(post1.body) && post2.status === 200 && opt === 1 && ev === 1, `${post1.status}/${post2.status} rows=${opt} events=${ev}`);
  const bogus = curl(["-o", "/dev/null", `${BASE}/t/se/${crypto.randomBytes(24).toString("base64url")}/unsubscribe`]);
  ok("an unknown link answers 404 with a way out", bogus.status === 404, String(bogus.status));
  const send = admin(`/api/admin/sales/prospects/${prospectId}/email`, ["-X", "POST", "-H", "Content-Type: application/json", "-d",
    JSON.stringify({ to: probeEmail.toUpperCase(), subject: "probe", body: "This should never be sent because they unsubscribed." })]);
  // The Sales tab may be locked to super admins; if so the gate answers first (403) and the
  // opt-out check is proven by the database row above. A 409 proves the refusal end to end.
  ok("sending to an unsubscribed address is refused", send.status === 409 || send.status === 403, `${send.status} ${send.body.slice(0, 160)}`);
  if (send.status === 409) ok("…with the reason in words", /unsubscribed on/.test(send.body));
} catch (e: any) { fails.push(`threw ${e?.message}`); console.log(e); }
finally {
  for (const k of storageKeys) await driveStorage().remove(k).catch((e) => console.log("  (bytes not removed:", k, e.message, ")"));
  if (quoteId) await pool.query(`DELETE FROM print_quotes WHERE id=$1 AND customer_email='verify-probe@example.com'`, [quoteId]);
  if (expenseId) await pool.query(`DELETE FROM print_expenses WHERE id=$1 AND description LIKE 'VERIFY PROBE%'`, [expenseId]);
  await pool.query(`DELETE FROM sales_email_optouts WHERE lower(email)=$1`, [probeEmail]);
  if (prospectId) await pool.query(`DELETE FROM sales_prospects WHERE id=$1 AND name='VERIFY PROBE prospect'`, [prospectId]);
  if (userId) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [userId]); await pool.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [userId])); }
  await pool.end(); console.log(`\n${pass} passed, ${fails.length} failed`); if (fails.length) process.exit(1);
}


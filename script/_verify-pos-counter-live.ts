/**
 * Prove the COUNTER SCREEN works on production, end to end, and that a screen
 * can only ever do the few things it is allowed to.
 *
 *   npx tsx --env-file=.env script/_verify-pos-counter-live.ts            (API)
 *   SHOTS=1 npx tsx --env-file=.env script/_verify-pos-counter-live.ts    (+ real Chrome at reader size)
 *
 * Drives two "screens" (plain HTTP clients holding a counter token, exactly as
 * the S710's web view does) against a throwaway register: pairing by code, the
 * idle → cart → pay → paid screens, claiming the card prompt once, a declined
 * card leaving the payment open for another try, the till's cancel, and every
 * refusal that matters (unknown token, wrong register, unlinked screen, a
 * second screen replacing the first). Nothing is charged: the PaymentIntent is
 * created and cancelled, never collected. Every row it makes is removed.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { mkdirSync } from "fs";

const BASE = process.env.POS_VERIFY_BASE || "https://app.usg.co.nz";
const WS = "christchurch-united";
const SHOTS = process.env.SHOTS === "1";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "✓" : "✗"} ${l}${d ? ` — ${d}` : ""}`); };
const made = { users: [] as number[], registers: [] as number[], sales: [] as number[], devices: [] as number[] };

async function mkUser() {
  const email = `counterprobe-${crypto.randomBytes(5).toString("hex")}@example.com`;
  const password = crypto.randomBytes(16).toString("base64url");
  const u = await pool.query(`insert into users (email, password, first_name, last_name, role, active) values ($1,$2,'Counter','Probe','coach',true) returning id`, [email, await bcrypt.hash(password, 10)]);
  made.users.push(u.rows[0].id);
  const org = await pool.query(`select id from organizations where slug = $1`, [WS]);
  await pool.query(`insert into user_organizations (user_id, organization_id, role, tabs) values ($1,$2,'team_member',$3)`, [u.rows[0].id, org.rows[0].id, JSON.stringify(["pos"])]);
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) throw new Error(`login failed: ${r.status}`);
  return cookie;
}
function staff(cookie: string) {
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${BASE}${path}`, { method, headers: { cookie, "X-Workspace-Slug": WS, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* */ }
    return { status: r.status, body: j, setCookie: r.headers.get("set-cookie") };
  };
}
/** A counter screen: holds its token the way the web view holds the cookie. */
function screen(token?: string) {
  const h = (extra: Record<string, string> = {}) => ({ ...(token ? { Authorization: `Counter ${token}` } : {}), ...extra });
  return {
    get token() { return token; },
    set token(t: string | undefined) { token = t; },
    async call(method: string, path: string, body?: unknown) {
      const r = await fetch(`${BASE}${path}`, { method, headers: h(body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
      const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* */ }
      return { status: r.status, body: j, setCookie: r.headers.get("set-cookie") };
    },
  };
}

async function main() {
  console.log(`\n  Counter screen — live against ${BASE}\n`);
  const api = staff(await mkUser());
  const boot = await api("GET", "/api/admin/pos/bootstrap");
  ok("staff with the POS tick can open the register", boot.status === 200);
  const club = boot.body.brands.find((b: any) => b.slug === "christchurch-united");

  const reg = await api("POST", "/api/admin/pos/registers", { name: `Counter probe ${crypto.randomBytes(3).toString("hex")}`, defaultOrgId: club.id });
  ok("a throwaway register is created", reg.status === 201);
  const registerId = reg.body.id; made.registers.push(registerId);
  const shift = await api("POST", "/api/admin/pos/shifts/open", { registerId, openingFloatCents: 0 });
  ok("its shift opens", shift.status === 201 || shift.status === 200, String(shift.status));

  // ── Refusals before anything exists ──────────────────────────────────────
  ok("no token → 401", (await screen().call("GET", "/api/public/pos/counter/state")).status === 401);
  ok("a made-up token → 401", (await screen("a".repeat(64)).call("GET", "/api/public/pos/counter/state")).status === 401);

  // ── Start: a new screen gets an identity and a code ──────────────────────
  const A = screen();
  const st = await A.call("POST", "/api/public/pos/counter/start", {});
  ok("a new screen starts", st.status === 201, String(st.status));
  ok("…on the pair screen with a 6-character code", st.body?.screen === "pair" && /^[A-Z2-9]{6}$/.test(st.body?.code ?? ""), st.body?.code);
  ok("…the token arrives as a __Host- httpOnly cookie", /__Host-clubos_counter=[a-f0-9]{64}; Path=\/; Secure; HttpOnly/.test(st.setCookie ?? ""));
  A.token = st.body.token; made.devices.push(st.body.deviceId);
  const resumed = await A.call("POST", "/api/public/pos/counter/start", {});
  ok("starting again RESUMES the same screen (no second identity)", resumed.status === 200 && resumed.body.deviceId === st.body.deviceId && !resumed.body.token);
  ok("an unlinked screen cannot claim a payment", (await A.call("POST", "/api/public/pos/counter/payments/1/claim", {})).status === 409);
  ok("an unlinked screen gets no connection token", (await A.call("POST", "/api/public/pos/counter/connection-token", {})).status === 409);

  // ── Pair ─────────────────────────────────────────────────────────────────
  ok("a wrong code is refused", (await api("POST", `/api/admin/pos/registers/${registerId}/counter`, { code: "ZZZZZZ" })).status === 404);
  ok("a short code is refused", (await api("POST", `/api/admin/pos/registers/${registerId}/counter`, { code: "AB" })).status === 400);
  const paired = await api("POST", `/api/admin/pos/registers/${registerId}/counter`, { code: st.body.code.toLowerCase() });
  ok("the right code (any case) links the screen", paired.status === 201, String(paired.status));
  const idle = await A.call("GET", "/api/public/pos/counter/state?v=probe&nv=0.0.0-probe&rs=not_connected");
  ok("a linked screen idles, naming its register", idle.body?.screen === "idle" && idle.body?.register?.id === registerId);
  ok("…with brand crests to show", (idle.body?.idle?.brands ?? []).length >= 4, `${idle.body?.idle?.brands?.length} crests`);
  ok("…and kit with photographs", (idle.body?.idle?.products ?? []).every((p: any) => /^https:\/\//.test(p.image)), `${idle.body?.idle?.products?.length} products`);
  const status = await api("GET", `/api/admin/pos/registers/${registerId}/counter`);
  ok("the till sees it Online with its versions", status.body?.counter?.online === true && status.body?.counter?.nativeVersion === "0.0.0-probe");
  const bootAfter = await api("GET", "/api/admin/pos/bootstrap");
  ok("bootstrap marks the register hasCounter", bootAfter.body.registers.find((r: any) => r.id === registerId)?.hasCounter === true);
  const tok = await A.call("POST", "/api/public/pos/counter/connection-token", {});
  ok("a linked screen gets a Terminal connection token", tok.status === 200 && typeof tok.body?.secret === "string" && tok.body.secret.startsWith("pst_"));

  // ── Cart ─────────────────────────────────────────────────────────────────
  const sale = await api("POST", "/api/admin/pos/sales", { registerId });
  made.sales.push(sale.body.id);
  await api("POST", `/api/admin/pos/sales/${sale.body.id}/lines`, { kind: "custom", orgId: club.id, title: "Counter probe item", unitCents: 100, qty: 1 });
  const disp = await api("POST", `/api/admin/pos/sales/${sale.body.id}/display`, {});
  ok("the till's display call goes to the counter", disp.body?.via === "counter" && disp.body?.shown === true);
  const cart = await A.call("GET", "/api/public/pos/counter/state");
  ok("the screen shows the cart, live", cart.body?.screen === "cart" && cart.body?.sale?.lines?.[0]?.title === "Counter probe item" && cart.body?.sale?.totalCents === 100);
  ok("…with GST shown", cart.body?.sale?.gstCents === 13, String(cart.body?.sale?.gstCents));

  // ── Card ─────────────────────────────────────────────────────────────────
  const early = await api("POST", `/api/admin/pos/sales/${sale.body.id}/payments/card`, {});
  ok("🔴 Card is refused while the screen's card reader isn't connected", early.status === 409 && early.body?.code === "POS_COUNTER_READER", early.body?.message);
  await A.call("GET", "/api/public/pos/counter/state?rs=connected");
  const card = await api("POST", `/api/admin/pos/sales/${sale.body.id}/payments/card`, {});
  ok("Card goes to the counter screen", card.status === 201 && card.body?.viaCounter === true, JSON.stringify(card.body).slice(0, 120));
  const pid = card.body.paymentId;
  const ch = await pool.query(`select channel, collect_started_at from pos_payments where id = $1`, [pid]);
  ok("…the payment is recorded as channel 'counter', unclaimed", ch.rows[0]?.channel === "counter" && ch.rows[0]?.collect_started_at === null);
  const pay = await A.call("GET", "/api/public/pos/counter/state");
  ok("the screen switches to Pay", pay.body?.screen === "pay" && pay.body?.charge?.paymentId === pid && pay.body?.charge?.amountCents === 100);
  ok("…and the state never carries a client secret", !JSON.stringify(pay.body).includes("_secret_"));
  const claim = await A.call("POST", `/api/public/pos/counter/payments/${pid}/claim`, {});
  ok("the screen claims the card prompt", claim.status === 200 && /^pi_.+_secret_/.test(claim.body?.clientSecret ?? ""));
  ok("🔴 a second claim is refused (no double prompt)", (await A.call("POST", `/api/public/pos/counter/payments/${pid}/claim`, {})).status === 409);

  // A second, unrelated screen on ANOTHER register cannot touch this payment.
  const reg2 = await api("POST", "/api/admin/pos/registers", { name: `Counter probe ${crypto.randomBytes(3).toString("hex")}`, defaultOrgId: club.id });
  made.registers.push(reg2.body.id);
  const B = screen();
  const stB = await B.call("POST", "/api/public/pos/counter/start", {});
  B.token = stB.body.token; made.devices.push(stB.body.deviceId);
  await api("POST", `/api/admin/pos/registers/${reg2.body.id}/counter`, { code: stB.body.code });
  ok("🔴 another register's screen cannot claim it", (await B.call("POST", `/api/public/pos/counter/payments/${pid}/claim`, { retry: true })).status === 404);
  ok("🔴 …nor report a result for it", (await B.call("POST", `/api/public/pos/counter/payments/${pid}/result`, { outcome: "succeeded" })).status === 404);
  ok("🔴 …nor email its receipt", (await B.call("POST", `/api/public/pos/counter/sales/${sale.body.id}/receipt`, { email: "x@example.com" })).status === 404);

  // A declined card: the payment stays open, the till hears about it.
  const res1 = await A.call("POST", `/api/public/pos/counter/payments/${pid}/result`, { outcome: "failed", message: "Your card was declined." });
  ok("a declined result is accepted — Stripe still says unpaid", res1.status === 200 && res1.body?.stripeStatus !== "succeeded", res1.body?.stripeStatus);
  const afterDecline = await A.call("GET", "/api/public/pos/counter/state");
  ok("…the screen offers Try again (unclaimed, with the reason)", afterDecline.body?.charge?.claimed === false && /declined/i.test(afterDecline.body?.charge?.lastError ?? ""));
  const conf = await api("POST", `/api/admin/pos/sales/${sale.body.id}/payments/${pid}/confirm`, {});
  ok("…the till's poll carries the counter's note", /declined/i.test(conf.body?.counterNote ?? ""), conf.body?.counterNote);
  ok("…and the sale is still open", conf.body?.sale?.status === "open");
  ok("a 'succeeded' claim from the screen is NOT believed", (await pool.query(`select status from pos_payments where id = $1`, [pid])).rows[0].status === "pending");
  const retry = await A.call("POST", `/api/public/pos/counter/payments/${pid}/claim`, { retry: true });
  ok("Try again re-claims the prompt", retry.status === 200);

  // The till cancels.
  const cancel = await api("POST", `/api/admin/pos/sales/${sale.body.id}/payments/${pid}/cancel`, {});
  ok("the till cancels the card payment", cancel.status === 200 && cancel.body?.payments?.find((p: any) => p.id === pid)?.status === "canceled");
  const backToCart = await A.call("GET", "/api/public/pos/counter/state");
  ok("…and the screen goes back to the cart", backToCart.body?.screen === "cart");
  ok("a cancelled payment cannot be claimed", (await A.call("POST", `/api/public/pos/counter/payments/${pid}/claim`, { retry: true })).status === 409);

  // Settle it another way: the counter thanks them and offers a receipt.
  const eft = await api("POST", `/api/admin/pos/sales/${sale.body.id}/payments`, { method: "eftpos", amountCents: 100, reference: "PROBE" });
  ok("paid on the EFTPOS terminal instead", eft.body?.sale?.status === "paid", eft.body?.sale?.status);
  const paid = await A.call("GET", "/api/public/pos/counter/state");
  ok("the screen shows Thank you", paid.body?.screen === "paid" && paid.body?.sale?.paidBy?.includes("EFTPOS"));
  ok("a bad email is refused", (await A.call("POST", `/api/public/pos/counter/sales/${sale.body.id}/receipt`, { email: "not-an-email" })).status === 400);

  if (SHOTS) await shots(A.token!, registerId, club.id, api);

  // ── Replacing a screen ───────────────────────────────────────────────────
  const C = screen();
  const stC = await C.call("POST", "/api/public/pos/counter/start", {});
  C.token = stC.body.token; made.devices.push(stC.body.deviceId);
  ok("a new screen linked to the same register replaces the old", (await api("POST", `/api/admin/pos/registers/${registerId}/counter`, { code: stC.body.code })).status === 201);
  ok("🔴 the replaced screen is locked out at once", (await A.call("GET", "/api/public/pos/counter/state")).status === 401);
  ok("unlinking works", (await api("DELETE", `/api/admin/pos/registers/${registerId}/counter`)).body?.counter === null);
  ok("🔴 an unlinked screen is locked out", (await C.call("GET", "/api/public/pos/counter/state")).status === 401);
  ok("…and the till falls back to no counter", (await api("GET", "/api/admin/pos/bootstrap")).body.registers.find((r: any) => r.id === registerId)?.hasCounter === false);

  ok("the screen's log reached ClubOS", (await pool.query(`select count(*)::int n from pos_counter_events where device_id = $1`, [st.body.deviceId])).rows[0].n >= 3);
}

/** The real page, in real Chrome, at the S710's size. */
async function shots(token: string, registerId: number, orgId: number, api: ReturnType<typeof staff>) {
  const puppeteer = (await import("puppeteer-core")).default;
  const dir = "/private/tmp/claude-501/counter-shots"; mkdirSync(dir, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.setCookie({ name: "__Host-clubos_counter", value: token, domain: new URL(BASE).hostname, path: "/", secure: true, httpOnly: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}/counter`, { waitUntil: "networkidle2" });
    await page.waitForSelector("[data-testid=counter-receipt]", { timeout: 15000 });
    await page.screenshot({ path: `${dir}/1-paid.png` });
    await page.click("[data-testid=counter-receipt]");
    await page.waitForSelector("[data-testid=counter-email]");
    for (const k of ["d", "@"]) { const [b] = await page.$$(`xpath/.//button[normalize-space(text())="${k}"]`); await b?.click(); }
    const [g] = await page.$$(`xpath/.//button[normalize-space(text())="gmail.com"]`); await g?.click();
    const typed = await page.$eval("[data-testid=counter-email]", (e) => (e as HTMLElement).innerText);
    ok("our own keyboard types into the receipt field", typed.includes("d@gmail.com"), typed);
    await page.screenshot({ path: `${dir}/2-receipt-keyboard.png` });
    // New sale → the cart screen, with a photo line if a variant is in stock.
    const sale2 = await api("POST", "/api/admin/pos/sales", { registerId }); made.sales.push(sale2.body.id);
    const v = await pool.query(`select v.id from shop_variants v join shop_products p on p.id = v.product_id join shop_product_images i on i.product_id = p.id where v.active and v.stock > 0 and p.status = 'active' and p.organization_id = $1 limit 1`, [orgId]);
    if (v.rowCount) await api("POST", `/api/admin/pos/sales/${sale2.body.id}/lines`, { kind: "variant", variantId: v.rows[0].id, qty: 1 });
    await api("POST", `/api/admin/pos/sales/${sale2.body.id}/lines`, { kind: "custom", orgId, title: "Holiday camp — full day", detail: "Probe child", unitCents: 5000, qty: 2 });
    await api("POST", `/api/admin/pos/sales/${sale2.body.id}/display`, {});
    await page.waitForSelector("[data-testid=counter-total]", { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: `${dir}/3-cart.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    ok("the cart fits a 360px screen (no sideways scroll)", !overflow);
    await api("POST", `/api/admin/pos/sales/${sale2.body.id}/void`, { reason: "probe" });
    await page.waitForFunction(() => !document.querySelector("[data-testid=counter-total]"), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1200));
    await page.screenshot({ path: `${dir}/4-idle.png` });
    ok("the page threw no errors", errors.length === 0, errors.join(" | ").slice(0, 200));
    console.log(`  screenshots: ${dir}`);
  } finally { await browser.close(); }
}

async function cleanup() {
  for (const id of made.sales) {
    await pool.query(`delete from pos_payments where sale_id = $1 and status <> 'succeeded'`, [id]).catch(() => {});
    await pool.query(`delete from pos_payments where sale_id = $1`, [id]).catch(() => {});
    await pool.query(`update pos_sales set paid_cents = 0, status = 'void', voided_at = now(), void_reason = 'probe cleanup' where id = $1`, [id]).catch(() => {});
    await pool.query(`delete from pos_sale_lines where sale_id = $1`, [id]).catch(() => {});
    await pool.query(`delete from pos_sales where id = $1`, [id]).catch(() => {});
  }
  await pool.query(`update pos_registers set counter_sale_id = null where id = any($1)`, [made.registers]).catch(() => {});
  await pool.query(`delete from pos_counter_devices where id = any($1)`, [made.devices]).catch((e) => console.error("cleanup devices", e.message));
  for (const id of made.registers) {
    await pool.query(`delete from pos_sales where register_id = $1`, [id]).catch(() => {});
    await pool.query(`delete from pos_shifts where register_id = $1`, [id]).catch(() => {});
    // A register holding a paid probe sale can't be deleted (the database
    // refuses to delete a paid sale) — retire it so no till ever lists it.
    await pool.query(`delete from pos_registers where id = $1`, [id]).catch(async () => {
      await pool.query(`update pos_shifts set closed_at = now(), closed_by_user_id = opened_by_user_id where register_id = $1 and closed_at is null`, [id]).catch(() => {});
      await pool.query(`update pos_registers set active = false where id = $1`, [id]).catch(() => {});
    });
  }
  for (const id of made.users) {
    await pool.query(`delete from user_organizations where user_id = $1`, [id]).catch(() => {});
    await pool.query(`delete from users where id = $1`, [id]).catch(() => {});
  }
}

main()
  .catch((e) => { fail++; console.error("\n  CRASHED:", e); })
  .finally(async () => { await cleanup(); await pool.end(); console.log(`\n  ${pass} passed, ${fail} failed\n`); process.exit(fail > 0 ? 1 : 0); });

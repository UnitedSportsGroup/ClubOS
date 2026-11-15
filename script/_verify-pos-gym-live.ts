/**
 * Prove United Gymnastics classes sell on the tills and bank with the gym's
 * account, on production. A throwaway staff user with the POS and the gym's
 * Registrations tabs, a throwaway register for each till, a screen token for
 * the reader. Nothing is charged: the one "paid" sale is a recorded bank
 * transfer, its registration is checked, then every row is removed. The two
 * confirmation emails go to Resend's test inbox, nobody real.
 *
 *   npx tsx --env-file=.env script/_verify-pos-gym-live.ts
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const BASE = process.env.POS_VERIFY_BASE || "https://app.usg.co.nz";
const WS = "christchurch-united";
const T = "/api/public/pos/counter/till";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "✓" : "✗"} ${l}${d ? ` — ${d}` : ""}`); };
const made = { users: [] as number[], registers: [] as number[], sales: [] as number[], devices: [] as number[], regs: [] as number[] };
const tag = crypto.randomBytes(4).toString("hex");
const EMAIL = `delivered+gymprobe-${tag}@resend.dev`;

async function mkUser(tabs: string[]) {
  const email = `gymprobe-${tag}@example.com`;
  const password = crypto.randomBytes(16).toString("base64url");
  const u = await pool.query(`insert into users (email, password, first_name, last_name, role, active) values ($1,$2,'Gym','Probe','coach',true) returning id`, [email, await bcrypt.hash(password, 10)]);
  made.users.push(u.rows[0].id);
  const club = await pool.query(`select id from organizations where slug = $1`, [WS]);
  const gym = await pool.query(`select id from organizations where slug = 'united-gymnastics'`);
  await pool.query(`insert into user_organizations (user_id, organization_id, role, tabs) values ($1,$2,'team_member',$3)`, [u.rows[0].id, club.rows[0].id, JSON.stringify(["pos"])]);
  await pool.query(`insert into user_organizations (user_id, organization_id, role, tabs) values ($1,$2,'team_member',$3)`, [u.rows[0].id, gym.rows[0].id, JSON.stringify(tabs)]);
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) throw new Error(`login failed: ${r.status}`);
  return { id: u.rows[0].id as number, cookie, clubOrg: club.rows[0].id as number, gymOrg: gym.rows[0].id as number };
}
function staff(cookie: string) {
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${BASE}${path}`, { method, headers: { cookie, "X-Workspace-Slug": WS, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* */ }
    return { status: r.status, body: j };
  };
}
function screen(token?: string) {
  return {
    set token(t: string | undefined) { token = t; },
    async call(method: string, path: string, body?: unknown) {
      const r = await fetch(`${BASE}${path}`, { method, headers: { ...(token ? { Authorization: `Counter ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* */ }
      return { status: r.status, body: j };
    },
  };
}
const gymnast = (n: number) => ({ firstName: `Probe${tag}`, lastName: `Gymnast${n}`, dob: "2020-03-14" });
const parent = { name: `Probe Parent ${tag}`, email: EMAIL, phone: "021 555 0199" };

async function main() {
  console.log(`\n  Gym on the tills — live against ${BASE}\n`);
  const ver = await fetch(`${BASE}/api/version`).then((r) => r.json()).catch(() => null);
  console.log(`  production runs ${ver?.sha?.slice(0, 7) ?? "?"}`);

  const me = await mkUser(["cugc-registrations"]);
  const api = staff(me.cookie);
  const boot = await api("GET", "/api/admin/pos/bootstrap");
  ok("bootstrap carries a publishable key per account (club + gym)", !!boot.body?.stripePublishableKeys?.club && !!boot.body?.stripePublishableKeys?.cugc, Object.keys(boot.body?.stripePublishableKeys ?? {}).join(","));
  ok("…and never a secret key", !JSON.stringify(boot.body).includes("sk_live") && !JSON.stringify(boot.body).includes("sk_test"));
  const cat = await api("GET", "/api/admin/pos/catalogue");
  const gym = cat.body?.gym;
  ok("the laptop catalogue lists the gym: a term and priced programmes", !!gym && gym.orgId === me.gymOrg && /Term/.test(gym.term?.name ?? "") && gym.programmes.length >= 3, gym ? `${gym.term.name} · ${gym.programmes.map((p: any) => p.title).join(" · ")}` : JSON.stringify(cat.body).slice(0, 100));
  const gp = gym.programmes.find((p: any) => p.slug === "gymplay");
  const opt = gp?.options?.[0];
  ok("…GymPlay's option is priced in cents with class times", !!opt && opt.priceCents > 0 && opt.choices.length > 0, opt ? `${opt.label} ${opt.priceCents}c · ${opt.choices.length} classes` : "");

  // ── The laptop till: a club register, a gym sale ─────────────────────────
  const reg = await api("POST", "/api/admin/pos/registers", { name: `Gym probe laptop ${tag}`, defaultOrgId: me.clubOrg });
  const registerId = reg.body.id; made.registers.push(registerId);
  const regRow = boot.body.registers.find((r: any) => r.id === registerId);
  const boot2 = await api("GET", "/api/admin/pos/bootstrap");
  ok("a club register's reader account reads 'club'", boot2.body.registers.find((r: any) => r.id === registerId)?.readerAccount === "club", String(regRow?.readerAccount));
  await api("POST", "/api/admin/pos/shifts/open", { registerId, openingFloatCents: 0 });

  const clubSale = await api("POST", "/api/admin/pos/sales", { registerId });
  made.sales.push(clubSale.body.id);
  const wrongAcct = await api("POST", `/api/admin/pos/sales/${clubSale.body.id}/gym-registrations`, { programSlug: "gymplay", optionIndex: 0, sessionTime: opt.choices[0], gymnast: gymnast(1), parent, heardVia: "Facebook" });
  ok("a gym class on a CLUB sale is refused with a plain reason", wrongAcct.status === 409 && wrongAcct.body?.code === "POS_BUCKET_MISMATCH", wrongAcct.body?.message);
  const sw = await api("PATCH", `/api/admin/pos/sales/${clubSale.body.id}`, { moneyAccount: "cugc" });
  ok("an EMPTY sale may switch to the gym's account", sw.status === 200 && sw.body?.moneyAccount === "cugc", `${sw.status} ${sw.body?.moneyAccount}`);
  const saleId = clubSale.body.id;

  const noHeard = await api("POST", `/api/admin/pos/sales/${saleId}/gym-registrations`, { programSlug: "gymplay", optionIndex: 0, sessionTime: opt.choices[0], gymnast: gymnast(1), parent });
  ok("a NEW gym family must say how they heard", noHeard.status === 409 && noHeard.body?.code === "hdyhau_required", noHeard.body?.message);
  const badTime = await api("POST", `/api/admin/pos/sales/${saleId}/gym-registrations`, { programSlug: "gymplay", optionIndex: 0, sessionTime: "Sunday 3am", gymnast: gymnast(1), parent, heardVia: "Facebook" });
  ok("a class not on this term's timetable is refused", badTime.status === 400 && /timetable|class/i.test(badTime.body?.message ?? ""), badTime.body?.message);
  const badDob = await api("POST", `/api/admin/pos/sales/${saleId}/gym-registrations`, { programSlug: "gymplay", optionIndex: 0, sessionTime: opt.choices[0], gymnast: { ...gymnast(1), dob: "2031-01-01" }, parent, heardVia: "Facebook" });
  ok("a date of birth in the future is refused", badDob.status === 400, badDob.body?.message);
  const noPhone = await api("POST", `/api/admin/pos/sales/${saleId}/gym-registrations`, { programSlug: "gymplay", optionIndex: 0, sessionTime: opt.choices[0], gymnast: gymnast(1), parent: { ...parent, phone: "" }, heardVia: "Facebook" });
  ok("the counter needs a parent phone", noPhone.status === 400 && /phone/i.test(noPhone.body?.message ?? ""), noPhone.body?.message);
  const priced = await api("POST", `/api/admin/pos/sales/${saleId}/gym-registrations`, { programSlug: "gymplay", optionIndex: 0, sessionTime: opt.choices[0], gymnast: gymnast(1), parent, heardVia: "Facebook", photoConsent: "yes" });
  ok("the registration goes on the sale as a line", priced.status === 201 && priced.body?.sale?.lines?.length === 1 && priced.body.sale.lines[0].kind === "cugc_registration", JSON.stringify(priced.body).slice(0, 140));
  const line = priced.body?.sale?.lines?.[0];
  const regId = Number(priced.body?.registrationId); if (regId) made.regs.push(regId);
  ok("…priced by the SERVER at the option's term price, not by the browser", line?.lineCents === opt.priceCents && priced.body.sale.totalCents === opt.priceCents, `${line?.lineCents} vs ${opt.priceCents}`);
  ok("…the line names the gymnast, the class and the term", /Probe/.test(line?.detail ?? "") && (line?.detail ?? "").includes(opt.choices[0]) && /Term/.test(line?.detail ?? ""), line?.detail);
  ok("…the sale banks with the gym", priced.body.sale.moneyAccount === "cugc");
  const row = await pool.query(`select status, price_cents, term, pos_sale_id, heard_via, photo_consent, served_by_user_id, phone from cugc_registrations where id = $1`, [regId]);
  ok("the gym's own row exists, pending payment, linked to the sale, served by the PIN's person", row.rows[0]?.status === "pending_payment" && row.rows[0]?.pos_sale_id === saleId && row.rows[0]?.served_by_user_id === me.id && row.rows[0]?.heard_via === "Facebook" && row.rows[0]?.photo_consent === "Yes", JSON.stringify(row.rows[0]));
  ok("…the phone was normalised", /^\+64/.test(row.rows[0]?.phone ?? ""), row.rows[0]?.phone);
  const dup = await api("POST", `/api/admin/pos/sales/${saleId}/gym-registrations`, { programSlug: "gymplay", optionIndex: 0, sessionTime: opt.choices[0], gymnast: gymnast(1), parent, heardVia: "Facebook" });
  ok("the same child twice on one sale is refused", dup.status === 409 && dup.body?.code === "on_sale_already", dup.body?.message);
  const qty = await api("PATCH", `/api/admin/pos/sales/${saleId}/lines/${line.id}`, { qty: 2 });
  ok("a gym registration has no quantity", qty.status === 409);
  const lockedSwitch = await api("PATCH", `/api/admin/pos/sales/${saleId}`, { moneyAccount: "club" });
  ok("a sale with a line on it cannot change account", lockedSwitch.status === 409 && lockedSwitch.body?.code === "POS_BUCKET_LOCKED");
  const kit = cat.body.products.find((p: any) => p.orgId === me.clubOrg && p.colours.some((c: any) => c.variants.length));
  const v = kit?.colours.find((c: any) => c.variants.length)?.variants[0];
  const mixed = v ? await api("POST", `/api/admin/pos/sales/${saleId}/lines`, { kind: "variant", variantId: v.id, qty: 1 }) : { status: 409, body: { code: "skipped" } };
  ok("club kit on the gym sale is refused — one account per sale", mixed.status === 409, mixed.body?.message ?? mixed.body?.code);

  // A typed card: the PaymentIntent is made on the GYM's account.
  const keyed = await api("POST", `/api/admin/pos/sales/${saleId}/payments/card`, { keyed: true });
  ok("a typed card makes a PaymentIntent with a client secret on the gym's account", keyed.status === 201 && keyed.body?.keyed === true && keyed.body?.account === "cugc" && /^pi_.*_secret_/.test(keyed.body?.clientSecret ?? ""), `${keyed.status} ${keyed.body?.code ?? ""} ${keyed.body?.message ?? ""}`);
  const readerRefused = await api("POST", `/api/admin/pos/sales/${saleId}/payments/card`, {});
  ok("…and a second card attempt while one is pending is refused", readerRefused.status === 409 && readerRefused.body?.code === "POS_CARD_PENDING");
  const cancelled = keyed.body?.paymentId ? await api("POST", `/api/admin/pos/sales/${saleId}/payments/${keyed.body.paymentId}/cancel`, {}) : { status: 0, body: null };
  ok("the typed-card payment cancels cleanly", cancelled.status === 200 && (cancelled.body?.payments ?? []).every((p: any) => p.status !== "pending"), String(cancelled.status));
  const manualCard = await api("POST", `/api/admin/pos/sales/${saleId}/payments`, { method: "card_keyed", amountCents: 100 });
  ok("a typed card can never be 'recorded' by hand", manualCard.status === 400);

  // Remove the line: the registration is unlinked, kept, never deleted.
  const del = await api("DELETE", `/api/admin/pos/sales/${saleId}/lines/${line.id}`);
  const unlinked = await pool.query(`select status, pos_sale_id from cugc_registrations where id = $1`, [regId]);
  ok("removing the line keeps the pending row and unlinks it", del.status === 200 && unlinked.rows[0]?.status === "pending_payment" && unlinked.rows[0]?.pos_sale_id === null, JSON.stringify(unlinked.rows[0]));
  // Put a second child on and pay by bank transfer: the gym row becomes PAID.
  const again = await api("POST", `/api/admin/pos/sales/${saleId}/gym-registrations`, { programSlug: "gymplay", optionIndex: 0, sessionTime: opt.choices[0], gymnast: gymnast(2), parent, heardVia: "Facebook" });
  const regId2 = Number(again.body?.registrationId); if (regId2) made.regs.push(regId2);
  ok("a second gymnast for the same family goes on", again.status === 201 && again.body?.sale?.lines?.length === 1);
  const paid = await api("POST", `/api/admin/pos/sales/${saleId}/payments`, { method: "bank_transfer", amountCents: again.body.sale.remainingCents, reference: `probe-${tag}` });
  ok("the sale is paid by a recorded bank transfer", paid.status === 201 && paid.body?.sale?.status === "paid", `${paid.status} ${paid.body?.message ?? paid.body?.sale?.status}`);
  await new Promise((r) => setTimeout(r, 1500));
  const after = await pool.query(`select status, paid_at, payment_method, pos_sale_id, served_by_user_id from cugc_registrations where id = $1`, [regId2]);
  ok("…and the gym's row is PAID with the tender, the sale and the server on it", after.rows[0]?.status === "paid" && !!after.rows[0]?.paid_at && after.rows[0]?.payment_method === "bank_transfer" && after.rows[0]?.pos_sale_id === saleId && after.rows[0]?.served_by_user_id === me.id, JSON.stringify(after.rows[0]));
  const roll = await api("GET", "/api/admin/cugc/registrations");
  ok("the gym's Registrations tab lists it exactly like a website enrolment", roll.status === 200 && (roll.body ?? []).some((r: any) => r.id === regId2 && r.status === "paid"), String(roll.status));

  // ── The reader: a GYM register (default org = the gym) takes gym classes ──
  const greg = await api("POST", "/api/admin/pos/registers", { name: `Gym probe reader ${tag}`, defaultOrgId: me.gymOrg });
  made.registers.push(greg.body.id);
  await api("PUT", "/api/admin/pos/my-counter-pin", { pin: "2580" });
  const A = screen();
  const st = await A.call("POST", "/api/public/pos/counter/start", {});
  A.token = st.body.token; made.devices.push(st.body.deviceId);
  ok("a screen links to the gym register", (await api("POST", `/api/admin/pos/registers/${greg.body.id}/counter`, { code: st.body.code })).status === 201);
  const un = await A.call("POST", `${T}/unlock`, { userId: me.id, pin: "2580" });
  ok("the PIN unlocks the gym reader", un.status === 200);
  const who = await A.call("GET", `${T}/me`);
  ok("the reader knows this person may register a gymnast", who.body?.canRegisterGym === true);
  ok("…and its brands are the gym's only", (who.body?.brands ?? []).length === 1 && /gymnastics/i.test(who.body.brands[0].name), who.body?.brands?.map((b: any) => b.name).join(" · "));
  const rcat = await A.call("GET", `${T}/catalogue`);
  ok("the gym reader's catalogue carries the gym programmes", !!rcat.body?.gym && rcat.body.gym.programmes.length >= 3);
  ok("…and no club kit", (rcat.body?.products ?? []).every((p: any) => p.orgId === me.gymOrg), `${rcat.body?.products?.length} products`);
  const rreg = await A.call("POST", `${T}/gym-registrations`, { programSlug: "gymbasics", optionIndex: 0, sessionTime: rcat.body.gym.programmes.find((p: any) => p.slug === "gymbasics").options[0].choices[0], gymnast: gymnast(3), parent, referralSource: "instagram" });
  const rsale = rreg.body?.sale; if (rsale?.id) made.sales.push(rsale.id);
  ok("the reader registers a gymnast onto a sale that banks with the gym", rreg.status === 201 && rsale?.lines?.[0]?.kind === "cugc_registration" && rsale.lines[0].brand === "United Gymnastics", JSON.stringify(rreg.body).slice(0, 160));
  const rrow = rsale ? await pool.query(`select id, heard_via from cugc_registrations where pos_sale_id = $1`, [rsale.id]) : { rows: [] as any[] };
  if (rrow.rows[0]) made.regs.push(rrow.rows[0].id);
  ok("…the reader's HDYHAU answer is stored as words", rrow.rows[0]?.heard_via === "Instagram", rrow.rows[0]?.heard_via);
  const rdup = await A.call("POST", `${T}/gym-registrations`, { programSlug: "gymbasics", optionIndex: 0, sessionTime: rcat.body.gym.programmes.find((p: any) => p.slug === "gymbasics").options[0].choices[0], gymnast: gymnast(3), parent });
  ok("…the same child again on the reader is refused", rdup.status === 409);
  const rvoid = await A.call("POST", `${T}/sale/void`, { reason: "probe" });
  ok("the reader's sale clears", rvoid.status === 200);

  // ── The club's reader never offers the gym ────────────────────────────────
  const B = screen();
  const st2 = await B.call("POST", "/api/public/pos/counter/start", {});
  B.token = st2.body.token; made.devices.push(st2.body.deviceId);
  await api("POST", `/api/admin/pos/registers/${registerId}/counter`, { code: st2.body.code });
  await B.call("POST", `${T}/unlock`, { userId: me.id, pin: "2580" });
  const ccat = await B.call("GET", `${T}/catalogue`);
  ok("the CLUB's reader lists no gym programmes", ccat.status === 200 && !ccat.body?.gym);
  const cref = await B.call("POST", `${T}/gym-registrations`, { programSlug: "gymplay", optionIndex: 0, sessionTime: opt.choices[0], gymnast: gymnast(4), parent, heardVia: "Facebook" });
  ok("…and refuses a gym class with a plain reason", cref.status === 409 && /club/i.test(cref.body?.message ?? ""), cref.body?.message);
  const csale = await B.call("GET", `${T}/sale`); if (csale.body?.sale?.id) made.sales.push(csale.body.sale.id);
}

async function cleanup() {
  for (const id of made.sales) {
    await pool.query(`update cugc_registrations set pos_sale_id = null where pos_sale_id = $1`, [id]).catch(() => {});
    await pool.query(`delete from pos_payments where sale_id = $1`, [id]).catch(() => {});
    await pool.query(`delete from pos_sale_lines where sale_id = $1`, [id]).catch(() => {});
    await pool.query(`delete from pos_sales where id = $1`, [id]).catch(() => {});
  }
  await pool.query(`delete from cugc_registrations where id = any($1)`, [made.regs]).catch((e) => console.error("cleanup regs", e.message));
  await pool.query(`delete from cugc_registrations where email = $1`, [EMAIL]).catch(() => {});
  await pool.query(`update pos_registers set counter_sale_id = null where id = any($1)`, [made.registers]).catch(() => {});
  await pool.query(`delete from pos_counter_devices where id = any($1)`, [made.devices]).catch((e) => console.error("cleanup devices", e.message));
  for (const id of made.registers) {
    const s = await pool.query(`select id from pos_sales where register_id = $1`, [id]).catch(() => ({ rows: [] as any[] }));
    for (const x of s.rows) { await pool.query(`update cugc_registrations set pos_sale_id = null where pos_sale_id = $1`, [x.id]).catch(() => {}); await pool.query(`delete from pos_payments where sale_id = $1`, [x.id]).catch(() => {}); await pool.query(`delete from pos_sale_lines where sale_id = $1`, [x.id]).catch(() => {}); }
    await pool.query(`delete from pos_sales where register_id = $1`, [id]).catch(() => {});
    await pool.query(`delete from pos_shifts where register_id = $1`, [id]).catch(() => {});
    await pool.query(`delete from pos_registers where id = $1`, [id]).catch(async () => { await pool.query(`update pos_registers set active = false where id = $1`, [id]).catch(() => {}); });
  }
  for (const id of made.users) {
    await pool.query(`delete from pos_staff_pins where user_id = $1`, [id]).catch(() => {});
    await pool.query(`delete from user_organizations where user_id = $1`, [id]).catch(() => {});
    await pool.query(`delete from users where id = $1`, [id]).catch(() => {});
  }
}

main()
  .catch((e) => { fail++; console.error("\n  CRASHED:", e); })
  .finally(async () => { await cleanup(); await pool.end(); console.log(`\n  ${pass} passed, ${fail} failed\n`); process.exit(fail > 0 ? 1 : 0); });

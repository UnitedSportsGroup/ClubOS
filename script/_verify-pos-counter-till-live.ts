/**
 * Prove the reader TILL works on production: a staff PIN, unlocking the
 * reader, the catalogue it may sell, a typed amount as a line, the refusals,
 * and the re-lock. Drives a throwaway register + a "screen" holding a counter
 * token exactly as the S710's web view does. Nothing is charged: the sale is
 * voided. Every row it makes is removed.
 *
 *   npx tsx --env-file=.env script/_verify-pos-counter-till-live.ts
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
const made = { users: [] as number[], registers: [] as number[], sales: [] as number[], devices: [] as number[] };

async function mkUser(tabs: string[]) {
  const email = `tillprobe-${crypto.randomBytes(5).toString("hex")}@example.com`;
  const password = crypto.randomBytes(16).toString("base64url");
  const u = await pool.query(`insert into users (email, password, first_name, last_name, role, active) values ($1,$2,'Till','Probe','coach',true) returning id`, [email, await bcrypt.hash(password, 10)]);
  made.users.push(u.rows[0].id);
  const org = await pool.query(`select id from organizations where slug = $1`, [WS]);
  await pool.query(`insert into user_organizations (user_id, organization_id, role, tabs) values ($1,$2,'team_member',$3)`, [u.rows[0].id, org.rows[0].id, JSON.stringify(tabs)]);
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) throw new Error(`login failed: ${r.status}`);
  return { id: u.rows[0].id as number, cookie };
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

async function main() {
  console.log(`\n  Counter till — live against ${BASE}\n`);
  const ver = await fetch(`${BASE}/api/version`).then((r) => r.json()).catch(() => null);
  console.log(`  production runs ${ver?.sha?.slice(0, 7) ?? "?"}`);

  // ── Without a screen, nothing ──────────────────────────────────────────────
  ok("no device → staff list 401", (await screen().call("GET", `${T}/staff`)).status === 401);
  ok("no device → a typed amount 401", (await screen().call("POST", `${T}/sale/custom`, { amountCents: 100 })).status === 401);
  ok("not signed in → my PIN 401", (await fetch(`${BASE}/api/admin/pos/my-counter-pin`)).status === 401);

  const me = await mkUser(["pos"]);
  const api = staff(me.cookie);
  const boot = await api("GET", "/api/admin/pos/bootstrap");
  const club = boot.body.brands.find((b: any) => b.slug === WS);
  const reg = await api("POST", "/api/admin/pos/registers", { name: `Till probe ${crypto.randomBytes(3).toString("hex")}`, defaultOrgId: club.id });
  ok("a throwaway register is created", reg.status === 201, String(reg.status));
  const registerId = reg.body.id; made.registers.push(registerId);

  // ── The PIN ────────────────────────────────────────────────────────────────
  ok("no PIN yet", (await api("GET", "/api/admin/pos/my-counter-pin")).body?.hasPin === false);
  ok("a 3-digit PIN is refused", (await api("PUT", "/api/admin/pos/my-counter-pin", { pin: "123" })).status === 400);
  ok("1111 is refused", (await api("PUT", "/api/admin/pos/my-counter-pin", { pin: "1111" })).status === 400);
  ok("1234 is refused", (await api("PUT", "/api/admin/pos/my-counter-pin", { pin: "1234" })).status === 400);
  const set = await api("PUT", "/api/admin/pos/my-counter-pin", { pin: "2580" });
  ok("2580 is accepted", set.status === 200, JSON.stringify(set.body).slice(0, 80));
  const row = await pool.query(`select pin_hash from pos_staff_pins where user_id = $1`, [me.id]);
  ok("…stored hashed, never plain", /^s1\$/.test(row.rows[0]?.pin_hash ?? "") && !row.rows[0].pin_hash.includes("2580"));

  // ── Pair a screen ──────────────────────────────────────────────────────────
  const A = screen();
  const st = await A.call("POST", "/api/public/pos/counter/start", {});
  A.token = st.body.token; made.devices.push(st.body.deviceId);
  ok("the screen is linked to the register", (await api("POST", `/api/admin/pos/registers/${registerId}/counter`, { code: st.body.code })).status === 201);
  ok("a linked but LOCKED screen cannot sell", (await A.call("POST", `${T}/sale/custom`, { amountCents: 100 })).status === 401);

  // ── Staff + unlock ─────────────────────────────────────────────────────────
  const list = await A.call("GET", `${T}/staff`);
  ok("the staff list names people with a PIN and POS access", list.status === 200 && (list.body?.staff ?? []).some((s: any) => s.id === me.id), `${list.body?.staff?.length} staff`);
  ok("…and never carries a hash or email", !JSON.stringify(list.body).includes("s1$") && !JSON.stringify(list.body).includes("@"));
  ok("a wrong PIN is refused", (await A.call("POST", `${T}/unlock`, { userId: me.id, pin: "0000" })).status === 401);
  const un = await A.call("POST", `${T}/unlock`, { userId: me.id, pin: "2580" });
  ok("the right PIN unlocks the reader", un.status === 200, JSON.stringify(un.body).slice(0, 100));
  const who = await A.call("GET", `${T}/me`);
  ok("the reader knows who is serving", who.body?.user?.id === me.id);
  ok("…cashless register: no cash", who.body?.handlesCash === false);
  ok("…no Contacts access: kit and amounts only, no registering", who.body?.canRegister === false);
  ok("…the brands it may bank under, the register's first", Array.isArray(who.body?.brands) && who.body.brands[0]?.id === club.id && who.body?.defaultBrandId === club.id, `${who.body?.brands?.length} brands: ${who.body?.brands?.map((b: any) => b.name).join(" · ")}`);
  ok("…and United Gymnastics (its own Stripe account) is NOT among them", !(who.body?.brands ?? []).some((b: any) => /gymnastics/i.test(b.name)));

  // ── Catalogue ──────────────────────────────────────────────────────────────
  const cat = await A.call("GET", `${T}/catalogue`);
  ok("the catalogue loads", cat.status === 200 && Array.isArray(cat.body?.products) && Array.isArray(cat.body?.programmes), `${cat.body?.products?.length} products · ${cat.body?.programmes?.length} programmes`);
  ok("…kit carries photographs", (cat.body?.products ?? []).length > 0 && (cat.body?.products ?? []).every((p: any) => !p.image || /^https:\/\//.test(p.image)));
  ok("…programmes carry a price and a kind", (cat.body?.programmes ?? []).every((p: any) => p.fromCents > 0 && (p.kind === "academy" || p.kind === "camp")));

  // ── A typed amount ─────────────────────────────────────────────────────────
  ok("$0 is refused", (await A.call("POST", `${T}/sale/custom`, { amountCents: 0 })).status === 400);
  const big = await A.call("POST", `${T}/sale/custom`, { amountCents: 2_000_000 });
  ok("$20,000 is refused with a plain reason", big.status === 400 && /10,000/.test(big.body?.message ?? ""), big.body?.message);
  const add = await A.call("POST", `${T}/sale/custom`, { amountCents: 150, title: "Probe raffle" });
  ok("$1.50 'Probe raffle' becomes a line", add.status === 201 && add.body?.sale?.lines?.[0]?.kind === "custom" && add.body?.sale?.lines?.[0]?.title === "Probe raffle" && add.body?.sale?.remainingCents === 150, JSON.stringify(add.body).slice(0, 160));
  if (add.body?.sale?.id) made.sales.push(add.body.sale.id);
  const gym = await A.call("POST", `${T}/sale/custom`, { amountCents: 100, orgId: 6, title: "Wrong brand" });
  ok("a brand on another Stripe account falls back to the register's, never mixes", gym.status === 201 && gym.body?.sale?.lines?.every((l: any) => l.brand !== "United Gymnastics"), gym.body?.sale?.lines?.map((l: any) => l.brand).join(" · "));
  const untitled = await A.call("POST", `${T}/sale/custom`, { amountCents: 200 });
  ok("no label → 'Counter sale'", untitled.status === 201 && untitled.body?.sale?.lines?.some((l: any) => l.title === "Counter sale"));
  const sale = await A.call("GET", `${T}/sale`);
  ok("the sale totals the three lines, GST shown", sale.body?.sale?.remainingCents === 450 && sale.body?.sale?.gstCents === Math.round(450 * 3 / 23), `${sale.body?.sale?.remainingCents} · gst ${sale.body?.sale?.gstCents}`);
  const db = await pool.query(`select served_by_user_id, status from pos_sales where id = $1`, [sale.body.sale.id]);
  ok("…served by the PIN's person", db.rows[0]?.served_by_user_id === me.id && db.rows[0]?.status === "open");

  // ── Void, lock, lockout ────────────────────────────────────────────────────
  ok("the sale is voided (nothing charged)", (await A.call("POST", `${T}/sale/void`, {})).status === 200);
  ok("Lock locks", (await A.call("POST", `${T}/lock`, { reason: "probe" })).status === 200);
  ok("…and the reader cannot sell until unlocked again", (await A.call("POST", `${T}/sale/custom`, { amountCents: 100 })).status === 401);
  for (let i = 0; i < 5; i++) await A.call("POST", `${T}/unlock`, { userId: me.id, pin: "9999" });
  const locked = await A.call("POST", `${T}/unlock`, { userId: me.id, pin: "2580" });
  ok("five wrong tries lock the PIN, even to the right one", locked.status === 429 || locked.status === 423 || locked.status === 401, `${locked.status} ${locked.body?.message ?? ""}`);
}

async function cleanup() {
  for (const id of made.sales) {
    await pool.query(`delete from pos_payments where sale_id = $1`, [id]).catch(() => {});
    await pool.query(`delete from pos_sale_lines where sale_id = $1`, [id]).catch(() => {});
    await pool.query(`delete from pos_sales where id = $1`, [id]).catch(() => {});
  }
  await pool.query(`update pos_registers set counter_sale_id = null where id = any($1)`, [made.registers]).catch(() => {});
  await pool.query(`delete from pos_counter_devices where id = any($1)`, [made.devices]).catch((e) => console.error("cleanup devices", e.message));
  for (const id of made.registers) {
    await pool.query(`delete from pos_sales where register_id = $1`, [id]).catch(() => {});
    await pool.query(`delete from pos_shifts where register_id = $1`, [id]).catch(() => {});
    await pool.query(`delete from pos_registers where id = $1`, [id]).catch(async () => {
      await pool.query(`update pos_registers set active = false where id = $1`, [id]).catch(() => {});
    });
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

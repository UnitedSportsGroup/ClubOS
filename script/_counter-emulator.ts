// Dev helper: link the newest unlinked ClubOS Counter screen (the emulator) to a
// throwaway register and put a sale on it.   up | cart | pay | clean
import pg from "pg"; import bcrypt from "bcryptjs"; import crypto from "crypto"; import { writeFileSync, readFileSync, existsSync } from "fs";
const BASE = "https://app.usg.co.nz"; const WS = "christchurch-united"; const F = "/private/tmp/claude-501/counter-emu.json";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const st: any = existsSync(F) ? JSON.parse(readFileSync(F, "utf8")) : {};
async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { cookie: st.cookie, "X-Workspace-Slug": WS, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({}));
}
const cmd = process.argv[2];
if (cmd === "up") {
  const email = `counteremu-${crypto.randomBytes(4).toString("hex")}@example.com`, password = crypto.randomBytes(12).toString("hex");
  const u = await pool.query(`insert into users (email,password,first_name,last_name,role,active) values ($1,$2,'Counter','Emulator','coach',true) returning id`, [email, await bcrypt.hash(password, 10)]);
  const org = await pool.query(`select id from organizations where slug=$1`, [WS]);
  await pool.query(`insert into user_organizations (user_id,organization_id,role,tabs) values ($1,$2,'team_member',$3)`, [u.rows[0].id, org.rows[0].id, JSON.stringify(["pos"])]);
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  st.cookie = (r.headers.get("set-cookie") ?? "").split(";")[0]; st.userId = u.rows[0].id; st.orgId = org.rows[0].id;
  const reg = await api("POST", "/api/admin/pos/registers", { name: "Emulator counter", defaultOrgId: st.orgId }); st.registerId = reg.id;
  await api("POST", "/api/admin/pos/shifts/open", { registerId: st.registerId, openingFloatCents: 0 });
  const d = await pool.query(`select id, pairing_code from pos_counter_devices where paired_at is null and revoked_at is null and user_agent like '%ClubOSCounter%' and pairing_expires_at > now() order by id desc limit 1`);
  st.deviceId = d.rows[0]?.id;
  console.log("pair", d.rows[0]?.pairing_code, JSON.stringify(await api("POST", `/api/admin/pos/registers/${st.registerId}/counter`, { code: d.rows[0]?.pairing_code })).slice(0, 120));
} else if (cmd === "cart") {
  const s = await api("POST", "/api/admin/pos/sales", { registerId: st.registerId }); st.saleId = s.id;
  const v = await pool.query(`select v.id from shop_variants v join shop_products p on p.id=v.product_id join shop_product_images i on i.product_id=p.id where v.active and v.stock>0 and p.status='active' and p.organization_id in (1,2) order by random() limit 2`);
  for (const r of v.rows) await api("POST", `/api/admin/pos/sales/${st.saleId}/lines`, { kind: "variant", variantId: r.id, qty: 1 });
  await api("POST", `/api/admin/pos/sales/${st.saleId}/lines`, { kind: "custom", orgId: st.orgId, title: "Holiday camp — full day", detail: "Ava Smith", unitCents: 5000, qty: 1 });
  console.log(JSON.stringify(await api("POST", `/api/admin/pos/sales/${st.saleId}/display`, {})));
} else if (cmd === "pay") {
  console.log(JSON.stringify(await api("POST", `/api/admin/pos/sales/${st.saleId}/payments/card`, {})).slice(0, 200));
} else if (cmd === "clean") {
  const sale = await api("GET", `/api/admin/pos/sales/${st.saleId}`);
  const p = sale?.payments?.find((x: any) => x.status === "pending"); if (p) await api("POST", `/api/admin/pos/sales/${st.saleId}/payments/${p.id}/cancel`, {});
  if (st.saleId) await api("POST", `/api/admin/pos/sales/${st.saleId}/void`, { reason: "emulator" });
  await pool.query(`update pos_registers set counter_sale_id=null where id=$1`, [st.registerId]);
  await pool.query(`delete from pos_payments where sale_id in (select id from pos_sales where register_id=$1)`, [st.registerId]).catch(() => {});
  await pool.query(`delete from pos_sale_lines where sale_id in (select id from pos_sales where register_id=$1)`, [st.registerId]).catch(() => {});
  await pool.query(`delete from pos_sales where register_id=$1`, [st.registerId]).catch((e) => console.log(e.message));
  await pool.query(`delete from pos_counter_devices where register_id=$1 or id=$2`, [st.registerId, st.deviceId]).catch((e) => console.log(e.message));
  await pool.query(`delete from pos_counter_devices where paired_at is null and user_agent like '%ClubOSCounter%'`).catch(() => {});
  await pool.query(`delete from pos_shifts where register_id=$1`, [st.registerId]).catch(() => {});
  await pool.query(`delete from pos_registers where id=$1`, [st.registerId]).catch((e) => console.log(e.message));
  await pool.query(`delete from user_organizations where user_id=$1`, [st.userId]); await pool.query(`delete from users where id=$1`, [st.userId]).catch(() => {});
  console.log("cleaned");
}
writeFileSync(F, JSON.stringify(st)); await pool.end();

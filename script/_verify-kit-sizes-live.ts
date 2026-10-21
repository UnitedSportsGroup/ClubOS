/**
 * Kit sizes on a player's profile, proven on LIVE PRODUCTION as ordinary staff
 * (not a super admin) against a throwaway player that is deleted afterwards.
 *
 *   npx tsx --env-file=.env script/_verify-kit-sizes-live.ts
 */
import "dotenv/config";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const BASE = "https://app.usg.co.nz";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c: boolean, l: string, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); };

let userId: number | null = null, contactId: number | null = null;
try {
  const email = `kitsizes-${crypto.randomBytes(6).toString("hex")}@example.com`;
  const password = crypto.randomBytes(18).toString("base64url");
  userId = (await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'Kit','Size Probe',$2,'coach',true) RETURNING id`, [email, await bcrypt.hash(password, 10)])).rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,1,'admin',NULL)`, [userId]);
  contactId = (await pool.query(
    `INSERT INTO contacts (first_name, last_name, type) VALUES ('KitProbe','Player','player') RETURNING id`)).rows[0].id;

  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  ok(login.ok && !!cookie, "ordinary staff signs in");
  const call = (method: string, body?: any) => fetch(`${BASE}/api/admin/people/contact-${contactId}`, {
    method, headers: { Cookie: cookie, "X-Workspace-Slug": "christchurch-united", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const get = async () => (await (await call("GET")).json()).person;

  let p = await get();
  ok(p.shirtSize === null && p.shortsSize === null && p.bootSize === null, "a new player has NO sizes (blank, never defaulted)");

  let r = await call("PATCH", { firstName: "KitProbe", shirtSize: "10 (140)", shortsSize: "12 (150)", bootSize: "UK 3.5" });
  ok(r.status === 200, "staff saves shirt, shorts and boot sizes", `HTTP ${r.status}`);
  p = await get();
  ok(p.shirtSize === "10 (140)" && p.shortsSize === "12 (150)" && p.bootSize === "UK 3.5", "they read back exactly", JSON.stringify([p.shirtSize, p.shortsSize, p.bootSize]));
  ok(!!p.kitSizesUpdatedAt, "and the date they were recorded is stamped");

  r = await call("PATCH", { firstName: "KitProbe", shirtSize: "Medium-ish" });
  ok(r.status === 400, "a size that isn't on the list is refused", `HTTP ${r.status}`);
  p = await get();
  ok(p.shirtSize === "10 (140)", "and nothing changed");

  r = await call("PATCH", { firstName: "KitProbe", shirtSize: "", shortsSize: "12 (150)", bootSize: "UK 3.5" });
  p = await get();
  ok(r.status === 200 && p.shirtSize === null && p.bootSize === "UK 3.5", "blank clears one size and leaves the others");

  r = await call("PATCH", { firstName: "KitProbe Renamed" });
  p = await get();
  ok(p.bootSize === "UK 3.5" && p.firstName === "KitProbe Renamed", "a name-only edit does not touch the sizes");
} catch (e: any) {
  ok(false, "threw", e.message);
} finally {
  if (contactId) await pool.query(`DELETE FROM contacts WHERE id=$1`, [contactId]).catch(e => console.log("  cleanup contact:", e.message));
  if (userId) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [userId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(e => console.log("  cleanup user:", e.message));
  }
  await pool.end();
  console.log(`\n═══ ${pass} passed, ${fail} failed ═══\n`);
  process.exit(fail ? 1 : 0);
}

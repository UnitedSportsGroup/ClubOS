/**
 * Staff Chat — room admins, proven on LIVE PRODUCTION.
 *
 * Daniel, 2026-09-21: "allow person who created chat to become admin, to
 * appoint admins and allow them to remove people from chats."
 *
 * Four throwaway people: A (leadership — a workspace admin, the only kind who
 * can create a channel) and B, C, D (ordinary staff). Every rule is proven
 * from both sides — the person who may act, and the person who may not.
 *
 *   npx tsx --env-file=.env script/_verify-chat-admins-live.ts
 */
import "dotenv/config";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c: boolean, l: string, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${l}${d ? " — " + d : ""}`); };
const users: number[] = [];
const channels: number[] = [];

async function mkUser(name: string, leadership: boolean) {
  const email = `chatadmin-${crypto.randomBytes(5).toString("hex")}@example.com`;
  const password = crypto.randomBytes(16).toString("base64url");
  const r = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,$2,'AdminProbe',$3,'team_member',true) RETURNING id`,
    [email, name, await bcrypt.hash(password, 10)]);
  const id = r.rows[0].id; users.push(id);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,1,$2,NULL)`, [id, leadership ? "admin" : "team_member"]);
  const lr = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!lr.ok) throw new Error(`login ${name}: ${lr.status}`);
  return { id, name, cookie: (lr.headers.get("set-cookie") || "").split(";")[0] };
}
type U = Awaited<ReturnType<typeof mkUser>>;
const call = async (u: U, path: string, method = "GET", body?: any) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { Cookie: u.cookie, "X-Workspace-Slug": "christchurch-united", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json: any = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
};
const roleOf = async (u: U, channelId: number, userId: number) => {
  const r = await call(u, `/api/admin/chat/channels/${channelId}/messages`);
  const m = (r.body?.members ?? []).find((x: any) => x.userId === userId);
  return { status: r.status, role: m?.role ?? null, present: !!m };
};

async function main() {
  const A = await mkUser("Ava", true), B = await mkUser("Ben", false), C = await mkUser("Cal", false), D = await mkUser("Dee", false);

  console.log(`\nA channel: the creator owns it  (${BASE})\n`);
  const created = await call(A, "/api/admin/chat/channels", "POST", { name: `probe-admins-${crypto.randomBytes(3).toString("hex")}`, isPrivate: true });
  ok(created.status === 201, "leadership creates a private channel", `HTTP ${created.status}`);
  const ch = created.body.id as number; channels.push(ch);
  ok((await call(A, `/api/admin/chat/channels/${ch}/members`, "POST", { userIds: [B.id, C.id, D.id] })).status === 200, "the creator adds three people");
  ok((await roleOf(B, ch, A.id)).role === "owner", "the creator is the OWNER, and everyone can see it");
  ok((await roleOf(B, ch, B.id)).role === "member", "a person added is a plain member");

  console.log(`\nA plain member can do none of it\n`);
  ok((await call(B, `/api/admin/chat/channels/${ch}/members/${C.id}`, "DELETE")).status === 403, "a member cannot remove somebody");
  ok((await call(B, `/api/admin/chat/channels/${ch}/members/${C.id}`, "PATCH", { role: "admin" })).status === 403, "a member cannot appoint an admin");
  ok((await call(B, `/api/admin/chat/channels/${ch}`, "PATCH", { topic: "hijacked" })).status === 403, "a member cannot change the channel's settings");

  console.log(`\nThe owner appoints an admin, and the admin can act\n`);
  const appoint = await call(A, `/api/admin/chat/channels/${ch}/members/${B.id}`, "PATCH", { role: "admin" });
  ok(appoint.status === 200 && appoint.body?.role === "admin", "the owner makes B an admin", `HTTP ${appoint.status}`);
  ok((await roleOf(C, ch, B.id)).role === "admin", "B now reads as ADMIN to everyone");
  ok((await call(B, `/api/admin/chat/channels/${ch}`, "PATCH", { topic: "run by B" })).status === 200, "an admin can edit the channel's topic");
  ok((await call(B, `/api/admin/chat/channels/${ch}`, "PATCH", { archived: true })).status === 403, "…but cannot archive it (leadership only)");
  ok((await call(B, `/api/admin/chat/channels/${ch}/members/${D.id}`, "PATCH", { role: "admin" })).status === 200, "an admin can appoint another admin");
  ok((await call(B, `/api/admin/chat/channels/${ch}/members/${D.id}`, "PATCH", { role: "member" })).status === 200, "…and take it back");
  const removed = await call(B, `/api/admin/chat/channels/${ch}/members/${C.id}`, "DELETE");
  ok(removed.status === 200, "an admin removes C from the channel", `HTTP ${removed.status}`);
  const cAfter = await roleOf(C, ch, C.id);
  ok(cAfter.status === 403, "C can no longer read the private channel", `HTTP ${cAfter.status}`);
  ok(!(await roleOf(A, ch, C.id)).present, "C is off the members list");
  const kept = await pool.query(`SELECT left_at FROM staff_channel_members WHERE channel_id=$1 AND user_id=$2`, [ch, C.id]);
  ok(kept.rows[0]?.left_at != null, "the row is kept with left_at — who was in the room survives");

  console.log(`\nThe owner is the owner\n`);
  ok((await call(B, `/api/admin/chat/channels/${ch}/members/${A.id}`, "DELETE")).status === 400, "an admin cannot remove the creator");
  ok((await call(B, `/api/admin/chat/channels/${ch}/members/${A.id}`, "PATCH", { role: "member" })).status === 400, "an admin cannot demote the creator");
  ok((await call(B, `/api/admin/chat/channels/${ch}/members/${B.id}`, "DELETE")).status === 400, "removing yourself is refused — leave instead");
  ok((await call(A, `/api/admin/chat/channels/${ch}/members/${B.id}`, "PATCH", { role: "member" })).status === 200, "the owner demotes B");
  ok((await call(B, `/api/admin/chat/channels/${ch}/members/${D.id}`, "DELETE")).status === 403, "a demoted admin can no longer remove anyone");
  ok((await call(A, `/api/admin/chat/channels/${ch}/members/${999999}`, "DELETE")).status === 404, "removing somebody who is not in the room is 404");

  console.log(`\nThe default channels keep everyone\n`);
  const { rows: def } = await pool.query(`SELECT id FROM staff_channels WHERE is_default = true AND kind = 'channel' LIMIT 1`);
  if (def.length) {
    await call(B, `/api/admin/chat/channels/${def[0].id}/join`, "POST");
    ok((await call(A, `/api/admin/chat/channels/${def[0].id}/members/${B.id}`, "DELETE")).status === 400, "nobody can be removed from a default channel, not even by leadership");
  }

  console.log(`\nA group message: the person who opened it runs it\n`);
  const gdm = await call(B, "/api/admin/chat/dms", "POST", { userIds: [C.id, D.id] });
  ok(gdm.status === 201, "B opens a group message with C and D", `HTTP ${gdm.status}`);
  const g = gdm.body.id as number; channels.push(g);
  ok((await roleOf(C, g, B.id)).role === "owner", "B is the group's OWNER");
  ok((await call(C, `/api/admin/chat/channels/${g}/members/${D.id}`, "DELETE")).status === 403, "C cannot remove D");
  ok((await call(B, `/api/admin/chat/channels/${g}/members/${D.id}`, "DELETE")).status === 200, "B removes D from the group");
  ok(!(await roleOf(B, g, D.id)).present, "D is gone from the group");
  const dm = await call(B, "/api/admin/chat/dms", "POST", { userIds: [C.id] });
  channels.push(dm.body.id);
  ok((await roleOf(B, dm.body.id, B.id)).role === "member", "a one-to-one message has no owner");
  ok((await call(B, `/api/admin/chat/channels/${dm.body.id}/members/${C.id}`, "DELETE")).status === 400, "nobody can be removed from a one-to-one message");
  ok((await call(B, `/api/admin/chat/channels/${dm.body.id}/members/${C.id}`, "PATCH", { role: "admin" })).status === 400, "…and it has no admins to appoint");

  console.log(`\nLeadership still runs every room\n`);
  const E = await mkUser("Eve", true);
  ok((await call(E, `/api/admin/chat/channels/${ch}/members/${D.id}`, "DELETE")).status === 200, "a workspace admin who is not even in the channel can remove someone");
}

main()
  .catch((e) => { console.error("\nthrew:", e); fail++; })
  .finally(async () => {
    for (const id of channels) await pool.query(`DELETE FROM staff_channels WHERE id=$1`, [id]).catch(() => {});
    for (const id of users) {
      await pool.query(`DELETE FROM staff_channel_members WHERE user_id=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM staff_chat_presence WHERE user_id=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {});
    }
    await pool.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });

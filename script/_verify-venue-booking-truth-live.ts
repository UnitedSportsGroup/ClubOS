// Live check, after a deploy, that the USC Bookings tab tells the truth about
// money — signed in as an ORDINARY USC staff member (a super admin would not
// reproduce what staff see). Creates a throwaway account, exercises the
// endpoints, deletes the account. Read-only against bookings.
//   npx tsx --env-file=.env script/_verify-venue-booking-truth-live.ts
//   BASE=http://localhost:5000 … for a local server
import "dotenv/config";
import pg from "pg";
import bcrypt from "bcryptjs";
import { describeVenuePayment } from "../shared/venue-booking-truth";

const BASE = process.env.BASE || "https://app.usg.co.nz";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let failures = 0;
const ok = (cond: boolean, label: string) => { console.log(`  ${cond ? "ok  " : "✗   "}${label}`); if (!cond) failures++; };
const users: number[] = [];

async function main() {
  console.log(`\nUSC booking truth — live against ${BASE}\n`);
  const email = `_venuetruth_${Date.now()}@usg.co.nz`;
  const password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Preflight','VenueTruth',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(password, 10)]);
  users.push(rows[0].id);
  const { rows: o } = await pool.query(`SELECT id FROM organizations WHERE slug='united-sports-centre'`);
  const orgId = o[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'team_member',$3::jsonb)`, [rows[0].id, orgId, JSON.stringify(["bookings"])]);

  // unauthenticated: the new routes exist and are gated
  for (const p of ["/api/admin/venue/splits?orgId=4", "/api/admin/venue/splits/50", "/api/admin/venue/bookings/5789/confirm-paid"]) {
    const r = await fetch(`${BASE}${p}`, { method: p.endsWith("confirm-paid") ? "POST" : "GET" });
    ok(r.status === 401, `${p} answers 401 signed out (got ${r.status})`);
  }

  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  ok(login.ok, `ordinary USC staff can sign in (HTTP ${login.status})`);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const H = { cookie, "X-Workspace-Slug": "united-sports-centre" };

  // the bookings list carries each Player Pay split
  const list = await fetch(`${BASE}/api/admin/venue/bookings?orgId=${orgId}`, { headers: H });
  ok(list.status === 200, `bookings list answers 200 (got ${list.status})`);
  const bookings: any[] = list.ok ? await list.json() : [];
  const james = bookings.find(b => b.id === 5789);
  ok(!!james, "James Na #5789 is in the list");
  if (james) {
    ok(james.split && james.split.id === 50 && james.split.paidCount === 5, `#5789 carries split 50 with 5 paid (got ${JSON.stringify(james.split && { id: james.split.id, paid: james.split.paidCount })})`);
    const t = describeVenuePayment(james);
    ok(t.state === "paid" && t.method === "player_pay", `#5789 reads ${t.headline} · ${t.detail}`);
    ok(james.status === "paid" && !!james.paidAt, "#5789 row is paid with a paid_at (the repair landed)");
  }
  for (const [id, state] of [[5507, "paid"], [5434, "paid"]] as const) {
    const b = bookings.find(x => x.id === id);
    ok(!!b && describeVenuePayment(b).state === state, `#${id} reads ${b ? describeVenuePayment(b).headline + " · " + describeVenuePayment(b).detail : "missing"}`);
  }
  const cory = bookings.find(b => b.id === 5791);
  if (cory) {
    const t = describeVenuePayment(cory);
    ok(t.state === "not_paid" || t.state === "in_progress", `#5791 Cory Wu reads ${t.headline} · ${t.detail}`);
    ok(t.state !== "attention", "#5791 is not flagged for attention (nothing was charged)");
  }
  const attention = bookings.filter(b => describeVenuePayment(b).state === "attention");
  ok(attention.length === 0, `no booking needs attention (${attention.map(b => "#" + b.id).join(", ") || "none"})`);
  const cancelledNoReason = bookings.filter(b => b.source === "public" && b.status === "cancelled" && !b.cancelReason);
  ok(cancelledNoReason.length === 0, `every released website booking says why (${cancelledNoReason.length} without a reason)`);
  const lights = bookings.find(b => b.id === 5792);
  ok(!!lights && Array.isArray(lights.addonsJson) && lights.addonsJson.some((a: any) => a.name === "Floodlights" && a.priceCents === 6900), "#5792 carries its Floodlights add-on at $69.00 for the page to show");

  // the Player Pay view
  const splits = await fetch(`${BASE}/api/admin/venue/splits?orgId=${orgId}`, { headers: H });
  ok(splits.status === 200, `venue splits list answers 200 (got ${splits.status})`);
  const srows: any[] = splits.ok ? await splits.json() : [];
  ok(srows.some(s => s.id === 50 && s.status === "settled" && s.collectedCents === 18690), "split 50 listed as settled with $186.90 collected");
  ok(srows.every(s => typeof s.organiserName === "string" || s.organiserName === null), "every split names its organiser (or null)");
  const detail = await fetch(`${BASE}/api/admin/venue/splits/50`, { headers: H });
  ok(detail.status === 200, `split 50 detail answers 200 (got ${detail.status})`);
  const d: any = detail.ok ? await detail.json() : null;
  ok(d && d.members && d.members.filter((m: any) => m.status === "paid").length === 5, "split 50 detail lists five paid members");
  // a split from another org (an MFL registration split) is not reachable here
  const { rows: foreign } = await pool.query(`SELECT id FROM split_sessions WHERE funding_type='registration' ORDER BY id DESC LIMIT 1`);
  if (foreign[0]) {
    const f = await fetch(`${BASE}/api/admin/venue/splits/${foreign[0].id}`, { headers: H });
    ok(f.status === 404, `an MFL registration split answers 404 on the venue route (got ${f.status})`);
  }
  // cancel is refused on a settled split (never a refund by accident)
  const cancel = await fetch(`${BASE}/api/admin/venue/splits/50/cancel`, { method: "POST", headers: { ...H, "Content-Type": "application/json" } });
  ok(cancel.status === 400, `cancelling the settled split 50 is refused (got ${cancel.status})`);
  // confirm-paid on an already-paid booking is a no-op, not an error
  const cp = await fetch(`${BASE}/api/admin/venue/bookings/5789/confirm-paid`, { method: "POST", headers: { ...H, "Content-Type": "application/json" } });
  const cpj: any = cp.ok ? await cp.json() : null;
  ok(cp.status === 200 && cpj && cpj.paid.length === 0 && cpj.conflicts.length === 0, `confirm-paid on a paid booking changes nothing (got ${cp.status} ${JSON.stringify(cpj)})`);

  // the sweeper's exclusion really is live: a pending Player Pay row older than
  // 30 min must NOT be returned by the stale-cart query the sweep runs
  const { rows: stale } = await pool.query(`
    SELECT b.id FROM facility_bookings b WHERE b.status='pending' AND b.created_at < now() - interval '30 minutes'
      AND EXISTS (SELECT 1 FROM split_sessions s WHERE s.facility_booking_group_id=b.booking_group_id)`);
  console.log(`  (${stale.length} pending Player Pay row(s) older than 30 min — the deployed sweep must leave these alone)`);
}

main().then(async () => {
  for (const id of users) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]); await pool.query(`DELETE FROM users WHERE id=$1`, [id]); }
  await pool.end();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}).catch(async (e) => {
  console.error(e);
  for (const id of users) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {}); await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {}); }
  await pool.end(); process.exit(1);
});

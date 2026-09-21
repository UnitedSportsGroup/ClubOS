/**
 * Moving ONE child off a booking that covers two — proven against production.
 *
 * Builds a throwaway family shaped exactly like registration #619 (two
 * children, two afternoons each, one day already refunded), signs in as
 * ORDINARY staff, previews and moves one child to the World Cup camp, and
 * checks that the money split adds back to the cent, the sibling stayed, the
 * days landed on the right sessions, and every refusal refuses. Then deletes
 * the family. Nothing it creates carries a Stripe id.
 *
 *   npx tsx --env-file=.env script/_verify-transfer-split-live.ts
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WORKSPACE = "christchurch-united";
const FROM_CAMP = 30;       // FUNdamentals U4–U8
const TO_CAMP = 39;         // World Cup U9–U13 — same ten dates
const OTHER_ORG_PROGRAMME = 45; // an MFL programme — must read 404 from CUFC
const TERM_PROGRAMME = 4;   // FUNiño term sessions carry start times → no camp day matches
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); good ? pass++ : fail++; };

let tempUserId: number | null = null;
let cookie = "";
async function signInAsStaff() {
  const email = `_move_probe_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Move','Probe',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)]);
  tempUserId = rows[0].id;
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`, [tempUserId, org[0].id]);
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  if (!res.ok) throw new Error(`login HTTP ${res.status}`);
  cookie = (res.headers.get("set-cookie") || "").split(";")[0];
}
const asStaff = (path: string, init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { cookie, "X-Workspace-Slug": WORKSPACE, "Content-Type": "application/json", ...(init.headers || {}) } });

const probe = { contactId: 0, childA: 0, childB: 0, regId: 0, newRegId: 0, pendingRegId: 0 };

async function seed() {
  const { rows: c } = await pool.query(
    `INSERT INTO contacts (type, first_name, last_name, email) VALUES ('parent','Move','Probe',$1) RETURNING id`,
    [`_move_probe_${Date.now()}@example.com`]);
  probe.contactId = c[0].id;
  const kid = async (n: string) => (await pool.query(
    `INSERT INTO children (parent_id, first_name, last_name, date_of_birth) VALUES ($1,$2,'Probe','2018-05-05') RETURNING id`, [probe.contactId, n])).rows[0].id;
  probe.childA = await kid("Alpha"); probe.childB = await kid("Beta");
  const { rows: dates } = await pool.query(`SELECT id, date::text FROM camp_dates WHERE camp_id=$1 AND start_time IS NULL ORDER BY date LIMIT 2`, [FROM_CAMP]);
  if (dates.length < 2) throw new Error("FROM camp has fewer than two dates");
  // $120 booking: 2 kids × 2 afternoons × $30; Alpha's first day already refunded ($30).
  const { rows: r } = await pool.query(
    `INSERT INTO registrations (program_id, contact_id, guardian_id, status, subtotal_cents, discount_cents, total_cents, amount_paid, refunded_amount_cents, source, registration_location, currency, order_number)
     VALUES ($1,$2,$2,'partially_refunded',12000,0,12000,'120.00',3000,'public_booking','online','NZD',999999) RETURNING id`,
    [FROM_CAMP, probe.contactId]);
  probe.regId = r[0].id;
  for (const [child, refund] of [[probe.childA, true], [probe.childB, false]] as const) {
    for (let i = 0; i < 2; i++) {
      await pool.query(`INSERT INTO registration_items (registration_id, child_id, camp_date_id, product_type, refunded_amount_cents) VALUES ($1,$2,$3,'AFTERNOON',$4)`,
        [probe.regId, child, dates[i].id, refund && i === 0 ? 3000 : null]);
    }
  }
  const { rows: p } = await pool.query(
    `INSERT INTO registrations (program_id, contact_id, guardian_id, status, subtotal_cents, total_cents, amount_paid, source, currency) VALUES ($1,$2,$2,'pending',3000,3000,'0','public_booking','NZD') RETURNING id`,
    [FROM_CAMP, probe.contactId]);
  probe.pendingRegId = p[0].id;
  return dates.map((d: any) => d.date);
}

async function cleanup() {
  const regs = [probe.regId, probe.newRegId, probe.pendingRegId].filter(Boolean);
  if (regs.length) await pool.query(`DELETE FROM registrations WHERE id = ANY($1::int[])`, [regs]);
  if (probe.childA) await pool.query(`DELETE FROM children WHERE id = ANY($1::int[])`, [[probe.childA, probe.childB]]);
  if (probe.contactId) await pool.query(`DELETE FROM contacts WHERE id=$1`, [probe.contactId]);
  // Probe users cannot be deleted (audit_logs RESTRICT) — deactivate and strip.
  if (tempUserId) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [tempUserId]);
    await pool.query(`UPDATE users SET active=false, password='!' WHERE id=$1`, [tempUserId]);
  }
}

async function main() {
  console.log(`\nMove one child off a two-child booking — ${BASE}\n`);
  await signInAsStaff();
  const dates = await seed();
  const reg = probe.regId;

  console.log("Preview, nobody named");
  let res = await asStaff(`/api/admin/registrations/${reg}/transfer-preview`);
  let plan: any = await res.json();
  ok("staff can preview", res.ok, `HTTP ${res.status}`);
  ok("both children listed, two sessions each", plan.children?.length === 2 && plan.children.every((c: any) => c.sessions.length === 2));
  ok("with nobody named, everyone moves and nothing splits", plan.children.every((c: any) => c.moving) && plan.split === null);
  ok("a session prices at what was paid ($30), stamped or not", plan.children[0].sessions[0].priceCents === 3000);
  ok("the refunded day is marked", plan.children.some((c: any) => c.sessions.some((s: any) => s.refundedCents === 3000)));

  console.log("\nPreview, Alpha → World Cup");
  res = await asStaff(`/api/admin/registrations/${reg}/transfer-preview?toProgramId=${TO_CAMP}&childIds=${probe.childA}`);
  plan = await res.json();
  ok("preview loads", res.ok, `HTTP ${res.status}`);
  const alpha = plan.children?.find((c: any) => c.childId === probe.childA);
  const beta = plan.children?.find((c: any) => c.childId === probe.childB);
  ok("only Alpha moves", alpha?.moving === true && beta?.moving === false);
  ok("every one of Alpha's days matched a World Cup session on the same date", alpha?.sessions.every((s: any) => s.target && s.target.date === s.date) && plan.unmatched.length === 0);
  ok("Beta's days are not matched — she is not moving", beta?.sessions.every((s: any) => s.target === null));
  ok("split: Alpha's share is $60 of $120", plan.split?.moving.totalCents === 6000 && plan.split?.staying.totalCents === 6000);
  ok("split: Alpha's $30 refund travels with her day; Beta's side has none", plan.split?.moving.refundedCents === 3000 && plan.split?.staying.refundedCents === 0);
  ok("split: paid $60 / $60", plan.split?.moving.amountPaidCents === 6000 && plan.split?.staying.amountPaidCents === 6000);
  ok("split: statuses follow the money (Alpha partial, Beta confirmed)", plan.split?.moving.status === "partially_refunded" && plan.split?.staying.status === "confirmed");
  ok("names for the sentence", plan.movingNames?.[0] === "Alpha Probe" && plan.stayingNames?.[0] === "Beta Probe");

  console.log("\nRefusals (read-only)");
  res = await asStaff(`/api/admin/registrations/${reg}/transfer-preview?toProgramId=${OTHER_ORG_PROGRAMME}`);
  ok("a programme in another workspace reads 404", res.status === 404, `HTTP ${res.status}`);
  res = await asStaff(`/api/admin/registrations/${reg}/transfer-preview?childIds=424242`);
  ok("a child not on the booking is refused", res.status === 400, `HTTP ${res.status}`);
  res = await asStaff(`/api/admin/registrations/${probe.pendingRegId}/transfer-preview`);
  ok("an unpaid (pending) registration cannot be moved", res.status === 400, `HTTP ${res.status}`);
  res = await asStaff(`/api/admin/registrations/${reg}/transfer-preview?toProgramId=${TERM_PROGRAMME}&childIds=${probe.childA}`);
  plan = await res.json();
  ok("a programme with no session on those days names them", res.ok && plan.unmatched?.length === 2, JSON.stringify(plan.unmatched));
  res = await asStaff(`/api/admin/registrations/${reg}/transfer`, { method: "POST", body: JSON.stringify({ toProgramId: TERM_PROGRAMME, childIds: [probe.childA] }) });
  const conflict: any = await res.json();
  ok("…and the move is refused (409) until told to drop them", res.status === 409 && conflict.needsConfirmation === true, `HTTP ${res.status}`);
  const { rows: untouched } = await pool.query(`SELECT count(*)::int n FROM registration_items WHERE registration_id=$1`, [reg]);
  ok("nothing was written by the refusal", untouched[0].n === 4);

  console.log("\nThe move: Alpha → World Cup");
  res = await asStaff(`/api/admin/registrations/${reg}/transfer`, { method: "POST", body: JSON.stringify({ toProgramId: TO_CAMP, childIds: [probe.childA] }) });
  const out: any = await res.json();
  ok("moved", res.ok && out.ok === true, `HTTP ${res.status} ${out.message ?? ""}`);
  probe.newRegId = out.moved?.registrationId ?? 0;
  ok("Alpha got her OWN registration", probe.newRegId > 0 && probe.newRegId !== reg, String(probe.newRegId));
  ok("Beta stayed on the original", out.stayed?.registrationId === reg && out.stayed?.names?.[0] === "Beta Probe");
  ok("two sessions carried, none dropped", out.daysRemapped === 2 && out.daysDropped === 0);
  ok("the shift is reported per session (from → to, same dates)", out.sessions?.length === 2 && out.sessions.every((s: any) => s.to && s.to.date === s.from.date));

  const { rows: [a] } = await pool.query(`SELECT * FROM registrations WHERE id=$1`, [probe.newRegId]);
  const { rows: [b] } = await pool.query(`SELECT * FROM registrations WHERE id=$1`, [reg]);
  ok("new row: World Cup, $60, paid $60, $30 refunded, partially_refunded", a.program_id === TO_CAMP && a.total_cents === 6000 && a.amount_paid === "60.00" && a.refunded_amount_cents === 3000 && a.status === "partially_refunded");
  ok("original: still FUNdamentals, $60, paid $60, no refund, confirmed", b.program_id === FROM_CAMP && b.total_cents === 6000 && b.amount_paid === "60.00" && b.refunded_amount_cents === null && b.status === "confirmed");
  ok("🔴 the two rows add back to the one payment", a.total_cents + b.total_cents === 12000 && Number(a.amount_paid) + Number(b.amount_paid) === 120 && (a.refunded_amount_cents ?? 0) + (b.refunded_amount_cents ?? 0) === 3000);
  ok("same order number, same family on both", a.order_number === b.order_number && a.contact_id === b.contact_id && a.guardian_id === b.guardian_id);
  ok("both rows say what happened", /Split from registration #/.test(a.notes ?? "") && new RegExp(`as registration #${probe.newRegId}`).test(b.notes ?? ""));

  const { rows: aItems } = await pool.query(`SELECT ri.child_id, ri.price_cents, cd.camp_id, cd.date::text FROM registration_items ri JOIN camp_dates cd ON cd.id=ri.camp_date_id WHERE ri.registration_id=$1 ORDER BY cd.date`, [probe.newRegId]);
  const { rows: bItems } = await pool.query(`SELECT ri.child_id, ri.price_cents, cd.camp_id, cd.date::text FROM registration_items ri JOIN camp_dates cd ON cd.id=ri.camp_date_id WHERE ri.registration_id=$1 ORDER BY cd.date`, [reg]);
  ok("Alpha's two days now point at World Cup sessions on the same dates", aItems.length === 2 && aItems.every((i: any) => i.child_id === probe.childA && i.camp_id === TO_CAMP) && aItems.map((i: any) => i.date).join() === dates.join());
  ok("Beta's two days still point at FUNdamentals", bItems.length === 2 && bItems.every((i: any) => i.child_id === probe.childB && i.camp_id === FROM_CAMP));
  ok("🔴 every line now carries the price that was PAID ($30) — a later refund uses it, not the new camp's rate", [...aItems, ...bItems].every((i: any) => i.price_cents === 3000));

  console.log("\nThe whole move: Beta (now alone) → World Cup");
  res = await asStaff(`/api/admin/registrations/${reg}/transfer`, { method: "POST", body: JSON.stringify({ toProgramId: TO_CAMP }) });
  const whole: any = await res.json();
  ok("moved whole — no split when everyone on the booking moves", res.ok && whole.stayed === null && whole.money === null && whole.moved?.registrationId === reg, `HTTP ${res.status} ${whole.message ?? ""}`);
  const { rows: [b2] } = await pool.query(`SELECT program_id, total_cents FROM registrations WHERE id=$1`, [reg]);
  ok("same row, now on World Cup, money untouched", b2.program_id === TO_CAMP && b2.total_cents === 6000);
  const { rows: rolls } = await pool.query(`SELECT count(*)::int n FROM registration_items ri JOIN camp_dates cd ON cd.id=ri.camp_date_id WHERE ri.registration_id IN ($1,$2) AND cd.camp_id=$3`, [reg, probe.newRegId, TO_CAMP]);
  ok("all four days are on World Cup rolls", rolls[0].n === 4);

  res = await asStaff(`/api/admin/registrations/${reg}/transfer-preview?toProgramId=${TO_CAMP}`);
  ok("already there → refused", res.status === 400);
}

main()
  .catch((e) => { console.error("\nERROR", e); fail++; })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup failed:", e.message));
    await pool.end();
    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
  });

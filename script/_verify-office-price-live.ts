/**
 * Proves, against PRODUCTION, that the office can record the price it actually
 * agreed — the bug Olga reported on 15 September 2026:
 *
 *   "I entered price $135. But it's shown as $30."
 *
 * She was selling Technification ($150 a term) two sessions from the end of
 * Term 3, so the form quoted the pro-rated $30. She typed $135, the Apply
 * button accepted it, and the registration was written at $30 with nothing
 * said. Two real rows went in that way that afternoon.
 *
 * 🔴 It signs in as ORDINARY STAFF, never as a super admin — a super admin
 * short-circuits the membership checks, so proving it works for Daniel proves
 * nothing about Olga at the counter.
 *
 * 🔴 It writes ONE registration through the real endpoint and removes it again.
 * A price is money; the only honest proof is the row the route actually wrote.
 *
 *   npx tsx --env-file=.env script/_verify-office-price-live.ts
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WORKSPACE = "christchurch-united";
const TECHNIFICATION = 5;
const TERM_3 = 7;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};
const money = (c: number | null | undefined) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);

let tempUserId: number | null = null;
let cookie = "";
const madeRegistrations: number[] = [];
const madeContacts: number[] = [];

async function signInAsStaff() {
  const email = `_price_probe_${Date.now()}@usg.co.nz`;
  const pw = `P${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'Price','Probe',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)],
  );
  tempUserId = rows[0].id;
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  await pool.query(
    `INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`,
    [tempUserId, org[0].id],
  );
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  if (!res.ok) throw new Error(`login HTTP ${res.status}`);
  cookie = (res.headers.get("set-cookie") || "").split(";")[0];
}

const asStaff = (path: string, init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: { cookie, "X-Workspace-Slug": WORKSPACE, "Content-Type": "application/json", ...(init.headers || {}) },
  });

/** A walk-up exactly like the one Olga took, with the price she meant to charge. */
function payload(
  overrideCents: number | null,
  reason: string,
  amountPaidCents: number,
  /** Where the "skip the NZ Football details" tick rides. The FORM has always
   *  sent it nested; the server used to read only the flat one, so the tick had
   *  never worked at the counter. Both must now be honoured. */
  deferAt: "nested" | "flat" = "nested",
) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const defer = { deferIdentity: true, deferReason: "Other", deferNote: "verification probe" };
  return {
    programId: TECHNIFICATION,
    programOptionId: 13,              // U9–U10, $150 a term
    paymentPlan: "term",
    termId: TERM_3,                   // the term that was nearly over
    guardian: { firstName: "Price", lastName: `Probe${stamp}`, email: `_price_probe_${stamp}@usg.co.nz`, phone: "0200000000", relationship: "parent" },
    player: {
      firstName: "Probe", lastName: `Child${stamp}`, dateOfBirth: "2016-08-22", gender: "male",
      ...(deferAt === "nested" ? defer : {}),
    },
    ...(deferAt === "flat" ? defer : {}),
    emergency: { name: "", phone: "" },
    policyAccepted: true,
    acknowledgeAgeWarning: true,
    notes: "AUTOMATED VERIFICATION — removed immediately",
    ...(overrideCents == null ? {} : { priceOverrideCents: overrideCents, priceOverrideReason: reason }),
    payment: { isPaid: true, method: "eftpos", reference: "verify", amountPaidCents },
    servedByUserId: tempUserId,
  };
}

async function cleanup() {
  for (const id of madeRegistrations) {
    await pool.query(`DELETE FROM attendance WHERE contact_id IN (SELECT contact_id FROM registrations WHERE id=$1)`, [id]).catch(() => {});
    await pool.query(`DELETE FROM registration_items WHERE registration_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM registrations WHERE id=$1`, [id]).catch(() => {});
  }
  for (const id of madeContacts) {
    await pool.query(`DELETE FROM contact_relationships WHERE from_contact_id=$1 OR to_contact_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM contacts WHERE id=$1`, [id]).catch(() => {});
  }
  if (tempUserId) {
    await pool.query(`DELETE FROM audit_logs WHERE user_id=$1`, [tempUserId]).catch(() => {});
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [tempUserId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id=$1`, [tempUserId]).catch(() => {});
  }
}

async function main() {
  console.log(`\nThe office can record the price it agreed — ${BASE}\n`);
  await signInAsStaff();

  // ── 1. The exact conditions that produced the bug ─────────────────────────
  console.log("The conditions Olga was in");
  const qs = new URLSearchParams({ programId: String(TECHNIFICATION), programOptionId: "13", plan: "term", termId: String(TERM_3) });
  const qRes = await asStaff(`/api/admin/registrations/manual/quote?${qs}`);
  ok("the counter can price Technification Term 3", qRes.ok, `HTTP ${qRes.status}`);
  const quote: any = qRes.ok ? (await qRes.json()).quote : null;
  ok("the published fee is $150", quote?.subtotalCents === 15000, money(quote?.subtotalCents));
  ok("and today's quote is LESS than it (pro-rated)", (quote?.totalCents ?? 0) < (quote?.subtotalCents ?? 0),
    `${money(quote?.totalCents)} of ${money(quote?.subtotalCents)}`);

  // ── 2. The ceiling is the fee, not the quote ──────────────────────────────
  console.log("\nThe ceiling");
  const overRes = await asStaff("/api/admin/registrations/manual", {
    method: "POST", body: JSON.stringify(payload(15100, "probe", 15100)),
  });
  const overBody: any = await overRes.json().catch(() => ({}));
  ok("a price above the $150 fee is refused", overRes.status === 400, `HTTP ${overRes.status}`);
  ok("…and the message names the FEE, not the pro-rated quote",
    typeof overBody.message === "string" && overBody.message.includes("$150.00") && !overBody.message.includes("$30.00"),
    overBody.message);

  const noReason = await asStaff("/api/admin/registrations/manual", {
    method: "POST", body: JSON.stringify(payload(13500, "   ", 13500)),
  });
  ok("a changed price with no reason is refused", noReason.status === 400, `HTTP ${noReason.status}`);

  // ── 3. Olga's $135, end to end ────────────────────────────────────────────
  console.log("\nHer $135");
  const res = await asStaff("/api/admin/registrations/manual", {
    method: "POST", body: JSON.stringify(payload(13500, "Attended all term, settling up", 13500)),
  });
  const body: any = await res.json().catch(() => ({}));
  ok("$135 on a $150 term is ACCEPTED", res.ok, `HTTP ${res.status} ${body.message ?? ""}`);
  ok("…and the response says $135, not the quote", body.totalCents === 13500, money(body.totalCents));

  if (body.registrationId) {
    madeRegistrations.push(body.registrationId);
    const { rows } = await pool.query(
      `SELECT subtotal_cents, discount_cents, total_cents, amount_paid, status::text AS status, notes, term_id, contact_id, guardian_id
       FROM registrations WHERE id=$1`, [body.registrationId]);
    const r = rows[0];
    if (r) { madeContacts.push(r.contact_id); if (r.guardian_id && r.guardian_id !== r.contact_id) madeContacts.push(r.guardian_id); }
    ok("the row stores the $150 fee as the subtotal", Number(r?.subtotal_cents) === 15000, money(Number(r?.subtotal_cents)));
    ok("…$15 as the discount", Number(r?.discount_cents) === 1500, money(Number(r?.discount_cents)));
    ok("…and $135 as the total", Number(r?.total_cents) === 13500, money(Number(r?.total_cents)));
    ok("subtotal − discount === total, exactly",
      Number(r?.subtotal_cents) - Number(r?.discount_cents) === Number(r?.total_cents));
    ok("$135 was recorded as PAID — no longer clamped to the quote", String(r?.amount_paid) === "135.00", String(r?.amount_paid));
    ok("…so it is CONFIRMED, not left pending", r?.status === "confirmed", r?.status);
    ok("the note explains the figure", typeof r?.notes === "string" && r.notes.includes("$135.00") && r.notes.includes("settling up"), r?.notes);
    ok("it is filed under Term 3, the term it was sold for", Number(r?.term_id) === TERM_3, String(r?.term_id));

    const { rows: al } = await pool.query(
      `SELECT details FROM audit_logs WHERE entity='registration' AND entity_id=$1 ORDER BY id DESC LIMIT 1`, [body.registrationId]);
    ok("the audit line reports what was charged, not the list price",
      typeof al[0]?.details === "string" && al[0].details.includes("135.00") && !al[0].details.includes("30.00 NZD"),
      al[0]?.details);
  }

  // ── 3b. The skip tick, found by this harness on 2026-09-15 ────────────────
  // The form sends the deferral INSIDE `player`; the server read only the flat
  // one, so "skip the NZ Football details" was silently ignored and the save
  // was refused naming a field the tick exists to make unnecessary.
  console.log("\nThe \"skip NZ Football details\" tick");
  ok("honoured when sent the way the FORM sends it (nested in player)",
    res.ok, `HTTP ${res.status} ${body.message ?? ""}`);
  {
    const flat = await asStaff("/api/admin/registrations/manual", {
      method: "POST", body: JSON.stringify(payload(13500, "Attended all term, settling up", 13500, "flat")),
    });
    const flatBody: any = await flat.json().catch(() => ({}));
    ok("…and still honoured at the top level (the old shape)", flat.ok, `HTTP ${flat.status} ${flatBody.message ?? ""}`);
    if (flatBody.registrationId) {
      madeRegistrations.push(flatBody.registrationId);
      const { rows } = await pool.query(`SELECT contact_id, guardian_id FROM registrations WHERE id=$1`, [flatBody.registrationId]);
      if (rows[0]) { madeContacts.push(rows[0].contact_id); if (rows[0].guardian_id && rows[0].guardian_id !== rows[0].contact_id) madeContacts.push(rows[0].guardian_id); }
    }
    ok("neither shape invented an identity for the child",
      !flatBody.nzfMissing || flatBody.nzfMissing.length > 0, JSON.stringify(flatBody.nzfMissing ?? []));
  }

  // ── 4. What Olga's real rows still say ────────────────────────────────────
  console.log("\nHer two real rows from 15 September (reported, not changed)");
  const { rows: hers } = await pool.query(
    `SELECT r.id, c.first_name||' '||c.last_name AS person, p.name AS programme,
            r.subtotal_cents, r.discount_cents, r.total_cents, r.amount_paid
     FROM registrations r
     JOIN users u ON u.id = r.served_by_user_id
     LEFT JOIN contacts c ON c.id = r.contact_id
     LEFT JOIN programs p ON p.id = r.program_id
     WHERE u.email='olgastreletsky@gmail.com' AND r.registered_at >= '2026-09-15'
     ORDER BY r.id`);
  for (const h of hers) {
    console.log(`        #${h.id}  ${h.person} · ${h.programme} · fee ${money(h.subtotal_cents)} → charged ${money(h.total_cents)} · paid $${h.amount_paid}`);
  }
  ok("both are still on file, untouched", hers.length === 2, `${hers.length} found`);

  await cleanup();
  const { rows: gone } = await pool.query(
    `SELECT count(*)::int n FROM registrations WHERE id = ANY($1::int[])`, [madeRegistrations]);
  ok("the probe registration was removed from production", Number(gone[0].n) === 0);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); await pool.end().catch(() => {}); process.exit(1); });

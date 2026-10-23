// Venue bookings: make the status tell the truth about the money.
//
// Daniel, 2026-10-22, of the USC Bookings tab: "why this say cancelled, does
// it mean they didn't pay?" and "please check all of it". Every website
// booking was checked against Stripe that afternoon. The findings:
//
//   • Two bugs released slots that were then PAID for:
//       1. The 30-minute abandoned-cart sweep released every Player Pay
//          booking (the row carries no PaymentIntent — each squad member pays
//          their own) — James Na #5789, five shares of $37.38, $186.90 landed.
//       2. A declined first attempt cancelled the group, the customer retried
//          on the SAME PaymentIntent and paid — adib ahlami #5434 ($85.10,
//          charge ch_3TwddQB0V2tnya311wztFffv) and James Burns #5507 ($25.00,
//          charge ch_3U4VbjB0V2tnya311q0VkK1p).
//     Nobody else was ever booked onto those three slots. The money is on the
//     club's Stripe account and none of it was refunded, so the TRUE state of
//     all three rows is PAID.
//   • Cory Wu #5791: Player Pay split 51 still open (0 of 10 paid, nothing
//     charged) but the sweep had already released his pitch. Restored to
//     pending while the split is open; the split's own deadline governs.
//   • The other 11 cancelled website bookings never paid (Stripe: canceled
//     "abandoned", requires_payment_method, or an empty expired split).
//
// This script, in ONE transaction:
//   1. adds facility_bookings.cancel_reason (nullable text, no default);
//   2. repairs the four rows above — each flip guarded by what the database
//      and Stripe say today, and a clash check on the slot;
//   3. backfills cancel_reason on cancelled website rows it can explain.
//
// Dry run (default): npx tsx --env-file=.env script/apply-venue-booking-truth.ts
// Apply:             npx tsx --env-file=.env script/apply-venue-booking-truth.ts --commit
import "dotenv/config";
import pg from "pg";
import { cellsOverlap } from "../shared/field-cells";

const COMMIT = process.argv.includes("--commit");

// Facts read off Stripe on 2026-10-22 (charge ids in the header). paid_at is
// the moment the money landed, not the moment this script ran.
const REPAIRS: { id: number; expectPi: string | null; paidAtIso: string; why: string }[] = [
  { id: 5789, expectPi: null, paidAtIso: "2026-10-20T01:22:02.506Z", why: "Player Pay split 50 settled — 5 of 5 shares paid, $186.90" },
  { id: 5507, expectPi: "pi_3U4VbjB0V2tnya311quXrpvg", paidAtIso: "2026-08-15T00:42:29Z", why: "card succeeded on retry after a decline — $25.00" },
  { id: 5434, expectPi: "pi_3TwddQB0V2tnya311rfmTjXf", paidAtIso: "2026-07-24T07:36:47Z", why: "card succeeded on retry after a decline — $85.10" },
];
const CORY = { id: 5791, splitId: 51 };
// Stripe's own verdict on the one decline we could see (generic_decline, never charged).
const DECLINED_IDS = [5625];

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  let failures = 0;
  const check = (ok: boolean, label: string) => { console.log(`  ${ok ? "ok  " : "✗   "}${label}`); if (!ok) failures++; };

  try {
    await c.query("BEGIN");

    // ── 1. the column ──────────────────────────────────────────────────────
    await c.query(`ALTER TABLE facility_bookings ADD COLUMN IF NOT EXISTS cancel_reason text`);
    const col = await q(`SELECT 1 FROM information_schema.columns WHERE table_name='facility_bookings' AND column_name='cancel_reason'`);
    check(col.length === 1, "facility_bookings.cancel_reason exists");

    // ── 2. the repairs ─────────────────────────────────────────────────────
    console.log("\nRepairs:");
    for (const r of REPAIRS) {
      const [b] = await q(`SELECT * FROM facility_bookings WHERE id=$1`, [r.id]);
      if (!b) { check(false, `#${r.id} exists`); continue; }
      if (b.status === "paid") { check(true, `#${r.id} ${b.customer_name}: already paid — left alone`); continue; }
      check(b.status === "cancelled" && b.paid_at === null, `#${r.id} ${b.customer_name}: is cancelled with no paid_at`);
      if (r.expectPi) check(b.stripe_payment_intent_id === r.expectPi, `#${r.id}: carries ${r.expectPi}`);
      else {
        const [s] = await q(`SELECT status FROM split_sessions WHERE facility_booking_group_id=$1`, [b.booking_group_id]);
        check(s?.status === "settled", `#${r.id}: its Player Pay split is settled`);
      }
      // the slot must still be free of any LIVE booking (it is — checked 22 Oct — but prove it)
      const live = await q(
        `SELECT * FROM facility_bookings WHERE facility_id=$1 AND booking_date=$2 AND status IN ('pending','confirmed','paid') AND id<>$3`,
        [b.facility_id, b.booking_date, b.id]);
      const clash = live.find((e: any) => e.start_time < b.end_time && e.end_time > b.start_time && cellsOverlap(e.half_full, e.half_position, b.half_full, b.half_position));
      check(!clash, `#${r.id}: nobody else holds that slot${clash ? ` (clash with #${clash.id})` : ""}`);
      if (clash) continue;
      const upd = await q(`UPDATE facility_bookings SET status='paid', paid_at=$2, cancel_reason=NULL WHERE id=$1 AND status='cancelled' RETURNING id, status, paid_at`, [r.id, r.paidAtIso]);
      check(upd.length === 1 && upd[0].status === "paid", `#${r.id} → PAID (${r.why})`);
    }

    // Cory Wu: pending again while his split is open; if the deadline has
    // already passed, the row stays released and says why.
    const [cory] = await q(`SELECT b.status, b.paid_at, s.status AS split_status, s.deadline_at FROM facility_bookings b JOIN split_sessions s ON s.id=$2 WHERE b.id=$1`, [CORY.id, CORY.splitId]);
    if (cory) {
      if (cory.status === "cancelled" && cory.split_status === "open" && new Date(cory.deadline_at) > new Date()) {
        const upd = await q(`UPDATE facility_bookings SET status='pending', cancel_reason=NULL WHERE id=$1 AND status='cancelled' RETURNING id`, [CORY.id]);
        check(upd.length === 1, `#${CORY.id} Cory Wu → PENDING (Player Pay open until ${new Date(cory.deadline_at).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" })})`);
      } else if (cory.status === "cancelled" && cory.split_status !== "settled") {
        const upd = await q(`UPDATE facility_bookings SET cancel_reason='player_pay_expired' WHERE id=$1 AND status='cancelled' AND cancel_reason IS NULL RETURNING id`, [CORY.id]);
        check(true, `#${CORY.id} Cory Wu: split ${cory.split_status}, deadline passed — stays released${upd.length ? " (reason stamped)" : ""}`);
      } else {
        check(true, `#${CORY.id} Cory Wu: ${cory.status} / split ${cory.split_status} — left alone`);
      }
    }

    // ── 3. backfill reasons the data can justify ───────────────────────────
    console.log("\nBackfill cancel_reason (website rows, still cancelled, never paid):");
    const bf = await q(`
      UPDATE facility_bookings b SET cancel_reason = CASE
        WHEN EXISTS (SELECT 1 FROM split_sessions s WHERE s.facility_booking_group_id = b.booking_group_id AND s.status = 'cancelled') THEN 'player_pay_cancelled'
        WHEN b.id = ANY($1::int[]) THEN 'card_declined'
        ELSE 'abandoned' END
      WHERE b.source = 'public' AND b.status = 'cancelled' AND b.paid_at IS NULL AND b.cancel_reason IS NULL
      RETURNING b.id, b.customer_name, b.cancel_reason`, [DECLINED_IDS]);
    for (const r of bf) console.log(`  #${r.id} ${r.customer_name} → ${r.cancel_reason}`);
    const other = await q(`SELECT count(*)::int AS n FROM facility_bookings WHERE status='cancelled' AND cancel_reason IS NULL`);
    console.log(`  (${other[0].n} cancelled row(s) outside the website channel left without a reason)`);

    // ── invariants ─────────────────────────────────────────────────────────
    console.log("\nInvariants:");
    const bad1 = await q(`SELECT id FROM facility_bookings WHERE status='paid' AND cancel_reason IS NOT NULL`);
    check(bad1.length === 0, "no paid row carries a cancel reason");
    const bad2 = await q(`SELECT id FROM facility_bookings WHERE status<>'cancelled' AND cancel_reason IS NOT NULL`);
    check(bad2.length === 0, "only cancelled rows carry a reason");
    const paidNoDate = await q(`SELECT id FROM facility_bookings WHERE id = ANY($1::int[]) AND status='paid' AND paid_at IS NULL`, [REPAIRS.map(r => r.id)]);
    check(paidNoDate.length === 0, "every repaired row has its paid_at");
    const settledUnpaid = await q(`
      SELECT b.id FROM facility_bookings b JOIN split_sessions s ON s.facility_booking_group_id=b.booking_group_id
      WHERE s.status='settled' AND b.status<>'paid'`);
    check(settledUnpaid.length === 0, "no settled Player Pay split sits on an unpaid booking");

    console.log("\nFinal state of every cancelled-or-repaired website booking:");
    const rows = await q(`
      SELECT b.id, b.customer_name, b.booking_date::text AS play, b.status, b.cancel_reason, b.paid_at::text,
             s.status AS split, (SELECT count(*) FROM split_members m WHERE m.split_session_id=s.id AND m.status='paid') AS paid_shares
      FROM facility_bookings b LEFT JOIN split_sessions s ON s.facility_booking_group_id=b.booking_group_id
      WHERE b.source='public' AND (b.status='cancelled' OR b.id = ANY($1::int[]) OR b.id=$2) ORDER BY b.created_at DESC`, [REPAIRS.map(r => r.id), CORY.id]);
    for (const r of rows) console.log(`  #${r.id} ${String(r.customer_name).padEnd(22)} ${r.play}  ${String(r.status).padEnd(9)} ${String(r.cancel_reason ?? "").padEnd(21)} ${r.split ? `split ${r.split} ${r.paid_shares} paid` : ""} ${r.paid_at ? `paid ${r.paid_at}` : ""}`);

    if (failures > 0) throw new Error(`${failures} check(s) failed — rolled back`);
    if (!COMMIT) { await c.query("ROLLBACK"); console.log("\nDRY RUN — rolled back. Re-run with --commit to apply."); }
    else { await c.query("COMMIT"); console.log("\nCOMMITTED."); }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

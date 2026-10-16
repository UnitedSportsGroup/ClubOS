// Ballers Youth League cancelled (Daniel, 16 Oct 2026 — not enough sign-ups).
// Refund EVERY Ballers registration in full and mark it refunded in ClubOS.
//
// Per registration: cancel the weekly subscription (no more charges) → refund the
// checkout PaymentIntent → refund every paid subscription invoice → write
// status='refunded' + refunded_at/amount/by/reason/stripe_refund_id.
// The amount refunded is what Stripe actually holds, not total_cents (a weekly
// family paid $30 of $100). Idempotency keys make a re-run a no-op, and a charge
// already refunded is skipped. No email is sent (the stock refund email is CUFC-
// branded; the cancellation message is Daniel's call).
//
// Dry run (default): npx tsx script/refund-ballers-cancelled.ts
// Apply:             npx tsx script/refund-ballers-cancelled.ts --apply
import "dotenv/config"; import { Pool } from "pg"; import Stripe from "stripe";

const APPLY = process.argv.includes("--apply");
const PROGRAM_IDS = [44, 45, 46, 47];
const REFUNDED_BY = 1; // Daniel — his decision
const REASON = "Ballers Youth League cancelled — not enough registrations";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const $ = (c: number) => `$${(c / 100).toFixed(2)}`;

async function invoicePIs(invId: string): Promise<string[]> {
  const inv: any = await stripe.invoices.retrieve(invId, { expand: ["payments"] });
  const out = new Set<string>();
  if (typeof inv.payment_intent === "string") out.add(inv.payment_intent);
  if (inv.payment_intent?.id) out.add(inv.payment_intent.id);
  for (const p of inv.payments?.data ?? []) {
    const pi = p.payment?.payment_intent; if (pi) out.add(typeof pi === "string" ? pi : pi.id);
  }
  return [...out];
}

async function refundPI(piId: string, regId: number, label: string) {
  const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge"] });
  const ch: any = pi.latest_charge;
  if (pi.status !== "succeeded" || !ch) { console.log(`    ${label} ${piId}: ${pi.status}, nothing to refund`); return { cents: 0, id: null as string | null }; }
  const left = ch.amount - ch.amount_refunded;
  if (left <= 0) { console.log(`    ${label} ${piId}: already refunded`); return { cents: 0, id: null }; }
  if (!APPLY) { console.log(`    ${label} ${piId}: would refund ${$(left)}`); return { cents: left, id: null }; }
  const r = await stripe.refunds.create(
    { payment_intent: piId, amount: left, reason: "requested_by_customer", metadata: { registrationId: String(regId), why: "ballers-cancelled" } },
    { idempotencyKey: `ballers-cancel-${regId}-${piId}-${left}` });
  console.log(`    ${label} ${piId}: refunded ${$(left)} (${r.id} ${r.status})`);
  return { cents: left, id: r.id, status: r.status };
}

(async () => {
  const regs = (await pool.query(
    `select id, program_id, status, total_cents, stripe_payment_intent_id pi, stripe_subscription_id sub, coalesce(refunded_amount_cents,0) already
       from registrations where program_id = any($1::int[]) and status in ('confirmed','partially_refunded') order by id`, [PROGRAM_IDS])).rows;
  let grand = 0;
  for (const r of regs) {
    console.log(`reg #${r.id} (program ${r.program_id})`);
    let cents = 0; let mainRefund: any = null;
    if (r.sub) {
      const s = await stripe.subscriptions.retrieve(r.sub);
      if (s.status !== "canceled") {
        if (APPLY) await stripe.subscriptions.cancel(r.sub);
        console.log(`    subscription ${r.sub}: ${APPLY ? "CANCELLED" : "would cancel"} (was ${s.status})`);
      }
      const invs = await stripe.invoices.list({ subscription: r.sub, limit: 50 });
      for (const inv of invs.data.filter((i) => i.status === "paid" && i.amount_paid > 0)) {
        for (const piId of await invoicePIs(inv.id!)) cents += (await refundPI(piId, r.id, `weekly ${inv.number}`)).cents;
      }
    }
    if (r.pi) { mainRefund = await refundPI(r.pi, r.id, "checkout"); cents += mainRefund.cents; }
    grand += cents;
    if (APPLY) {
      await pool.query(
        `update registrations set status='refunded', refunded_at=now(), refunded_amount_cents=$2, refund_reason=$3,
            refunded_by=$4, stripe_refund_id=coalesce($5, stripe_refund_id), stripe_refund_status=coalesce($6, stripe_refund_status),
            balance_status='none'
          where id=$1`,
        [r.id, Number(r.already) + cents, REASON, REFUNDED_BY, mainRefund?.id ?? null, mainRefund?.status ?? null]);
      console.log(`    ✓ ClubOS: marked refunded (${$(Number(r.already) + cents)})`);
    }
  }
  console.log(`\n${regs.length} registrations · ${APPLY ? "refunded" : "would refund"} ${$(grand)}${APPLY ? "" : "  (DRY RUN — re-run with --apply)"}`);
  await pool.end();
})().catch((e) => { console.error("FAILED:", e.message || e); process.exit(1); });

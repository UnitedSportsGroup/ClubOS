// Proves the reader path against REAL Stripe, in test mode, with a simulated
// S700 — the same calls server/pos-routes.ts makes, in the same order:
//   create Location → register reader by code → show the cart → charge →
//   the customer taps → Stripe says succeeded → clean up.
//
//   STRIPE_TEST_SECRET_KEY=sk_test_… npx tsx script/_verify-pos-reader-stripe.ts
//
// Refuses a live key: a simulated reader cannot exist in live mode, and this
// script creates and deletes Terminal objects.
import Stripe from "stripe";
import { readerCart, POS_DEFAULT_READER_ADDRESS } from "../shared/pos";

const key = process.env.STRIPE_TEST_SECRET_KEY ?? "";
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  console.error("Set STRIPE_TEST_SECRET_KEY to a TEST key (sk_test_…). Refusing to run against live.");
  process.exit(2);
}
const stripe = new Stripe(key, { apiVersion: "2025-04-30.basil" as any });

let pass = 0, fail = 0;
const ok = (name: string, cond: unknown, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let locationId: string | null = null, readerId: string | null = null;
  try {
    // 1. Location, exactly as the pair route files it.
    const loc = await stripe.terminal.locations.create({ display_name: "ClubOS verify — delete me", address: { ...POS_DEFAULT_READER_ADDRESS } });
    locationId = loc.id;
    ok("Location created at the USC address", loc.address.line1 === POS_DEFAULT_READER_ADDRESS.line1 && loc.address.country === "NZ");

    // 2. Pair by registration code (the simulated S700's code).
    const reader: any = await stripe.terminal.readers.create({ registration_code: "simulated-s700", label: "Office counter (verify)", location: loc.id });
    readerId = reader.id;
    ok("Reader registered by pairing code", !!reader.id && reader.location === loc.id, JSON.stringify({ id: reader.id, loc: reader.location }));
    ok("Reader is test-mode", reader.livemode === false);

    // 3. A bad code is refused (the pair route turns this into plain words).
    let refused = false;
    try { await stripe.terminal.readers.create({ registration_code: "not-a-real-code-xyz", location: loc.id }); } catch (e: any) { refused = /registration/i.test(e?.message ?? "") || e?.type === "StripeInvalidRequestError"; }
    ok("A wrong pairing code is refused", refused);

    // 4. The cart the parent sees — built by the same readerCart() the route uses.
    const sale = {
      lines: [
        { title: "U4–U8 FUNiño — Term 4", detail: "Jack", qty: 1, unitCents: 16000 },
        { title: "CUFC Training Shirt", detail: "Youth M", qty: 2, unitCents: 3500 },
      ],
      discountCents: 1000, totalCents: 16000 + 7000 - 1000,
    };
    const cart = readerCart(sale);
    ok("Cart carries each line plus a discount note", cart.line_items.length === 3 && cart.total === 22000);
    const shown: any = await stripe.terminal.readers.setReaderDisplay(reader.id, { type: "cart", cart } as any);
    ok("Reader accepts the cart display", shown.action?.type === "set_reader_display", JSON.stringify(shown.action?.type));

    // 5. Charge exactly as the card route does, then the customer taps.
    const pi = await stripe.paymentIntents.create({ amount: sale.totalCents, currency: "nzd", payment_method_types: ["card_present"], capture_method: "automatic", description: "Register verify", metadata: { kind: "pos_sale", verify: "1" } });
    const proc: any = await stripe.terminal.readers.processPaymentIntent(reader.id, { payment_intent: pi.id });
    ok("Reader starts taking the payment", proc.action?.type === "process_payment_intent");
    await stripe.testHelpers.terminal.readers.presentPaymentMethod(reader.id);
    let status = "";
    for (let i = 0; i < 15 && status !== "succeeded"; i++) { await sleep(1000); status = (await stripe.paymentIntents.retrieve(pi.id)).status; }
    ok("Payment succeeds after the tap (read back from Stripe)", status === "succeeded", status);

    // 6. Cancel path: a second intent, cancelled at the reader, is not charged.
    const pi2 = await stripe.paymentIntents.create({ amount: 500, currency: "nzd", payment_method_types: ["card_present"] });
    await stripe.terminal.readers.processPaymentIntent(reader.id, { payment_intent: pi2.id });
    await stripe.terminal.readers.cancelAction(reader.id);
    await stripe.paymentIntents.cancel(pi2.id);
    ok("A cancelled reader payment is not charged", (await stripe.paymentIntents.retrieve(pi2.id)).status === "canceled");

    // 7. Refund of the successful one, as a refund at the till would.
    const r = await stripe.refunds.create({ payment_intent: pi.id, amount: 1000 });
    ok("Part refund against a reader payment", r.status === "succeeded" || r.status === "pending", r.status ?? "");
  } catch (e: any) {
    fail++; console.log(`  ✗ threw: ${e?.message ?? e}`);
  } finally {
    if (readerId) await stripe.terminal.readers.del(readerId).catch(() => {});
    if (locationId) await stripe.terminal.locations.del(locationId).catch(() => {});
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
}
main();

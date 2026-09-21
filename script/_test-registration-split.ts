/** Unit checks for shared/registration-split.ts — pure, no DB. */
import { splitRegistrationMoney, lineCents, statusFor } from "../shared/registration-split";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); } };

const L = (id: number, price: number, refunded: number, moving: boolean) => ({ id, priceCents: price, refundedCents: refunded, moving });

// #619 exactly: $600, two children × 10 afternoons at $30, one day each refunded ($60 total).
{
  const lines = [
    ...Array.from({ length: 10 }, (_, i) => L(100 + i, 3000, i === 0 ? 3000 : 0, false)), // Eden
    ...Array.from({ length: 10 }, (_, i) => L(200 + i, 3000, i === 0 ? 3000 : 0, true)),  // Jack
  ];
  const r = splitRegistrationMoney({ subtotalCents: 60000, discountCents: 0, totalCents: 60000, amountPaidCents: 60000, refundedCents: 6000 }, lines);
  ok("619: Jack's total is $300", r.moving.totalCents === 30000, String(r.moving.totalCents));
  ok("619: Jack's paid is $300", r.moving.amountPaidCents === 30000);
  ok("619: Jack carries HIS $30 refund only", r.moving.refundedCents === 3000);
  ok("619: Eden keeps hers", r.staying.refundedCents === 3000 && r.staying.totalCents === 30000);
  ok("619: both sides partially_refunded", r.moving.status === "partially_refunded" && r.staying.status === "partially_refunded");
  ok("619: line ids partitioned", r.moving.lineIds.length === 10 && r.staying.lineIds.length === 10);
}

// Uneven: one child 3 days, sibling 7, a $25 discount and an odd cent total.
{
  const lines = [...Array.from({ length: 3 }, (_, i) => L(i, 5000, 0, true)), ...Array.from({ length: 7 }, (_, i) => L(10 + i, 5000, 0, false))];
  const reg = { subtotalCents: 50000, discountCents: 2500, totalCents: 47500, amountPaidCents: 47500, refundedCents: 0 };
  const r = splitRegistrationMoney(reg, lines);
  ok("uneven: moving total pro rata (3/10 of $475 = $142.50)", r.moving.totalCents === 14250, String(r.moving.totalCents));
  ok("uneven: sums hold on every field",
    (["subtotalCents", "discountCents", "totalCents", "amountPaidCents", "refundedCents"] as const).every((k) => r.moving[k] + r.staying[k] === reg[k]));
  ok("uneven: both confirmed", r.moving.status === "confirmed" && r.staying.status === "confirmed");
}

// An UNTIED refund (Part amount) stays on the original, never guessed onto the mover.
{
  const lines = [L(1, 3000, 0, true), L(2, 3000, 0, false)];
  const r = splitRegistrationMoney({ subtotalCents: 6000, discountCents: 0, totalCents: 6000, amountPaidCents: 6000, refundedCents: 2000 }, lines);
  ok("untied refund stays put", r.moving.refundedCents === 0 && r.staying.refundedCents === 2000);
  ok("untied: mover reads confirmed, original partially_refunded", r.moving.status === "confirmed" && r.staying.status === "partially_refunded");
}

// A fully refunded child moving: their side reads refunded, not confirmed.
{
  const lines = [L(1, 3000, 3000, true), L(2, 3000, 0, false)];
  const r = splitRegistrationMoney({ subtotalCents: 6000, discountCents: 0, totalCents: 6000, amountPaidCents: 6000, refundedCents: 3000 }, lines);
  ok("fully refunded mover reads refunded", r.moving.status === "refunded" && r.staying.status === "confirmed");
}

// Rounding cannot lose a cent: three-way odd split.
{
  const lines = [L(1, 3333, 0, true), L(2, 3333, 0, false), L(3, 3334, 0, false)];
  const reg = { subtotalCents: 10000, discountCents: 1, totalCents: 9999, amountPaidCents: 9999, refundedCents: 0 };
  const r = splitRegistrationMoney(reg, lines);
  ok("odd cents: sums hold", r.moving.totalCents + r.staying.totalCents === 9999 && r.moving.discountCents + r.staying.discountCents === 1);
}

// Refusals.
{
  let threw = false;
  try { splitRegistrationMoney({ subtotalCents: 1, discountCents: 0, totalCents: 1, amountPaidCents: 1, refundedCents: 0 }, [L(1, 1, 0, true)]); } catch { threw = true; }
  ok("refuses when everything moves (that is a move, not a split)", threw);
  threw = false;
  try { splitRegistrationMoney({ subtotalCents: 6000, discountCents: 0, totalCents: 6000, amountPaidCents: 6000, refundedCents: 1000 }, [L(1, 3000, 3000, true), L(2, 3000, 0, false)]); } catch { threw = true; }
  ok("refuses when lines claim more refund than the registration records", threw);
}

// lineCents + statusFor.
{
  const m = new Map([["AFTERNOON", 3000], ["FULL_DAY", 5000]]);
  ok("lineCents: stamped price wins", lineCents({ priceCents: 2500, productType: "AFTERNOON" }, m) === 2500);
  ok("lineCents: null price → programme price", lineCents({ priceCents: null, productType: "FULL_DAY" }, m) === 5000);
  ok("lineCents: unknown product → 0, never a guess", lineCents({ priceCents: null, productType: "MYSTERY" }, m) === 0);
  ok("statusFor: 0 refund → confirmed", statusFor(3000, 0) === "confirmed");
  ok("statusFor: full → refunded", statusFor(3000, 3000) === "refunded");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

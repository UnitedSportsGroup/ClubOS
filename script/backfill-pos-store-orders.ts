// File every PAID till sale's shop items as Store orders — the same function
// the till now calls on payment (recordPosSaleAsShopOrders), so history and
// new sales are one shape. Idempotent: a sale already filed is skipped by the
// (pos_sale_id, organization_id) unique index. Fully refunded sales are filed
// as refunded so the Store's numbers match the till's.
//   npx tsx --env-file=.env script/backfill-pos-store-orders.ts            # list only
//   npx tsx --env-file=.env script/backfill-pos-store-orders.ts --commit
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { recordPosSaleAsShopOrders, markPosSaleShopOrdersRefunded } from "../server/shop-routes";

const commit = process.argv.includes("--commit");
const sales = (await db.execute(sql`
  SELECT s.id, s.sale_number, s.paid_at, s.discount_cents, s.subtotal_cents, s.paid_cents, s.refunded_cents,
         s.customer_name, s.customer_email, s.customer_phone
    FROM pos_sales s
   WHERE s.paid_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM pos_sale_lines l WHERE l.sale_id = s.id AND l.kind = 'variant')
     AND NOT EXISTS (SELECT 1 FROM shop_orders o WHERE o.pos_sale_id = s.id)
   ORDER BY s.id`)).rows as any[];
console.log(`${sales.length} paid till sale(s) with shop items not yet in the Store`);
for (const s of sales) {
  const lines = (await db.execute(sql`
    SELECT kind, organization_id, variant_id, product_id, title, detail, unit_cents, qty, line_cents
      FROM pos_sale_lines WHERE sale_id = ${s.id} ORDER BY sort, id`)).rows as any[];
  console.log(`  ${s.sale_number}  $${(s.paid_cents / 100).toFixed(2)}${s.refunded_cents ? `  refunded $${(s.refunded_cents / 100).toFixed(2)}` : ""}`);
  if (!commit) continue;
  await recordPosSaleAsShopOrders({
    id: s.id, saleNumber: s.sale_number, paidAt: s.paid_at, discountCents: s.discount_cents, subtotalCents: s.subtotal_cents,
    customerName: s.customer_name, customerEmail: s.customer_email, customerPhone: s.customer_phone,
    lines: lines.map((l) => ({
      kind: l.kind, organizationId: l.organization_id, variantId: l.variant_id, productId: l.product_id,
      title: l.title, detail: l.detail, unitCents: l.unit_cents, qty: l.qty, lineCents: l.line_cents,
    })),
  });
  if (s.refunded_cents >= s.paid_cents) await markPosSaleShopOrdersRefunded(s.id);
}
console.log(commit ? "\nDone." : "\nList only. Re-run with --commit.");
process.exit(0);

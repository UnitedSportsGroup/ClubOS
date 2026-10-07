// Proves the United Prints order-number fix (2026-10-07) and the tee studio's
// back-print pricing. READ-ONLY against production — nothing is written.
//   npx tsx --env-file=.env script/_test-print-order-number.ts
import { maxSequence, formatPrintOrderNumber, nextPrintOrderNumber } from "../server/print-order-number";
import { quotePrintItem } from "../server/print-pricing";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };

// The exact shape that broke: 10 rows, numbers to 0012, one row with no number.
const nums = ["UP-2026-0001", "UP-2026-0003", null, "UP-2026-0012", "UP-2026-0011", "UP-2025-0099", "CUSTOM"];
ok(maxSequence(nums, 2026) === 12, "max is read from the numbers used, not the row count");
ok(formatPrintOrderNumber(2026, 13) === "UP-2026-0013", "formats as UP-YYYY-NNNN");
ok(maxSequence([], 2027) === 0, "a new year starts at 0001");
ok(maxSequence(["UP-2026-10000"], 2026) === 10000, "past 9999 still counts up");

const next = await nextPrintOrderNumber();
const r: any = await db.execute(sql`SELECT count(*)::int n FROM print_orders WHERE order_number = ${next}`);
ok(Number((r.rows ?? r)[0].n) === 0, `next number ${next} is not already taken (live DB)`);
const c: any = await db.execute(sql`SELECT count(*)::int n FROM print_orders WHERE organization_id = 8`);
const old = `UP-${new Date().getFullYear()}-${String(Number((c.rows ?? c)[0].n) + 1).padStart(4, "0")}`;
const o: any = await db.execute(sql`SELECT count(*)::int n FROM print_orders WHERE order_number = ${old}`);
console.log(`      (the old count+1 scheme would have used ${old} — taken: ${Number((o.rows ?? o)[0].n) > 0})`);

// Pricing — the live studio tee.
const m: any = await db.execute(sql`SELECT * FROM print_materials WHERE slug = 'tee-as-colour-staple'`);
const row = (m.rows ?? m)[0];
const mat: any = {
  ...row, pricingMethod: row.pricing_method, baseRateCents: row.base_rate_cents, minChargeCents: row.min_charge_cents,
  addonsJson: row.addons_json, qtyTiersJson: row.qty_tiers_json, sizeTiersJson: row.size_tiers_json,
  humanQuoteRequired: row.human_quote_required, turnaroundDays: row.turnaround_days, rushAvailable: row.rush_available,
  category: row.category, name: row.name,
};
const front = quotePrintItem(mat, { quantity: 1, widthMm: 210, heightMm: 210 }) as any;
ok(front.ok && front.breakdown.some((b: any) => /^Decoration 1 ×/.test(b.label)), `label reads "Decoration", not "DTG decoration"`);
ok(!front.breakdown.some((b: any) => /DTG/.test(b.label)), "no DTG anywhere in the customer's breakdown");
const backAddon = (row.addons_json as any[]).find((a) => a.id === "extra_print_location");
const f20 = quotePrintItem(mat, { quantity: 20, widthMm: 210, heightMm: 210 }) as any;
const b20 = quotePrintItem(mat, { quantity: 20, widthMm: 210, heightMm: 210, selectedAddonIds: ["extra_print_location"] }) as any;
ok(b20.subtotalCents - f20.subtotalCents === backAddon.unitPriceCents * 20,
  `20 shirts front+back = front + 20 × Dima's "Second print location" ($${(backAddon.unitPriceCents / 100).toFixed(2)})`);
console.log(`      20 shirts: front only $${(f20.subtotalCents / 100).toFixed(2)} · front+back $${(b20.subtotalCents / 100).toFixed(2)} ex GST`);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);

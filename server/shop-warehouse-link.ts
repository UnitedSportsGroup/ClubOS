// The warehouse ⇄ shop link (2026-11-04). Daniel: "It should all be connected:
// the warehouse, the shop, the shop to the warehouse, and the warehouse to
// the shop … one system."
//
// For a shop switched on in WH_STOCK_BRANDS (comma list, e.g. "cufc"):
//   • the WAREHOUSE is the stock of record. After any movement, the item's
//     available quantity (on hand in real places − active reservations) is
//     written to shop_variants.stock — server/warehouse-sync.ts pushItemUsing.
//   • every sale TAKES stock out of the warehouse as a 'sale' movement:
//     a paid online order, a till sale. A cancel/refund puts it back
//     ('return'). That movement then pushes the new figure to the shop.
// A shop NOT in the list behaves exactly as before (its own stock column).
// 🔴 Switch a shop on only once its warehouse stock is real (imported from
// Shopify or counted) — otherwise every product on it shows sold out.
import { sql } from "drizzle-orm";

export function warehouseDrivenBrands(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(String(env.WH_STOCK_BRANDS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}
export function warehouseDrivesShop(brand: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return !!brand && warehouseDrivenBrands(env).has(brand.toLowerCase());
}

/** The location a sale comes OUT of: the preferred place (the till's own
 *  location) when it holds some, else wherever has the most on hand. */
async function pickLocation(db: any, itemId: number, prefer?: string) {
  const rows = (await db.execute(sql`
    SELECT l.id, l.code, coalesce(s.on_hand, 0) AS on_hand
    FROM wh_locations l LEFT JOIN wh_stock s ON s.location_id = l.id AND s.item_id = ${itemId}
    WHERE l.kind <> 'virtual' AND l.active AND upper(l.code) <> 'QUARANTINE'
    ORDER BY (l.code = ${prefer ?? ""} AND coalesce(s.on_hand, 0) > 0) DESC, coalesce(s.on_hand, 0) DESC, l.id`)).rows as Array<{ id: number; code: string; on_hand: string }>;
  return rows[0] ?? null;
}

/**
 * Record shop sales (or their reversal) in the warehouse ledger. Best-effort by
 * design: a paid order must never fail because the warehouse write did — the
 * failure is logged and the next stock take or re-push heals it.
 * `sign` −1 = a sale, +1 = a cancel/refund putting it back.
 */
export async function recordShopMovement(args: {
  lines: { variantId: number; qty: number }[];
  sign: -1 | 1;
  ref: { kind: "shop_order"; id: number } | null;
  operatorUserId: number | null;
  note: string;
  idempotencyKey: string;
  preferLocation?: string;
}): Promise<void> {
  try {
    const { db } = await import("./db");
    const { runMovementGroup } = await import("./warehouse");
    const legs: { itemId: number; locationId: number; locationCode: string; delta: number; allowNegative: boolean }[] = [];
    for (const l of args.lines) {
      if (!(l.qty > 0)) continue;
      const row = (await db.execute(sql`
        SELECT w.id AS item_id, w.brand_owner, v.continue_selling, v.track_inventory
        FROM wh_items w JOIN shop_variants v ON v.id = w.shop_variant_id
        WHERE w.shop_variant_id = ${l.variantId} LIMIT 1`)).rows[0] as any;
      if (!row || !warehouseDrivesShop(row.brand_owner) || row.track_inventory === false) continue;
      const loc = await pickLocation(db, Number(row.item_id), args.preferLocation);
      if (!loc) continue;
      // Continue-selling lets a sale take a location below zero (Shopify's
      // oversold state); otherwise the ledger's own negative guard stands.
      legs.push({ itemId: Number(row.item_id), locationId: Number(loc.id), locationCode: loc.code, delta: args.sign * l.qty, allowNegative: args.sign < 0 });
    }
    if (legs.length === 0) return;
    let operator = args.operatorUserId;
    if (!operator) {
      const sys = (await db.execute(sql`SELECT id FROM users WHERE lower(email) = 'daniel@cufc.co.nz' LIMIT 1`)).rows[0] as any;
      operator = sys ? Number(sys.id) : null;
    }
    if (!operator) { console.error("[shop→warehouse] no operator user — movement skipped"); return; }
    await runMovementGroup({
      legs,
      movementType: args.sign < 0 ? "sale" : "return",
      ref: args.ref,
      operatorUserId: operator,
      idempotencyKey: args.idempotencyKey,
      note: args.note,
    });
  } catch (e) {
    console.error("[shop→warehouse] movement failed:", e);
  }
}

/** Was a sale for this key ever posted? A return is only ever the mirror of one. */
export async function saleWasRecorded(saleKey: string): Promise<boolean> {
  const { db } = await import("./db");
  return ((await db.execute(sql`SELECT 1 FROM wh_movements WHERE idempotency_key = ${saleKey} LIMIT 1`)).rows.length > 0);
}

/** Put a recorded sale back (cancel / refund) — exactly the lines it took. */
export async function reverseRecordedSale(saleKey: string, returnKey: string, note: string, operatorUserId: number | null): Promise<void> {
  try {
    const { db } = await import("./db");
    const { runMovementGroup } = await import("./warehouse");
    const taken = (await db.execute(sql`
      SELECT m.item_id, m.location_id, l.code, m.delta, m.ref_kind, m.ref_id, m.operator_user_id
      FROM wh_movements m JOIN wh_locations l ON l.id = m.location_id
      WHERE m.idempotency_key = ${saleKey}`)).rows as any[];
    if (taken.length === 0) return;
    await runMovementGroup({
      legs: taken.map((t) => ({ itemId: Number(t.item_id), locationId: Number(t.location_id), locationCode: t.code, delta: -Number(t.delta), allowNegative: false })),
      movementType: "return",
      ref: taken[0].ref_kind ? { kind: taken[0].ref_kind, id: Number(taken[0].ref_id) } : null,
      operatorUserId: operatorUserId ?? Number(taken[0].operator_user_id),
      idempotencyKey: returnKey,
      note,
    });
  } catch (e) {
    console.error("[shop→warehouse] reversal failed:", e);
  }
}

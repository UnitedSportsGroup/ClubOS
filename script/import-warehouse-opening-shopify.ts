// Opening stock for the warehouse, from a Shopify inventory export (2026-11-04).
//
// Daniel: "on hand showing 0 everywhere … needs to initially be taken from
// Shopify … make sure this transition goes smooth for all stock in all
// locations correctly". The plan file is built by
// outputs/warehouse/2026-11-04-shopify-opening-stock/match_cufc.py from
// Shopify's own "Export inventory → All variants" CSV, matched to wh_items on
// product handle + colour + size (343/343 stocked rows, nothing guessed).
//
// It posts, per location, ONE movement group of type 'count' / reason
// 'stock_take' — the same shape a stock take writes — moving each item's on
// hand at that location TO Shopify's "On hand (current)". Delta = target −
// what the warehouse holds now, so a re-run writes nothing, and the
// idempotency key makes a replay a no-op. Shopify's negative on-hand (sold
// more than it recorded) opens at 0 and is listed for the stock take:
// physical stock can't be negative.
//
//   npx tsx --env-file=.env script/import-warehouse-opening-shopify.ts <plan.json>            (dry run)
//   npx tsx --env-file=.env script/import-warehouse-opening-shopify.ts <plan.json> --apply
import { readFileSync } from "fs";
import { Pool } from "pg";
import { runMovementGroup } from "../server/warehouse";

const planPath = process.argv[2];
const APPLY = process.argv.includes("--apply");
const OPERATOR_EMAIL = "daniel@cufc.co.nz";
if (!planPath) throw new Error("usage: import-warehouse-opening-shopify.ts <plan.json> [--apply]");

type PlanRow = { item_id: number; sku: string; location: string; shopify_location: string; title: string; options: Record<string, string>; on_hand: number };
const { plan, unmatched } = JSON.parse(readFileSync(planPath, "utf8")) as { plan: PlanRow[]; unmatched: unknown[] };
const source = (process.argv.find((a) => a.startsWith("--source=")) ?? "--source=shopify-cufc").slice(9);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  console.log(APPLY ? "\nAPPLYING opening stock.\n" : "\nDRY RUN — nothing written. Add --apply to post.\n");
  const op = (await pool.query(`SELECT id FROM users WHERE lower(email) = $1`, [OPERATOR_EMAIL])).rows[0];
  if (!op) throw new Error(`no user ${OPERATOR_EMAIL}`);
  const locs = new Map<string, { id: number; code: string }>(
    (await pool.query(`SELECT id, code FROM wh_locations WHERE kind <> 'virtual' AND active`)).rows.map((r) => [r.code, r]),
  );
  const items = new Map<number, { allow_negative: boolean; tracking_mode: string }>(
    (await pool.query(`SELECT id, allow_negative, tracking_mode FROM wh_items`)).rows.map((r) => [Number(r.id), r]),
  );
  const stock = new Map<string, number>(
    (await pool.query(`SELECT item_id, location_id, on_hand FROM wh_stock`)).rows.map((r) => [`${r.item_id}:${r.location_id}`, Number(r.on_hand)]),
  );

  const negatives: PlanRow[] = [];
  const byLoc = new Map<string, { itemId: number; locationId: number; locationCode: string; delta: number; allowNegative: boolean }[]>();
  let target = 0;
  for (const p of plan) {
    const loc = locs.get(p.location);
    if (!loc) throw new Error(`location ${p.location} not found or inactive`);
    const it = items.get(p.item_id);
    if (!it) throw new Error(`item ${p.item_id} (${p.sku}) not found`);
    if (it.tracking_mode === "asset") throw new Error(`${p.sku} is an asset — not counted by quantity`);
    const want = Math.max(0, p.on_hand);
    if (p.on_hand < 0) negatives.push(p);
    target += want;
    const delta = want - (stock.get(`${p.item_id}:${loc.id}`) ?? 0);
    if (delta === 0) continue;
    const legs = byLoc.get(loc.code) ?? [];
    legs.push({ itemId: p.item_id, locationId: loc.id, locationCode: loc.code, delta, allowNegative: it.allow_negative });
    byLoc.set(loc.code, legs);
  }

  for (const [code, legs] of Array.from(byLoc.entries())) {
    const units = legs.reduce((n, l) => n + l.delta, 0);
    console.log(`  ${code}: ${legs.length} lines, ${units >= 0 ? "+" : ""}${units} units`);
  }
  console.log(`  target on hand after import: ${target} units across ${plan.length} item-locations`);
  console.log(`  Shopify negatives opened at 0 (count these): ${negatives.length}`);
  for (const n of negatives) console.log(`    ${n.shopify_location} · ${n.title} · ${Object.values(n.options).join(" / ")} · Shopify says ${n.on_hand}`);
  console.log(`  unmatched rows (not imported): ${unmatched.length}`);

  if (APPLY) {
    for (const [code, legs] of Array.from(byLoc.entries())) {
      const g = await runMovementGroup({
        legs,
        movementType: "count",
        reasonCode: "stock_take",
        operatorUserId: Number(op.id),
        idempotencyKey: `opening:${source}:2026-11-04:${code}`,
        note: `Opening stock from the ${source} inventory export, 4 Nov 2026 (Shopify "On hand")`,
      });
      console.log(`  posted ${code}: group ${g.groupId}${g.alreadyProcessed ? " (already posted — nothing changed)" : ""}`);
    }
    const after = (await pool.query(
      `SELECT coalesce(sum(s.on_hand),0) u FROM wh_stock s JOIN wh_items i ON i.id = s.item_id
       WHERE s.item_id = ANY($1::int[])`, [plan.map((p) => p.item_id)])).rows[0].u;
    console.log(`\n  CHECK: warehouse now holds ${Number(after)} of these items · target ${target} · ${Number(after) === target ? "MATCHES" : "MISMATCH"}`);
    if (Number(after) !== target) process.exitCode = 1;
  }
} finally {
  await pool.end();
  process.exit(process.exitCode ?? 0);
}

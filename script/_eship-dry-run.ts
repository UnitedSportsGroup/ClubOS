// Build (never send) the eShip payload for one shop order: npx tsx --env-file=.env script/_eship-dry-run.ts SIU-1004
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { buildEshipOrder, isInternational } from "../server/eship";
const num = process.argv[2];
// Raw read so this works before the migration is applied.
const r: any = await db.execute(sql`SELECT * FROM shop_orders WHERE order_number = ${num}`);
const raw = (Array.isArray(r) ? r : r.rows)[0];
const o: any = raw && Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));
if (!o) { console.error("no such order"); process.exit(1); }
const p = await buildEshipOrder(o);
// Mask the customer's personal details in the printout.
const d: any = p.order.destination;
for (const k of ["name", "email", "phone", "street"]) if (d[k]) d[k] = String(d[k]).replace(/[A-Za-z0-9]/g, (c, i) => (i < 2 ? c : "•"));
console.log(JSON.stringify({ international: isInternational(o), ...p }, null, 2));
process.exit(0);

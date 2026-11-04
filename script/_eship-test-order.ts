// End-to-end proof of the eShip keys, with no shop order and no label:
// create a clearly-marked TEST order in eShip, read it back, delete it.
//   npx tsx --env-file=.env script/_eship-test-order.ts [--keep]
// --keep leaves it in eShip's New tab so a human can see it there.
const base = (process.env.ESHIP_API_BASE || "https://api.starshipit.com").replace(/\/+$/, "");
const apiKey = process.env.ESHIP_API_KEY || "";
const subKey = process.env.ESHIP_SUBSCRIPTION_KEY || "";
if (!apiKey || !subKey) { console.error("✗ ESHIP_API_KEY / ESHIP_SUBSCRIPTION_KEY missing from .env"); process.exit(1); }
const keep = process.argv.includes("--keep");
const headers = { "Content-Type": "application/json", "StarShipIT-Api-Key": apiKey, "Ocp-Apim-Subscription-Key": subKey };
async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j: any = null; try { j = JSON.parse(t); } catch { /* */ }
  return { status: r.status, json: j, text: t.slice(0, 300) };
}
const num = `TEST-CLUBOS-${Date.now().toString().slice(-6)}`;
const created = await call("POST", "/api/orders", { order: {
  order_number: num,
  order_date: new Date().toISOString(),
  reference: "ClubOS connection test — delete me",
  shipping_method: "TEST — do not ship",
  destination: { name: "ClubOS Test", street: "466 Yaldhurst Road", suburb: "Yaldhurst", city: "Christchurch", post_code: "7676", country: "New Zealand" },
  items: [{ description: "TEST ITEM — do not ship", sku: "TEST", quantity: 1, value: 1 }],
} });
const id = created.json?.order?.order_id;
console.log(created.status === 200 && id ? `✓ created ${num} → eShip order ${id}` : `✗ create failed: HTTP ${created.status} ${created.text}`);
if (!id) process.exit(1);
const read = await call("GET", `/api/orders?order_number=${encodeURIComponent(num)}`);
console.log(read.json?.order?.order_id === id ? "✓ read back by order number" : `✗ read back: HTTP ${read.status} ${read.text}`);
const shipped = await call("GET", `/api/orders/shipped?limit=1`);
console.log(shipped.status === 200 ? "✓ shipped list readable (tracking sync will work)" : `✗ shipped list: HTTP ${shipped.status} ${shipped.text}`);
if (keep) { console.log(`… left in eShip's New tab as ${num}`); process.exit(0); }
let del = await call("DELETE", `/api/orders/delete?order_id=${id}`);
if (del.status !== 200 || del.json?.success === false) del = await call("DELETE", `/api/orders/delete`, { order_id: id });
console.log(del.status === 200 && del.json?.success !== false ? "✓ deleted the test order" : `✗ delete: HTTP ${del.status} ${del.text} — remove ${num} in eShip by hand`);

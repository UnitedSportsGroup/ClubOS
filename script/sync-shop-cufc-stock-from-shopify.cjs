// Bring the ClubOS CUFC kit (org 1) level with Shopify's live catalogue at cut-over.
//
// Source: outputs/shopify-cufc-archive/<date>/raw/products.json (the Shopify Admin API dump).
// Pairing: Shopify product handle = ClubOS shop_products.slug (seed-shop-cufc.ts used the handle),
// then variant by (colour, size) read from Shopify's option NAMES, falling back to SKU.
//
//   • stock  -> set to Shopify's inventory_quantity (a negative Shopify count — oversold — becomes 0)
//   • price  -> REPORTED, never changed (Dima/Daniel own prices; a difference is a question)
//   • a Shopify size ClubOS lacks -> reported, never invented
//
// Dry-run by default; --commit writes. Every changed row is printed.
//   cd apps/clubos && node --env-file=.env script/sync-shop-cufc-stock-from-shopify.cjs [--archive <dir>] [--commit]

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const commit = process.argv.includes("--commit");
const ai = process.argv.indexOf("--archive");
const ARCHIVE = ai > 0 ? process.argv[ai + 1]
  : path.resolve(__dirname, "../../../outputs/shopify-cufc-archive/2026-10-18");
let products = JSON.parse(fs.readFileSync(path.join(ARCHIVE, "raw/products.json"), "utf8"));
products = Array.isArray(products) ? products : products.products;
const norm = (s) => (s || "").trim().toLowerCase();

function colourSize(p, v) {
  const names = (p.options || []).map((o) => norm(o.name));
  const opt = (i) => (i >= 0 ? v[`option${i + 1}`] : null);
  const ci = names.findIndex((n) => /colou?r/.test(n));
  const si = names.findIndex((n) => /size/.test(n));
  return { colour: norm(opt(ci) || "Default"), size: norm(opt(si) || "One size") };
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const s = { shopifyVariants: 0, paired: 0, stockChanged: 0, priceDiffers: 0, unpairedVariants: 0, unpairedProducts: 0 };
  try {
    await c.query("BEGIN");
    const rows = (await c.query(
      `SELECT v.id, v.size, v.sku, v.stock, COALESCE(v.price_cents, p.price_cents) price, p.slug, p.title, col.name colour
         FROM shop_variants v JOIN shop_products p ON p.id = v.product_id
         LEFT JOIN shop_product_colours col ON col.id = v.colour_id
        WHERE p.organization_id = 1 AND p.type <> 'photo'`)).rows;
    const bySlug = new Map();
    for (const r of rows) (bySlug.get(r.slug) || bySlug.set(r.slug, []).get(r.slug)).push(r);
    for (const p of products) {
      const cand = bySlug.get(p.handle);
      if (!cand) { s.unpairedProducts++; console.log(`? product not in ClubOS: ${p.title} [${p.handle}]`); s.shopifyVariants += p.variants.length; continue; }
      for (const v of p.variants) {
        s.shopifyVariants++;
        const { colour, size } = colourSize(p, v);
        let m = cand.filter((r) => norm(r.size) === size && norm(r.colour || "default") === colour);
        if (m.length !== 1 && v.sku) m = cand.filter((r) => r.sku === v.sku);
        if (m.length !== 1 && cand.length === 1) m = cand;
        if (m.length !== 1) { s.unpairedVariants++; console.log(`? ${p.title} / ${v.title}: ${m.length} ClubOS matches`); continue; }
        const r = m[0]; s.paired++;
        const want = Math.max(0, v.inventory_quantity ?? 0);
        const price = Math.round(parseFloat(v.price) * 100);
        if (r.price !== price) { s.priceDiffers++; console.log(`$ ${r.title} ${r.colour}/${r.size}: ClubOS $${(r.price / 100).toFixed(2)} vs Shopify $${(price / 100).toFixed(2)} (not changed)`); }
        if (r.stock !== want) {
          s.stockChanged++;
          console.log(`# ${r.title} ${r.colour || ""}/${r.size}: ${r.stock} -> ${want}${v.inventory_quantity < 0 ? ` (Shopify ${v.inventory_quantity}, oversold)` : ""}`);
          await c.query("UPDATE shop_variants SET stock = $2 WHERE id = $1", [r.id, want]);
        }
      }
    }
    console.log(s);
    if (s.unpairedVariants || s.unpairedProducts) throw new Error("some Shopify stock has no home in ClubOS — fix before commit");
    await c.query(commit ? "COMMIT" : "ROLLBACK");
    console.log(commit ? "COMMITTED" : "DRY RUN — rolled back (pass --commit to write)");
  } catch (e) {
    await c.query("ROLLBACK"); console.error("ROLLED BACK:", e.message); process.exitCode = 1;
  } finally { await c.end(); }
})();

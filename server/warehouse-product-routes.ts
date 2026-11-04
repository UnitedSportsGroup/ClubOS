// Warehouse → Products → one product's page, and Add product (2026-11-04).
//
// Daniel: "make the product pages when click in also like shopify with all 1
// to 1 features" + "make the add new product flow the same as shopify".
// Decided the same day: ONE product = the shop product the storefront sells
// (shop_products / shop_product_colours / shop_variants), exactly as Shopify
// has one Products list for warehouse and website. Editing here changes the
// website; a new product starts as DRAFT so nothing goes live by accident.
//
// Stock is the warehouse's: every variant has a wh_items row (created here
// for new variants), and on hand per location comes from wh_stock. Opening
// quantities typed into Add product are posted to the append-only ledger as
// a 'count' / 'stock_take' group — the same shape a stock take writes —
// never written to wh_stock directly.
import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireTab } from "./auth";
import { runMovementGroup } from "./warehouse";
import { normaliseSku, locationLabel } from "@shared/warehouse";

// Brand ⇄ the organisation that owns its shop (server/shop-routes.ts SHOP_BRANDS).
const SHOP_ORG: Record<string, { orgId: number; storefront: string; name: string }> = {
  cufc: { orgId: 1, storefront: "https://shop.cufc.co.nz", name: "Christchurch United FC" },
  siu: { orgId: 2, storefront: "https://shop.southislandunited.com", name: "South Island United" },
  mfl: { orgId: 3, storefront: "https://shop.minifootball.co.nz", name: "Mini Football Leagues" },
  cic: { orgId: 5, storefront: "https://shop.cicyouth.com", name: "Christchurch International Cup" },
};
const brandForOrg = (orgId: number) => Object.entries(SHOP_ORG).find(([, v]) => v.orgId === orgId)?.[0] ?? null;
const STATUSES = ["active", "draft", "archived"];

class ProductError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function fail(res: Response, e: any, what: string) {
  if (e instanceof ProductError) return res.status(e.status).json({ message: e.message });
  if (e?.code === "23505") return res.status(409).json({ message: "That already exists — a product with this handle, or an item with this SKU." });
  console.error(`[warehouse products] ${what}:`, e);
  res.status(500).json({ message: `Couldn't ${what}` });
}
const rows = async (q: any) => ((await db.execute(q)).rows as Array<Record<string, any>>);
function slugify(text: string): string {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "product";
}
function cents(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) throw new ProductError("Prices can't be negative");
  return n;
}
function cleanText(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

/** A unique warehouse SKU for a new variant, in the seed's own scheme. */
async function uniqueWarehouseSku(tx: any, brand: string, variantSku: string | null, slug: string, colour: string, size: string) {
  const base = variantSku ? `${brand}-${variantSku}` : `${brand}-${slug}-${colour}-${size}`;
  let candidate = normaliseSku(base);
  for (let n = 2; ; n++) {
    const hit = (await tx.execute(sql`SELECT 1 FROM wh_items WHERE sku = ${candidate}`)).rows.length > 0;
    if (!hit) return candidate;
    const suffix = `-${n}`;
    candidate = normaliseSku(normaliseSku(base).slice(0, Math.max(1, 20 - suffix.length)) + suffix);
  }
}

async function createVariant(
  tx: any,
  p: { id: number; slug: string; title: string; type: string; brand: string },
  colourId: number, colourName: string, size: string, sku: string | null, priceCents: number | null,
) {
  const v = (await tx.execute(sql`
    INSERT INTO shop_variants (product_id, colour_id, size, sku, stock, active, price_cents)
    VALUES (${p.id}, ${colourId}, ${size}, ${sku}, 0, true, ${priceCents})
    RETURNING id`)).rows[0] as { id: number };
  const whSku = await uniqueWarehouseSku(tx, p.brand, sku, p.slug, colourName, size);
  const item = (await tx.execute(sql`
    INSERT INTO wh_items (sku, name, kind, brand_owner, category, unit, active, shop_variant_id)
    VALUES (${whSku}, ${`${p.title} — ${colourName}, ${size}`}, 'merch', ${p.brand}, ${p.type}, 'ea', true, ${v.id})
    RETURNING id`)).rows[0] as { id: number };
  return { variantId: Number(v.id), itemId: Number(item.id) };
}

async function findOrCreateColour(tx: any, productId: number, name: string) {
  const hit = (await tx.execute(sql`SELECT id FROM shop_product_colours WHERE product_id = ${productId} AND lower(name) = lower(${name}) LIMIT 1`)).rows[0];
  if (hit) return Number((hit as any).id);
  const sort = Number(((await tx.execute(sql`SELECT coalesce(max(sort_order),0)+1 AS n FROM shop_product_colours WHERE product_id = ${productId}`)).rows[0] as any).n);
  const c = (await tx.execute(sql`INSERT INTO shop_product_colours (product_id, name, sort_order, active) VALUES (${productId}, ${name}, ${sort}, true) RETURNING id`)).rows[0] as { id: number };
  return Number(c.id);
}

/** Post opening quantities (typed on Add product / a new variant) as a stock take. */
async function postOpeningStock(userId: number, productId: number, lines: { itemId: number; locationId: number; qty: number }[]) {
  const real = lines.filter((l) => Number.isFinite(l.qty) && l.qty > 0);
  if (real.length === 0) return;
  const locs = new Map((await rows(sql`SELECT id, code FROM wh_locations WHERE kind <> 'virtual'`)).map((r) => [Number(r.id), r.code as string]));
  const legs = real.map((l) => {
    const code = locs.get(l.locationId);
    if (!code) throw new ProductError("A quantity was given for a location that isn't a real place");
    return { itemId: l.itemId, locationId: l.locationId, locationCode: code, delta: l.qty, allowNegative: false };
  });
  await runMovementGroup({
    legs,
    movementType: "count",
    reasonCode: "stock_take",
    operatorUserId: userId,
    note: `Opening quantity entered on the product page (product ${productId})`,
  });
}

export function registerWarehouseProductRoutes(app: Express) {
  const gate = [requireAuth, requireTab("warehouse")];

  // What Add product needs before anything exists: the shops, each shop's
  // product types (from what it already sells), and the real locations.
  app.get("/api/admin/warehouse/product-meta", ...gate, async (_req: Request, res: Response) => {
    try {
      const types = await rows(sql`SELECT organization_id, type, count(*) n FROM shop_products GROUP BY 1,2 ORDER BY 1, 3 DESC`);
      const locations = await rows(sql`SELECT id, code, name FROM wh_locations WHERE kind <> 'virtual' AND active ORDER BY id`);
      res.json({
        shops: Object.entries(SHOP_ORG).map(([key, v]) => ({
          key, name: v.name, storefront: v.storefront,
          types: types.filter((t) => Number(t.organization_id) === v.orgId).map((t) => t.type as string),
        })),
        locations: locations.map((l) => ({ id: Number(l.id), label: locationLabel({ code: l.code, name: l.name }) })),
      });
    } catch (e) { fail(res, e, "load product settings"); }
  });

  app.get("/api/admin/warehouse/products/:id", ...gate, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Bad id" });
      const p = (await rows(sql`SELECT * FROM shop_products WHERE id = ${id}`))[0];
      if (!p) return res.status(404).json({ message: "Product not found" });
      const brand = brandForOrg(Number(p.organization_id));
      if (!brand) return res.status(404).json({ message: "Product not found" });
      const colours = await rows(sql`SELECT id, name, swatch_hex, sort_order, active FROM shop_product_colours WHERE product_id = ${id} ORDER BY sort_order, id`);
      const images = await rows(sql`SELECT id, colour_id, url, alt FROM shop_product_images WHERE product_id = ${id} ORDER BY (colour_id IS NOT NULL), sort_order, id`);
      const variants = await rows(sql`
        SELECT v.id, v.colour_id, v.size, v.sku, v.active, v.price_cents, w.id AS item_id, w.sku AS wh_sku
        FROM shop_variants v LEFT JOIN wh_items w ON w.shop_variant_id = v.id
        WHERE v.product_id = ${id} ORDER BY v.colour_id, v.id`);
      const itemIds = variants.map((v) => v.item_id).filter((x) => x != null).map(Number);
      const stock = itemIds.length
        ? await rows(sql`SELECT s.item_id, s.location_id, s.on_hand FROM wh_stock s JOIN wh_locations l ON l.id = s.location_id
                         WHERE l.kind <> 'virtual' AND s.item_id IN (${sql.join(itemIds.map((i) => sql`${i}`), sql`, `)})`)
        : [];
      const siblings = await rows(sql`SELECT id FROM shop_products WHERE organization_id = ${p.organization_id} ORDER BY sort_order, id`);
      const at = siblings.findIndex((s) => Number(s.id) === id);
      res.json({
        id, brand,
        shopName: SHOP_ORG[brand].name,
        storefrontUrl: `${SHOP_ORG[brand].storefront}/products/${p.slug}`,
        slug: p.slug, title: p.title, subtitle: p.subtitle, description: p.description,
        type: p.type, status: p.status, priceCents: Number(p.price_cents),
        compareAtCents: p.compare_at_cents == null ? null : Number(p.compare_at_cents),
        updatedAt: p.updated_at,
        prevId: at > 0 ? Number(siblings[at - 1].id) : null,
        nextId: at >= 0 && at < siblings.length - 1 ? Number(siblings[at + 1].id) : null,
        colours: colours.map((c) => ({ id: Number(c.id), name: c.name, swatchHex: c.swatch_hex, active: c.active })),
        images: images.map((im) => ({ id: Number(im.id), colourId: im.colour_id == null ? null : Number(im.colour_id), url: im.url, alt: im.alt })),
        variants: variants.map((v) => ({
          id: Number(v.id), colourId: Number(v.colour_id), size: v.size, sku: v.sku, active: v.active,
          priceCents: v.price_cents == null ? null : Number(v.price_cents),
          itemId: v.item_id == null ? null : Number(v.item_id), warehouseSku: v.wh_sku ?? null,
          stock: Object.fromEntries(stock.filter((s) => Number(s.item_id) === Number(v.item_id)).map((s) => [String(s.location_id), Number(s.on_hand)])),
        })),
      });
    } catch (e) { fail(res, e, "load the product"); }
  });

  // Body: { brand, title, description?, status?, type, priceCents, compareAtCents?,
  //         colours: string[] (may be empty), sizes: string[] (may be empty),
  //         sku?, quantities?: { [locationId]: qty } (single-variant only),
  //         variantQuantities?: { "<colour>|<size>": { [locationId]: qty } } }
  app.post("/api/admin/warehouse/products", ...gate, async (req: Request, res: Response) => {
    try {
      const b = req.body || {};
      const brand = String(b.brand || "");
      const shop = SHOP_ORG[brand];
      if (!shop) throw new ProductError("Choose which shop sells this product (Vendor)");
      const title = cleanText(b.title);
      if (!title) throw new ProductError("Title can't be blank");
      const type = cleanText(b.type) ?? "apparel";
      const status = STATUSES.includes(b.status) ? b.status : "draft";
      const priceCents = cents(b.priceCents) ?? 0;
      const compareAtCents = cents(b.compareAtCents);
      const uniq = (a: unknown) => Array.from(new Set((Array.isArray(a) ? a : []).map((x) => String(x).trim()).filter(Boolean)));
      const colours = uniq(b.colours);
      const sizes = uniq(b.sizes);
      if (colours.length * Math.max(sizes.length, 1) > 100) throw new ProductError("That's more than 100 variants — split it into separate products");

      const userId = req.session.userId!;
      const result = await db.transaction(async (tx) => {
        let slug = slugify(cleanText(b.slug) ?? title);
        for (let n = 2; (await tx.execute(sql`SELECT 1 FROM shop_products WHERE organization_id = ${shop.orgId} AND slug = ${slug}`)).rows.length; n++) {
          slug = `${slugify(title)}-${n}`;
        }
        const sort = Number(((await tx.execute(sql`SELECT coalesce(max(sort_order),0)+1 AS n FROM shop_products WHERE organization_id = ${shop.orgId}`)).rows[0] as any).n);
        const prod = (await tx.execute(sql`
          INSERT INTO shop_products (organization_id, slug, title, description, type, price_cents, compare_at_cents, status, sort_order)
          VALUES (${shop.orgId}, ${slug}, ${title}, ${cleanText(b.description)}, ${type}, ${priceCents}, ${compareAtCents}, ${status}, ${sort})
          RETURNING id`)).rows[0] as { id: number };
        const p = { id: Number(prod.id), slug, title, type, brand };
        const made: { itemId: number; key: string }[] = [];
        const colourList = colours.length ? colours : ["Default"];
        const sizeList = sizes.length ? sizes : ["One size"];
        for (const c of colourList) {
          const colourId = await findOrCreateColour(tx, p.id, c);
          for (const s of sizeList) {
            const single = colourList.length === 1 && sizeList.length === 1;
            const v = await createVariant(tx, p, colourId, c, s, single ? cleanText(b.sku) : null, null);
            made.push({ itemId: v.itemId, key: `${c}|${s}` });
          }
        }
        return { productId: p.id, made };
      });

      // Opening quantities go through the ledger, after the product exists.
      const lines: { itemId: number; locationId: number; qty: number }[] = [];
      const single = result.made.length === 1;
      for (const m of result.made) {
        const q = single ? (b.quantities ?? {}) : ((b.variantQuantities ?? {})[m.key] ?? {});
        for (const [loc, qty] of Object.entries(q)) lines.push({ itemId: m.itemId, locationId: Number(loc), qty: Number(qty) });
      }
      try {
        await postOpeningStock(userId, result.productId, lines);
      } catch (e: any) {
        return res.status(201).json({ id: result.productId, warning: `Product saved, but the quantities weren't: ${e.message}` });
      }
      res.status(201).json({ id: result.productId });
    } catch (e) { fail(res, e, "create the product"); }
  });

  // Body: any of { title, description, status, type, priceCents, compareAtCents,
  //                variantPrices: [{ variantId, priceCents|null }] }
  app.patch("/api/admin/warehouse/products/:id", ...gate, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const p = (await rows(sql`SELECT id, organization_id FROM shop_products WHERE id = ${id}`))[0];
      if (!p || !brandForOrg(Number(p.organization_id))) return res.status(404).json({ message: "Product not found" });
      await db.transaction(async (tx) => {
        const sets: any[] = [sql`updated_at = now()`];
        if (b.title !== undefined) {
          const t = cleanText(b.title);
          if (!t) throw new ProductError("Title can't be blank");
          sets.push(sql`title = ${t}`);
        }
        if (b.description !== undefined) sets.push(sql`description = ${cleanText(b.description)}`);
        if (b.status !== undefined) {
          if (!STATUSES.includes(b.status)) throw new ProductError("Status must be Active, Draft or Archived");
          sets.push(sql`status = ${b.status}`);
        }
        if (b.type !== undefined) sets.push(sql`type = ${cleanText(b.type) ?? "apparel"}`);
        if (b.priceCents !== undefined) sets.push(sql`price_cents = ${cents(b.priceCents) ?? 0}`);
        if (b.compareAtCents !== undefined) sets.push(sql`compare_at_cents = ${cents(b.compareAtCents)}`);
        await tx.execute(sql`UPDATE shop_products SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
        for (const vp of Array.isArray(b.variantPrices) ? b.variantPrices : []) {
          await tx.execute(sql`UPDATE shop_variants SET price_cents = ${cents(vp.priceCents)} WHERE id = ${Number(vp.variantId)} AND product_id = ${id}`);
        }
        if (b.title !== undefined) {
          // Keep warehouse item names in step with the product title.
          await tx.execute(sql`
            UPDATE wh_items w SET name = ${cleanText(b.title)} || ' — ' || c.name || ', ' || v.size, updated_at = now()
            FROM shop_variants v JOIN shop_product_colours c ON c.id = v.colour_id
            WHERE w.shop_variant_id = v.id AND v.product_id = ${id}`);
        }
        if (b.type !== undefined) {
          await tx.execute(sql`UPDATE wh_items w SET category = ${cleanText(b.type) ?? "apparel"} FROM shop_variants v WHERE w.shop_variant_id = v.id AND v.product_id = ${id}`);
        }
      });
      res.json({ ok: true });
    } catch (e) { fail(res, e, "save the product"); }
  });

  // Shopify's editable "Available" at one location. Body: { itemId, locationId, onHand }.
  // Posts the DIFFERENCE as a stock take (count / stock_take), so the ledger
  // says who changed it, when, and from what to what.
  app.post("/api/admin/warehouse/products/:id/stock", ...gate, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const itemId = Number(req.body?.itemId);
      const locationId = Number(req.body?.locationId);
      const want = Number(req.body?.onHand);
      if (!Number.isFinite(want) || want < 0 || !Number.isInteger(want)) throw new ProductError("Quantity must be a whole number, 0 or more");
      const ok = (await rows(sql`SELECT 1 FROM wh_items w JOIN shop_variants v ON v.id = w.shop_variant_id WHERE w.id = ${itemId} AND v.product_id = ${id}`)).length;
      if (!ok) throw new ProductError("That variant isn't on this product", 404);
      const loc = (await rows(sql`SELECT id, code FROM wh_locations WHERE id = ${locationId} AND kind <> 'virtual'`))[0];
      if (!loc) throw new ProductError("Choose a real location");
      const have = Number((await rows(sql`SELECT coalesce((SELECT on_hand FROM wh_stock WHERE item_id = ${itemId} AND location_id = ${locationId}), 0) AS q`))[0].q);
      const delta = want - have;
      if (delta !== 0) {
        await runMovementGroup({
          legs: [{ itemId, locationId, locationCode: loc.code, delta, allowNegative: false }],
          movementType: "count",
          reasonCode: "stock_take",
          operatorUserId: req.session.userId!,
          note: `Quantity set to ${want} on the product page (was ${have})`,
        });
      }
      res.json({ onHand: want, changed: delta !== 0 });
    } catch (e) { fail(res, e, "change the quantity"); }
  });

  // Body: { colour, size, sku?, priceCents?, quantities?: { [locationId]: qty } }
  app.post("/api/admin/warehouse/products/:id/variants", ...gate, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const p = (await rows(sql`SELECT id, organization_id, slug, title, type FROM shop_products WHERE id = ${id}`))[0];
      const brand = p ? brandForOrg(Number(p.organization_id)) : null;
      if (!p || !brand) return res.status(404).json({ message: "Product not found" });
      const colour = cleanText(b.colour) ?? "Default";
      const size = cleanText(b.size) ?? "One size";
      const made = await db.transaction(async (tx) => {
        const colourId = await findOrCreateColour(tx, id, colour);
        const dup = (await tx.execute(sql`SELECT 1 FROM shop_variants WHERE colour_id = ${colourId} AND lower(size) = lower(${size}) AND active`)).rows.length;
        if (dup) throw new ProductError(`${colour} / ${size} already exists`, 409);
        return createVariant(tx, { id, slug: p.slug, title: p.title, type: p.type, brand }, colourId, colour, size, cleanText(b.sku), cents(b.priceCents));
      });
      await postOpeningStock(req.session.userId!, id,
        Object.entries(b.quantities ?? {}).map(([loc, qty]) => ({ itemId: made.itemId, locationId: Number(loc), qty: Number(qty) })));
      res.status(201).json(made);
    } catch (e) { fail(res, e, "add the variant"); }
  });
}

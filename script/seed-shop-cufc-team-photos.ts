// Launch shop.cufc.co.nz with the 2026 academy team photos (Daniel, 2026-10-17).
//
// What it does, in ONE transaction (rolled back unless --commit):
//   1. Adds one product per team photo — $10, type 'photo', one "6×4 print"
//      variant with deep stock (printed on demand, so stock never runs out).
//      Preview images are hosted by the storefront itself
//      (shop.cufc.co.nz/team-photos/2026/*.jpg), watermarked "SAMPLE".
//   2. Moves every OTHER active CUFC product to draft. cufcshop.com (Shopify)
//      is still taking kit orders (5 in 11–15 Oct 2026), so the same stock
//      must not be sellable in two places. The ids moved are printed and
//      written to --log so `--restore-kit` can put exactly those back.
//   3. Adds "NZ Post — posted" at $5.00 (medium letter $3.60 since 1 Jul 2026
//      + envelope and card backing) and switches OFF the "NZ Courier" $9.99
//      placeholder, whose price nobody ever confirmed.
//
// Idempotent on (org 1, slug) for products and on label for shipping — a
// re-run never re-prices a photo Daniel has edited in the Store tab.
//
//   npx tsx --env-file=.env script/seed-shop-cufc-team-photos.ts              # dry run
//   npx tsx --env-file=.env script/seed-shop-cufc-team-photos.ts --commit
//   npx tsx --env-file=.env script/seed-shop-cufc-team-photos.ts --restore-kit=<log.json> --commit

import { Pool } from "pg";
import { readFileSync, writeFileSync } from "fs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");

const CUFC_ORG_ID = 1;
const IMAGE_BASE = "https://shop.cufc.co.nz/team-photos/2026";
const PRICE_CENTS = 1000;
const PRINT_SIZE = "6×4 print";
const STOCK = 1000;
const DEFAULT_LOG =
  "/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/outputs/cufc-shop/2026-10-17-team-photos/drafted-kit-products.json";

// Team names exactly as printed on each photo's own title. U12 Blue is
// deliberately absent: the file Max supplied as U12 Blue carries the
// U12 White title and the U12 White roster, so it goes back to him.
const TEAMS: { slug: string; team: string }[] = [
  { slug: "u9-pukekos", team: "U9 Pukekos" },
  { slug: "u9-fantails", team: "U9 Fantails" },
  { slug: "u9-kakapo", team: "U9 Kakapo" },
  { slug: "u9-magpies", team: "U9 Magpies" },
  { slug: "u9-sparrows", team: "U9 Sparrows" }, // added 19 Oct
  { slug: "u10-blue", team: "U10 Blue" },
  { slug: "u10-royal", team: "U10 Royal" },
  { slug: "u10-gold", team: "U10 Gold" },
  { slug: "u10-yellow", team: "U10 Yellow" },
  { slug: "u10-white", team: "U10 White" }, // added 19 Oct
  { slug: "u11-blue", team: "U11 Blue" },
  { slug: "u11-gold", team: "U11 Gold" },
  { slug: "u11-yellow", team: "U11 Yellow" },
  { slug: "u12-white", team: "U12 White" },
  { slug: "u13-blue", team: "U13 Blue" },
  { slug: "u13-white", team: "U13 White" }, // added 19 Oct
  { slug: "u14", team: "U14" },
  { slug: "u15", team: "U15" },
  { slug: "u17", team: "U17" },
];

const POSTED = {
  label: "NZ Post — posted",
  description: "Posted flat with a card backing, NZ Post standard mail. Usually 2–5 working days. Not tracked.",
  priceCents: 500,
  requiresAddress: true,
  sortOrder: 1,
};
const COURIER_PLACEHOLDER_LABEL = "NZ Courier";

const description = (team: string) =>
  `The official Christchurch United ${team} 2026 team photo, with every player named underneath.\n\n` +
  `Includes the full-resolution digital file, ready to download the moment you pay, plus a printed 6×4 inch (15 × 10 cm) copy. ` +
  `Collect the print free from the club office at United Sports Centre, or have it posted.\n\n` +
  `The "SAMPLE" watermark is only on this preview. Your download and print won't have it.`;

async function main() {
  const commit = process.argv.includes("--commit");
  const restoreArg = process.argv.find((a) => a.startsWith("--restore-kit="));
  const logArg = process.argv.find((a) => a.startsWith("--log="));
  const logPath = logArg ? logArg.slice(6) : DEFAULT_LOG;
  console.log(`Mode: ${commit ? "COMMIT" : "DRY RUN (rolled back)"}\n`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    if (restoreArg) {
      const ids: number[] = JSON.parse(readFileSync(restoreArg.slice("--restore-kit=".length), "utf8")).ids;
      const r = await c.query(
        `UPDATE shop_products SET status='active', updated_at=now()
          WHERE organization_id=$1 AND id = ANY($2::int[]) AND status='draft' RETURNING id, title`,
        [CUFC_ORG_ID, ids],
      );
      r.rows.forEach((x) => console.log(`↺ active again: ${x.id} ${x.title}`));
      await c.query(commit ? "COMMIT" : "ROLLBACK");
      console.log(commit ? "\nCOMMITTED." : "\nROLLED BACK.");
      return;
    }

    // 2 — draft the kit (anything active that is not a team photo).
    const drafted = await c.query(
      `UPDATE shop_products SET status='draft', updated_at=now()
        WHERE organization_id=$1 AND status='active' AND type <> 'photo'
        RETURNING id, slug, title`,
      [CUFC_ORG_ID],
    );
    console.log(`Kit moved to draft: ${drafted.rowCount}`);
    drafted.rows.forEach((x) => console.log(`  - ${x.id} ${x.title}`));

    // 1 — the photos.
    let added = 0, skipped = 0;
    for (const [i, t] of TEAMS.entries()) {
      const slug = `team-photo-2026-${t.slug}`;
      const title = `${t.team} Team Photo 2026`;
      const ex = await c.query(`SELECT id FROM shop_products WHERE organization_id=$1 AND slug=$2`, [CUFC_ORG_ID, slug]);
      if (ex.rows.length) {
        console.log(`✓ exists (id ${ex.rows[0].id}): ${title}`);
        skipped++;
        continue;
      }
      const p = await c.query(
        `INSERT INTO shop_products (organization_id, slug, title, subtitle, description, type, price_cents, status, sort_order)
         VALUES ($1,$2,$3,$4,$5,'photo',$6,'active',$7) RETURNING id`,
        [CUFC_ORG_ID, slug, title, "Digital download + 6×4 print", description(t.team), PRICE_CENTS, i],
      );
      const productId = p.rows[0].id;
      const col = await c.query(
        `INSERT INTO shop_product_colours (product_id, name, sort_order, active) VALUES ($1,'Print',0,true) RETURNING id`,
        [productId],
      );
      await c.query(
        `INSERT INTO shop_product_images (product_id, colour_id, url, alt, sort_order) VALUES ($1,$2,$3,$4,0)`,
        [productId, col.rows[0].id, `${IMAGE_BASE}/${t.slug}.jpg`, `Christchurch United ${t.team} 2026 team photo`],
      );
      await c.query(
        `INSERT INTO shop_variants (product_id, colour_id, size, sku, stock, active) VALUES ($1,$2,$3,$4,$5,true)`,
        [productId, col.rows[0].id, PRINT_SIZE, `TP26-${t.slug.toUpperCase()}`, STOCK],
      );
      console.log(`+ ${productId} ${title} — $${(PRICE_CENTS / 100).toFixed(2)}`);
      added++;
    }

    // 3 — shipping.
    const post = await c.query(
      `SELECT id FROM shop_shipping_options WHERE organization_id=$1 AND label=$2`,
      [CUFC_ORG_ID, POSTED.label],
    );
    if (post.rows.length) console.log(`✓ shipping exists: ${POSTED.label}`);
    else {
      await c.query(
        `INSERT INTO shop_shipping_options (organization_id,label,description,price_cents,requires_address,active,sort_order)
         VALUES ($1,$2,$3,$4,$5,true,$6)`,
        [CUFC_ORG_ID, POSTED.label, POSTED.description, POSTED.priceCents, POSTED.requiresAddress, POSTED.sortOrder],
      );
      console.log(`+ shipping: ${POSTED.label} $${(POSTED.priceCents / 100).toFixed(2)}`);
    }
    const off = await c.query(
      `UPDATE shop_shipping_options SET active=false WHERE organization_id=$1 AND label=$2 AND active RETURNING id`,
      [CUFC_ORG_ID, COURIER_PLACEHOLDER_LABEL],
    );
    console.log(`Courier placeholder switched off: ${off.rowCount}`);

    console.log(`\nPhotos added ${added}, already there ${skipped}`);
    if (commit) {
      await c.query("COMMIT");
      if (drafted.rowCount) {
        writeFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), ids: drafted.rows.map((r) => r.id), products: drafted.rows }, null, 2));
        console.log(`Drafted ids written to ${logPath}`);
      }
      console.log("COMMITTED.");
    } else {
      await c.query("ROLLBACK");
      console.log("ROLLED BACK (dry run).");
    }
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

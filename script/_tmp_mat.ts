import { db } from "../server/db";
import { sql } from "drizzle-orm";
async function main() {
  const r: any = await db.execute(sql`
    SELECT id, slug, name, category, quote_on_website, pricing_method,
           size_min_w_mm, size_max_w_mm, size_min_h_mm, size_max_h_mm, max_roll_width_mm,
           size_tiers_json, base_rate_cents, min_charge_cents
    FROM print_materials WHERE quote_on_website = true ORDER BY display_order, id`);
  for (const m of (r.rows ?? r)) {
    console.log(`\n#${m.id} ${m.slug}  (${m.category}, ${m.pricing_method})`);
    console.log(`   ${m.name}`);
    console.log(`   size tiers: ${JSON.stringify(m.size_tiers_json)}`);
    console.log(`   bounds w ${m.size_min_w_mm}-${m.size_max_w_mm} h ${m.size_min_h_mm}-${m.size_max_h_mm} roll ${m.max_roll_width_mm}`);
  }
  const n: any = await db.execute(sql`SELECT count(*)::int n, count(*) FILTER (WHERE quote_on_website) AS onweb FROM print_materials`);
  console.log("\ntotals:", JSON.stringify((n.rows ?? n)[0]));
  process.exit(0);
}
main();

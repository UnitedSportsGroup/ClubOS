import { db } from "../server/db";
import { sql } from "drizzle-orm";
async function main() {
  for (const t of ["teampay_competitions", "teampay_entries"]) {
    const c: any = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=${t} ORDER BY ordinal_position`);
    console.log(`\n${t}:`, (c.rows??c).map((x:any)=>x.column_name).join(", "));
  }
  const comp: any = await db.execute(sql`SELECT * FROM teampay_competitions ORDER BY id`);
  console.log("\ncompetitions:");
  console.table((comp.rows??comp).map((r:any)=>({id:r.id, slug:r.slug, name:r.name, brand:r.brand, org:r.organization_id, fee:r.fee_cents, open:r.entries_open, pay:r.payments_enabled})));
  const e: any = await db.execute(sql`SELECT competition_id, count(*)::int n FROM teampay_entries GROUP BY 1 ORDER BY 1`);
  console.log("entries per competition:"); console.table(e.rows??e);
  process.exit(0);
}
main();

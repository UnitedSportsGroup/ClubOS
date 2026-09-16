import { db } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs"; import path from "path";
const DRY = process.argv.includes("--dry-run");
let pass = 0, fail = 0;
const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); g ? pass++ : fail++; };
async function main() {
  const ddl = fs.readFileSync(path.join(process.cwd(), "migrations/2026-09-16_print_colour_options.sql"), "utf8");
  console.log(`\nGarment colours in the catalog — ${DRY ? "DRY RUN" : "APPLYING"}\n`);
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(ddl));
    const c: any = await tx.execute(sql`
      SELECT data_type, column_default FROM information_schema.columns
      WHERE table_name='print_materials' AND column_name='colour_options_json'`);
    ok("colour_options_json exists", (c.rows ?? c).length === 1);
    ok("defaults to an empty list, which means 'not set'", /\[\]/.test(String((c.rows ?? c)[0]?.column_default ?? "")));
    const n: any = await tx.execute(sql`SELECT count(*)::int n FROM print_materials WHERE colour_options_json <> '[]'::jsonb`);
    ok("no product has a colour list yet — nothing was invented", Number((n.rows ?? n)[0].n) === 0);
    if (DRY) throw new Error("__ROLLBACK__");
  }).catch((e: any) => { if (e?.message !== "__ROLLBACK__") throw e; });
  console.log(`\n${pass} passed, ${fail} failed${DRY ? " — NOTHING WRITTEN" : ""}\n`);
  process.exit(fail ? 1 : 0);
}
main();

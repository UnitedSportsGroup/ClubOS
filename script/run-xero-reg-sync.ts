// One sweep of the Xero → registration sync, by hand. SHADOW unless --live.
//   npx tsx --env-file=.env script/run-xero-reg-sync.ts [--live] [--since 2026-07-01]
import { runXeroRegistrationSync } from "../server/xero-registration-sync";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
const live = process.argv.includes("--live");
const si = process.argv.indexOf("--since");
const since = si > 0 ? new Date(process.argv[si + 1] + "T00:00:00Z") : undefined;
const r = await runXeroRegistrationSync({ mode: live ? "live" : "shadow", since });
console.log(r);
const rows: any = await db.execute(sql`SELECT decision, count(*)::int n FROM xero_invoice_registrations GROUP BY 1 ORDER BY 2 DESC`);
console.table(rows.rows ?? rows);
const rv: any = await db.execute(sql`SELECT reason, count(*)::int n FROM xero_invoice_registrations WHERE decision='needs_review' GROUP BY 1 ORDER BY 2 DESC`);
console.table(rv.rows ?? rv);
process.exit(0);

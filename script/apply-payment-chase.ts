/**
 * Apply migrations/2026-11-04_payment_chase_emails.sql.
 *   npx tsx --env-file=.env script/apply-payment-chase.ts            # DRY RUN — rolls back
 *   npx tsx --env-file=.env script/apply-payment-chase.ts --commit
 */
import { readFileSync } from "fs";
import { join } from "path";
import { sql } from "drizzle-orm";
import { db } from "../server/db";

const COMMIT = process.argv.includes("--commit");
const body = readFileSync(join(import.meta.dirname, "..", "migrations", "2026-11-04_payment_chase_emails.sql"), "utf8");
const rows = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
async function refused(tx: any, fn: (t: any) => Promise<unknown>) {
  try { await tx.transaction(async (sp: any) => { await fn(sp); throw new Error("__OK__"); }); return false; }
  catch (e: any) { return e?.message !== "__OK__"; }
}
const ROLLBACK = new Error("__ROLLBACK__");
let ok = true;
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(body));
    const [{ uid }] = rows(await tx.execute(sql`SELECT min(id)::int uid FROM users`));
    const ins = (t: any, over: Record<string, string> = {}) => t.execute(sql.raw(`
      INSERT INTO payment_chase_emails (organization_id, kind, family_key, to_email, from_email, invoice_ids, invoice_numbers, owed_cents, sent_by_user_id)
      VALUES (1, ${over.kind ?? "'reminder'"}, 'k', ${over.to ?? "'a@b.nz'"}, 'accounts@cufc.co.nz', ${over.ids ?? "ARRAY['x']"}, ARRAY['INV-1'], ${over.owed ?? "100"}, ${uid}) RETURNING id`));
    const [row] = rows(await ins(tx));
    const checks: [string, boolean][] = [
      ["a row can be written", !!row?.id],
      ["RLS on", rows(await tx.execute(sql`SELECT relrowsecurity r FROM pg_class WHERE relname='payment_chase_emails'`))[0]?.r === true],
      ["an unknown kind is REFUSED", await refused(tx, (t) => ins(t, { kind: "'shout'" }))],
      ["a blank address is REFUSED", await refused(tx, (t) => ins(t, { to: "' '" }))],
      ["no invoices is REFUSED", await refused(tx, (t) => ins(t, { ids: "ARRAY[]::text[]" }))],
      ["owing $0 is REFUSED", await refused(tx, (t) => ins(t, { owed: "0" }))],
      ["a row cannot be EDITED", await refused(tx, (t) => t.execute(sql`UPDATE payment_chase_emails SET note='x' WHERE id=${row.id}`))],
      ["a row cannot be DELETED", await refused(tx, (t) => t.execute(sql`DELETE FROM payment_chase_emails WHERE id=${row.id}`))],
    ];
    for (const [n, p] of checks) { console.log(`  ${p ? "✅" : "❌"} ${n}`); if (!p) ok = false; }
    if (!ok || !COMMIT) throw ROLLBACK;
    // keep the schema, drop the rehearsal row (trigger refuses DELETE, so disable it for this one statement)
    await tx.execute(sql`ALTER TABLE payment_chase_emails DISABLE TRIGGER payment_chase_emails_no_change`);
    await tx.execute(sql`DELETE FROM payment_chase_emails WHERE family_key = 'k' AND to_email = 'a@b.nz'`);
    await tx.execute(sql`ALTER TABLE payment_chase_emails ENABLE TRIGGER payment_chase_emails_no_change`);
  });
} catch (e) { if (e !== ROLLBACK) throw e; }
console.log(ok ? (COMMIT ? "\n🟢 applied" : "\n🧪 dry run passed — rolled back") : "\n❌ FAILED — rolled back");
process.exit(ok ? 0 : 1);

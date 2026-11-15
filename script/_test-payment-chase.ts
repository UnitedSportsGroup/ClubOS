// Proves the send path without touching a family: real Resend accepts both senders (to Resend's
// own test inbox), and the log INSERT + history query run, inside a transaction that is rolled back.
import { readFileSync } from "fs";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { sendEmailDetailed } from "../server/email";
import { SENDERS } from "../server/payments-chase";
const dir = process.argv[2];
let fail = 0; const ok = (l: string, g: boolean, d = "") => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); if (!g) fail++; };
for (const kind of ["reminder", "escalation"] as const) {
  const s = SENDERS[kind];
  const r = await sendEmailDetailed({ from: `${s.fromName} <${s.email}>`, replyTo: s.email, to: "delivered@resend.dev", subject: `[TEST] ${kind}`, html: readFileSync(`${dir}/chase-${kind}.html`, "utf8") });
  ok(`Resend accepts ${kind} from ${s.email}`, r.ok && !!r.id, r.id ?? "");
}
const R = new Error("rb");
try {
  await db.transaction(async (tx) => {
    const ids = ["test-inv-a", "test-inv-b"];
    await tx.execute(sql`
      INSERT INTO payment_chase_emails (organization_id, kind, family_key, to_email, from_email, invoice_ids, invoice_numbers, owed_cents, note, sent_by_user_id, resend_id)
      VALUES (1, 'reminder', 'test-family', 'delivered@resend.dev', 'accounts@cufc.co.nz',
              ${sql`ARRAY[${sql.join(ids.map((l) => sql`${l}`), sql`, `)}]::text[]`},
              ${sql`ARRAY[${sql.join(["INV-1", "INV-2"].map((l) => sql`${l}`), sql`, `)}]::text[]`}, 48500, null, 1, 'x')`);
    const got: any = await tx.execute(sql`SELECT kind, invoice_ids FROM payment_chase_emails WHERE organization_id = 1
       AND invoice_ids && ${sql`ARRAY[${sql.join(["test-inv-b", "nope"].map((i) => sql`${i}`), sql`, `)}]::text[]`}`);
    const rows = Array.isArray(got) ? got : got.rows;
    ok("log row written and found by invoice id", rows.length === 1 && rows[0].invoice_ids.length === 2, JSON.stringify(rows[0] ?? null));
    throw R;
  });
} catch (e) { if (e !== R) { ok("transaction", false, String((e as any)?.message)); } }
console.log(fail ? `${fail} FAILED` : "all passed"); process.exit(fail ? 1 : 0);

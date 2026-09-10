// Every dollar a family actually paid us, against the player it was for.
//
// Daniel, 2026-09-11: "make sure those uniform payments — if they're in xero
// they still need to be in clubos in the history of that player/parent,
// labelled for which player, how much they actually paid etc… as it's
// important when parents start disputing shit for our accounts team to have
// the accurate info."
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 `total` IS NOT WHAT THEY PAID, AND THE DIFFERENCE IS THE WHOLE POINT.
//
//   881 live invoices are PART-PAID and 1,775 carry a credit note. Real rows:
//     total $503.50 → actually paid $337.00 ($166.50 credited)
//     total $170.00 → actually paid  $79.00  ($91.00 credited)
//     total  $90.00 → actually paid   $5.00  ($85.00 credited)
//
//   Recording `total` would have the accounts team tell a disputing parent
//   they paid $503.50 when $337 arrived. That is not a small inaccuracy — it
//   is confidently wrong, which is worse than having no record at all. This
//   reads the PAYMENTS, never the invoice total.
//
// 🔴 ONE ROW PER PAYMENT, NOT PER INVOICE. All 17,807 settled invoices carry a
// real `payments[]` array with dates and amounts, so a family who paid a $540
// term in three instalments gets three rows on three dates — which is exactly
// what somebody answering "but I paid you in March" needs to see. Keyed on
// Xero's own `paymentID`, so re-running can never double-count.
//
// 🔴 EVERY KIND OF INVOICE, not just programme fees. Uniform, kit, jackets,
// levies, tournament entries — the registration migration deliberately ignores
// these because they are not enrolments, but they are money the family paid and
// they belong in the history. That is what Daniel asked for.
//
// 🔴 LABELLED WITH THE PLAYER. `first_name`/`last_name` carry the CHILD named on
// the Xero contact, not the payer, because "which player was this for" is the
// question being asked. The parent is reachable through the contact.
//
//   npx tsx --env-file=.env script/migrate-xero-payments.ts <invoices.json> <contacts.json> [--commit]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const [INVOICES, CONTACTS] = [process.argv[2], process.argv[3]];
const COMMIT = process.argv.includes("--commit");
const REPORT = process.argv.includes("--report") ? process.argv[process.argv.indexOf("--report") + 1] : null;
if (!INVOICES || !CONTACTS) {
  console.error("usage: migrate-xero-payments.ts <invoices.json> <contacts.json> [--commit] [--report f.json]");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SOURCE = "xero";
const ORG = 1;

const norm = (s: any) => String(s ?? "").trim();
const lower = (s: any) => norm(s).toLowerCase();
const TERM = /\b(?:term\s*([1-4])|T([1-4]))\b/i;
const YEAR_RE = /\b(20\d\d)\b/;
const isoDay = (d: any) => String(d ?? "").slice(0, 10);

/** What this money was for, in words a human recognises. */
function describe(ref: string): string {
  const s = lower(ref);
  if (/uniform|kit\b|jacket|hoodie|sock|short\b/.test(s)) return "Uniform / kit";
  if (/lev(y|ies)/.test(s)) return "Levies";
  if (/friends of cufc/.test(s)) return "88 Friends of CUFC";
  if (/residency/.test(s)) return "Residency";
  if (/tournament|cic/.test(s)) return "Tournament";
  if (/technification/.test(s)) return "Technification";
  if (/\bfs\b/.test(s)) return "FUNiño";
  if (/morning/.test(s)) return "Morning Programme";
  if (/u\s?\d{1,2}/.test(s)) return "Academy / Pre-Academy";
  return ref || "Payment";
}

async function main() {
  const invoices = JSON.parse(readFileSync(INVOICES, "utf8")).rows as any[];
  const xeroContacts = JSON.parse(readFileSync(CONTACTS, "utf8")).rows as any[];
  const xeroById = new Map(xeroContacts.map((c) => [c.contactID, c]));

  const client = await pool.connect();
  const stat = { rows: 0, already: 0, unmatched: 0, noMoney: 0, cents: 0, byKind: new Map<string, number>() };
  const unmatched: any[] = [];

  try {
    await client.query("BEGIN");

    const { rows: contacts } = await client.query(`SELECT id, type, first_name, last_name, email FROM contacts`);
    const { rows: rel } = await client.query(`SELECT guardian_id, player_id FROM contact_relationships`);
    const byId = new Map(contacts.map((c: any) => [c.id, c]));
    const guardianEmail = new Map<number, string>();
    for (const r of rel) { const g: any = byId.get(r.guardian_id); if (g?.email) guardianEmail.set(r.player_id, lower(g.email)); }
    const people = new Map<string, any[]>();
    for (const c of contacts) {
      const k = `${lower(c.first_name)} ${lower(c.last_name)}`.trim();
      people.set(k, [...(people.get(k) ?? []), { ...c, reach: [lower(c.email), guardianEmail.get(c.id)].filter(Boolean) }]);
    }

    const { rows: seen } = await client.query(
      `SELECT external_key FROM fm_payment_history WHERE source = $1`, [SOURCE]);
    const done = new Set(seen.map((r: any) => r.external_key));

    for (const inv of invoices) {
      if (!["PAID", "AUTHORISED"].includes(String(inv.status))) continue;
      const payments: any[] = inv.payments ?? [];
      if (payments.length === 0) { stat.noMoney++; continue; }

      const xc = xeroById.get((inv.contact ?? {}).contactID);
      if (!xc) { stat.unmatched++; continue; }

      const ref = norm(inv.reference);
      const child = norm(String(xc.name).replace(/^\s*\([^)]*\)\s*/, ""));
      const payer = lower(xc.emailAddress);

      // Same rule as the registration pass: the child's NAME and the payer's
      // EMAIL together. Siblings share a mailbox; children share names.
      const cands = people.get(lower(child)) ?? [];
      let person = cands.find((p: any) => payer && p.reach.includes(payer)) ?? null;
      if (!person && cands.length === 1 && !payer) person = cands[0];
      if (!person) { unmatched.push({ child, payer, ref }); stat.unmatched++; continue; }

      const tm = TERM.exec(ref);
      const termNo = tm ? Number(tm[1] ?? tm[2]) : null;
      const year = Number((YEAR_RE.exec(ref) ?? [])[1] ?? String(inv.date).slice(0, 4)) || null;
      const kind = describe(ref);
      const invNo = norm(inv.invoiceNumber) || norm(inv.invoiceID);

      for (const pay of payments) {
        const key = norm(pay.paymentID);
        if (!key || done.has(key)) { if (key) stat.already++; continue; }
        const cents = Math.round(Number(pay.amount ?? 0) * 100);
        if (cents <= 0) continue;

        stat.rows++; stat.cents += cents;
        stat.byKind.set(kind, (stat.byKind.get(kind) ?? 0) + cents);

        if (COMMIT) {
          await client.query(
            `INSERT INTO fm_payment_history
               (organization_id, contact_id, first_name, last_name, fee_number, fee_description,
                term_name, season_year, programme, method, method_raw, paid_on, amount_cents,
                currency, note_reference, source, external_key)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'other','xero',$10,$11,'NZD',$12,$13,$14)
             ON CONFLICT DO NOTHING`,
            [ORG, person.id, person.first_name, person.last_name, invNo, ref || kind,
             termNo ? `Term ${termNo} ${year ?? ""}`.trim() : null, year, kind,
             isoDay(pay.date), cents,
             // 🔴 The sentence the accounts team reads in a dispute. It names the
             // invoice, what arrived, and — when they differ — what was invoiced.
             `Xero payment ${key.slice(0, 8)} on invoice ${invNo} ("${ref}"): $${(cents / 100).toFixed(2)} received${
               Number(inv.total ?? 0) * 100 !== cents ? ` (invoice total $${Number(inv.total).toFixed(2)}${
                 Number(inv.amountCredited ?? 0) > 0 ? `, $${Number(inv.amountCredited).toFixed(2)} credited` : ""})` : ""}`,
             SOURCE, key]);
        }
        done.add(key);
      }
    }

    console.log(`\n${COMMIT ? "APPLIED" : "DRY RUN — nothing written"}\n`);
    console.log(`  payments to record        ${stat.rows.toLocaleString()}`);
    console.log(`  money they represent      $${(stat.cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    console.log(`  already recorded          ${stat.already.toLocaleString()}`);
    console.log(`  invoice had no payment    ${stat.noMoney.toLocaleString()}  (raised, never settled)`);
    console.log(`  person not matched        ${stat.unmatched.toLocaleString()}`);
    console.log(`\n  what the money was for:`);
    for (const [k, c] of [...stat.byKind].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`    ${k.slice(0, 30).padEnd(30)} $${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2 }).padStart(14)}`);
    }
    if (REPORT) { writeFileSync(REPORT, JSON.stringify({ stat: { ...stat, byKind: [...stat.byKind] }, unmatched: unmatched.slice(0, 500) }, null, 1)); console.log(`\n  wrote ${REPORT}`); }

    if (COMMIT) { await client.query("COMMIT"); console.log("\nCOMMITTED."); }
    else { await client.query("ROLLBACK"); console.log("\nRolled back. Re-run with --commit to apply."); }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); await pool.end(); }
}

main().catch((e) => { console.error("\n✗", e.message ?? e); process.exit(1); });

/**
 * Correct the price recorded on an existing registration.
 *
 * Why this exists: ClubOS has no way for staff to change the price on a
 * registration that is already written. The only surface that sets one is the
 * office form at the moment of sale, so a mistake — or a bug like the one Olga
 * hit on 2026-09-15, where the form silently discarded the $135 she typed and
 * wrote $30 — can only be repaired from here.
 *
 * 🔴 It goes through @shared/office-price, the SAME decider the counter uses.
 * This script can therefore never record a price a staff member could not have
 * agreed at the till: the ceiling is the programme's published fee, a reason is
 * required, and the columns are split the same way.
 *
 * 🔴 It sets amount_paid TOO, and that is the point. Raising the total while
 * leaving the amount taken behind turns the row into a SHORT PAYMENT, which
 * flips it to `pending` — and a pending registration is hidden from every staff
 * list by the unpaid-is-not-registered rule. Correcting the price would make the
 * family disappear. So the amount actually taken is a required argument, not an
 * inference.
 *
 *   npx tsx --env-file=.env script/correct-registration-price.ts \
 *     --id 2051 --price 135 --paid 135 --reason "…" [--commit]
 *
 * Dry run by default: it prints the before and after and writes nothing.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { agreedPriceError, agreedPriceColumns, agreedPriceNote } from "@shared/office-price";

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const COMMIT = argv.includes("--commit");

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const toCents = (v: string | undefined) => {
  if (v == null || v.trim() === "") return null;
  const n = Number(v.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

async function main() {
  const id = Number(arg("id"));
  const priceCents = toCents(arg("price"));
  const paidCents = toCents(arg("paid"));
  const reason = (arg("reason") ?? "").trim();
  const actorId = Number(arg("actor") ?? 1);   // who is making the correction

  if (!Number.isFinite(id) || priceCents == null || paidCents == null || !reason) {
    console.error("usage: --id <registrationId> --price <dollars> --paid <dollars> --reason \"…\" [--actor <userId>] [--commit]");
    process.exit(2);
  }

  const before: any = await db.execute(sql`
    SELECT r.id, c.first_name||' '||c.last_name AS person, p.name AS programme,
           t.name||' '||t.year AS term, r.status::text AS status,
           r.subtotal_cents, r.discount_cents, r.total_cents, r.amount_paid,
           r.payment_method, r.notes, u.email AS served_by
    FROM registrations r
    LEFT JOIN contacts c ON c.id = r.contact_id
    LEFT JOIN programs p ON p.id = r.program_id
    LEFT JOIN terms t ON t.id = r.term_id
    LEFT JOIN users u ON u.id = r.served_by_user_id
    WHERE r.id = ${id}`);
  const row = (before.rows ?? before)[0];
  if (!row) { console.error(`No registration #${id}.`); process.exit(1); }

  // 🔴 The ceiling is the programme's own published fee, which is what the
  // subtotal already holds. Never the pro-rated total that is being corrected.
  const listSubtotal = Number(row.subtotal_cents);
  const problem = agreedPriceError({ agreedCents: priceCents, listSubtotalCents: listSubtotal, reason });
  if (problem) { console.error(`REFUSED — ${problem}`); process.exit(1); }

  // A short payment would flip this to pending and hide the family.
  if (paidCents < priceCents) {
    console.error(
      `REFUSED — paid ${money(paidCents)} is less than the price ${money(priceCents)}.\n` +
      `That is a short payment: the registration would drop to 'pending' and the family\n` +
      `would vanish from every staff list. Record what was really taken, or leave it alone.`);
    process.exit(1);
  }

  const cols = agreedPriceColumns(priceCents, listSubtotal);
  const note = agreedPriceNote(Number(row.total_cents), priceCents, reason);
  const notes = [typeof row.notes === "string" ? row.notes.trim() : "", note].filter(Boolean).join(" · ");

  console.log(`\n#${row.id}  ${row.person} · ${row.programme} · ${row.term} · served by ${row.served_by}\n`);
  console.log(`                 before            after`);
  console.log(`  fee (subtotal) ${money(Number(row.subtotal_cents)).padStart(10)}  →  ${money(cols.subtotalCents)}`);
  console.log(`  discount       ${money(Number(row.discount_cents)).padStart(10)}  →  ${money(cols.discountCents)}`);
  console.log(`  charged        ${money(Number(row.total_cents)).padStart(10)}  →  ${money(cols.totalCents)}`);
  console.log(`  paid            ${("$" + row.amount_paid).padStart(9)}  →  ${money(paidCents)}`);
  console.log(`  status         ${String(row.status).padStart(10)}  →  confirmed`);
  console.log(`\n  note: ${note}\n`);

  if (!COMMIT) { console.log("DRY RUN — nothing written. Re-run with --commit.\n"); process.exit(0); }

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE registrations
         SET subtotal_cents = ${cols.subtotalCents},
             discount_cents = ${cols.discountCents},
             total_cents    = ${cols.totalCents},
             amount_paid    = ${(paidCents / 100).toFixed(2)},
             notes          = ${notes}
       WHERE id = ${id}`);
    await tx.execute(sql`
      INSERT INTO audit_logs (user_id, action, entity, entity_id, details, created_at)
      VALUES (${actorId}, 'update', 'registration', ${id},
              ${`Price corrected: ${money(Number(row.total_cents))} → ${money(priceCents)}, paid $${row.amount_paid} → ${money(paidCents)}. ${reason}`},
              now())`);
  });

  const after: any = await db.execute(sql`
    SELECT subtotal_cents, discount_cents, total_cents, amount_paid, status::text AS status, notes
    FROM registrations WHERE id = ${id}`);
  const a = (after.rows ?? after)[0];
  const ok =
    Number(a.subtotal_cents) === cols.subtotalCents &&
    Number(a.discount_cents) === cols.discountCents &&
    Number(a.total_cents) === cols.totalCents &&
    String(a.amount_paid) === (paidCents / 100).toFixed(2) &&
    a.status === "confirmed" &&
    Number(a.subtotal_cents) - Number(a.discount_cents) === Number(a.total_cents);

  console.log(ok ? "✓ written and read back" : "✗ READ-BACK MISMATCH", JSON.stringify(a));
  process.exit(ok ? 0 : 1);
}

main();

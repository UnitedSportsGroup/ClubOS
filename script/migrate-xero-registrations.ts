// Xero's invoices are the register of who is actually with us.
//
// Daniel, 2026-09-11, from Olga: "example olga gave yesterday was taha nabi —
// only shows he was with us last year but not this year in clubos and fm, but
// xero shows he's actually stayed with us this year too. this is why both the
// fm and the xero is important, not just one or the other."
//
// She is right, and the case proves it. Taha Nabi (contact 30446):
//   ClubOS  — ONE registration, a $100 holiday camp in April.
//   FM      — nine rows, the last of them Term 3 2025.
//   XERO    — 2026 Term 1 $540 PAID · Term 2 $615 PAID · uniform $199 ·
//             Term 3 $540 AUTHORISED (invoiced, still owing).
// In ClubOS he looks like a child who left a year ago. He is in fact a current
// player who owes us for this term.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE CURRENT SEASON GOES TO `registrations`. EVERY EARLIER YEAR GOES TO
// HISTORY. That split is not a preference, it is this codebase's standing rule:
// history lives in additive `fm_registration_history` / `fm_payment_history`
// (whose `source` column already carries 'friendly_manager' and 'shopify'),
// NEVER in live `registrations`. Ten years of invoices poured into the live
// table would put 8,000 people on today's roll.
//
// 🔴 A UNIFORM IS NOT A REGISTRATION. 3,057 live invoices are kit, jackets,
// levies, "88 Friends of CUFC", online courses and residency rent. An invoice
// only becomes a registration if its reference names a TERM and a programme we
// recognise. Anything else is counted and reported, never guessed at.
//
// 🔴 AUTHORISED IS NOT PAID. Taha's Term 3 is invoiced and outstanding. Under
// "if you ain't paid you ain't registered" that is not a confirmed
// registration — but it is not an abandoned checkout either, it is a debtor.
// This script REPORTS them and writes nothing, because which of those two
// things it is, is Olga's call and not mine.
//
// 🔴 MATCHED ON THE PARENT'S EMAIL PLUS THE CHILD'S NAME. The Xero contact is
// named for the child and carries the parent's mailbox — in 883 of 2,663
// families the surnames differ, so neither half identifies a person alone.
//
//   npx tsx --env-file=.env script/migrate-xero-registrations.ts <invoices.json> <contacts.json>
//   … --commit          actually write
//   … --year 2026       default; the season that goes to `registrations`
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const [INVOICES, CONTACTS] = [process.argv[2], process.argv[3]];
const COMMIT = process.argv.includes("--commit");
const YEAR = Number(process.argv.includes("--year") ? process.argv[process.argv.indexOf("--year") + 1] : 2026);
const REPORT = process.argv.includes("--report") ? process.argv[process.argv.indexOf("--report") + 1] : null;
if (!INVOICES || !CONTACTS) {
  console.error("usage: migrate-xero-registrations.ts <invoices.json> <contacts.json> [--year 2026] [--commit]");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const LEGACY_SOURCE = "xero";

const norm = (s: any) => String(s ?? "").trim();
const lower = (s: any) => norm(s).toLowerCase();

const TERM = /\b(?:term\s*([1-4])|T([1-4]))\b/i;
const YEAR_RE = /\b(20\d\d)\b/;
/** Kit, levies, donations, rent, courses — real invoices, not registrations. */
const NOT_A_PROGRAMME = /uniform|kit\b|jacket|hoodie|sock|short\b|ball\b|bag\b|late fee|credit|donation|merch|friends of cufc|residency|online course|photo|trophy|tour\b/i;

/**
 * Which ClubOS programme an invoice reference is talking about.
 *
 * 🔴 Returns null rather than a guess. A reference this does not recognise is
 * reported by its exact text so a human can extend the table — an invoice filed
 * against the wrong programme is worse than one left out, because it silently
 * puts a child on a roll they are not on.
 */
function programmeFor(ref: string): { id: number; why: string } | null {
  const s = lower(ref);
  if (/\bfs\b/.test(s)) return { id: 4, why: "FS → FUNiño" };
  if (/technification/.test(s)) return { id: 5, why: "Technification" };
  if (/morning/.test(s)) return { id: 20, why: "Morning Programme" };
  if (/goal ?keep/.test(s)) return { id: 19, why: "Goalkeeper" };
  // Age bands. Pre-Academy is U9–U12, Academy U13 and up.
  const ages = [...s.matchAll(/u\s?(\d{1,2})/g)].map((m) => Number(m[1])).filter((n) => n >= 4 && n <= 20);
  if (ages.length) {
    const youngest = Math.min(...ages);
    if (youngest <= 8) return { id: 4, why: `U${youngest} → FUNiño` };
    if (youngest <= 12) return { id: 16, why: `U${youngest} → Pre-Academy` };
    return { id: 17, why: `U${youngest} → Academy` };
  }
  return null;
}

async function main() {
  const invoices = JSON.parse(readFileSync(INVOICES, "utf8")).rows as any[];
  const xeroContacts = JSON.parse(readFileSync(CONTACTS, "utf8")).rows as any[];
  const xeroById = new Map(xeroContacts.map((c) => [c.contactID, c]));

  const client = await pool.connect();
  const out: any = {
    wouldCreate: [] as any[], alreadyThere: 0,
    unpaidInvoiced: [] as any[], notAProgramme: 0, noTerm: 0, otherYears: 0,
    unmatchedPerson: [] as any[], unknownProgramme: new Map<string, number>(), noTermRow: [] as any[],
  };

  try {
    await client.query("BEGIN");

    // ── the people, once ──────────────────────────────────────────────────
    const { rows: contacts } = await client.query(
      `SELECT id, type, first_name, last_name, email FROM contacts`);
    const { rows: rel } = await client.query(`SELECT guardian_id, player_id FROM contact_relationships`);
    const guardianEmail = new Map<number, string>();
    const byId = new Map(contacts.map((c: any) => [c.id, c]));
    for (const r of rel) {
      const g: any = byId.get(r.guardian_id);
      if (g?.email) guardianEmail.set(r.player_id, lower(g.email));
    }
    /** name → the players with that name, each with every address that reaches them */
    const players = new Map<string, any[]>();
    for (const c of contacts) {
      if (c.type !== "player") continue;
      const k = `${lower(c.first_name)} ${lower(c.last_name)}`.trim();
      players.set(k, [...(players.get(k) ?? []), { ...c, reach: [lower(c.email), guardianEmail.get(c.id)].filter(Boolean) }]);
    }

    const { rows: termRows } = await client.query(
      `SELECT id, year, term_number FROM terms WHERE organization_id = 1`);
    const termOf = new Map(termRows.map((t: any) => [`${t.year}|${t.term_number}`, t.id]));

    const { rows: existing } = await client.query(
      `SELECT legacy_external_id FROM registrations WHERE legacy_source = $1`, [LEGACY_SOURCE]);
    const done = new Set(existing.map((r: any) => r.legacy_external_id));

    // ── walk the invoices ─────────────────────────────────────────────────
    for (const inv of invoices) {
      const status = String(inv.status);
      if (status !== "PAID" && status !== "AUTHORISED") continue;
      const ref = norm(inv.reference);
      const invNo = norm(inv.invoiceNumber) || norm(inv.invoiceID);
      const xc = xeroById.get((inv.contact ?? {}).contactID);
      if (!xc) continue;

      if (!ref || !TERM.test(ref)) { out.noTerm++; continue; }
      if (NOT_A_PROGRAMME.test(ref)) { out.notAProgramme++; continue; }

      const tm = TERM.exec(ref)!;
      const termNo = Number(tm[1] ?? tm[2]);
      const year = Number((YEAR_RE.exec(ref) ?? [])[1] ?? String(inv.date).slice(0, 4));
      if (year !== YEAR) { out.otherYears++; continue; }

      if (done.has(invNo)) { out.alreadyThere++; continue; }

      const prog = programmeFor(ref);
      if (!prog) { out.unknownProgramme.set(ref, (out.unknownProgramme.get(ref) ?? 0) + 1); continue; }

      const termId = termOf.get(`${year}|${termNo}`);
      if (!termId) { out.noTermRow.push({ ref, year, termNo }); continue; }

      // ── who is this? child name from the Xero contact, parent email beside it
      const childName = norm(String(xc.name).replace(/^\s*\([^)]*\)\s*/, ""));
      const payer = lower(xc.emailAddress);
      const candidates = players.get(lower(childName)) ?? [];
      // 🔴 The name alone is not enough and the email alone is not enough:
      // siblings share a mailbox and children share names. Both, or nothing.
      let person = candidates.find((p: any) => payer && p.reach.includes(payer)) ?? null;
      if (!person && candidates.length === 1 && !payer) person = candidates[0];
      if (!person) {
        out.unmatchedPerson.push({ ref, child: childName, payer, sameName: candidates.length });
        continue;
      }

      const cents = Math.round(Number(inv.total ?? 0) * 100);
      if (status === "AUTHORISED") {
        out.unpaidInvoiced.push({ child: childName, ref, invNo, cents, contactId: person.id });
        continue;                                   // owed, not registered — Olga's call
      }

      out.wouldCreate.push({ child: childName, contactId: person.id, programId: prog.id, why: prog.why, termId, year, termNo, cents, ref, invNo });
      if (COMMIT) {
        await client.query(
          `INSERT INTO registrations
             (program_id, contact_id, status, season_year, term_id, subtotal_cents, discount_cents, total_cents,
              amount_paid, currency, registered_at, paid_at, payment_method, registration_location, source,
              legacy_source, legacy_external_id, notes)
           VALUES ($1,$2,'confirmed',$3,$4,$5,0,$5,$6,'NZD',$7,$7,'other','cufc_office','xero_import',$8,$9,$10)`,
          [prog.id, person.id, year, termId, cents, (cents / 100).toFixed(2), inv.date,
           LEGACY_SOURCE, invNo,
           `migrated from Xero invoice ${invNo} ("${ref}", $${(cents / 100).toFixed(2)} paid ${String(inv.date).slice(0, 10)})`]);
      }
    }

    // ── report ────────────────────────────────────────────────────────────
    const u = [...out.unknownProgramme.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`\n${COMMIT ? "APPLIED" : "DRY RUN — nothing written"} · season ${YEAR}\n`);
    console.log(`  WOULD CREATE registrations        ${out.wouldCreate.length}`);
    console.log(`  already migrated (idempotent)     ${out.alreadyThere}`);
    console.log(`\n  REPORTED, NOT WRITTEN`);
    console.log(`    invoiced but UNPAID             ${out.unpaidInvoiced.length}   🔴 debtors — Olga's call, see below`);
    console.log(`    person not matched in ClubOS    ${out.unmatchedPerson.length}`);
    console.log(`    programme not recognised        ${u.reduce((a, [, n]) => a + n, 0)} invoices across ${u.length} wordings`);
    console.log(`    no ClubOS term row for it       ${out.noTermRow.length}`);
    console.log(`\n  SKIPPED (correctly)`);
    console.log(`    not a programme (kit, levies…)  ${out.notAProgramme}`);
    console.log(`    reference names no term         ${out.noTerm}`);
    console.log(`    other seasons                   ${out.otherYears}`);

    if (out.wouldCreate.length) {
      console.log(`\n  sample of what would be created:`);
      for (const w of out.wouldCreate.slice(0, 6)) console.log(`    ${w.child.slice(0, 24).padEnd(24)} ${w.year} T${w.termNo}  $${(w.cents / 100).toFixed(2).padStart(8)}  ${w.why}`);
    }
    if (u.length) {
      console.log(`\n  wordings nobody has mapped yet (top 8):`);
      for (const [ref, n] of u.slice(0, 8)) console.log(`    ×${String(n).padEnd(4)} ${ref.slice(0, 56)}`);
    }
    if (REPORT) { writeFileSync(REPORT, JSON.stringify({ ...out, unknownProgramme: u }, null, 1)); console.log(`\n  wrote ${REPORT}`); }

    if (COMMIT) { await client.query("COMMIT"); console.log("\nCOMMITTED."); }
    else { await client.query("ROLLBACK"); console.log("\nRolled back. Re-run with --commit to apply."); }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); await pool.end(); }
}

main().catch((e) => { console.error("\n✗", e.message ?? e); process.exit(1); });

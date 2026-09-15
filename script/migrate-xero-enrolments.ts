// The four years nobody has any enrolments for.
//
// Daniel, 2026-09-11: "we should have a full unification, migration and merge
// between all of our databases of all time — clubos, fm, xero, and shopify."
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 WHAT WAS ACTUALLY MISSING — and it is not what it first looked like.
//
// History does NOT belong in `registrations`; it belongs in
// `fm_registration_history` (the standing rule). That table already covers
// 2021–2026, because Friendly Manager's export went back to 2021 and no further.
// **2017, 2018, 2019 and 2020 hold ZERO enrolments against 6,951 real payments
// and $1,098,495.77.** Four years where the club knows the money came in and
// nothing about who was enrolled in what.
//
// 🔴 THE PAYMENT REFERENCE IS USELESS FOR THOSE YEARS AND THE LINE ITEM IS GOLD.
// 2,629 of the 2,867 distinct references are a bare number — "2679", "3119" —
// carrying nothing. (That is also the bug behind the ~50 payments filed under
// season_year 2031–2099: the import's `\b(20\d\d)\b` matched a bare number.)
// The INVOICE LINE ITEMS say "Term 4 - U13 - U17 players: U17", which names the
// programme, the age group and the term.
//
// 🔴 A LINE ITEM IS NOT AUTOMATICALLY AN ENROLMENT. Uniform, socks, name prints,
// Mainland levies, referee fees, sanitiser and Spiideo are all on the same
// invoices. Anything not recognised as a programme is skipped and COUNTED, never
// guessed into an enrolment.
//
//   npx tsx --env-file=.env script/migrate-xero-enrolments.ts [--commit]
//        [--from 2017] [--to 2020] [--report f.json]
// ─────────────────────────────────────────────────────────────────────────────
import pg from "pg";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const COMMIT = process.argv.includes("--commit");
const FROM = Number(arg("from", "2017")), TO = Number(arg("to", "2020"));
const SRC = arg("src", "../../outputs/xero-contacts-migration/source/xero-invoices-20260915.json");
const ORG = 1;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

/** Not a programme fee. Kit, levies, printing, a referee's annual charge. */
const NOT_A_PROGRAMME = /levies|levy|uniform|sock|short|t-?shirt|shirt|jacket|beanie|glove|hoodie|track|cap\b|boots|bag\b|name print|number print|name and number|printing|sanitiz|spiideo|referee|mainland fee|photo|donation|sponsor|late fee|admin fee|credit note|discount|refund|equipment|ball\b|water bottle|drink bottle|medal|trophy|yellow card|red card|\bfine\b|playing service|^\s*(main package|extras)\s*:?\s*$|services?$/i;

/** A programme somebody was enrolled in. */
const IS_A_PROGRAMME = /academy|technification|skill\s*centre|funi|first kicks|players\b|programme|program\b|training fee|trial|online course|holiday|camp\b|tournament|international cup|\bcic\b|goalkeeper|morning|development|session\(s\)|pre-?academy|winter|summer|clinic|tovo|entry fee|registration|term\s*[1-4]/i;

const TERM_RE = /\b(?:term\s*([1-4])|t\s?([1-4])\b)/i;
const norm = (s: any) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * What the line says, in words a human recognises. Deliberately coarse: the
 * verbatim description is kept in `raw_json`, so this only has to be good
 * enough to group by — it must never invent a precision the source lacks.
 */
function programmeOf(desc: string): string {
  const s = desc.toLowerCase();
  if (/technification/.test(s)) return "Technification";
  if (/skill\s*centre/.test(s)) return "Skill Centre";
  if (/trial/.test(s)) return "Trials";
  if (/online course/.test(s)) return "Online Course";
  if (/goalkeeper/.test(s)) return "Goalkeeper";
  if (/morning/.test(s)) return "Morning Programme";
  if (/holiday|camp\b/.test(s)) return "Holiday Programme";
  if (/international cup|\bcic\b|tournament|entry fee/.test(s)) return "Tournament";
  if (/clinic|tovo/.test(s)) return "Training Clinic";
  if (/winter/.test(s)) return "Winter Season";
  if (/registration/.test(s)) return "Registration (programme not stated)";
  if (/funi|first kicks|u\s?[4-8]\b/.test(s)) return "FUNiño / U4–U8";
  if (/pre-?academy/.test(s)) return "Pre-Academy";
  if (/academy|players\b|training fee|programme|program\b|session\(s\)/.test(s)) return "Academy";
  return "Programme (unspecified)";
}

/** The age group, only when the line actually states one. Never inferred. */
function ageGroupOf(desc: string): string | null {
  const m = /\bu\s?(\d{1,2})\b/i.exec(desc);
  return m ? `U${m[1]}` : null;
}

async function main() {
  const raw = JSON.parse(readFileSync(SRC, "utf8"));
  const invoices: any[] = raw.rows ?? raw;
  const inRange = invoices.filter(i => {
    const y = Number(String(i.date ?? "").slice(0, 4));
    return y >= FROM && y <= TO;
  });

  const client = await pool.connect();
  const stat = { invoices: inRange.length, resolved: 0, unresolved: 0, lines: 0, enrolments: 0, notAProgramme: 0, unclassified: 0, wroteRows: 0, already: 0 };
  const unclassified = new Map<string, number>();
  const byProgramme = new Map<string, number>();

  try {
    // ── who each invoice belongs to ────────────────────────────────────────
    // 🔴 RESOLVED THROUGH WORK ALREADY PROVEN, never by re-matching names. The
    // payments migration matched these families on the child's name AND the
    // payer's email; re-deriving it here would be a second, divergent answer to
    // a question already settled. An invoice number that reached a payment row
    // carries that row's contact.
    const nums = [...new Set(inRange.map(i => norm(i.invoiceNumber)).filter(Boolean))];
    const { rows: paid } = await client.query(
      `SELECT fee_number, max(contact_id) AS cid FROM fm_payment_history
       WHERE source='xero' AND fee_number = ANY($1::text[]) AND contact_id IS NOT NULL
       GROUP BY 1`, [nums]);
    const byInvoice = new Map<string, number>(paid.map((r: any) => [r.fee_number, Number(r.cid)]));

    // …then carry that answer across to the same Xero CONTACT's other invoices.
    // A family that paid in 2019 is the same Xero contact in 2017, so an unpaid
    // or un-imported invoice of theirs still lands on the right person.
    const byXeroContact = new Map<string, number>();
    for (const inv of inRange) {
      const cid = byInvoice.get(norm(inv.invoiceNumber));
      const xid = inv.contact?.contactID;
      if (cid && xid && !byXeroContact.has(xid)) byXeroContact.set(xid, cid);
    }

    // 🔴 A merged duplicate must never receive history — it resolves to the
    // record that absorbed it, or four years of enrolments land on a person no
    // search can reach.
    const allCids = [...new Set([...byInvoice.values(), ...byXeroContact.values()])];
    const { rows: merged } = await client.query(
      `SELECT id, merged_into_contact_id m FROM contacts WHERE id = ANY($1::int[]) AND merged_into_contact_id IS NOT NULL`, [allCids]);
    const survivorOf = new Map<number, number>(merged.map((r: any) => [r.id, Number(r.m)]));
    const resolve = (id?: number) => (id == null ? undefined : survivorOf.get(id) ?? id);

    // ── existing rows, so a re-run writes nothing ─────────────────────────
    const { rows: seen } = await client.query(
      `SELECT fm_person_id, term_id, programme_group FROM fm_registration_history WHERE source='xero'`);
    const done = new Set(seen.map((r: any) => `${r.fm_person_id}|${r.term_id}|${r.programme_group}`));

    const toWrite: any[] = [];
    for (const inv of inRange) {
      const year = Number(String(inv.date ?? "").slice(0, 4));
      const cid = resolve(byInvoice.get(norm(inv.invoiceNumber)) ?? byXeroContact.get(inv.contact?.contactID));
      if (!cid) { stat.unresolved++; continue; }
      stat.resolved++;

      for (const li of inv.lineItems ?? []) {
        const desc = norm(li.description);
        stat.lines++;
        if (!desc) { stat.unclassified++; continue; }
        if (NOT_A_PROGRAMME.test(desc)) { stat.notAProgramme++; continue; }
        if (!IS_A_PROGRAMME.test(desc)) {
          stat.unclassified++;
          unclassified.set(desc, (unclassified.get(desc) ?? 0) + 1);
          continue;
        }
        stat.enrolments++;

        const tm = TERM_RE.exec(desc);
        const termNo = tm ? Number(tm[1] ?? tm[2]) : 0;   // 0 = the line names no term
        const programme = programmeOf(desc);
        const age = ageGroupOf(desc);
        const group = age ? `${programme} ${age}` : programme;
        byProgramme.set(group, (byProgramme.get(group) ?? 0) + 1);

        // 🔴 A SYNTHETIC term id in a range Friendly Manager's real ids (13–9026)
        // can never reach, so the two vocabularies cannot collide.
        const termId = year * 10 + termNo;
        const key = `xero:${cid}|${termId}|${group}`;
        if (done.has(key)) { stat.already++; continue; }
        done.add(key);
        toWrite.push({
          contactId: cid,
          fmPersonId: `xero:${cid}`,
          termId,
          termName: termNo ? `Term ${termNo} ${year}` : `${year} (term not stated)`,
          year,
          group,
          raw: {
            source: "xero invoice line item",
            invoiceNumber: inv.invoiceNumber, invoiceID: inv.invoiceID,
            date: String(inv.date ?? "").slice(0, 10),
            reference: norm(inv.reference) || null,
            description: desc,                       // verbatim, always
            unitAmount: li.unitAmount, quantity: li.quantity,
            xeroContactID: inv.contact?.contactID ?? null,
            xeroContactName: inv.contact?.name ?? null,
          },
        });
      }
    }

    console.log(`\n${COMMIT ? "APPLYING" : "DRY RUN — nothing is written"}   ${FROM}–${TO}\n`);
    console.log(`  invoices in range          ${stat.invoices.toLocaleString()}`);
    console.log(`  …belonging to a known person ${stat.resolved.toLocaleString()}`);
    console.log(`  …no person we can name     ${stat.unresolved.toLocaleString()}`);
    console.log(`  line items read            ${stat.lines.toLocaleString()}`);
    console.log(`    enrolments               ${stat.enrolments.toLocaleString()}`);
    console.log(`    kit, levies, fees etc.   ${stat.notAProgramme.toLocaleString()}  (deliberately not enrolments)`);
    console.log(`    unclassified             ${stat.unclassified.toLocaleString()}  (skipped, never guessed)`);
    console.log(`  new enrolment rows         ${toWrite.length.toLocaleString()}`);
    console.log(`  already on file            ${stat.already.toLocaleString()}`);
    console.log(`\n  what those enrolments are:`);
    for (const [k, v] of [...byProgramme].sort((a, b) => b[1] - a[1]).slice(0, 14))
      console.log(`    ${k.slice(0, 34).padEnd(36)} ${String(v).padStart(5)}`);
    if (unclassified.size) {
      console.log(`\n  top unclassified (a human may want to teach the rules these):`);
      for (const [k, v] of [...unclassified].sort((a, b) => b[1] - a[1]).slice(0, 10))
        console.log(`    ×${String(v).padStart(4)} ${k.slice(0, 62)}`);
    }

    if (COMMIT && toWrite.length) {
      await client.query("BEGIN");
      const CH = 500;
      for (let i = 0; i < toWrite.length; i += CH) {
        const chunk = toWrite.slice(i, i + CH);
        const params: any[] = [];
        const values = chunk.map((r, j) => {
          const b = j * 9;
          params.push(ORG, r.contactId, r.fmPersonId, r.termId, r.termName, r.year, r.group, "xero", JSON.stringify(r.raw));
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9}::jsonb)`;
        }).join(",");
        const res = await client.query(
          `INSERT INTO fm_registration_history
             (organization_id, contact_id, fm_person_id, term_id, term_name, season_year, programme_group, source, raw_json)
           VALUES ${values}
           ON CONFLICT (fm_person_id, term_id, programme_group) DO NOTHING`, params);
        stat.wroteRows += res.rowCount ?? 0;
      }
      // Prove it: every year in range now has enrolments on file.
      const { rows: check } = await client.query(
        `SELECT season_year y, count(*)::int n FROM fm_registration_history
         WHERE source='xero' AND season_year BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [FROM, TO]);
      if (check.length !== (TO - FROM + 1)) throw new Error(`only ${check.length} of ${TO - FROM + 1} years got enrolments — rolling back`);
      const { rows: [{ orphan }] } = await client.query(
        `SELECT count(*)::int orphan FROM fm_registration_history h
         LEFT JOIN contacts c ON c.id = h.contact_id
         WHERE h.source='xero' AND (c.id IS NULL OR c.merged_into_contact_id IS NOT NULL)`);
      if (orphan) throw new Error(`${orphan} enrolment(s) landed on a missing or retired contact — rolling back`);
      await client.query("COMMIT");
      console.log(`\n  written: ${stat.wroteRows.toLocaleString()}`);
      for (const c of check) console.log(`    ${c.y}: ${c.n} enrolments now on file`);
      console.log("\nCOMMITTED.\n");
    } else if (COMMIT) {
      console.log("\n  Nothing new to write.\n");
    } else {
      console.log("\nRolled back. Re-run with --commit to apply.\n");
    }

    const report = arg("report", "");
    if (report) {
      mkdirSync("outputs/xero-enrolments", { recursive: true });
      writeFileSync(report, JSON.stringify({ stat, byProgramme: [...byProgramme], unclassified: [...unclassified].sort((a, b) => b[1] - a[1]).slice(0, 300) }, null, 1));
      console.log(`  report → ${report}`);
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); await pool.end(); }
}

main().catch(e => { console.error("\n✗", e.message ?? e); process.exit(1); });

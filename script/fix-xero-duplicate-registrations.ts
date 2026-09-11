// Undo the double-counting my own Xero import created.
//
// Daniel, 2026-09-11: "a lot of players now showing $320 paid for term u4-u8 but
// one player should only cost $160 — is that us now double counting clubos and
// xero or parents actually paid twice? we need to iron this out and make sure
// everything in our software is actually accurate."
//
// 🔴 IT WAS US. `migrate-xero-registrations.ts` keyed idempotency on the XERO
// INVOICE NUMBER, which correctly stops the same invoice importing twice and is
// completely blind to the child ALREADY being registered for that term from
// Friendly Manager or a ClubOS checkout. $320 is $160 twice.
//
// The real natural key for "is this person already on this programme this term"
// is (contact, programme, term). The import now enforces that; this repairs the
// rows it wrote before it did.
//
// TWO SHAPES, both repaired the same way — keep exactly one registration per
// (contact, programme, term):
//   A. 46 Xero rows sitting on top of an existing FM or ClubOS registration.
//   B.  8 pairs of Xero rows, identical reference and amount under two invoice
//      numbers (duplicate Xero contacts, or an invoice re-issued).
//
// 🔴 ONLY ROWS THIS IMPORT CREATED ARE EVER DELETED (`legacy_source='xero'`),
// and a pre-existing row always wins. Nothing a human entered is touched.
//
// 🔴 THE MONEY IS NOT LOST. Every payment lives in `fm_payment_history`, keyed
// on Xero's paymentID — that is the record the accounts team reads, and it is
// untouched here. If a family genuinely paid twice, the payment rows still say
// so; a duplicate REGISTRATION never did.
//
//   npx tsx --env-file=.env script/fix-xero-duplicate-registrations.ts [--commit]
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Every (contact, programme, term) holding more than one live registration,
    // with the row we intend to KEEP chosen first: a non-Xero row if there is
    // one, else the lowest id.
    const { rows: doomed } = await client.query(`
      WITH ranked AS (
        SELECT r.id, r.contact_id, r.program_id, r.term_id, r.legacy_source, r.total_cents,
               row_number() OVER (
                 PARTITION BY r.contact_id, r.program_id, r.term_id
                 ORDER BY (coalesce(r.legacy_source,'') = 'xero') ASC, r.id ASC
               ) AS keep_rank,
               count(*) OVER (PARTITION BY r.contact_id, r.program_id, r.term_id) AS in_group
        FROM registrations r
        WHERE r.term_id IS NOT NULL
          AND r.status IN ('confirmed','refunded','partially_refunded')
      )
      SELECT id, contact_id, program_id, term_id, total_cents
      FROM ranked
      WHERE in_group > 1 AND keep_rank > 1
        -- 🔴 never delete anything this import did not create
        AND legacy_source = 'xero'`);

    const cents = doomed.reduce((a: number, r: any) => a + Number(r.total_cents || 0), 0);
    console.log(`\n${COMMIT ? "APPLIED" : "DRY RUN — nothing deleted"}\n`);
    console.log(`  duplicate registrations to remove : ${doomed.length}`);
    console.log(`  phantom money they were adding    : $${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);

    if (COMMIT && doomed.length) {
      const ids = doomed.map((r: any) => r.id);
      await client.query(`DELETE FROM registrations WHERE id = ANY($1) AND legacy_source = 'xero'`, [ids]);
    }

    // Prove it: after this, nobody is on one programme twice in one term.
    const { rows: left } = await client.query(`
      SELECT count(*)::int n FROM (
        SELECT 1 FROM registrations WHERE term_id IS NOT NULL
          AND status IN ('confirmed','refunded','partially_refunded')
        GROUP BY contact_id, program_id, term_id HAVING count(*) > 1) x`);
    console.log(`  people still doubled up           : ${left[0].n}${COMMIT ? "  ← must be 0" : "  (before the fix)"}`);

    if (COMMIT) {
      if (Number(left[0].n) !== 0) throw new Error(`${left[0].n} duplicates remain — rolling back rather than half-fixing`);
      await client.query("COMMIT");
      console.log("\nCOMMITTED.");
    } else {
      await client.query("ROLLBACK");
      console.log("\nRolled back. Re-run with --commit to apply.");
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); await pool.end(); }
}

main().catch((e) => { console.error("\n✗", e.message ?? e); process.exit(1); });

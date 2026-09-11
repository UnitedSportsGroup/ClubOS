// One child stored as two contact records — merged into one, auditably.
//
// Daniel, 2026-09-11: the Technification Term 3 list read **64** for **60**
// children. Four of them (Joel Cook, Jordy Cook, Luca Murdoch, Xan Nuthall)
// exist twice — an original ClubOS/Friendly-Manager record and a second one the
// Xero contacts import created — so each is registered twice and shows $300
// against a $150 term. It is the same double-count Daniel caught on the roll,
// but caused by two PEOPLE rows rather than two registration rows, which is
// exactly why the (contact, programme, term) dedupe could not see it.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE REPOINT LIST IS READ FROM information_schema, NEVER HAND-WRITTEN.
// 26 foreign keys point at `contacts`. A hand-kept list is one migration away
// from silently leaving a child's payments attached to a record nobody can see.
//
// 🔴 NOTHING IS OVERWRITTEN. Neither record is a superset of the other — the
// original holds the school, medical notes, emergency contact, consents and NZF
// identity; the import holds the email, phone, address and FM id. Blank fields
// on the survivor are filled from the loser; a field where BOTH hold a value is
// left alone and REPORTED. A child's date of birth is never silently picked.
//
// 🔴 THE SURVIVOR IS THE OLDER RECORD. It is the one other systems have had
// longest to reference, and here it is also the one carrying the safeguarding
// data. Reported per pair so it is never a surprise.
//
// 🔴 MONEY IS NEVER TOUCHED. `fm_payment_history` rows are repointed, never
// edited or removed: what a family paid is unchanged, it simply all lands on one
// person. Only the duplicate REGISTRATION is removed, and only where the other
// record already holds the same programme and term.
//
//   npx tsx --env-file=.env script/merge-duplicate-contacts.ts            # dry run
//   npx tsx --env-file=.env script/merge-duplicate-contacts.ts --commit
// ─────────────────────────────────────────────────────────────────────────────
import pg from "pg";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

pg.types.setTypeParser(1082, (v: string) => v); // DATE stays a plain string

const COMMIT = process.argv.includes("--commit");
const BY_USER = 1; // Daniel — who owns this merge
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

/** survivor first, absorbed second. Both ids are stated, never discovered, so a
 *  bad name match can never quietly merge two different children. */
const PAIRS: { who: string; keep: number; absorb: number }[] = [
  { who: "Joel Cook",     keep: 617,   absorb: 32764 },
  { who: "Jordy Cook",    keep: 616,   absorb: 32765 },
  { who: "Luca Murdoch",  keep: 31114, absorb: 35901 },
  { who: "Xan Nuthall",   keep: 30735, absorb: 36042 },
];

const REAL = ["confirmed", "refunded", "partially_refunded"];
const blank = (v: any) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

/** Unique on `contacts`, so these are moved rather than copied (see below). */
const UNIQUE_ON_CONTACTS = ["friendly_manager_id"];

/** Columns we never copy between records — identity of the ROW, not the person. */
const NEVER_COPY = new Set(["id", "created_at", "merged_into_contact_id", "merged_at", "merged_by_user_id", "merged_note"]);

async function main() {
  const client = await pool.connect();
  const notes: string[] = [];
  let removedRegs = 0, movedRows = 0, droppedDupRows = 0, filledFields = 0, conflicts = 0;

  try {
    await client.query("BEGIN");

    // ── the migration, in the same transaction as the merge ──────────────────
    await client.query(readFileSync("migrations/2026-09-11_contact_merge.sql", "utf8"));

    // ── every FK that points at contacts.id, from the catalogue ─────────────
    const { rows: fks } = await client.query(`
      SELECT tc.table_name AS tbl, kcu.column_name AS col
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'contacts' AND ccu.column_name = 'id'
        AND tc.table_name <> 'contacts'
      ORDER BY 1, 2`);
    console.log(`\n${COMMIT ? "APPLYING" : "DRY RUN — nothing is written"}\n`);

    // 🔴 A repointed row does not record where it came from, so the merge would
    // otherwise be irreversible: we would know 32764 went into 617 and never
    // which of 617's rows used to be its. Every affected row is written to disk
    // BEFORE anything moves, so an undo is always possible.
    const snapshot: any = { takenAt: new Date().toISOString(), pairs: PAIRS, tables: {} as any };
    for (const { keep, absorb } of PAIRS) {
      for (const { tbl, col } of fks) {
        const { rows } = await client.query(`SELECT * FROM "${tbl}" WHERE "${col}" = ANY($1::int[])`, [[keep, absorb]]);
        if (rows.length) (snapshot.tables[`${tbl}.${col}`] ??= []).push(...rows);
      }
      const { rows: people } = await client.query(`SELECT * FROM contacts WHERE id = ANY($1::int[])`, [[keep, absorb]]);
      (snapshot.tables["contacts"] ??= []).push(...people);
    }
    const snapPath = `outputs/contact-merges/2026-09-11-before.json`;
    mkdirSync("outputs/contact-merges", { recursive: true });
    writeFileSync(snapPath, JSON.stringify(snapshot, null, 1));
    console.log(`  snapshot of every affected row written to ${snapPath}`);

    console.log(`  ${fks.length} foreign keys point at contacts; every one is repointed.\n`);

    // Unique constraints that a repoint can collide with. Where the survivor
    // already holds the equivalent row, the loser's copy is dropped rather than
    // forced — two attendance rows for one child on one session is not a fact.
    const COLLIDE: Record<string, string[]> = {
      "attendance.contact_id": ["camp_date_id"],
      "contact_relationships.player_id": ["guardian_id"],
      "contact_relationships.guardian_id": ["player_id"],
      "club_squad_members.contact_id": ["squad_id", "role"],
    };

    for (const { who, keep, absorb } of PAIRS) {
      console.log(`─── ${who}: ${absorb} → ${keep}`);

      const { rows: both } = await client.query(`SELECT * FROM contacts WHERE id = ANY($1::int[])`, [[keep, absorb]]);
      const S = both.find((r: any) => r.id === keep);
      const L = both.find((r: any) => r.id === absorb);
      if (!S || !L) throw new Error(`${who}: one of ${keep}/${absorb} does not exist`);

      // Guards. Each one has to be able to fail, or it is decoration.
      if (S.merged_into_contact_id) throw new Error(`${who}: ${keep} has itself been merged into ${S.merged_into_contact_id}`);
      if (L.merged_into_contact_id === keep) { console.log(`     already merged — nothing to do\n`); continue; }
      if (L.merged_into_contact_id) throw new Error(`${who}: ${absorb} is already merged into ${L.merged_into_contact_id}`);
      const name = (c: any) => `${String(c.first_name ?? "").trim().toLowerCase()} ${String(c.last_name ?? "").trim().toLowerCase()}`;
      if (name(S) !== name(L)) throw new Error(`${who}: "${name(S)}" and "${name(L)}" are not the same name — refusing`);
      if (S.type !== L.type) throw new Error(`${who}: ${S.type} vs ${L.type} — refusing to merge different kinds of person`);

      // ── field union: fill blanks, never overwrite, report every conflict ──
      const fill: Record<string, any> = {};
      for (const k of Object.keys(S)) {
        if (NEVER_COPY.has(k)) continue;
        if (blank(S[k]) && !blank(L[k])) { fill[k] = L[k]; filledFields++; }
        else if (!blank(S[k]) && !blank(L[k]) && String(S[k]) !== String(L[k])) {
          conflicts++;
          const line = `${who}: ${k} — keeping "${String(S[k]).slice(0, 40)}" (${keep}), NOT taking "${String(L[k]).slice(0, 40)}" (${absorb})`;
          notes.push(line);
          console.log(`     ⚠ ${k}: keeping ${keep}'s "${String(S[k]).slice(0, 30)}" over ${absorb}'s "${String(L[k]).slice(0, 30)}"`);
        }
      }
      if (Object.keys(fill).length) {
        console.log(`     filling ${Object.keys(fill).length} blank field(s) from ${absorb}: ${Object.keys(fill).join(", ")}`);
        // 🔴 A UNIQUE column is MOVED, never copied. `friendly_manager_id` is
        // unique on contacts, so writing it onto the survivor while the loser
        // still holds it is refused by the index — and leaving it only on the
        // retired record is worse than a failed merge: the survivor would have
        // no tie to Friendly Manager, and the next FM sync would create the
        // duplicate all over again. Clear it on the loser first, in the same
        // transaction.
        for (const u of UNIQUE_ON_CONTACTS) {
          if (u in fill && COMMIT) await client.query(`UPDATE contacts SET "${u}" = NULL WHERE id = $1`, [absorb]);
        }
        if (COMMIT) {
          const sets = Object.keys(fill).map((k, i) => `"${k}" = $${i + 2}`).join(", ");
          await client.query(`UPDATE contacts SET ${sets} WHERE id = $1`, [keep, ...Object.values(fill)]);
        }
      }

      // ── the duplicate registration ───────────────────────────────────────
      const { rows: regs } = await client.query(
        `SELECT id, contact_id, program_id, term_id, status, total_cents, legacy_source
         FROM registrations WHERE contact_id = ANY($1::int[]) AND status::text = ANY($2::text[])
         ORDER BY program_id, term_id, id`, [[keep, absorb], REAL]);
      const seen = new Map<string, any>();
      for (const r of regs) {
        const k = `${r.program_id}|${r.term_id ?? "none"}`;
        const prev = seen.get(k);
        if (!prev) { seen.set(k, r); continue; }
        // Same programme, same term, two rows: keep the one that is NOT from the
        // Xero import (the original the office or a parent actually made), then
        // the lower id. Identical rule to the registration-level dedupe.
        const score = (x: any) => (x.legacy_source === "xero" ? 1 : 0) * 1e9 + x.id;
        const [win, lose] = score(prev) <= score(r) ? [prev, r] : [r, prev];
        seen.set(k, win);
        console.log(`     duplicate registration: prog ${lose.program_id} term ${lose.term_id} — removing #${lose.id} (${lose.legacy_source ?? "clubos"}, ${money(lose.total_cents ?? 0)}), keeping #${win.id} (${win.legacy_source ?? "clubos"})`);
        removedRegs++;
        if (COMMIT) await client.query(`DELETE FROM registrations WHERE id = $1`, [lose.id]);
      }

      // ── repoint everything else ──────────────────────────────────────────
      for (const { tbl, col } of fks) {
        const key = `${tbl}.${col}`;
        const { rows: [{ n }] } = await client.query(`SELECT count(*)::int n FROM "${tbl}" WHERE "${col}" = $1`, [absorb]);
        if (!n) continue;
        const on = COLLIDE[key];
        let dropped = 0;
        if (on && COMMIT) {
          // Drop the loser's row only where the survivor already holds the
          // equivalent — otherwise the unique index refuses the whole merge.
          const where = on.map((c, i) => `l."${c}" = s."${c}"`).join(" AND ");
          const res = await client.query(
            `DELETE FROM "${tbl}" l WHERE l."${col}" = $1
               AND EXISTS (SELECT 1 FROM "${tbl}" s WHERE s."${col}" = $2 AND ${where})`, [absorb, keep]);
          dropped = res.rowCount ?? 0;
          droppedDupRows += dropped;
        }
        const left = n - dropped;
        console.log(`     ${key}: ${left} row(s) move${dropped ? `, ${dropped} dropped as already present on ${keep}` : ""}`);
        movedRows += left;
        if (COMMIT) await client.query(`UPDATE "${tbl}" SET "${col}" = $1 WHERE "${col}" = $2`, [keep, absorb]);
      }

      if (COMMIT) {
        await client.query(
          `UPDATE contacts SET merged_into_contact_id = $1, merged_at = now(), merged_by_user_id = $2, merged_note = $3
           WHERE id = $4`,
          [keep, BY_USER, `Duplicate of ${keep}; created by the Xero contacts import. Merged 2026-09-11.`, absorb]);
      }
      console.log("");
    }

    // ── prove it ─────────────────────────────────────────────────────────────
    if (COMMIT) {
      for (const { who, keep, absorb } of PAIRS) {
        for (const { tbl, col } of fks) {
          const { rows: [{ n }] } = await client.query(`SELECT count(*)::int n FROM "${tbl}" WHERE "${col}" = $1`, [absorb]);
          if (n) throw new Error(`${who}: ${tbl}.${col} still holds ${n} row(s) for ${absorb} — rolling back`);
        }
        const { rows: [{ n }] } = await client.query(
          `SELECT count(*)::int n FROM (SELECT 1 FROM registrations WHERE contact_id = $1 AND status::text = ANY($2::text[])
             GROUP BY program_id, term_id HAVING count(*) > 1) x`, [keep, REAL]);
        if (n) throw new Error(`${who}: ${keep} is still on ${n} programme/term twice — rolling back`);
      }
      const { rows: [{ n: stillDup }] } = await client.query(`
        SELECT count(*)::int n FROM (
          SELECT lower(c.first_name)||' '||lower(c.last_name)
          FROM registrations r JOIN contacts c ON c.id = r.contact_id
          WHERE r.program_id = 5 AND r.term_id = 7 AND r.status::text = ANY($1::text[])
          GROUP BY 1 HAVING count(*) > 1) x`, [REAL]);
      if (stillDup) throw new Error(`Technification Term 3 still lists ${stillDup} name(s) twice — rolling back`);
    }

    const { rows: [tech] } = await client.query(
      `SELECT count(*)::int n FROM registrations WHERE program_id = 5 AND term_id = 7 AND status::text = ANY($1::text[])`, [REAL]);
    const { rows: [fun] } = await client.query(
      `SELECT count(*)::int n FROM registrations WHERE program_id = 4 AND term_id = 7 AND status::text = ANY($1::text[])`, [REAL]);

    console.log(`  duplicate registrations removed  ${removedRegs}`);
    console.log(`  rows moved onto the survivor     ${movedRows}`);
    console.log(`  rows dropped as already present  ${droppedDupRows}`);
    console.log(`  blank fields filled in           ${filledFields}`);
    console.log(`  field conflicts left for a human ${conflicts}`);
    console.log(`\n  Technification Term 3 now reads  ${tech.n}`);
    console.log(`  FUNiño Term 3 now reads          ${fun.n}`);
    if (notes.length) {
      console.log(`\n  🔴 A HUMAN MUST CONFIRM:`);
      for (const n of notes) console.log(`     • ${n}`);
    }

    if (COMMIT) { await client.query("COMMIT"); console.log("\nCOMMITTED.\n"); }
    else { await client.query("ROLLBACK"); console.log("\nRolled back. Re-run with --commit to apply.\n"); }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); await pool.end(); }
}

main().catch((e) => { console.error("\n✗", e.message ?? e); process.exit(1); });

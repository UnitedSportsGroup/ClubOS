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

/** The four Daniel named by hand on 2026-09-11 — already applied, kept as the
 *  worked example. `--auto` discovers the rest. */
const HAND_PICKED: { who: string; keep: number; absorb: number }[] = [
  { who: "Joel Cook",     keep: 617,   absorb: 32764 },
  { who: "Jordy Cook",    keep: 616,   absorb: 32765 },
  { who: "Luca Murdoch",  keep: 31114, absorb: 35901 },
  { who: "Xan Nuthall",   keep: 30735, absorb: 36042 },
];

const AUTO = process.argv.includes("--auto");
/** `--tier=safe` (default) merges only groups the records agree on. */
const TIER = (process.argv.find(a => a.startsWith("--tier=")) ?? "--tier=safe").split("=")[1];

/**
 * A group is a set of contact records that share a FULL NAME *and* a family.
 *
 * 🔴 FAMILY IS MATCHED ON THE GUARDIAN'S EMAIL, not the guardian's record id.
 * The Shopify import created new GUARDIAN records too — Xan Nuthall's mother
 * exists twice — so grouping on a shared guardian id alone finds only half of
 * them and would leave a child split across two "families".
 *
 * 🔴 A GROUP IS ONLY SAFE WHEN THE RECORDS AGREE ON THE CHILD'S DATE OF BIRTH.
 * 38 groups hold two different dates for one name; age grade is
 * `seasonYear − birthYear`, so picking one decides which session a child trains
 * in. Those are reported for a human and never merged automatically.
 */
async function findGroups(client: pg.PoolClient) {
  const { rows } = await client.query(`
    WITH linked AS (
      SELECT p.id AS person,
             lower(trim(p.first_name))||' '||lower(trim(p.last_name)) AS who,
             p.date_of_birth AS dob, p.friendly_manager_id AS fm,
             coalesce(lower(nullif(trim(g.email),'')), 'gid:'||g.id::text) AS family
      FROM contact_relationships cr
      JOIN contacts p ON p.id = cr.player_id AND p.merged_into_contact_id IS NULL
      JOIN contacts g ON g.id = cr.guardian_id
    )
    SELECT who, family,
           count(DISTINCT dob) FILTER (WHERE dob IS NOT NULL)::int AS distinct_dobs,
           count(DISTINCT fm) FILTER (WHERE fm IS NOT NULL)::int AS distinct_fms,
           array_agg(DISTINCT person ORDER BY person) AS ids
    FROM linked
    WHERE who <> ' '
    GROUP BY who, family
    HAVING count(DISTINCT person) > 1
    ORDER BY count(DISTINCT person) DESC`);
  return rows as { who: string; family: string; distinct_dobs: number; distinct_fms: number; ids: number[] }[];
}

/**
 * Which record survives.
 *
 * 🔴 The one carrying the most SUBSTANCE, not the lowest id. A duplicate made by
 * an import holds one payment; the record a human has been using holds the
 * registrations, the attendance and the squad place. Keeping the wrong one would
 * technically work — everything moves either way — but it throws away the id
 * that staff links, bookmarks and the Sporty register already point at.
 * Ties break to the lowest id, which is the oldest.
 */
async function pickSurvivors(client: pg.PoolClient, groups: number[][]): Promise<number[]> {
  const all = groups.flat();
  if (!all.length) return [];
  const { rows } = await client.query(`
    SELECT c.id,
      (SELECT count(*) FROM registrations r WHERE r.contact_id=c.id AND r.status::text = ANY($2::text[]))::int regs,
      (SELECT count(*) FROM fm_payment_history f WHERE f.contact_id=c.id)::int pays,
      (SELECT count(*) FROM attendance a WHERE a.contact_id=c.id)::int att,
      (SELECT count(*) FROM club_squad_members m WHERE m.contact_id=c.id)::int squad
    FROM contacts c WHERE c.id = ANY($1::int[])`, [all, REAL]);
  const by = new Map<number, any>(rows.map((r: any) => [r.id, r]));
  const score = (id: number) => { const r = by.get(id) ?? {}; return (r.regs ?? 0) * 1e6 + (r.squad ?? 0) * 1e5 + (r.att ?? 0) * 1e4 + (r.pays ?? 0); };
  return groups.map(ids => [...ids].sort((a, b) => score(b) - score(a) || a - b)[0]);
}

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

  // 🔴 THE MIGRATION RUNS FIRST AND ON ITS OWN — NEVER INSIDE THE MERGE.
  // `ALTER TABLE contacts` takes an ACCESS EXCLUSIVE lock and Postgres holds it
  // until the transaction ends, so running it inside a merge that takes minutes
  // blocks every read of `contacts` across live ClubOS for the whole run — and
  // it must first queue behind the app's in-flight readers to get the lock at
  // all. Even `ADD COLUMN IF NOT EXISTS` on an existing column takes it.
  const { rows: [{ present }] } = await client.query(
    `SELECT count(*)::int present FROM information_schema.columns
     WHERE table_name='contacts' AND column_name='merged_into_contact_id'`);
  if (!present) {
    console.log("  applying the merge columns (its own short transaction)…");
    await client.query(readFileSync("migrations/2026-09-11_contact_merge.sql", "utf8"));
  }

  try {
    console.log(`\n${COMMIT ? "APPLYING" : "DRY RUN — nothing is written"}\n`);

    // 🔴 EVERY STATEMENT IS BULK. The first version worked one pair at a time:
    // 512 pairs × 26 foreign keys is ~27,000 round trips, and at the ~90ms this
    // link actually costs that is over an hour — long enough that the pooler
    // killed the connection mid-merge. Work is done in SQL against a mapping
    // table instead, which is ~70 statements and seconds.
    const fks = (await client.query(`
      SELECT tc.table_name AS tbl, kcu.column_name AS col
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'contacts' AND ccu.column_name = 'id'
        AND tc.table_name <> 'contacts'
      ORDER BY 1, 2`)).rows as { tbl: string; col: string }[];

    // ── who is being merged ─────────────────────────────────────────────────
    const PAIRS: { who: string; keep: number; absorb: number }[] = [];
    const held: { who: string; ids: number[]; reason: string }[] = [];
    if (AUTO) {
      const groups = await findGroups(client);
      // 🔴 TWO REASONS TO REFUSE, and both mean "these may not be one child":
      //   · two different dates of birth — age grade is seasonYear − birthYear,
      //     so picking one decides which session they train in;
      //   · two different Friendly Manager ids — FM itself treated them as two
      //     people, and that is a stronger claim than a matching name.
      const why = (g: any) =>
        g.distinct_dobs > 1 ? `${g.distinct_dobs} different dates of birth`
        : g.distinct_fms > 1 ? `${g.distinct_fms} different Friendly Manager ids`
        : null;
      const eligible = groups.filter(g => !(TIER === "safe" && why(g)));
      for (const g of groups) { const r = why(g); if (r && TIER === "safe") held.push({ who: g.who, ids: g.ids, reason: r }); }
      // One query picks every survivor, not one query per group.
      const keeps = await pickSurvivors(client, eligible.map(g => g.ids));
      eligible.forEach((g, i) => { for (const id of g.ids) if (id !== keeps[i]) PAIRS.push({ who: g.who, keep: keeps[i], absorb: id }); });
      console.log(`  ${groups.length} duplicate groups · ${eligible.length} to merge · ${PAIRS.length} records absorbed · ${held.length} held back\n`);
    } else {
      PAIRS.push(...HAND_PICKED);
    }
    if (PAIRS.length === 0) { console.log("  Nothing to merge.\n"); return; }

    const everyId = [...new Set(PAIRS.flatMap(p => [p.keep, p.absorb]))];
    const absorbIds = PAIRS.map(p => p.absorb);
    const keepOf = new Map(PAIRS.map(p => [p.absorb, p.keep]));
    const whoOf = new Map(PAIRS.map(p => [p.absorb, p.who]));

    // ── the snapshot: one query per table, and it doubles as our working copy ─
    // 🔴 A repointed row does not record where it came from, so without this the
    // merge is irreversible: we would know 32764 went into 617 and never which
    // of 617's rows used to be its.
    const snapshot: any = { takenAt: new Date().toISOString(), pairs: PAIRS, tables: {} as any };
    const holders = new Map<string, Set<number>>();
    for (const { tbl, col } of fks) {
      const { rows } = await client.query(`SELECT * FROM "${tbl}" WHERE "${col}" = ANY($1::int[])`, [everyId]);
      if (!rows.length) continue;
      snapshot.tables[`${tbl}.${col}`] = rows;
      holders.set(`${tbl}.${col}`, new Set(rows.map((r: any) => Number(r[col]))));
    }
    const { rows: people } = await client.query(`SELECT * FROM contacts WHERE id = ANY($1::int[])`, [everyId]);
    snapshot.tables["contacts"] = people;
    mkdirSync("outputs/contact-merges", { recursive: true });
    const snapPath = `outputs/contact-merges/before${AUTO ? "-auto" : "-handpicked"}.json`;
    writeFileSync(snapPath, JSON.stringify(snapshot, null, 1));
    console.log(`  snapshot of ${Object.values(snapshot.tables).reduce((a: number, v: any) => a + v.length, 0)} affected rows → ${snapPath}`);
    console.log(`  ${fks.length} foreign keys point at contacts; every one is repointed.\n`);

    const byId = new Map<number, any>(people.map((c: any) => [c.id, c]));

    // ── guards, per pair, in memory ─────────────────────────────────────────
    const nameOf = (c: any) => `${String(c.first_name ?? "").trim().toLowerCase()} ${String(c.last_name ?? "").trim().toLowerCase()}`;
    for (const { who, keep, absorb } of PAIRS) {
      const S = byId.get(keep), L = byId.get(absorb);
      if (!S || !L) throw new Error(`${who}: ${keep}/${absorb} — one of them does not exist`);
      if (S.merged_into_contact_id) throw new Error(`${who}: ${keep} has itself been merged into ${S.merged_into_contact_id}`);
      if (L.merged_into_contact_id && L.merged_into_contact_id !== keep) throw new Error(`${who}: ${absorb} is already merged into ${L.merged_into_contact_id}`);
      if (nameOf(S) !== nameOf(L)) throw new Error(`${who}: "${nameOf(S)}" vs "${nameOf(L)}" — not the same name, refusing`);
      if (S.type !== L.type) throw new Error(`${who}: ${S.type} vs ${L.type} — refusing to merge different kinds of person`);
    }

    // ── field union, computed in memory, written as ONE statement ───────────
    // Blanks are filled from the absorbed record; a field where both hold a
    // value is LEFT ALONE and reported. Nothing about a child is guessed.
    // 🔴 A CONFLICT IS ONLY INTERESTING IF IT IS A FACT ABOUT THE CHILD.
    // `tags` and `notes` are import bookkeeping ("shopify-import"), and a
    // first/last split that differs while the FULL name matches is the same
    // name written two ways ("Joaquim Huertas"+"Porto" vs "Joaquim"+"Huertas
    // Porto"). Reporting those alongside a disputed date of birth buries the
    // one that matters in 300 that do not.
    const BOOKKEEPING = new Set(["tags", "notes", "first_name", "last_name"]);
    const fills = new Map<number, Record<string, any>>();
    let conflicts = 0, bookkeeping = 0;
    for (const { who, keep, absorb } of PAIRS) {
      const S = byId.get(keep), L = byId.get(absorb);
      const target = fills.get(keep) ?? {};
      for (const k of Object.keys(S)) {
        if (NEVER_COPY.has(k)) continue;
        const cur = blank(target[k]) ? S[k] : target[k];
        if (blank(cur) && !blank(L[k])) target[k] = L[k];
        else if (!blank(cur) && !blank(L[k]) && String(cur) !== String(L[k])) {
          if (BOOKKEEPING.has(k)) { bookkeeping++; continue; }
          conflicts++;
          notes.push(`${who}: ${k} — keeping "${String(cur).slice(0, 40)}" (${keep}), NOT taking "${String(L[k]).slice(0, 40)}" (${absorb})`);
        }
      }
      if (Object.keys(target).length) fills.set(keep, target);
    }
    const fillCols = [...new Set([...fills.values()].flatMap(f => Object.keys(f)))];
    console.log(`  ${fills.size} surviving record(s) gain a value they were missing, across ${fillCols.length} field(s)`);
    console.log(`  ${conflicts} real field conflict(s) reported and left alone (+${bookkeeping} import tags/name-splits ignored)\n`);

    if (COMMIT && fillCols.length) {
      await client.query("BEGIN");
      // 🔴 A UNIQUE column is MOVED, not copied — friendly_manager_id is unique,
      // and leaving it on the retired record would leave the survivor with no
      // tie to Friendly Manager, so the next sync recreates the duplicate.
      for (const u of UNIQUE_ON_CONTACTS)
        if (fillCols.includes(u)) await client.query(`UPDATE contacts SET "${u}" = NULL WHERE id = ANY($1::int[])`, [absorbIds]);
      // 🔴 EVERY VALUE IS CAST TO THE COLUMN'S REAL TYPE. A VALUES list types
      // an untyped parameter as text, and `contacts.gender` is an enum, so the
      // COALESCE failed with "types text and gender_type cannot be matched".
      // Read the types rather than special-casing the one that bit us — the
      // next enum column added to contacts would fail the same way.
      const { rows: typeRows } = await client.query(
        `SELECT column_name, udt_name FROM information_schema.columns WHERE table_name = 'contacts'`);
      const typeOf = new Map<string, string>(typeRows.map((r: any) => [r.column_name, r.udt_name]));
      const cast = (c: string) => {
        const t = typeOf.get(c) ?? "text";
        return t.startsWith("_") ? `${t.slice(1)}[]` : t;
      };
      const entries = [...fills.entries()];
      const params: any[] = [];
      const values = entries.map(([id, f], i) => {
        const base = i * (fillCols.length + 1);
        params.push(id, ...fillCols.map(c => f[c] ?? null));
        return `($${base + 1}::int, ${fillCols.map((c, j) => `$${base + 2 + j}::${cast(c)}`).join(", ")})`;
      }).join(", ");
      await client.query(
        `UPDATE contacts c SET ${fillCols.map(k => `"${k}" = COALESCE(v."${k}", c."${k}")`).join(", ")}
         FROM (VALUES ${values}) AS v(id, ${fillCols.map(k => `"${k}"`).join(", ")})
         WHERE c.id = v.id`, params);
    } else if (COMMIT) {
      await client.query("BEGIN");
    }
    if (!COMMIT) await client.query("BEGIN");

    // ── the mapping table every bulk statement below joins to ──────────────
    await client.query(`CREATE TEMP TABLE merge_map (absorb int PRIMARY KEY, keep int NOT NULL) ON COMMIT DROP`);
    await client.query(`INSERT INTO merge_map SELECT * FROM unnest($1::int[], $2::int[])`,
      [absorbIds, PAIRS.map(p => p.keep)]);

    // ── the duplicate registration ─────────────────────────────────────────
    // Same child, same programme, same term, twice. Keep the row that is NOT
    // from an import (the one the office or a parent actually made), then the
    // lower id. Money is untouched: payments live in fm_payment_history.
    const { rows: regs } = await client.query(
      `SELECT r.id, r.contact_id, r.program_id, r.term_id, r.total_cents, r.legacy_source
       FROM registrations r WHERE r.contact_id = ANY($1::int[]) AND r.status::text = ANY($2::text[])`,
      [everyId, REAL]);
    const bySeat = new Map<string, any[]>();
    for (const r of regs) {
      const owner = keepOf.get(r.contact_id) ?? r.contact_id;
      const k = `${owner}|${r.program_id}|${r.term_id ?? "none"}`;
      bySeat.set(k, [...(bySeat.get(k) ?? []), r]);
    }
    const doomed: number[] = [];
    let doomedCents = 0;
    for (const [, rows] of bySeat) {
      if (rows.length < 2) continue;
      const score = (x: any) => (x.legacy_source ? 1 : 0) * 1e9 + x.id;
      const sorted = [...rows].sort((a, b) => score(a) - score(b));
      for (const lose of sorted.slice(1)) { doomed.push(lose.id); doomedCents += Number(lose.total_cents ?? 0); }
    }
    console.log(`  ${doomed.length} duplicate registration(s) collapse (${money(doomedCents)} of phantom seats)`);
    if (COMMIT && doomed.length) await client.query(`DELETE FROM registrations WHERE id = ANY($1::int[])`, [doomed]);

    // ── repoint everything, one statement per table ────────────────────────
    const COLLIDE: Record<string, string[]> = {
      "attendance.contact_id": ["camp_date_id"],
      "contact_relationships.player_id": ["guardian_id"],
      "contact_relationships.guardian_id": ["player_id"],
      "club_squad_members.contact_id": ["squad_id", "role"],
    };
    let moved = 0, dropped = 0;
    for (const { tbl, col } of fks) {
      const key = `${tbl}.${col}`;
      if (!holders.has(key)) continue;
      const on = COLLIDE[key];
      if (COMMIT && on) {
        // 🔴 DEDUPE AGAINST THE WHOLE RESULT, not just against the survivor.
        // The first version dropped an absorbed row only where the SURVIVOR
        // already held the equivalent — but a child merged from six records has
        // six links to the same parent, and after repointing they collide with
        // each other. Vinn Hill (12 records) broke on exactly that.
        //
        // Group by what the row will look like AFTER the repoint and keep one:
        // the survivor's own row first (it is the one staff have been using),
        // then the lowest id.
        const part = ["COALESCE(m.keep, t.\"" + col + "\")", ...on.map(c => `t."${c}"`)].join(", ");
        const r = await client.query(
          `DELETE FROM "${tbl}" WHERE id IN (
             SELECT id FROM (
               SELECT t.id, row_number() OVER (PARTITION BY ${part}
                                               ORDER BY (m.keep IS NOT NULL), t.id) rn
               FROM "${tbl}" t LEFT JOIN merge_map m ON m.absorb = t."${col}"
               WHERE t."${col}" = ANY($1::int[])) x
             WHERE x.rn > 1)`, [everyId]);
        dropped += r.rowCount ?? 0;
      }
      const r = COMMIT
        ? await client.query(`UPDATE "${tbl}" l SET "${col}" = m.keep FROM merge_map m WHERE l."${col}" = m.absorb`)
        : { rowCount: (snapshot.tables[key] ?? []).filter((x: any) => absorbIds.includes(Number(x[col]))).length };
      console.log(`  ${key.padEnd(40)} ${String(r.rowCount ?? 0).padStart(5)} rows move`);
      moved += r.rowCount ?? 0;
    }
    console.log(`  ${"".padEnd(40)} ${String(moved).padStart(5)} total${dropped ? `, ${dropped} dropped as already present` : ""}\n`);

    // ── retire the absorbed records ────────────────────────────────────────
    if (COMMIT) await client.query(
      `UPDATE contacts c SET merged_into_contact_id = m.keep, merged_at = now(), merged_by_user_id = $1,
              merged_note = 'Duplicate of ' || m.keep || '; merged ' || to_char(now(),'YYYY-MM-DD')
       FROM merge_map m WHERE c.id = m.absorb`, [BY_USER]);

    // ── prove it ───────────────────────────────────────────────────────────
    if (COMMIT) {
      for (const { tbl, col } of fks) {
        const { rows: [{ n }] } = await client.query(`SELECT count(*)::int n FROM "${tbl}" WHERE "${col}" = ANY($1::int[])`, [absorbIds]);
        if (n) throw new Error(`${tbl}.${col} still holds ${n} row(s) for a retired record — rolling back`);
      }
      const { rows: [{ n: stillTwice }] } = await client.query(`
        SELECT count(*)::int n FROM (
          SELECT 1 FROM registrations WHERE contact_id = ANY($1::int[]) AND status::text = ANY($2::text[])
          GROUP BY contact_id, program_id, term_id HAVING count(*) > 1) x`, [everyId, REAL]);
      if (stillTwice) throw new Error(`${stillTwice} survivor(s) still on one programme/term twice — rolling back`);
      const { rows: [{ n: unretired }] } = await client.query(
        `SELECT count(*)::int n FROM contacts WHERE id = ANY($1::int[]) AND merged_into_contact_id IS NULL`, [absorbIds]);
      if (unretired) throw new Error(`${unretired} absorbed record(s) were not retired — rolling back`);
    }

    if (held.length) {
      console.log(`  🔴 HELD BACK — these records disagree on the child's date of birth, and age`);
      console.log(`     grade is seasonYear − birthYear, so choosing one decides which session`);
      console.log(`     they train in. ${held.length} group(s), nothing merged:`);
      for (const h of held.slice(0, 20)) console.log(`     • ${h.who} (${h.ids.length} records) — ${h.reason}`);
      if (held.length > 20) console.log(`     … and ${held.length - 20} more`);
      writeFileSync("outputs/contact-merges/held-for-a-human.json", JSON.stringify(held, null, 1));
      console.log(`     all of them → outputs/contact-merges/held-for-a-human.json`);
    }
    if (notes.length) {
      writeFileSync("outputs/contact-merges/conflicts.txt", notes.join("\n"));
      console.log(`\n  🔴 ${notes.length} field conflict(s) → outputs/contact-merges/conflicts.txt`);
      for (const n of notes.slice(0, 12)) console.log(`     • ${n}`);
      if (notes.length > 12) console.log(`     … and ${notes.length - 12} more`);
    }

    if (COMMIT) { await client.query("COMMIT"); console.log("\nCOMMITTED.\n"); }
    else { await client.query("ROLLBACK"); console.log("\nRolled back. Re-run with --commit to apply.\n"); }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); await pool.end(); }
}

main().catch((e) => { console.error("\n✗", e.message ?? e); process.exit(1); });

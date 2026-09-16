/**
 * Import the 2026 CIC Summer 7's registrations of interest and registered teams.
 *
 * Isaac asked (via Daniel, 2026-09-16) for last year's list in ClubOS so the
 * mailer can reach it, and for the 2026 teams as historical data.
 *
 *   npx tsx --env-file=.env script/import-cic7s-2026.ts [--commit]
 *
 * Dry run by default. Idempotent: re-running changes nothing, because every row
 * is keyed on what the source actually states.
 *
 * ── What is and is not asserted ──────────────────────────────────────────────
 * 🔴 Every submission in the interest sheet is kept, including the twelve
 * addresses that appear more than once. Two of those are DIFFERENT PEOPLE
 * SHARING A MAILBOX (Cody Lamond and Leo Lamond Okeefe; Idrees Hamid and Samuel
 * Pickering), so de-duplicating on email would delete real registrations. The
 * mailer dedupes by address when it builds an audience — the only place it
 * matters.
 *
 * 🔴 A team's payment state is read from the sheet's OWN boolean columns, never
 * parsed out of the breakdown text. That column holds "$495 + $495", "*$795",
 * "Paul to call" and "TBC"; turning it into money would be a reconstruction
 * presented as a record. It rides verbatim in the notes instead.
 *
 * 🔴 No 2026 entry fee is recorded, because nobody ever stated one. The sheet
 * shows at least six different totals and the asterisks are unexplained.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import type { Cic7sEntryPayment } from "@shared/cic7s";

const COMMIT = process.argv.includes("--commit");
const EDITION = 2026;
const SRC = path.join(process.cwd(), "../../outputs/cic7s/2026-import/source");

/** Minimal RFC-4180 CSV reader — the source has quoted fields with commas. */
function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift()!.map((h) => h.trim());
  return rows
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const TRUE = (v: string) => v.trim().toUpperCase() === "TRUE";

/** Read the sheet's booleans, never the money text. */
function entryPayment(r: Record<string, string>): Cic7sEntryPayment {
  if (/refund/i.test(r["Breakdown"] || "")) return "refunded";
  if (TRUE(r["Full Payment"])) return "paid";
  if (TRUE(r["1st Deposit"]) || TRUE(r["2nd Deposit"])) return "part_paid";
  return "unpaid";
}

/** "Carlisle reeve" vs "Carlisle Reeve" vs "Garbs " — compare people loosely. */
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const words = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
const initials = (s: string) => words(s).map((w) => w[0]).join("");

/**
 * Is the team contact the same person as this interest row?
 *
 * 🔴 Tiered, and anything below an exact match is REPORTED rather than applied
 * silently — because the reason we match on name at all is that two of these
 * mailboxes are shared by different people. Getting it wrong would hang one
 * person's team on another person's registration.
 *
 * The two weak matches in the real data are both unmistakable:
 *   "TC" ←→ Tom Clarkson (tom@designsight.co.nz)
 *   "Simeon Alexander James Sharpley" ←→ AJ Sharpley (sajsmail@yahoo.co.nz)
 */
function samePerson(contact: string, first: string, last: string): "exact" | "surname" | "initials" | null {
  const regoFull = nameKey(`${first} ${last}`);
  if (!contact.trim() || !regoFull) return null;
  if (nameKey(contact) === regoFull) return "exact";

  const cw = words(contact), rw = words(`${first} ${last}`);
  // Same surname AND a first name that is not a different name: an initial, a
  // shortening, or one of the contact's other given names.
  if (cw.length && rw.length && cw[cw.length - 1] === rw[rw.length - 1]) {
    const cGiven = cw.slice(0, -1), rGiven = rw.slice(0, -1);
    const shares = cGiven.some((a) => rGiven.some((b) => a === b || a.startsWith(b) || b.startsWith(a)));
    // 🔴 A SUBSEQUENCE of the contact's initials, not a prefix. "AJ Sharpley" is
    // Simeon **A**lexander **J**ames Sharpley — the second and third initials —
    // so a prefix rule ("sa") misses the one real case in this data.
    const cInit = cGiven.map((w) => w[0]).join("");
    const rInit = rGiven.join("").length <= 3 ? rGiven.join("") : rGiven.map((w) => w[0]).join("");
    let j = 0;
    for (const ch of cInit) if (j < rInit.length && rInit[j] === ch) j++;
    const initialsMatch = rInit.length > 0 && j === rInit.length;
    if (shares || initialsMatch) return "surname";
  }
  // The contact is written as the initials of the registered name, or vice versa.
  if (cw.length === 1 && cw[0] === initials(`${first} ${last}`)) return "initials";
  if (rw.length === 1 && rw[0] === initials(contact)) return "initials";
  return null;
}

async function main() {
  const interest = readCsv(path.join(SRC, "registrations-of-interest.csv"));
  const teams = [
    ...readCsv(path.join(SRC, "teams-mens.csv")).map((r) => ({ ...r, _cat: "Mens" })),
    ...readCsv(path.join(SRC, "teams-social-masters.csv")).map((r) => ({ ...r, _cat: "Social + Masters" })),
  ].filter((r) => (r["Team Name"] || "").trim());

  console.log(`\nCIC 7's ${EDITION} — ${COMMIT ? "IMPORTING" : "DRY RUN"}`);
  console.log(`  ${interest.length} registrations of interest · ${teams.length} registered teams\n`);

  const orgRes: any = await db.execute(sql`SELECT id FROM organizations WHERE slug = 'christchurch-international-cup'`);
  let orgId = (orgRes.rows ?? orgRes)[0]?.id;
  if (!orgId) {
    const fallback: any = await db.execute(sql`SELECT DISTINCT organization_id AS id FROM cic7s_registrations LIMIT 1`);
    orgId = (fallback.rows ?? fallback)[0]?.id;
  }
  if (!orgId) throw new Error("could not find the CIC organisation");
  console.log(`  CIC organisation: ${orgId}`);

  let inserted = 0, attached = 0, created = 0, skipped = 0;
  const notes: string[] = [];

  await db.transaction(async (tx) => {
    // ── 1. Every interest submission, exactly as recorded ─────────────────
    for (const r of interest) {
      const email = (r["Email"] || "").trim();
      if (!email) { notes.push(`interest row with no email: ${r["First Name"]} ${r["Last Name"]}`); continue; }
      const submittedAt = r["Date"] ? new Date(r["Date"]) : null;
      // The natural key of a SUBMISSION: who, when, which grade.
      const dupe: any = await tx.execute(sql`
        SELECT id FROM cic7s_registrations
        WHERE organization_id = ${orgId} AND edition_year = ${EDITION}
          AND lower(email) = ${email.toLowerCase()}
          AND created_at = ${submittedAt}
        LIMIT 1`);
      if ((dupe.rows ?? dupe).length) { skipped++; continue; }

      // "Called?" is the only progress the sheet records. TRUE means somebody
      // spoke to them; blank is not FALSE, it is unrecorded — so both read 'new'.
      const status = TRUE(r["Called?"]) ? "contacted" : "new";
      const staffNotes = [r["Notes:"], r[""]].filter((x) => x && x.trim()).join(" · ") || null;

      await tx.execute(sql`
        INSERT INTO cic7s_registrations
          (organization_id, edition_year, first_name, last_name, email, location, phone,
           category, status, notes, source_url, created_at)
        VALUES (${orgId}, ${EDITION}, ${r["First Name"] || "—"}, ${r["Last Name"] || null}, ${email},
                ${r["Location"] || null}, ${r["Phone Number"] || null},
                ${r["Tournament Category"] || null}, ${status}, ${staffNotes},
                ${"google-sheet:registrations-of-interest-2026"}, ${submittedAt})`);
      inserted++;
    }

    // ── 2. The teams, attached to their manager's interest row where there is one ──
    for (const t of teams) {
      const email = (t["Email"] || "").trim();
      const contact = (t["Team Contact"] || "").trim();
      const payment = entryPayment(t);
      const breakdown = [t["Breakdown"], t["Top Up Payment Link"] ? null : null, t[""]]
        .filter((x) => x && String(x).trim()).join(" · ");
      const teamNotes = [`2026 entry: ${t["Team Name"]}`, breakdown].filter(Boolean).join(" · ");

      // Idempotency: a team already on file is not imported again. Without this
      // a second run would create a fresh row for every team, because the
      // candidate lookup below deliberately ignores rows that already carry one.
      const already: any = await tx.execute(sql`
        SELECT id FROM cic7s_registrations
        WHERE organization_id = ${orgId} AND edition_year = ${EDITION} AND team_name = ${t["Team Name"]}
        LIMIT 1`);
      if ((already.rows ?? already).length) { skipped++; continue; }

      // 🔴 Match on email AND name. Two of these mailboxes are shared by
      // different people, so email alone would hang Idrees Hamid's team on
      // Samuel Pickering's registration.
      let target: number | null = null;
      if (email) {
        const cands: any = await tx.execute(sql`
          SELECT id, first_name, last_name FROM cic7s_registrations
          WHERE organization_id = ${orgId} AND edition_year = ${EDITION}
            AND lower(email) = ${email.toLowerCase()} AND team_name IS NULL
          ORDER BY created_at DESC`);
        const rows = (cands.rows ?? cands) as any[];
        let how: string | null = null;
        for (const tier of ["exact", "surname", "initials"] as const) {
          const hit = rows.find((c) => samePerson(contact, c.first_name || "", c.last_name || "") === tier);
          if (hit) { target = hit.id; how = tier; break; }
        }
        if (how && how !== "exact") {
          const hit = rows.find((c) => c.id === target)!;
          notes.push(`"${t["Team Name"]}": matched ${contact} to ${hit.first_name} ${hit.last_name || ""} on ${how} (${email}) — check this one`);
        }
        if (rows.length && !target) {
          notes.push(`"${t["Team Name"]}" (${contact}) shares ${email} with someone who is NOT them — new row created rather than attached`);
        }
      }

      if (target) {
        await tx.execute(sql`
          UPDATE cic7s_registrations
             SET team_name = ${t["Team Name"]}, entry_payment = ${payment}, status = 'entered',
                 notes = NULLIF(concat_ws(' · ', NULLIF(notes,''), ${teamNotes}::text), '')
           WHERE id = ${target}`);
        attached++;
      } else {
        // A team whose manager never registered interest — 8 of 25 did not,
        // and 4 have no email on file at all. They are still real entries.
        const [first, ...rest] = (contact || t["Team Name"]).split(/\s+/);
        await tx.execute(sql`
          INSERT INTO cic7s_registrations
            (organization_id, edition_year, first_name, last_name, email, phone,
             category, status, team_name, entry_payment, notes, source_url)
          VALUES (${orgId}, ${EDITION}, ${first || "—"}, ${rest.join(" ") || null},
                  ${email || ""}, ${t["Phone"] || null}, ${t._cat}, 'entered',
                  ${t["Team Name"]}, ${payment}, ${teamNotes},
                  ${"google-sheet:registered-team-contacts-2026"})`);
        created++;
      }
    }

    const check: any = await tx.execute(sql`
      SELECT
        count(*) FILTER (WHERE edition_year = ${EDITION})::int AS y2026,
        count(*) FILTER (WHERE edition_year = 2027)::int       AS y2027,
        count(*) FILTER (WHERE edition_year = ${EDITION} AND team_name IS NOT NULL)::int AS teams,
        count(*) FILTER (WHERE edition_year IS NULL)::int      AS unfiled
      FROM cic7s_registrations WHERE organization_id = ${orgId}`);
    const c = (check.rows ?? check)[0];
    console.log(`\n  interest inserted ${inserted}   already there ${skipped}`);
    console.log(`  teams attached to an existing registration ${attached}   created new ${created}`);
    console.log(`\n  after: ${c.y2026} rows for 2026 (${c.teams} of them teams) · ${c.y2027} for 2027 · ${c.unfiled} unfiled`);
    if (notes.length) { console.log("\n  worth knowing:"); notes.forEach((n) => console.log(`    - ${n}`)); }

    if (Number(c.teams) !== teams.length) throw new Error(`team rows ${c.teams} ≠ source ${teams.length}`);
    if (!COMMIT) { console.log("\n  DRY RUN — rolling back, nothing written.\n"); throw new Error("__ROLLBACK__"); }
  }).catch((e: any) => { if (e?.message !== "__ROLLBACK__") throw e; });

  if (COMMIT) console.log("\n  ✓ committed\n");
  process.exit(0);
}
main();

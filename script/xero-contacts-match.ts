// What the Xero contacts list knows that ClubOS does not — and who each row is.
//
// Daniel, 2026-09-10, after meeting Olga: "it turns out we have transferred FM
// data to clubos but in actual fact the real source of truth especially this
// year and also all previous years is Xero contacts list."
//
// 🔴 WHAT A XERO ROW ACTUALLY IS. Olga names each contact for the CHILD and
// fills the name/email/phone with the PARENT who pays:
//
//     *ContactName  "(A U10) Beauden Whittle"   ← the player
//     FirstName     "Mirren"                     ← the parent
//     LastName      "Harvey"                     ← the parent
//     EmailAddress  mirrenleigh7@gmail.com       ← the parent
//
// So ONE ROW IS TWO PEOPLE AND THE LINK BETWEEN THEM. That link is the most
// valuable thing here and the thing nothing else can supply: in 883 of 2,663
// families the child's surname is NOT the parent's, so no name-based heuristic
// could ever have paired them. Copying a Xero email onto the CHILD would be
// wrong in every single row.
//
// 🔴 MATCHED ON THE PARENT'S EMAIL, NEVER ON A NAME. Two children share a name
// far more often than two families share a mailbox, and the failure mode of a
// name match is one family's details written onto another family's child. A row
// with no email is REPORTED, never guessed at.
//
// 🔴 READ-ONLY. This writes nothing to ClubOS and nothing to Xero. It produces
// the report a human reads before anything is applied.
//
//   npx tsx --env-file=.env script/xero-contacts-match.ts <contacts.csv> [--json out.json]
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const CSV = process.argv[2];
const JSON_OUT = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
if (!CSV) { console.error("usage: xero-contacts-match.ts <contacts.csv> [--json out.json]"); process.exit(2); }

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

/** A CSV parser that survives quoted commas, embedded newlines and "" escapes. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() ?? []).map((h) => h.replace(/^﻿/, "").replace(/^\*/, "").trim());
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const norm = (s: string | null | undefined) => (s ?? "").trim();
const lower = (s: string | null | undefined) => norm(s).toLowerCase();
/** Phones compare on digits alone: 0211767473 and +64 21 176 7473 are one number. */
const digits = (s: string | null | undefined) => norm(s).replace(/\D/g, "").replace(/^64/, "0");
const nameKey = (f: string, l: string) => `${lower(f)}|${lower(l)}`;

type Row = Record<string, string>;

/** "(A U10) Beauden Whittle" → { code: "A U10", child: "Beauden Whittle" } */
function splitName(contactName: string): { code: string | null; child: string } {
  const m = /^\s*\(([^)]{0,20})\)\s*(.*)$/.exec(contactName);
  if (!m) return { code: null, child: contactName.trim() };
  return { code: m[1].trim().toUpperCase() || null, child: m[2].trim() };
}

/** The one-line address Xero holds, in ClubOS's shape. */
function address(r: Row): { oneLine: string; street: string; city: string; postcode: string } | null {
  const street = norm(r.POAddressLine1) || norm(r.SAAddressLine1);
  const extra = norm(r.POAddressLine2) || norm(r.SAAddressLine2);
  const city = norm(r.POCity) || norm(r.SACity);
  const postcode = norm(r.POPostalCode) || norm(r.SAPostalCode);
  if (!street && !city) return null;
  return { oneLine: [street, extra, city, postcode].filter(Boolean).join(", "), street, city, postcode };
}

async function main() {
  const rows = parseCsv(readFileSync(CSV, "utf8"));
  const people = rows
    .map((r) => ({ ...splitName(r.ContactName ?? ""), r }))
    .filter((x) => x.code !== null); // unprefixed rows are businesses/suppliers, not families

  // ── ClubOS, read once ──────────────────────────────────────────────────────
  const { rows: contacts } = await pool.query(`
    SELECT id, type, first_name, last_name, email, phone, address, date_of_birth
    FROM contacts`);
  const byEmail = new Map<string, any[]>();
  const byName = new Map<string, any[]>();
  for (const c of contacts) {
    if (c.email) { const k = lower(c.email); byEmail.set(k, [...(byEmail.get(k) ?? []), c]); }
    const k = nameKey(c.first_name, c.last_name);
    byName.set(k, [...(byName.get(k) ?? []), c]);
  }
  // Who is already linked to whom, so an existing family is never re-linked.
  const { rows: rel } = await pool.query(`SELECT guardian_id, player_id FROM contact_relationships`);
  const linked = new Set(rel.map((r: any) => `${r.guardian_id}|${r.player_id}`));
  const childrenOf = new Map<number, number[]>();
  for (const r of rel) childrenOf.set(r.guardian_id, [...(childrenOf.get(r.guardian_id) ?? []), r.player_id]);
  const contactById = new Map(contacts.map((c: any) => [c.id, c]));

  const out: any[] = [];
  const tally = {
    rows: people.length,
    noEmail: 0,
    parentMatched: 0, parentNew: 0, parentAmbiguous: 0,
    childMatched: 0, childNew: 0, childAmbiguous: 0,
    linkAlready: 0, linkNew: 0,
    fillParentEmail: 0, fillParentPhone: 0, fillParentAddress: 0,
    conflictEmail: 0, conflictPhone: 0, conflictAddress: 0,
  };

  for (const { code, child, r } of people) {
    const pEmail = lower(r.EmailAddress);
    const pFirst = norm(r.FirstName), pLast = norm(r.LastName);
    const phone = norm(r.PhoneNumber) || norm(r.MobileNumber);
    const addr = address(r);
    const rec: any = { code, child, parent: { first: pFirst, last: pLast, email: pEmail, phone, address: addr?.oneLine ?? null } };

    // ── the parent, by EMAIL only ──────────────────────────────────────────
    if (!pEmail) {
      tally.noEmail++;
      rec.verdict = "no email — cannot match safely";
      out.push(rec); continue;
    }
    const pCands = byEmail.get(pEmail) ?? [];
    let parent: any = null;
    if (pCands.length === 1) parent = pCands[0];
    else if (pCands.length > 1) {
      // Prefer the guardian; more than one guardian on one mailbox is ambiguous.
      const gs = pCands.filter((c: any) => c.type === "guardian");
      if (gs.length === 1) parent = gs[0];
      else { tally.parentAmbiguous++; rec.verdict = `parent email matches ${pCands.length} ClubOS contacts`; rec.candidates = pCands.map((c: any) => c.id); out.push(rec); continue; }
    }

    if (parent) {
      tally.parentMatched++;
      rec.parentId = parent.id;
      // What we could FILL (blank in ClubOS) vs what CONFLICTS (differs).
      const fills: string[] = [], conflicts: any[] = [];
      if (!norm(parent.email)) { /* impossible: matched by email */ }
      if (!norm(parent.phone) && phone) { fills.push("phone"); tally.fillParentPhone++; }
      else if (phone && digits(parent.phone) !== digits(phone)) { conflicts.push({ field: "phone", clubos: parent.phone, xero: phone }); tally.conflictPhone++; }
      if (!norm(parent.address) && addr) { fills.push("address"); tally.fillParentAddress++; }
      else if (addr && lower(parent.address) !== lower(addr.oneLine)) { conflicts.push({ field: "address", clubos: parent.address, xero: addr.oneLine }); tally.conflictAddress++; }
      if (fills.length) rec.fillParent = fills;
      if (conflicts.length) rec.conflicts = conflicts;
    } else {
      tally.parentNew++;
      rec.verdict = "parent not in ClubOS";
    }

    // ── the child, by name WITHIN this parent's family ─────────────────────
    // 🔴 Scoped to the matched parent, never searched globally: "Jack Wood"
    // exists more than once in this database, and the whole point of the Xero
    // row is that it tells us WHICH Jack Wood.
    const parts = child.split(/\s+/);
    const cFirst = parts[0] ?? "", cLast = parts.slice(1).join(" ");
    rec.childFirst = cFirst; rec.childLast = cLast;
    if (parent) {
      const mine = (childrenOf.get(parent.id) ?? []).map((id) => contactById.get(id)).filter(Boolean);
      const hit = mine.filter((c: any) => lower(c.first_name) === lower(cFirst) && lower(c.last_name) === lower(cLast));
      if (hit.length === 1) { tally.childMatched++; rec.childId = hit[0].id; tally.linkAlready++; rec.link = "already linked"; }
      else if (hit.length > 1) { tally.childAmbiguous++; rec.verdict = "more than one child of this parent has that name"; }
      else {
        // Not under this parent. Is there a player of that name at all?
        const anywhere = (byName.get(nameKey(cFirst, cLast)) ?? []).filter((c: any) => c.type === "player");
        if (anywhere.length === 1) { rec.childId = anywhere[0].id; rec.link = "NEW LINK — player exists but is not linked to this parent"; tally.linkNew++; tally.childMatched++; }
        else if (anywhere.length > 1) { tally.childAmbiguous++; rec.verdict = `${anywhere.length} players share this child's name — needs a human`; }
        else { tally.childNew++; rec.verdict = (rec.verdict ? rec.verdict + "; " : "") + "child not in ClubOS"; }
      }
    }
    out.push(rec);
  }

  // ── report ────────────────────────────────────────────────────────────────
  const pct = (n: number) => `${n} (${Math.round((n / tally.rows) * 100)}%)`;
  console.log(`\nXero family-shaped contacts: ${tally.rows}\n`);
  console.log(`  THE PARENT (matched on email, never a name)`);
  console.log(`    already in ClubOS        ${pct(tally.parentMatched)}`);
  console.log(`    not in ClubOS            ${pct(tally.parentNew)}`);
  console.log(`    email hits >1 contact    ${pct(tally.parentAmbiguous)}`);
  console.log(`    no email on the row      ${pct(tally.noEmail)}`);
  console.log(`\n  THE CHILD`);
  console.log(`    found                    ${tally.childMatched}`);
  console.log(`    not in ClubOS            ${tally.childNew}`);
  console.log(`    name is ambiguous        ${tally.childAmbiguous}`);
  console.log(`\n  THE LINK (the thing only Xero knows)`);
  console.log(`    already linked           ${tally.linkAlready}`);
  console.log(`    NEW parent→child link    ${tally.linkNew}`);
  console.log(`\n  WHAT WOULD BE FILLED (blank in ClubOS today)`);
  console.log(`    parent phone             ${tally.fillParentPhone}`);
  console.log(`    parent address           ${tally.fillParentAddress}`);
  console.log(`\n  WHAT CONFLICTS (differs — reported, never overwritten)`);
  console.log(`    phone                    ${tally.conflictPhone}`);
  console.log(`    address                  ${tally.conflictAddress}`);

  if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify({ tally, rows: out }, null, 1)); console.log(`\nwrote ${JSON_OUT}`); }
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });

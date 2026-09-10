// Bring the Xero contacts list into ClubOS: fill what is blank, link the
// families Xero knows about, and create the people ClubOS has never seen.
//
// Daniel, 2026-09-10: "the real source of truth especially this year and also
// all previous years is Xero contacts list... transfer all the correct details
// matched to the right player/parent profiles in clubos." His rule for
// disagreements: FILL BLANKS ONLY, report every conflict.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 ONE XERO ROW IS TWO PEOPLE AND THE LINK BETWEEN THEM.
//
//     *ContactName  "(A U10) Beauden Whittle"   ← the PLAYER
//     FirstName     "Mirren"                     ← the PARENT who pays
//     EmailAddress  mirrenleigh7@gmail.com       ← the PARENT
//
// In 883 of 2,663 rows the child's surname is NOT the parent's, so that link
// cannot be derived from names by anything, ever. It is the single most
// valuable thing in this file. And it is why the email must NEVER be written
// onto the child: it is the parent's mailbox, on the child's row.
//
// 🔴 MATCHED ON THE PARENT'S EMAIL, NEVER A NAME. Two children share a name far
// more often than two families share a mailbox, and the failure mode of a name
// match is one family's details landing on another family's child. Rows with no
// email, or whose email hits several ClubOS contacts, are REPORTED and skipped.
//
// 🔴 ONLY THE FAMILY CODES. Xero's prefixes are not all families: (CIC) are
// visiting academies, (MFL) are team names like "Big Bula's men", (S) are
// businesses like "Commodore Airport Hotel Ltd", (REF) are referees and (C) are
// coaches. Creating those as children with guardians would be nonsense, so this
// script only touches the codes in FAMILY_CODES and reports the rest untouched.
//
// 🔴 DRY RUN BY DEFAULT. Nothing is written without --commit.
//
//   npx tsx --env-file=.env script/apply-xero-contacts.ts <contacts.csv>
//   npx tsx --env-file=.env script/apply-xero-contacts.ts <contacts.csv> --commit
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const CSV = process.argv[2];
const COMMIT = process.argv.includes("--commit");
const REPORT = process.argv.includes("--report") ? process.argv[process.argv.indexOf("--report") + 1] : null;
if (!CSV) { console.error("usage: apply-xero-contacts.ts <contacts.csv> [--commit] [--report out.json]"); process.exit(2); }

/** The codes that really are "a child and the parent who pays for them". */
const FAMILY_CODES = (c: string | null) =>
  !!c && (/^A(\s|_|$)/.test(c) || /^A\s?U\d/.test(c) || c.startsWith("FS") || c === "G" || c.startsWith("JA"));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() ?? []).map((h) => h.replace(/^﻿/, "").replace(/^\*/, "").trim());
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const norm = (s: any) => String(s ?? "").trim();
const lower = (s: any) => norm(s).toLowerCase();
const digits = (s: any) => norm(s).replace(/\D/g, "").replace(/^64/, "0");

function splitName(n: string) {
  const m = /^\s*\(([^)]{0,20})\)\s*(.*)$/.exec(n);
  return m ? { code: m[1].trim().toUpperCase() || null, person: m[2].trim() } : { code: null, person: n.trim() };
}
function address(r: Record<string, string>) {
  const street = norm(r.POAddressLine1) || norm(r.SAAddressLine1);
  const extra = norm(r.POAddressLine2) || norm(r.SAAddressLine2);
  const city = norm(r.POCity) || norm(r.SACity);
  const postcode = norm(r.POPostalCode) || norm(r.SAPostalCode);
  if (!street && !city) return null;
  return { oneLine: [street, extra, city, postcode].filter(Boolean).join(", "), street, city, postcode };
}

async function main() {
  const client = await pool.connect();
  const actions = { fillPhone: [] as any[], fillAddress: [] as any[], link: [] as any[], newParent: [] as any[], newChild: [] as any[] };
  const skipped = { notFamily: 0, noEmail: [] as any[], duplicateEmail: [] as any[], ambiguousChild: [] as any[], sameRowBoth: [] as any[] };
  const conflicts: any[] = [];

  try {
    await client.query("BEGIN");

    const all = parseCsv(readFileSync(CSV, "utf8"));
    const fam = all.map((r) => ({ ...splitName(r.ContactName ?? ""), r })).filter((x) => {
      if (!FAMILY_CODES(x.code)) { if (x.code) skipped.notFamily++; return false; }
      return true;
    });

    const { rows: contacts } = await client.query(`SELECT id, type, first_name, last_name, email, phone, address FROM contacts`);
    const byEmail = new Map<string, any[]>();
    for (const c of contacts) if (c.email) { const k = lower(c.email); byEmail.set(k, [...(byEmail.get(k) ?? []), c]); }
    const byName = new Map<string, any[]>();
    for (const c of contacts) { const k = `${lower(c.first_name)}|${lower(c.last_name)}`; byName.set(k, [...(byName.get(k) ?? []), c]); }
    const { rows: rel } = await client.query(`SELECT guardian_id, player_id FROM contact_relationships`);
    const childrenOf = new Map<number, Set<number>>();
    for (const r of rel) childrenOf.set(r.guardian_id, (childrenOf.get(r.guardian_id) ?? new Set()).add(r.player_id));
    const contactById = new Map(contacts.map((c: any) => [c.id, c]));

    for (const { code, person: child, r } of fam) {
      const email = lower(r.EmailAddress);
      const pFirst = norm(r.FirstName), pLast = norm(r.LastName);
      const phone = norm(r.PhoneNumber) || norm(r.MobileNumber);
      const addr = address(r);
      const tag = `(${code}) ${child}`;

      if (!email) { skipped.noEmail.push({ tag }); continue; }

      // ── the parent ────────────────────────────────────────────────────────
      const cands = byEmail.get(email) ?? [];
      let parent: any = null;
      if (cands.length === 1) parent = cands[0];
      else if (cands.length > 1) {
        const gs = cands.filter((c: any) => c.type === "guardian");
        if (gs.length === 1) parent = gs[0];
        else { skipped.duplicateEmail.push({ tag, email, ids: cands.map((c: any) => c.id) }); continue; }
      }

      if (!parent) {
        if (!pFirst && !pLast) { skipped.noEmail.push({ tag, why: "no parent name either" }); continue; }
        actions.newParent.push({ tag, first: pFirst, last: pLast, email, phone: phone || null, address: addr?.oneLine ?? null });
        if (COMMIT) {
          const { rows: [made] } = await client.query(
            `INSERT INTO contacts (type, first_name, last_name, email, phone, address)
             VALUES ('guardian',$1,$2,$3,$4,$5) RETURNING id, type, first_name, last_name, email, phone, address`,
            [pFirst, pLast, email, phone || null, addr?.oneLine ?? null]);
          parent = made; contactById.set(made.id, made);
          byEmail.set(email, [made]);
        } else {
          parent = { id: null, first_name: pFirst, last_name: pLast, email, phone: phone || null, address: addr?.oneLine ?? null };
        }
      } else {
        // 🔴 FILL BLANKS ONLY. A value that differs is Daniel's call, not this
        // script's — families update details with us directly and that may well
        // be newer than the invoice Olga raised in March.
        if (phone && !norm(parent.phone)) {
          actions.fillPhone.push({ tag, contactId: parent.id, value: phone });
          if (COMMIT) await client.query(`UPDATE contacts SET phone=$1 WHERE id=$2 AND (phone IS NULL OR phone='')`, [phone, parent.id]);
        } else if (phone && digits(parent.phone) !== digits(phone)) {
          conflicts.push({ tag, contactId: parent.id, field: "phone", clubos: parent.phone, xero: phone });
        }
        if (addr && !norm(parent.address)) {
          actions.fillAddress.push({ tag, contactId: parent.id, value: addr.oneLine });
          if (COMMIT) await client.query(`UPDATE contacts SET address=$1 WHERE id=$2 AND (address IS NULL OR address='')`, [addr.oneLine, parent.id]);
        } else if (addr && lower(parent.address) !== lower(addr.oneLine)) {
          conflicts.push({ tag, contactId: parent.id, field: "address", clubos: parent.address, xero: addr.oneLine });
        }
      }

      // ── the child, and the link ───────────────────────────────────────────
      const parts = child.split(/\s+/).filter(Boolean);
      if (parts.length < 2) { skipped.ambiguousChild.push({ tag, why: "child name is a single word" }); continue; }
      const cFirst = parts[0], cLast = parts.slice(1).join(" ");

      let childId: number | null = null;
      const mine = parent.id ? [...(childrenOf.get(parent.id) ?? [])].map((id) => contactById.get(id)).filter(Boolean) : [];
      const underParent = mine.filter((c: any) => lower(c.first_name) === lower(cFirst) && lower(c.last_name) === lower(cLast));
      if (underParent.length === 1) childId = underParent[0].id;           // already right
      else {
        const anywhere = (byName.get(`${lower(cFirst)}|${lower(cLast)}`) ?? []).filter((c: any) => c.type === "player");
        if (anywhere.length === 1) childId = anywhere[0].id;
        else if (anywhere.length > 1) { skipped.ambiguousChild.push({ tag, why: `${anywhere.length} players share this name` }); continue; }
        else {
          // 🔴 A NEW CHILD IS CREATED WITH NO EMAIL AND NO PHONE. Those belong
          // to the parent. Writing them onto the child is the single easiest
          // way to corrupt this dataset, and it would look completely fine.
          actions.newChild.push({ tag, first: cFirst, last: cLast, parentEmail: email });
          if (COMMIT) {
            const { rows: [made] } = await client.query(
              `INSERT INTO contacts (type, first_name, last_name) VALUES ('player',$1,$2) RETURNING id, type, first_name, last_name`,
              [cFirst, cLast]);
            childId = made.id; contactById.set(made.id, made);
          }
        }
      }

      // 🔴 A PERSON IS NEVER THEIR OWN PARENT. 52 rows hit this on the first
      // dry run: one ClubOS contact carries the PARENT's email under the
      // CHILD's name — the duplicate-guardian shape the abandoned-checkout path
      // has been minting for months — so the same row satisfied both the email
      // lookup and the name lookup. Writing that link would have recorded 52
      // children as their own guardian, and it would have looked entirely
      // normal in the database. These are mis-shaped records a human must fix,
      // so they are REPORTED rather than quietly dropped.
      if (childId && parent.id && childId === parent.id) {
        skipped.sameRowBoth.push({ tag, contactId: childId, email });
        continue;
      }

      if (childId && parent.id && !(childrenOf.get(parent.id)?.has(childId))) {
        actions.link.push({ tag, guardianId: parent.id, playerId: childId });
        if (COMMIT) {
          await client.query(
            `INSERT INTO contact_relationships (guardian_id, player_id, relationship, is_primary_contact)
             VALUES ($1,$2,'parent',true) ON CONFLICT DO NOTHING`, [parent.id, childId]);
          childrenOf.set(parent.id, (childrenOf.get(parent.id) ?? new Set()).add(childId));
        }
      }
    }

    // ── report ─────────────────────────────────────────────────────────────
    console.log(`\n${COMMIT ? "APPLIED" : "DRY RUN — nothing written"}\n`);
    console.log(`  WOULD FILL (blank in ClubOS today)`);
    console.log(`    parent phone                ${actions.fillPhone.length}`);
    console.log(`    parent address              ${actions.fillAddress.length}`);
    console.log(`\n  WOULD LINK (the relationship only Xero knows)`);
    console.log(`    new parent → child links    ${actions.link.length}`);
    console.log(`\n  WOULD CREATE`);
    console.log(`    parents (guardians)         ${actions.newParent.length}`);
    console.log(`    children (players)          ${actions.newChild.length}`);
    console.log(`\n  REPORTED, NOT TOUCHED`);
    console.log(`    conflicts (differs)         ${conflicts.length}`);
    console.log(`    no email on the Xero row    ${skipped.noEmail.length}`);
    console.log(`    email hits >1 ClubOS row    ${skipped.duplicateEmail.length}`);
    console.log(`    child name ambiguous        ${skipped.ambiguousChild.length}`);
    console.log(`    ONE row is parent AND child ${skipped.sameRowBoth.length}  🔴 mis-shaped ClubOS records — needs a human`);
    console.log(`    non-family Xero rows        ${skipped.notFamily}  (coaches, referees, clubs, teams, businesses)`);

    if (REPORT) { writeFileSync(REPORT, JSON.stringify({ actions, skipped, conflicts }, null, 1)); console.log(`\n  wrote ${REPORT}`); }

    if (COMMIT) { await client.query("COMMIT"); console.log("\nCOMMITTED."); }
    else { await client.query("ROLLBACK"); console.log("\nRolled back. Re-run with --commit to apply."); }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error("\n✗", e.message ?? e); process.exit(1); });

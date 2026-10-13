/**
 * XERO INVOICE → CLUBOS REGISTRATION — the rules, and nothing but the rules.
 *
 * Daniel, 2026-10-14: "an always on xero job where as soon as payment comes in
 * or perhaps reconciled by olga to correct profile that syncs with clubos to
 * mark them from not registered to just a normal player … any mistakes with
 * this automation marking wrong player is a disaster."
 *
 * Olga's shape (proven on 21,160 invoices):
 *   contact  "(A U12) Beauden Whittle"  ← the CHILD; name/email = the PAYING PARENT
 *   ref      "2026 U11/U12 - Term 4"    ← programme by age, the term, the year
 *            "FS 2026 - Term 4"         ← FUNiño
 *            "2026 Technification - T4"
 *
 * 🔴 PURE. No database, no Xero — so every rule here is unit-tested against
 * Olga's real references and the server only ever applies a verdict.
 * 🔴 Anything not understood is `null` / review, never a best guess. A missed
 * auto-confirm costs Olga one click; a wrong one marks the wrong child paid.
 */

export type ProgrammeKey = "funino" | "pre_academy" | "academy" | "technification";

export type ParsedRef = {
  programme: ProgrammeKey;
  year: number;
  term: 1 | 2 | 3 | 4;
  /** Age grades the reference names, inclusive ("U11/U12" → [11,12]). Null = none named. */
  grades: [number, number] | null;
};

export type RefVerdict =
  | { kind: "registration"; ref: ParsedRef }
  | { kind: "not_registration"; reason: string }
  | { kind: "unreadable"; reason: string };

const NOT_FEES = /uniform|kit|referee|match fee|tournament|yellow card|socks|t-?shirt|print|entry|levies only|boarding|auction|closing down|camp|holiday|southern league|pre-season/i;

/** Read one invoice reference. */
export function parseReference(refRaw: string | null | undefined): RefVerdict {
  const ref = (refRaw ?? "").replace(/\s+/g, " ").trim();
  if (!ref) return { kind: "unreadable", reason: "No reference on the invoice" };

  const terms = Array.from(ref.matchAll(/\b(?:term ?|t)([1-4])\b/gi)).map((m) => Number(m[1]));
  const hasTerm = terms.length > 0;
  if (!hasTerm) {
    return NOT_FEES.test(ref)
      ? { kind: "not_registration", reason: "Not a programme fee (uniform, referee fees, entry…)" }
      : { kind: "unreadable", reason: "No term in the reference" };
  }
  // 🔴 "Term 1 & Term 2", "T2,3": one invoice, two terms — never split by guesswork.
  if (new Set(terms).size > 1 || /t\d\s*,\s*\d/i.test(ref)) return { kind: "unreadable", reason: "Covers more than one term" };
  if (/unregistered attendance/i.test(ref)) return { kind: "unreadable", reason: "Invoice for attendance without a registration — check by hand" };

  const years = Array.from(ref.matchAll(/\b(20\d{2})\b/g)).map((m) => Number(m[1]));
  if (years.length !== 1) return { kind: "unreadable", reason: years.length ? "More than one year in the reference" : "No year in the reference" };
  const year = years[0];
  const term = terms[0] as 1 | 2 | 3 | 4;

  if (/technification/i.test(ref)) return { kind: "registration", ref: { programme: "technification", year, term, grades: null } };
  if (/^fs\b|\bfs \d{4}/i.test(ref)) return { kind: "registration", ref: { programme: "funino", year, term, grades: [4, 8] } };

  // "U11/U12", "U9/10", "U9/U10", "U13", "U 14"
  const age = /\bu ?(\d{1,2})(?: ?\/ ?u? ?(\d{1,2}))?\b/i.exec(ref);
  if (!age) return { kind: "unreadable", reason: "No programme or age group in the reference" };
  const lo = Number(age[1]), hi = age[2] ? Number(age[2]) : lo;
  if (hi < lo || lo < 4 || hi > 23) return { kind: "unreadable", reason: "Age group out of range" };
  const programme: ProgrammeKey | null = hi <= 8 ? "funino" : hi <= 12 ? "pre_academy" : lo >= 13 ? "academy" : null;
  if (!programme) return { kind: "unreadable", reason: "Age group spans two programmes" };
  return { kind: "registration", ref: { programme, year, term, grades: [lo, hi] } };
}

/** "(A U12) Beauden  Whittle" → { prefix: "A U12", child: "Beauden Whittle" } */
export function splitContactName(name: string): { prefix: string | null; child: string } {
  const m = /^\s*\(([^)]*)\)\s*(.*)$/.exec(name ?? "");
  return m ? { prefix: m[1].trim(), child: m[2].replace(/\s+/g, " ").trim() } : { prefix: null, child: (name ?? "").replace(/\s+/g, " ").trim() };
}

/** Prefixes that are a child in an academy family — nothing else is touched. */
export function isFamilyPrefix(prefix: string | null): boolean {
  return !!prefix && /^(FS|FS_FAM|A(?: U\d{1,2})?(?:_[A-Za-z0-9]+)?)$/.test(prefix);
}

/** Compare names: lower case, letters and single spaces only. */
export function normName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z ]/g, "").replace(/ +/g, " ").trim();
}

export function normEmail(s: string | null | undefined): string | null {
  const e = (s ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

export type Candidate = {
  contactId: number;
  name: string;
  /** NZF grade in the REFERENCE's year (year − birth year). Null = no usable DOB. */
  grade: number | null;
  dob: string | null;
  /** Lower-cased emails of this child's known parents/guardians (and its own). */
  familyEmails: string[];
  /** How many registrations this record already carries — the record with the
   *  history is the real one when a child was entered twice. */
  registrations?: number;
};

export type MatchVerdict =
  | { decision: "auto"; contactId: number; evidence: string[] }
  | { decision: "review"; reason: string; candidates: number[] };

/**
 * Who is this invoice for? Called ONLY when the Xero contact has no confirmed
 * link yet — a link (made once, by this rule or by a person) is used from then on.
 *
 * Auto ONLY when all three hold:
 *   1. exactly one CHILD in ClubOS carries the name (records sharing one birth
 *      date are the same child entered twice — newest wins);
 *   2. their age grade fits the age the invoice is for, in the invoice's year;
 *   3. the paying parent's email on the Xero contact is a known email of that
 *      child's family.
 * Anything less → review, with the candidates, for a person to pick once.
 */
export function matchChild(opts: {
  childName: string;
  parentEmail: string | null;
  ref: ParsedRef;
  candidates: Candidate[];   // every ClubOS player whose normalised name equals childName
}): MatchVerdict {
  const c = opts.candidates;
  if (c.length === 0) return { decision: "review", reason: "No child with this name in ClubOS", candidates: [] };
  const dobs = new Set(c.map((x) => x.dob));
  const sameChild = c.length === 1 || (dobs.size === 1 && !dobs.has(null));
  if (!sameChild) return { decision: "review", reason: `${c.length} different children in ClubOS share this name`, candidates: c.map((x) => x.contactId) };
  // Same child entered twice: the record carrying the history, else the oldest.
  const pick = [...c].sort((a, b) => (b.registrations ?? 0) - (a.registrations ?? 0) || a.contactId - b.contactId)[0];

  const evidence: string[] = [c.length === 1 ? "only child with this name" : `${c.length} records, one date of birth`];
  if (pick.grade === null) return { decision: "review", reason: "No date of birth in ClubOS to check the age group", candidates: [pick.contactId] };
  const [lo, hi] = opts.ref.grades ?? [4, 23];
  // 🔴 Playing UP is normal (a U8 in the U9/U10 group, a U17 in the U20s);
  // playing DOWN is never allowed — so older than the band always reviews.
  // That one-sided gate is what caught "Finn Jones": invoiced for U9/U10, and
  // the only Finn Jones in ClubOS is fourteen.
  const playUp = hi >= 13 ? 3 : 2;
  if (pick.grade > hi || pick.grade < lo - playUp) {
    return { decision: "review", reason: `Age doesn't fit: U${pick.grade} in ${opts.ref.year}, invoice is for U${lo}${hi !== lo ? `–U${hi}` : ""}`, candidates: [pick.contactId] };
  }
  evidence.push(`U${pick.grade} in ${opts.ref.year} fits the invoice`);

  const pe = normEmail(opts.parentEmail);
  if (!pe) return { decision: "review", reason: "No parent email on the Xero contact to confirm the family", candidates: [pick.contactId] };
  const merged = new Set<string>(c.flatMap((x) => x.familyEmails));
  if (!merged.has(pe)) return { decision: "review", reason: "Parent email on the invoice isn't one ClubOS has for this child's family", candidates: [pick.contactId] };
  evidence.push("parent email matches the family");

  return { decision: "auto", contactId: pick.contactId, evidence };
}

/** Money only once the invoice is settled in full. Part-paid is NOT registered. */
// 🔴 Xero also says PAID when a CREDIT NOTE cancels the invoice and no money
// moved. "Paid" here means money actually received: amountPaid > 0 and
// nothing left owing. A fully credited invoice is "credited", never paid.
export function paymentState(inv: { status: string; amountDue: number; amountPaid: number; amountCredited?: number; total: number }):
  "paid" | "part_paid" | "unpaid" | "credited" | "void" | "draft" {
  const s = (inv.status ?? "").toUpperCase();
  if (s === "VOIDED" || s === "DELETED") return "void";
  if (s === "DRAFT" || s === "SUBMITTED") return "draft";
  const paid = Number(inv.amountPaid) || 0, due = Number(inv.amountDue) || 0;
  if (paid <= 0) return (Number(inv.amountCredited) || 0) > 0 && due <= 0.004 ? "credited" : "unpaid";
  return due <= 0.004 ? "paid" : "part_paid";
}

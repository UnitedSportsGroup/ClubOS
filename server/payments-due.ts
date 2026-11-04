// Payments due — every fee a CUFC family still owes, as of now (Daniel, 2026-11-04):
// "click and it shows all overdue payments or due payments … by program, by age,
// by player/family … by term and year … as accurate as possible as of today."
//
// 🔴 XERO IS THE LEDGER FOR WHAT IS OWED. A ClubOS online checkout is paid in full
// before a registration exists, so ClubOS never holds a debt; everything owed is an
// invoice Olga raised in Xero. This reads Xero LIVE (every AUTHORISED sales invoice
// to a family contact — "(A U14) Child", "(FS) Child"), caches it 10 minutes, and
// joins ClubOS for WHO the child is, who the parent is, and whether ClubOS already
// shows them registered/paid for that term.
// 🔴 READ ONLY. Nothing here writes to Xero or to a registration.
// 🔴 A part-paid invoice with a payment in the last 45 days is a live INSTALMENT
// PLAN, not a stalled debt (project_money_to_collect) — it is flagged, not hidden.
// 🔴 Overdue is DERIVED from Xero's due date against NZ today, never stored.
import { sql } from "drizzle-orm";
import { db } from "./db";
import { getXeroForOrg } from "./xero";
import { nzTodayIso } from "@shared/academy";
import { REAL_REGISTRATION_STATUSES } from "@shared/registrations";
import { parseReference, splitContactName, type ProgrammeKey } from "@shared/xero-reg-match";

const ORG = 1;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const cents = (n: unknown) => Math.round((Number(n) || 0) * 100);
/** Xero dates are calendar days stamped at UTC midnight — the first 10 chars ARE the day. */
const day = (d: unknown): string | null => (d ? new Date(String(d)).toISOString().slice(0, 10) : null);
const REAL = sql.join(REAL_REGISTRATION_STATUSES.map((s) => sql`${s}`), sql`, `);

/** A child in a CUFC academy family: "(FS)", "(A)", "(A U14)", "(A U17_FI_TM)", "(A U20_Over18)". */
export function isCufcFamily(prefix: string | null): boolean {
  return !!prefix && /^(FS|A)(?=$|[ _])/i.test(prefix.trim());
}

export const PROGRAMMES: Record<ProgrammeKey | "unknown", { label: string; order: number }> = {
  funino: { label: "U4–U8 FUNiño", order: 1 },
  pre_academy: { label: "U9–U12 Pre-Academy", order: 2 },
  academy: { label: "U13–U20 Academy", order: 3 },
  technification: { label: "Technification", order: 4 },
  unknown: { label: "Programme not stated", order: 9 },
};
const programmeForGrade = (g: number | null): ProgrammeKey | "unknown" =>
  g == null ? "unknown" : g <= 8 ? "funino" : g <= 12 ? "pre_academy" : "academy";

export type DueKind = "term_fee" | "uniform" | "levies" | "other";
export type DueStatus = "overdue" | "due_soon" | "not_yet_due";

export type DueRow = {
  invoiceId: string; invoiceNumber: string | null; reference: string | null;
  xeroContactName: string; childName: string;
  kind: DueKind; programme: ProgrammeKey | "unknown"; programmeLabel: string;
  ageGroup: string | null; ageSort: number; year: number | null; term: number | null;
  issued: string | null; due: string | null; status: DueStatus; daysOverdue: number;
  ageing: "not_due" | "1-30" | "31-60" | "61-90" | "90+";
  totalCents: number; paidCents: number; owedCents: number;
  lastPaymentOn: string | null; onPlan: boolean; partPaid: boolean; sent: boolean;
  // ClubOS
  childId: number | null; childDob: string | null;
  parentName: string | null; parentEmail: string | null; parentPhone: string | null; contactSource: "clubos" | "xero" | null;
  familyKey: string; familyLabel: string;
  registeredInClubOS: boolean; paidInClubOSCents: number;
};

export type DueSnapshot = {
  asOf: string; today: string; rows: DueRow[];
  outOfScope: { label: string; invoices: number; owedCents: number }[];
  coverage: Array<{ programme: string; programmeLabel: string; year: number; term: number; registered: number; invoiced: number; invoicedOpen: number; owedCents: number }>;
};

function kindOf(ref: string | null): DueKind {
  const v = parseReference(ref);
  if (v.kind === "registration") return "term_fee";
  const r = ref ?? "";
  if (/uniform|kit|socks|t-?shirt|jacket|hoodie/i.test(r)) return "uniform";
  if (/lev(y|ies)|referee|match fee|\bmf\b|registration fee/i.test(r)) return "levies";
  if (/term|t\d|training|whole year|season/i.test(r)) return "term_fee";
  return "other";
}

/** "U9/10" / "U13" from the reference; else the contact's "(A U14)"; else null. */
function ageOf(ref: string | null, prefix: string | null): { label: string | null; lo: number | null } {
  const m = /\bu ?(\d{1,2})(?: ?\/ ?u? ?(\d{1,2}))?\b/i.exec(ref ?? "");
  if (m) { const lo = Number(m[1]), hi = m[2] ? Number(m[2]) : lo; return { label: hi > lo ? `U${lo}–U${hi}` : `U${lo}`, lo }; }
  if (/^fs\b/i.test(ref ?? "") || /^FS/i.test(prefix ?? "")) return { label: "U4–U8", lo: 4 };
  const p = /\bU ?(\d{1,2})/i.exec(prefix ?? "");
  if (p) return { label: `U${Number(p[1])}`, lo: Number(p[1]) };
  return { label: null, lo: null };
}

function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

const FAMILY_LABEL_OUT: Record<string, string> = {
  S: "Sponsors (see Sponsorship → Partners)", C: "Coaches", Staff: "Staff", Res: "Residency", OFC: "SIU / OFC",
  MFL: "Mini Football (MFL workspace)", UP: "United Prints", G: "Gymnastics",
};

async function build(): Promise<DueSnapshot> {
  const today = nzTodayIso();
  const { xero, tenantId } = await getXeroForOrg(ORG);
  const open: any[] = [];
  for (let page = 1; page <= 40; page++) {
    const r = await xero.accountingApi.getInvoices(tenantId, undefined, 'Type=="ACCREC"', "Date ASC",
      undefined, undefined, undefined, ["AUTHORISED"], page, false, undefined, undefined, false, 100);
    const got = (r.body.invoices ?? []) as any[];
    open.push(...got);
    if (got.length < 100) break;
  }

  const fam: any[] = [];
  const out = new Map<string, { invoices: number; owedCents: number }>();
  for (const i of open) {
    if (Number(i.amountDue) <= 0) continue;
    const { prefix } = splitContactName(i.contact?.name ?? "");
    if (isCufcFamily(prefix)) { fam.push(i); continue; }
    const label = (prefix && FAMILY_LABEL_OUT[prefix]) || "Other contacts";
    const o = out.get(label) ?? { invoices: 0, owedCents: 0 };
    o.invoices++; o.owedCents += cents(i.amountDue); out.set(label, o);
  }

  // Xero contact email + phone (the paying parent), 50 a call.
  const contactIds = Array.from(new Set(fam.map((i) => String(i.contact.contactID))));
  const xc = new Map<string, { email: string | null; phone: string | null }>();
  for (let k = 0; k < contactIds.length; k += 50) {
    const r = await xero.accountingApi.getContacts(tenantId, undefined, undefined, undefined, contactIds.slice(k, k + 50), undefined, true);
    for (const c of (r.body.contacts ?? []) as any[]) {
      const ph = (c.phones ?? []).find((p: any) => p.phoneNumber && String(p.phoneType) === "MOBILE") ?? (c.phones ?? []).find((p: any) => p.phoneNumber);
      xc.set(String(c.contactID), {
        email: c.emailAddress ? String(c.emailAddress).trim() : null,
        phone: ph ? [ph.phoneCountryCode, ph.phoneAreaCode, ph.phoneNumber].filter(Boolean).join(" ").trim() : null,
      });
    }
  }

  // Who each Xero contact is in ClubOS: a confirmed link first, else what the sync matched.
  const links = new Map<string, number>();
  if (contactIds.length) {
    for (const r of rowsOf(await db.execute(sql`
      SELECT xero_contact_id, contact_id FROM xero_contact_links
       WHERE organization_id = ${ORG} AND xero_contact_id IN (${sql.join(contactIds.map((c) => sql`${c}`), sql`, `)})`))) links.set(String(r.xero_contact_id), Number(r.contact_id));
  }
  const invIds = fam.map((i) => String(i.invoiceID));
  const syncChild = new Map<string, number>();
  if (invIds.length) {
    for (const r of rowsOf(await db.execute(sql`
      SELECT invoice_id, child_contact_id FROM xero_invoice_registrations
       WHERE organization_id = ${ORG} AND child_contact_id IS NOT NULL
         AND invoice_id IN (${sql.join(invIds.map((c) => sql`${c}`), sql`, `)})`))) syncChild.set(String(r.invoice_id), Number(r.child_contact_id));
  }
  const childIds = Array.from(new Set([...Array.from(links.values()), ...Array.from(syncChild.values())]));
  const kids = new Map<number, { name: string; dob: string | null; parentName: string | null; parentEmail: string | null; parentPhone: string | null; guardianId: number | null }>();
  if (childIds.length) {
    for (const r of rowsOf(await db.execute(sql`
      SELECT c.id, c.first_name || ' ' || c.last_name AS name, c.date_of_birth::text AS dob,
             g.id AS gid, NULLIF(btrim(coalesce(g.first_name,'') || ' ' || coalesce(g.last_name,'')), '') AS gname, g.email AS gemail, g.phone AS gphone
        FROM contacts c
        LEFT JOIN LATERAL (
          SELECT g.* FROM contacts g
           WHERE g.id IN (SELECT guardian_id FROM contact_relationships WHERE player_id = c.id
                          UNION SELECT guardian_id FROM registrations WHERE contact_id = c.id AND guardian_id IS NOT NULL)
           ORDER BY (g.phone IS NOT NULL AND g.phone <> '') DESC, g.id LIMIT 1) g ON true
       WHERE c.id IN (${sql.join(childIds.map((c) => sql`${c}`), sql`, `)})`))) {
      kids.set(Number(r.id), { name: String(r.name), dob: r.dob ?? null, parentName: r.gname ?? null, parentEmail: r.gemail ?? null, parentPhone: r.gphone ?? null, guardianId: r.gid ? Number(r.gid) : null });
    }
  }

  // Programmes + terms, to see whether ClubOS already has the child registered for that term.
  const progBySlug = new Map(rowsOf(await db.execute(sql`SELECT id, slug FROM programs WHERE organization_id = ${ORG}`)).map((x: any) => [String(x.slug), Number(x.id)]));
  const progId: Record<string, number | undefined> = {
    funino: progBySlug.get("u4-u8"), pre_academy: progBySlug.get("pre-academy-u9-u12"),
    academy: progBySlug.get("academy-u13-u17"), technification: progBySlug.get("technification"),
  };
  const terms = rowsOf(await db.execute(sql`SELECT id, year, term_number FROM terms WHERE organization_id = ${ORG}`));
  const termId = (y: number, t: number) => terms.find((x: any) => Number(x.year) === y && Number(x.term_number) === t)?.id;
  const regs = childIds.length ? rowsOf(await db.execute(sql`
    SELECT r.contact_id, r.program_id, r.term_id, r.legacy_external_id, r.total_cents
      FROM registrations r
     WHERE r.contact_id IN (${sql.join(childIds.map((c) => sql`${c}`), sql`, `)}) AND r.status IN (${REAL})`)) : [];

  const rows: DueRow[] = fam.map((i) => {
    const { prefix, child } = splitContactName(i.contact?.name ?? "");
    const ref: string | null = i.reference ?? null;
    const v = parseReference(ref);
    const kind = kindOf(ref);
    const age = ageOf(ref, prefix);
    let programme: ProgrammeKey | "unknown" = v.kind === "registration" ? v.ref.programme : /technification/i.test(ref ?? "") ? "technification" : programmeForGrade(age.lo);
    const yearM = /\b(20\d{2})\b/.exec(ref ?? "");
    const year = v.kind === "registration" ? v.ref.year : yearM ? Number(yearM[1]) : (day(i.date) ? Number(day(i.date)!.slice(0, 4)) : null);
    const termM = /\b(?:term ?|t)([1-4])\b/i.exec(ref ?? "");
    const term = v.kind === "registration" ? v.ref.term : kind === "term_fee" && termM ? Number(termM[1]) : null;
    const due = day(i.dueDate) ?? day(i.date);
    const dOver = due ? daysBetween(due, today) : 0;
    const status: DueStatus = due && dOver > 0 ? "overdue" : due && dOver >= -14 ? "due_soon" : "not_yet_due";
    const ageing: DueRow["ageing"] = status !== "overdue" ? "not_due" : dOver <= 30 ? "1-30" : dOver <= 60 ? "31-60" : dOver <= 90 ? "61-90" : "90+";
    const pays = ((i.payments ?? []) as any[]).map((p) => day(p.date)).filter(Boolean).sort() as string[];
    const last = pays[pays.length - 1] ?? null;
    const paid = cents(i.amountPaid) + cents(i.amountCredited);
    const partPaid = paid > 0;
    const onPlan = partPaid && !!last && daysBetween(last, today) <= 45;

    const childId = links.get(String(i.contact.contactID)) ?? syncChild.get(String(i.invoiceID)) ?? null;
    const kid = childId ? kids.get(childId) : undefined;
    const x = xc.get(String(i.contact.contactID));
    const parentEmail = kid?.parentEmail || x?.email || null;
    const parentPhone = kid?.parentPhone || x?.phone || null;
    const contactSource = kid?.parentEmail || kid?.parentPhone ? "clubos" : x?.email || x?.phone ? "xero" : null;
    const familyKey = (x?.email || kid?.parentEmail || "").toLowerCase().trim() || (kid?.guardianId ? `g${kid.guardianId}` : `x${i.contact.contactID}`);

    // ClubOS: is this child already registered for this programme + term?
    let registeredInClubOS = false, paidInClubOSCents = 0;
    if (childId && kind === "term_fee" && year && term && programme !== "unknown") {
      const tId = termId(year, term), pId = progId[programme];
      for (const r of regs) {
        if (Number(r.contact_id) !== childId || Number(r.program_id) !== pId || Number(r.term_id) !== Number(tId)) continue;
        registeredInClubOS = true;
        if (r.legacy_external_id !== i.invoiceNumber) paidInClubOSCents += Number(r.total_cents) || 0;
      }
    }

    return {
      invoiceId: String(i.invoiceID), invoiceNumber: i.invoiceNumber ?? null, reference: ref,
      xeroContactName: String(i.contact?.name ?? ""), childName: kid?.name ?? child,
      kind, programme, programmeLabel: PROGRAMMES[programme].label,
      ageGroup: age.label, ageSort: age.lo ?? 99, year, term,
      issued: day(i.date), due, status, daysOverdue: Math.max(0, dOver), ageing,
      totalCents: cents(i.total), paidCents: paid, owedCents: cents(i.amountDue),
      lastPaymentOn: last, onPlan, partPaid, sent: !!i.sentToContact,
      childId, childDob: kid?.dob ?? null,
      parentName: kid?.parentName ?? null, parentEmail, parentPhone, contactSource,
      familyKey, familyLabel: kid?.parentName || parentEmail || child,
      registeredInClubOS, paidInClubOSCents,
    };
  });

  // Coverage: for each term programme, how many ClubOS registrations vs Xero invoices —
  // a term nobody invoiced shows up here even though nothing is "owed".
  // 🔴 Only terms the Xero sync has read every invoice for (it starts 1 Jul 2026) —
  // an earlier term would read as 'not invoiced' when the invoices simply weren't read.
  const cov = rowsOf(await db.execute(sql`
    WITH pk AS (
      SELECT * FROM (VALUES ('funino','u4-u8'),('pre_academy','pre-academy-u9-u12'),('academy','academy-u13-u17'),('technification','technification')) v(key, slug)
    )
    SELECT pk.key AS programme, t.year, t.term_number AS term,
           (SELECT count(DISTINCT r.contact_id)::int FROM registrations r
             WHERE r.program_id = p.id AND r.term_id = t.id AND r.status IN (${REAL})) AS registered,
           (SELECT count(*)::int FROM xero_invoice_registrations x
             WHERE x.organization_id = ${ORG} AND x.program_id = p.id AND x.term_id = t.id AND x.payment_state NOT IN ('void','credited')) AS invoiced
      FROM pk JOIN programs p ON p.slug = pk.slug AND p.organization_id = ${ORG}
      JOIN terms t ON t.organization_id = ${ORG} AND t.start_date >= '2026-07-01' AND t.start_date <= (${today}::date + 60)
     ORDER BY t.year, t.term_number, pk.key`));
  const coverage = cov.map((c: any) => {
    const open = rows.filter((r) => r.kind === "term_fee" && r.programme === c.programme && r.year === Number(c.year) && r.term === Number(c.term));
    return {
      programme: String(c.programme), programmeLabel: PROGRAMMES[c.programme as ProgrammeKey].label,
      year: Number(c.year), term: Number(c.term), registered: Number(c.registered),
      invoiced: Math.max(Number(c.invoiced), open.length), invoicedOpen: open.length,
      owedCents: open.reduce((s, r) => s + r.owedCents, 0),
    };
  });

  rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.owedCents - a.owedCents);
  return {
    asOf: new Date().toISOString(), today, rows,
    outOfScope: Array.from(out.entries()).map(([label, o]) => ({ label, ...o })).sort((a, b) => b.owedCents - a.owedCents),
    coverage,
  };
}

let cache: { at: number; snap: DueSnapshot } | null = null;
let inflight: Promise<DueSnapshot> | null = null;
const TTL = 10 * 60_000;
export const snapshotAgeMs = () => (cache ? Date.now() - cache.at : null);

/** The snapshot, from Xero at most every 10 minutes (or on a forced refresh, at most once a minute). */
export async function paymentsDue(force = false): Promise<DueSnapshot> {
  const age = cache ? Date.now() - cache.at : Infinity;
  if (cache && (age < TTL) && !(force && age > 60_000)) return cache.snap;
  if (!inflight) {
    inflight = build().then((snap) => { cache = { at: Date.now(), snap }; return snap; }).finally(() => { inflight = null; });
  }
  return inflight;
}
export const isInLatestSnapshot = (invoiceId: string) => !!cache?.snap.rows.some((r) => r.invoiceId === invoiceId);

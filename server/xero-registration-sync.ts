// Xero invoice → ClubOS registration — the always-on sync (Daniel, 2026-10-14).
//
// Olga invoices academy families by hand; they pay by bank transfer; she
// reconciles the transfer and the invoice goes PAID. This sweep reads every
// academy invoice that changed since it last looked and, when one is paid, makes
// the child a normal registered player for that programme and term.
//
// 🔴 The rules live in @shared/xero-reg-match (pure, tested). This file reads,
// decides with them, and writes only what they allow.
// 🔴 XERO_REG_SYNC = off | shadow | live. SHADOW decides and records everything
// and writes NO registration and NO link — so its decisions can be checked
// against reality before it is trusted. A person's choice in the review queue is
// always applied: that is a human decision, not the automation's.
// 🔴 ONLY ADDS. It never cancels, refunds or deletes a registration. A paid
// invoice later voided or credited goes to review for a person.
// 🔴 A child is attached to a Xero contact ONCE (auto only on unique name + age
// fits + parent email belongs to the family); every later invoice to that
// contact follows the link. Anything less → the review queue.
import { sql } from "drizzle-orm";
import { db } from "./db";
import { getXeroForOrg } from "./xero";
import { nzTodayIso } from "@shared/academy";
import { REAL_REGISTRATION_STATUSES } from "@shared/registrations";
import {
  parseReference, splitContactName, isFamilyPrefix, normName, normEmail, matchChild, paymentState,
  type ParsedRef, type ProgrammeKey, type Candidate,
} from "@shared/xero-reg-match";

export type SyncMode = "off" | "shadow" | "live";
export function syncMode(): SyncMode {
  const m = (process.env.XERO_REG_SYNC ?? "off").toLowerCase();
  return m === "live" || m === "shadow" ? m : "off";
}

const ORG = 1; // Christchurch United — Olga's academy invoices
const SLUG: Record<ProgrammeKey, string> = {
  funino: "u4-u8", pre_academy: "pre-academy-u9-u12", academy: "academy-u13-u17", technification: "technification",
};
const START = new Date("2026-07-01T00:00:00Z"); // first run reads Term 3 onward
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const cents = (n: unknown) => Math.round((Number(n) || 0) * 100);
const isoDay = (d: unknown) => (d ? new Date(String(d)).toISOString().slice(0, 10) : null);
const REAL = sql.join(REAL_REGISTRATION_STATUSES.map((s) => sql`${s}`), sql`, `);

type Inv = {
  invoiceID: string; invoiceNumber?: string; reference?: string; status: string; type: string;
  total: number; amountDue: number; amountPaid: number; amountCredited?: number;
  date?: string; updatedDateUTC?: string; fullyPaidOnDate?: string;
  contact: { contactID: string; name: string; emailAddress?: string };
  payments?: Array<{ date?: string; amount?: number }>;
};

type Decision = {
  decision: string; reason: string | null; programmeKey: string | null; programId: number | null; termId: number | null;
  childId: number | null; candidates: number[] | null; registrationId: number | null; registeredBySync: boolean;
  autoLink: { evidence: string[] } | null;
};

/** Every ClubOS player whose name equals this child's — merged records excluded. */
async function candidatesFor(child: string, ref: ParsedRef): Promise<Candidate[]> {
  const n = normName(child);
  if (!n) return [];
  const r = await db.execute(sql`
    SELECT p.id, p.first_name, p.last_name, p.date_of_birth::text AS dob,
           (SELECT count(*)::int FROM registrations r2 WHERE r2.contact_id = p.id) AS regs,
           ARRAY(
             SELECT DISTINCT lower(btrim(e)) FROM (
               SELECT p.email AS e
               UNION ALL SELECT g.email FROM registrations r JOIN contacts g ON g.id = r.guardian_id WHERE r.contact_id = p.id
               UNION ALL SELECT g.email FROM contact_relationships cr JOIN contacts g ON g.id = cr.guardian_id WHERE cr.player_id = p.id
             ) x WHERE e IS NOT NULL AND btrim(e) <> ''
           ) AS emails
      FROM contacts p
     WHERE p.type = 'player' AND p.merged_into_contact_id IS NULL
       AND trim(regexp_replace(regexp_replace(lower(p.first_name || ' ' || p.last_name), '[^a-z ]', '', 'g'), ' +', ' ', 'g')) = ${n}`);
  return rowsOf(r).map((p: any) => ({
    contactId: Number(p.id), name: `${p.first_name} ${p.last_name}`, dob: p.dob ?? null,
    grade: p.dob ? ref.year - Number(String(p.dob).slice(0, 4)) : null,
    familyEmails: (p.emails ?? []).map(String), registrations: Number(p.regs) || 0,
  }));
}

async function programmes(): Promise<Map<ProgrammeKey, number>> {
  const r = await db.execute(sql`SELECT id, slug FROM programs WHERE organization_id = ${ORG} AND slug IN (${sql.join(Object.values(SLUG).map((s) => sql`${s}`), sql`, `)})`);
  const bySlug = new Map(rowsOf(r).map((x: any) => [String(x.slug), Number(x.id)]));
  return new Map((Object.keys(SLUG) as ProgrammeKey[]).filter((k) => bySlug.has(SLUG[k])).map((k) => [k, bySlug.get(SLUG[k])!]));
}

async function termOf(year: number, term: number): Promise<{ id: number; endDate: string } | null> {
  const r = await db.execute(sql`SELECT id, end_date::text AS end_date FROM terms WHERE organization_id = ${ORG} AND year = ${year} AND term_number = ${term} LIMIT 1`);
  const t = rowsOf(r)[0];
  return t ? { id: Number(t.id), endDate: String(t.end_date) } : null;
}
/** A term counts as finished a fortnight after its last day (late payers). */
const finished = (endDate: string) => {
  const [y, m, d] = endDate.split("-").map(Number);
  const cutoff = new Date(Date.UTC(y, m - 1, d + 14)).toISOString().slice(0, 10);
  return cutoff < nzTodayIso();
};

/** Decide one invoice. Reads only. */
export async function decide(inv: Inv, progs: Map<ProgrammeKey, number>, parentEmail: string | null): Promise<Decision | null> {
  const { prefix, child } = splitContactName(inv.contact?.name ?? "");
  if (!isFamilyPrefix(prefix)) return null;                     // coaches, sponsors, referees… never touched
  const v = parseReference(inv.reference);
  if (v.kind === "not_registration") return null;                // uniforms, referee fees…
  const pay = paymentState(inv);
  const base: Decision = { decision: "needs_review", reason: null, programmeKey: null, programId: null, termId: null,
    childId: null, candidates: null, registrationId: null, registeredBySync: false, autoLink: null };

  // Our own earlier registration for this invoice, if any.
  const ours = rowsOf(await db.execute(sql`
    SELECT x.registration_id, x.registered_by_sync, x.child_contact_id FROM xero_invoice_registrations x
     WHERE x.organization_id = ${ORG} AND x.invoice_id = ${inv.invoiceID}`))[0];

  if (pay === "void" || pay === "credited") {
    if (ours?.registered_by_sync && ours.registration_id) {
      return { ...base, decision: "needs_review", childId: ours.child_contact_id, registrationId: ours.registration_id, registeredBySync: true,
        reason: `Invoice ${pay === "void" ? "voided" : "credited"} after this child was registered from it — check and cancel/refund by hand` };
    }
    return { ...base, decision: "void", reason: pay === "void" ? "Invoice voided" : "Invoice cancelled by a credit note — no money received" };
  }
  if (pay === "draft") return null;                              // not sent yet
  if (v.kind === "unreadable") return { ...base, reason: `Can't read the reference: ${v.reason}` };

  const ref = v.ref;
  const programId = progs.get(ref.programme) ?? null;
  const term = await termOf(ref.year, ref.term);
  const tId = term?.id ?? null;
  const withRef = { ...base, programmeKey: ref.programme, programId, termId: tId };
  if (!programId) return { ...withRef, reason: `No ClubOS programme for ${ref.programme}` };
  if (!tId) return { ...withRef, reason: `No ClubOS term for Term ${ref.term} ${ref.year}` };

  // Who is it for? A link first; the strict rule only for a contact never linked.
  const link = rowsOf(await db.execute(sql`
    SELECT contact_id FROM xero_contact_links WHERE organization_id = ${ORG} AND xero_contact_id = ${inv.contact.contactID}`))[0];
  let childId: number | null = link ? Number(link.contact_id) : null;
  let autoLink: Decision["autoLink"] = null;
  if (!childId) {
    const m = matchChild({ childName: child, parentEmail, ref, candidates: await candidatesFor(child, ref) });
    if (m.decision === "review") return { ...withRef, reason: m.reason, candidates: m.candidates };
    childId = m.contactId; autoLink = { evidence: m.evidence };
  }

  // Already registered — by the website, the office, an import or an earlier pass.
  // 🔴 Across EVERY record of this child — same name and date of birth — or a
  // child entered twice who paid online under the other record is registered again.
  const existing = rowsOf(await db.execute(sql`
    WITH me AS (SELECT first_name, last_name, date_of_birth FROM contacts WHERE id = ${childId}),
         same AS (
           SELECT c.id FROM contacts c, me
            WHERE c.id = ${childId}
               OR (me.date_of_birth IS NOT NULL AND c.date_of_birth = me.date_of_birth
                   AND lower(btrim(c.first_name)) = lower(btrim(me.first_name))
                   AND lower(btrim(c.last_name)) = lower(btrim(me.last_name)))
               OR c.merged_into_contact_id = ${childId})
    SELECT id FROM registrations
     WHERE contact_id IN (SELECT id FROM same) AND program_id = ${programId} AND term_id = ${tId} AND status IN (${REAL})
     ORDER BY id LIMIT 1`))[0]
    ?? rowsOf(await db.execute(sql`
    SELECT id FROM registrations WHERE legacy_source = 'xero' AND legacy_external_id IN (${inv.invoiceNumber ?? ""}, ${inv.invoiceID}) LIMIT 1`))[0];

  const out = { ...withRef, childId, autoLink };
  if (pay === "unpaid") return { ...out, decision: existing ? "already_registered" : "awaiting_payment", registrationId: existing?.id ?? null, reason: existing ? null : "Invoiced, not paid yet" };
  if (pay === "part_paid") return { ...out, decision: existing ? "already_registered" : "part_paid", registrationId: existing?.id ?? null, reason: existing ? null : "Part-paid — registered once paid in full" };
  if (existing) return { ...out, decision: "already_registered", registrationId: Number(existing.id), registeredBySync: !!ours?.registered_by_sync };
  // 🔴 The automation only fills the term running now and those ahead. A paid
  // invoice for a term that finished is shown, never added on its own — older
  // terms were recorded through Friendly Manager in other shapes, and adding
  // to a closed term rewrites its numbers. A person can still choose to.
  if (term && finished(term.endDate)) return { ...out, decision: "past_term", reason: `Paid for Term ${ref.term} ${ref.year}, which has finished — not added automatically` };
  return { ...out, decision: "would_register", reason: null };
}

/** Make the registration a paid invoice stands for. One transaction; idempotent. */
async function register(inv: Inv, d: Decision, parentEmail: string | null, decidedBy: number | null): Promise<number> {
  return db.transaction(async (tx) => {
    // The guardian whose email is on the invoice, else the child's primary one.
    const pe = normEmail(parentEmail);
    const g = rowsOf(await tx.execute(sql`
      SELECT g.id FROM contacts g
       WHERE g.id IN (SELECT guardian_id FROM contact_relationships WHERE player_id = ${d.childId}
                      UNION SELECT guardian_id FROM registrations WHERE contact_id = ${d.childId} AND guardian_id IS NOT NULL)
       ORDER BY (lower(btrim(g.email)) = ${pe ?? ""}) DESC, g.id LIMIT 1`))[0];
    const child = rowsOf(await tx.execute(sql`SELECT date_of_birth::text dob FROM contacts WHERE id = ${d.childId}`))[0];
    const year = Number(String(rowsOf(await tx.execute(sql`SELECT year FROM terms WHERE id = ${d.termId}`))[0]?.year));
    const grade = child?.dob ? year - Number(String(child.dob).slice(0, 4)) : null;
    // The option whose age band holds the child (Pre-Academy U9…U12, Academy U13–U15 / U17).
    const opts = rowsOf(await tx.execute(sql`SELECT id, name FROM program_options WHERE program_id = ${d.programId} AND is_active ORDER BY id`));
    const fits = (name: string) => {
      const m = /u ?(\d{1,2})(?:\s*[–-]\s*u?(\d{1,2}))?/i.exec(name);
      if (!m || grade == null) return false;
      const lo = Number(m[1]), hi = m[2] ? Number(m[2]) : lo;
      return grade >= lo && grade <= hi;
    };
    const opt = opts.find((o: any) => fits(String(o.name))) ?? (opts.length === 1 ? opts[0] : null);

    const paid = cents(inv.amountPaid);
    const paidOn = isoDay(inv.fullyPaidOnDate) ?? isoDay(inv.payments?.[inv.payments.length - 1]?.date) ?? nzTodayIso();
    const note = `Paid by bank transfer — Xero ${inv.invoiceNumber ?? inv.invoiceID} "${inv.reference ?? ""}", reconciled ${paidOn}. Registered by the Xero sync${decidedBy ? " on a staff decision" : ""}.`;
    const ins = rowsOf(await tx.execute(sql`
      INSERT INTO registrations (
        program_id, program_option_id, contact_id, guardian_id, status, term_id,
        payment_mode, academy_payment_plan, season_year,
        subtotal_cents, discount_cents, total_cents, currency, amount_paid,
        registration_location, source, notes, payment_method, payment_reference,
        served_by_user_id, paid_at, registered_at, legacy_source, legacy_external_id, order_number)
      VALUES (${d.programId}, ${opt?.id ?? null}, ${d.childId}, ${g?.id ?? null}, 'confirmed', ${d.termId},
        'upfront', 'term', ${year},
        ${paid}, 0, ${paid}, 'NZD', ${(paid / 100).toFixed(2)},
        'cufc_office', 'xero', ${note}, 'bank_transfer', ${inv.invoiceNumber ?? inv.invoiceID},
        NULL, ${paidOn + "T00:00:00+13:00"}::timestamptz, ${paidOn + "T00:00:00+13:00"}::timestamptz,
        'xero', ${inv.invoiceNumber ?? inv.invoiceID}, (SELECT COALESCE(MAX(order_number), 0) + 1 FROM registrations))
      ON CONFLICT (legacy_source, legacy_external_id) WHERE legacy_external_id IS NOT NULL DO NOTHING
      RETURNING id`))[0];
    const regId = ins?.id ?? rowsOf(await tx.execute(sql`
      SELECT id FROM registrations WHERE legacy_source = 'xero' AND legacy_external_id = ${inv.invoiceNumber ?? inv.invoiceID}`))[0]?.id;
    await tx.execute(sql`INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
      VALUES (${decidedBy}, 'create', 'registration', ${regId}, ${note})`);
    return Number(regId);
  });
}

async function saveLink(xeroContactId: string, name: string, childId: number, source: "auto" | "staff", by: number | null, evidence: unknown) {
  await db.execute(sql`
    INSERT INTO xero_contact_links (organization_id, xero_contact_id, xero_contact_name, contact_id, source, decided_by_user_id, evidence)
    VALUES (${ORG}, ${xeroContactId}, ${name}, ${childId}, ${source}, ${by}, ${JSON.stringify(evidence)}::jsonb)
    ON CONFLICT (organization_id, xero_contact_id) DO NOTHING`);
}

async function record(inv: Inv, parentEmail: string | null, d: Decision, by: number | null) {
  await db.execute(sql`
    INSERT INTO xero_invoice_registrations (
      organization_id, invoice_id, invoice_number, xero_contact_id, xero_contact_name, parent_email, reference,
      xero_status, payment_state, total_cents, amount_paid_cents, amount_due_cents, paid_on, invoice_date, xero_updated_at,
      programme_key, program_id, term_id, child_contact_id, decision, reason, candidates, registration_id, registered_by_sync,
      decided_by_user_id)
    VALUES (${ORG}, ${inv.invoiceID}, ${inv.invoiceNumber ?? null}, ${inv.contact.contactID}, ${inv.contact.name}, ${parentEmail}, ${inv.reference ?? null},
      ${inv.status}, ${paymentState(inv)}, ${cents(inv.total)}, ${cents(inv.amountPaid)}, ${cents(inv.amountDue)},
      ${isoDay(inv.fullyPaidOnDate)}, ${isoDay(inv.date)}, ${inv.updatedDateUTC ? new Date(inv.updatedDateUTC).toISOString() : null},
      ${d.programmeKey}, ${d.programId}, ${d.termId}, ${d.childId}, ${d.decision}, ${d.reason},
      ${d.candidates && d.candidates.length ? sql`ARRAY[${sql.join(d.candidates.map((c) => sql`${c}`), sql`, `)}]::int[]` : sql`NULL`},
      ${d.registrationId}, ${d.registeredBySync}, ${by})
    ON CONFLICT (organization_id, invoice_id) DO UPDATE SET
      invoice_number = EXCLUDED.invoice_number, xero_contact_name = EXCLUDED.xero_contact_name, parent_email = EXCLUDED.parent_email,
      reference = EXCLUDED.reference, xero_status = EXCLUDED.xero_status, payment_state = EXCLUDED.payment_state,
      total_cents = EXCLUDED.total_cents, amount_paid_cents = EXCLUDED.amount_paid_cents, amount_due_cents = EXCLUDED.amount_due_cents,
      paid_on = EXCLUDED.paid_on, invoice_date = EXCLUDED.invoice_date, xero_updated_at = EXCLUDED.xero_updated_at,
      programme_key = EXCLUDED.programme_key, program_id = EXCLUDED.program_id, term_id = EXCLUDED.term_id,
      child_contact_id = EXCLUDED.child_contact_id, decision = EXCLUDED.decision, reason = EXCLUDED.reason,
      candidates = EXCLUDED.candidates,
      -- 🔴 never forget a registration we made, or that we made it
      registration_id = COALESCE(EXCLUDED.registration_id, xero_invoice_registrations.registration_id),
      registered_by_sync = xero_invoice_registrations.registered_by_sync OR EXCLUDED.registered_by_sync,
      decided_by_user_id = COALESCE(EXCLUDED.decided_by_user_id, xero_invoice_registrations.decided_by_user_id),
      last_seen_at = now(),
      decided_at = CASE WHEN xero_invoice_registrations.decision IS DISTINCT FROM EXCLUDED.decision THEN now() ELSE xero_invoice_registrations.decided_at END`);
}

/** Apply one invoice. `staffChild` = a person picked the child (always applied). */
export async function applyInvoice(inv: Inv, parentEmail: string | null, mode: SyncMode, progs: Map<ProgrammeKey, number>,
  staff?: { userId: number; childId: number }): Promise<Decision | null> {
  // A person's choice: store their link first, then decide as normal — the link is now the answer.
  if (staff) await saveLink(inv.contact.contactID, inv.contact.name, staff.childId, "staff", staff.userId, { by: "review queue" });
  // A dismissed invoice stays dismissed unless a person acts on it again.
  if (!staff) {
    const prev = rowsOf(await db.execute(sql`SELECT decision FROM xero_invoice_registrations WHERE organization_id = ${ORG} AND invoice_id = ${inv.invoiceID}`))[0];
    if (prev?.decision === "dismissed" && paymentState(inv) !== "void") return null;
  }
  const d = await decide(inv, progs, parentEmail);
  if (!d) return null;
  if (staff && d.decision === "past_term") d.decision = "would_register"; // a person chose to
  const write = mode === "live" || !!staff;
  if (d.decision === "would_register" && write) {
    if (d.autoLink) await saveLink(inv.contact.contactID, inv.contact.name, d.childId!, "auto", null, d.autoLink);
    d.registrationId = await register(inv, d, parentEmail, staff?.userId ?? null);
    d.decision = "registered"; d.registeredBySync = true;
  } else if (write && d.autoLink && d.decision !== "needs_review") {
    // Unpaid/part-paid with a confident match: remember who it is now, so the
    // day it's paid it follows the link.
    await saveLink(inv.contact.contactID, inv.contact.name, d.childId!, "auto", null, d.autoLink);
  }
  await record(inv, parentEmail, d, staff?.userId ?? null);
  return d;
}

/** Xero contacts' emails, 50 ids a call. */
async function contactEmails(xero: any, tenantId: string, ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 50) {
    const r = await xero.accountingApi.getContacts(tenantId, undefined, undefined, undefined, ids.slice(i, i + 50), undefined, true);
    for (const c of r.body.contacts ?? []) out.set(String(c.contactID), c.emailAddress ?? null);
  }
  return out;
}

/** One sweep. Returns counts. Holds a lease so two machines never overlap. */
export async function runXeroRegistrationSync(opts: { mode?: SyncMode; since?: Date } = {}) {
  const mode = opts.mode ?? syncMode();
  if (mode === "off") return { skipped: "off" };
  await db.execute(sql`INSERT INTO xero_registration_sync_state (organization_id) VALUES (${ORG}) ON CONFLICT DO NOTHING`);
  const lease = rowsOf(await db.execute(sql`
    UPDATE xero_registration_sync_state SET lease_until = now() + interval '9 minutes', last_run_at = now()
     WHERE organization_id = ${ORG} AND (lease_until IS NULL OR lease_until < now())
     RETURNING modified_since`))[0];
  if (!lease) return { skipped: "another machine is running" };
  const counts: Record<string, number> = {};
  try {
    const since = opts.since ?? (lease.modified_since ? new Date(lease.modified_since) : START);
    const { xero, tenantId } = await getXeroForOrg(ORG);
    const progs = await programmes();
    const invoices: Inv[] = [];
    for (let page = 1; page <= 40; page++) {
      const r = await xero.accountingApi.getInvoices(tenantId, since, 'Type=="ACCREC"', "UpdatedDateUTC ASC",
        undefined, undefined, undefined, undefined, page, false, undefined, undefined, false, 100);
      const got = (r.body.invoices ?? []) as any[];
      invoices.push(...got);
      if (got.length < 100) break;
    }
    const family = invoices.filter((i) => isFamilyPrefix(splitContactName(i.contact?.name ?? "").prefix) && parseReference(i.reference).kind !== "not_registration");
    const emails = await contactEmails(xero, tenantId, Array.from(new Set(family.map((i) => i.contact.contactID))));
    let maxUpdated = since.getTime();
    for (const inv of invoices) {
      const t = inv.updatedDateUTC ? new Date(inv.updatedDateUTC).getTime() : 0;
      if (t > maxUpdated) maxUpdated = t;
      if (!family.includes(inv)) continue;
      try {
        const d = await applyInvoice(inv, emails.get(inv.contact.contactID) ?? null, mode, progs);
        if (d) counts[d.decision] = (counts[d.decision] ?? 0) + 1;
      } catch (e: any) {
        counts.errors = (counts.errors ?? 0) + 1;
        console.error(`[xero-reg-sync] ${inv.invoiceNumber}:`, e?.message ?? e);
      }
    }
    counts.invoicesRead = invoices.length;
    // 🔴 The cursor only moves when the whole pass succeeded; 1s back so an
    // invoice updated in the same second is read again (idempotent).
    await db.execute(sql`UPDATE xero_registration_sync_state
       SET modified_since = ${new Date(maxUpdated - 1000).toISOString()}::timestamptz, last_ok_at = now(), last_error = NULL,
           last_counts = ${JSON.stringify({ mode, ...counts })}::jsonb, lease_until = NULL
     WHERE organization_id = ${ORG}`);
    return { mode, ...counts };
  } catch (e: any) {
    const msg = typeof e === "string" ? e.slice(0, 300) : String(e?.message ?? e?.response?.statusCode ?? "error").slice(0, 300);
    await db.execute(sql`UPDATE xero_registration_sync_state SET last_error = ${msg}, lease_until = NULL WHERE organization_id = ${ORG}`);
    throw new Error(msg);
  }
}

const EVERY_MS = 10 * 60_000;
export function startXeroRegistrationSync(): void {
  const mode = syncMode();
  if (mode === "off") { console.log("[xero-reg-sync] off (XERO_REG_SYNC unset) — paid invoices are not synced"); return; }
  console.log(`[xero-reg-sync] ${mode} — every ${EVERY_MS / 60000} min`);
  const tick = () => runXeroRegistrationSync().then(
    (r) => console.log("[xero-reg-sync]", JSON.stringify(r)),
    // 🔴 never print a raw xero-node error: it can carry the bearer token
    (e) => console.error("[xero-reg-sync] failed:", String(e?.message ?? "error").slice(0, 200)));
  setTimeout(tick, 90_000);
  setInterval(tick, EVERY_MS);
}

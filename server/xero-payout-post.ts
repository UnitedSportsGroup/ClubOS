// Post one Stripe payout into Xero as a Receive Money, already split.
//
// 🔴 The document this builds is deliberately INDISTINGUISHABLE from the ones
// Olga and Natalia make by hand: type RECEIVE, contact "Stripe Payments", bank
// account ANZ Business Premium (600 since Victor's renumbering; found by number), `Inclusive` line amounts, and the Stripe fee as a negative line
// on 484/01 with GST on Expenses. Their shape was read off their own most recent
// entry rather than assumed — a document that looks foreign is a document that
// gets deleted.
//
// 🔴 It is left UNRECONCILED on purpose. Xero cannot reconcile a bank line
// through the API and never will ("we do not plan to add this capability"), so
// the last step stays a human clicking OK against the bank statement line. That
// is also the safety: nothing is final until a person accepts it.

import Stripe from "stripe";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { getXeroForOrg } from "./xero";
import { walkPayout, type WalkedItem } from "./xero-payout";
import type { XeroCategoryKey } from "@shared/xero-payout";

const CONTACT_NAME = "Stripe Payments";
/**
 * 🔴 The bank account is found by its ACCOUNT NUMBER, never its code.
 *
 * Victor's chart restructure (Sep 2026) renumbered ANZ Business Premium from 147
 * to 600. The poster asked for "147", so every payout from 15 Sep was rejected —
 * AND the duplicate guard below silently found no bank, answered "not coded yet",
 * and would have double-posted had Xero not refused the code. A bank account's
 * number is what the bank prints on the statement; it does not change when a
 * chart of accounts is reorganised.
 */
const BANK_ACCOUNT_NUMBER = (process.env.XERO_STRIPE_BANK_ACCOUNT_NUMBER || "010635037482300").replace(/\D/g, "");
const FEE_ACCOUNT = "484/01";
const FEE_TAX = "INPUT2";

/**
 * The chart of accounts, fetched ONCE per 10 minutes. A plan used to ask Xero for
 * it three times (bank, code check, duplicate guard) — enough to trip Xero's
 * 60-a-minute limit on a catch-up run and to eat a daily allowance shared with
 * every other ClubOS Xero feature.
 */
let chartCache: { at: number; orgId: number; accs: any[] } | null = null;
async function chart(orgId: number): Promise<any[]> {
  if (chartCache && chartCache.orgId === orgId && Date.now() - chartCache.at < 10 * 60_000) return chartCache.accs;
  const { xero, tenantId } = await getXeroForOrg(orgId);
  const accs = (await xeroCall(() => xero.accountingApi.getAccounts(tenantId))).body.accounts ?? [];
  chartCache = { at: Date.now(), orgId, accs };
  return accs;
}

/** One Xero call, retried once after a PER-MINUTE rejection (Retry-After ≤ 60s).
 *  A DAY-limit rejection is not retried — waiting minutes cannot fix it. */
async function xeroCall<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    const h = e?.response?.headers ?? {};
    if (e?.response?.statusCode === 429 && h["x-rate-limit-problem"] === "minute") {
      const wait = Math.min(60, Number(h["retry-after"] ?? 10)) * 1000 + 500;
      await new Promise((r) => setTimeout(r, wait));
      return await fn();
    }
    throw e;
  }
}

/** The Stripe deposit account as Xero knows it TODAY (id + current code), or null. */
async function stripeBankAccount(orgId: number): Promise<{ accountID: string; code: string | null; name: string } | null> {
  const accs = await chart(orgId);
  const bank = accs.find((a) => String(a.type) === "BANK" && String(a.status) === "ACTIVE"
    && String(a.bankAccountNumber ?? "").replace(/\D/g, "") === BANK_ACCOUNT_NUMBER);
  return bank?.accountID ? { accountID: bank.accountID, code: bank.code ?? null, name: bank.name ?? "" } : null;
}

/** Child name per registration id (academy payments only). */
async function childNames(regIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!regIds.length) return out;
  const r = await db.execute(sql`
    SELECT r.id, btrim(c.first_name) || ' ' || btrim(c.last_name) AS name
      FROM registrations r JOIN contacts c ON c.id = r.contact_id
     WHERE r.id IN (${sql.join(regIds.map((i) => sql`${i}`), sql`, `)})`);
  for (const row of (r.rows as any[])) out.set(Number(row.id), String(row.name));
  return out;
}

const normName = (s: string) => s.replace(/^\([^)]*\)\s*/, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Olga's per-child academy invoices — contact "(A U11) Ruben Kruger" — open, or
 * paid in the last 3 weeks (a payment she has already applied by hand must also
 * stay out of the Receive Money).
 */
async function academyInvoices(orgId: number) {
  const { xero, tenantId } = await getXeroForOrg(orgId);
  const since = new Date(Date.now() - 120 * 86400_000);
  const all: any[] = [];
  for (let page = 1; page <= 15; page++) {
    const r = await xeroCall(() => xero.accountingApi.getInvoices(tenantId, since,
      `Type=="ACCREC" AND Contact.Name.StartsWith("(A") AND (Status=="AUTHORISED" OR Status=="PAID")`, "Date DESC", undefined, undefined, undefined, undefined, page));
    const got = r.body.invoices ?? [];
    all.push(...got);
    if (got.length < 100) break;
  }
  return all.map((i: any) => ({
    number: String(i.invoiceNumber ?? ""), id: String(i.invoiceID ?? ""), child: normName(String(i.contact?.name ?? "")),
    status: String(i.status), totalCents: Math.round(Number(i.total ?? 0) * 100),
    dueCents: Math.round(Number(i.amountDue ?? 0) * 100),
    paidOn: i.fullyPaidOnDate ? new Date(i.fullyPaidOnDate).toISOString().slice(0, 10) : null,
  }));
}

/** Programmes Olga invoices per child (and so must never be coded as plain income). */
const INVOICED_PROGRAMMES = new Set<number>([16 /* Pre-Academy */]);

/** What an invoice needs: the child, their age group (the option bought), the
 *  term, and the parent the invoice contact is named for. */
async function invoiceInfo(regIds: number[]) {
  const out = new Map<number, { child: string; grade: number | null; termLabel: string; parentFirst: string; parentLast: string; parentEmail: string | null }>();
  if (!regIds.length) return out;
  const r = await db.execute(sql`
    SELECT r.id, btrim(c.first_name)||' '||btrim(c.last_name) child, o.name option_name,
           c.date_of_birth::text dob, coalesce(t.name, '') term_name, t.year term_year,
           coalesce(g.first_name,'') pf, coalesce(g.last_name,'') pl, g.email pe
      FROM registrations r
      JOIN contacts c ON c.id = r.contact_id
      LEFT JOIN program_options o ON o.id = r.program_option_id
      LEFT JOIN terms t ON t.id = r.term_id
      LEFT JOIN contacts g ON g.id = r.guardian_id
     WHERE r.id IN (${sql.join(regIds.map((i) => sql`${i}`), sql`, `)})`);
  for (const x of (r.rows as any[])) {
    const fromOption = /U\s?(\d{1,2})/i.exec(String(x.option_name ?? ""))?.[1];
    const fromDob = x.dob ? Number(String(x.term_year ?? new Date().getFullYear())) - Number(String(x.dob).slice(0, 4)) : null;
    const term = /term\s*(\d)/i.exec(String(x.term_name))?.[1];
    out.set(Number(x.id), {
      child: String(x.child), grade: fromOption ? Number(fromOption) : fromDob,
      termLabel: term ? `Term ${term}` : String(x.term_name || "Term"),
      parentFirst: String(x.pf), parentLast: String(x.pl), parentEmail: x.pe ? String(x.pe) : null,
    });
  }
  return out;
}

/** Raise one Pre-Academy invoice exactly as Olga does (read off INV-17545). */
async function raiseAcademyInvoice(orgId: number, v: NonNullable<PostPlan["toInvoice"]>[number], date: string): Promise<string> {
  const { xero, tenantId } = await getXeroForOrg(orgId);
  const name = `(A U${v.grade}) ${v.child}`;
  const found = (await xero.accountingApi.getContacts(tenantId, undefined, `Name=="${name.replace(/"/g, "")}"`)).body.contacts ?? [];
  let contactID = found[0]?.contactID;
  if (!contactID) {
    const made = await xero.accountingApi.createContacts(tenantId, { contacts: [{
      name, firstName: v.parentFirst || undefined, lastName: v.parentLast || undefined,
      emailAddress: v.parentEmail || undefined,
    }] });
    contactID = made.body.contacts?.[0]?.contactID;
    // Her contacts sit in an age-group group ("U9"); join it when it exists.
    const groups = (await xero.accountingApi.getContactGroups(tenantId, `Name=="U${v.grade}"`)).body.contactGroups ?? [];
    if (contactID && groups[0]?.contactGroupID) {
      await xero.accountingApi.createContactGroupContacts(tenantId, groups[0].contactGroupID, { contacts: [{ contactID }] }).catch(() => {});
    }
  }
  if (!contactID) throw new Error(`could not create the Xero contact ${name}`);
  const band = v.grade <= 10 ? "U9/10" : "U11/12";
  const due = new Date(Date.parse(date) + 8 * 86400_000).toISOString().slice(0, 10);
  const res = await xero.accountingApi.createInvoices(tenantId, { invoices: [{
    type: "ACCREC" as any, contact: { contactID }, date, dueDate: due, status: "AUTHORISED" as any,
    lineAmountTypes: "Inclusive" as any, reference: `${date.slice(0, 4)} ${band} - ${v.termLabel}`,
    brandingThemeID: process.env.XERO_ACADEMY_BRANDING_THEME || "41bcfebe-bc82-4d2d-a06e-5df0b6b60b46",
    lineItems: [{ description: "Training fee", quantity: 1, unitAmount: v.amountCents / 100, accountCode: "101", taxType: "OUTPUT2" }],
  }] });
  const inv = res.body.invoices?.[0];
  if (!inv?.invoiceNumber) throw new Error(`Xero did not return an invoice for ${name}`);
  return inv.invoiceNumber;
}

/** Every ACTIVE account code in the chart right now. */
async function activeAccountCodes(orgId: number): Promise<Set<string>> {
  const accs = await chart(orgId);
  return new Set(accs.filter((a) => String(a.status) === "ACTIVE" && a.code).map((a) => a.code as string));
}

export interface PostLine { accountCode: string; taxType: string; amountCents: number; description: string; }
export interface PostPlan {
  payoutId: string; arrivalDate: string; payoutCents: number; currency: string;
  lines: PostLine[];
  /**
   * Academy payments that belong to a per-child Xero INVOICE (Olga invoices
   * every academy child, e.g. "INV-17543 (A U11) Ruben Kruger"). They are NOT
   * coded as income here — that would count the fee twice, once on her invoice
   * and once on this Receive Money. They are named in the reference so the
   * invoice payment is one search away, and the Receive Money totals the rest.
   */
  invoiced: { invoiceNumber: string; child: string; amountCents: number; alreadyPaid: boolean }[];
  /**
   * Pre-Academy payments with no invoice yet. postPayout raises each one in
   * Olga's exact shape (contact "(A U9) Oscar Gabites" · "Training fee" on 101 ·
   * reference "2026 U9/10 - Term 4"), left OPEN for her to tick on the reconcile
   * screen — this connection can create invoices but not record payments.
   */
  toInvoice?: { regId: number; child: string; grade: number; amountCents: number; termLabel: string;
    parentFirst: string; parentLast: string; parentEmail: string | null }[];
  /** Anything that must be resolved by a human before this can post. */
  blockers: string[];
  alreadyPosted: { xeroBankTxnId: string | null; postedAt: string | null } | null;
}

/** Where does this item's money go? Programme first, then the category. */
async function loadMap(orgId: number) {
  const r = await db.execute(sql`
    SELECT category, program_id, teampay_competition_id, xero_account_code, xero_tax_type, confirmed_by
      FROM xero_account_map WHERE organization_id = ${orgId}`);
  const byProgram = new Map<string, any>();
  const byCompetition = new Map<string, any>();
  const byCategory = new Map<string, any>();
  for (const row of r.rows as any[]) {
    if (row.program_id != null) byProgram.set(`${row.category}:${row.program_id}`, row);
    else if (row.teampay_competition_id != null) byCompetition.set(`${row.category}:${row.teampay_competition_id}`, row);
    else byCategory.set(row.category, row);
  }
  return { byProgram, byCompetition, byCategory };
}

/**
 * Build the document without sending it. Every refusal is collected rather than
 * thrown, so one run tells a human everything they have to fix instead of one
 * thing at a time.
 */
/**
 * Have WE already posted this payout? A pure DB read, no Stripe and no Xero.
 *
 * 🔴 Exists so the hourly sweep can skip work it has already done. `planPayout`
 * walks the payout in Stripe and then asks Xero for the chart of accounts and a
 * window of bank transactions — two Xero calls — before it gets far enough to
 * notice `alreadyPosted`. Eight payouts an hour on two Fly machines is ~768
 * wasted Xero calls a day against a 5,000/day tenant limit, which is how the
 * quota came to be exhausted mid-afternoon.
 *
 * 🔴 This does NOT weaken the duplicate guard. `findExistingEntry` — the check
 * that Olga or Natalia has not already coded the deposit by hand — still runs
 * on every payout that could actually be posted. This only short-circuits ones
 * our own ledger already claims, where there is nothing left to decide.
 */
export async function isAlreadyPosted(payoutId: string): Promise<boolean> {
  const prior = await db.execute(sql`
    SELECT 1 FROM xero_payout_posts
     WHERE stripe_payout_id = ${payoutId} AND stripe_account = 'club' AND status IN ('posted', 'skipped')
     LIMIT 1`);
  return (prior.rows as any[]).length > 0;
}

/** A person coded this deposit in Xero themselves. Recorded so the sweep stops
 *  re-checking it; nothing is posted. */
export async function markHandledByHand(payoutId: string, arrivalDate: string, payoutCents: number, currency: string) {
  await db.execute(sql`
    INSERT INTO xero_payout_posts (organization_id, stripe_payout_id, stripe_account, arrival_date, currency, payout_cents, status, error)
    VALUES (1, ${payoutId}, 'club', ${arrivalDate}, ${currency}, ${payoutCents}, 'skipped', 'coded by hand in Xero')
    ON CONFLICT (stripe_account, stripe_payout_id) DO UPDATE SET status = 'skipped', error = 'coded by hand in Xero', updated_at = now()
    WHERE xero_payout_posts.status <> 'posted'`);
}

export async function planPayout(payoutId: string, orgId = 1): Promise<PostPlan> {
  const { split, items } = await walkPayout(payoutId);
  const map = await loadMap(orgId);
  const blockers: string[] = [];

  if (!split.balances) blockers.push(`the split does not reconcile: computed $${(split.computedCents / 100).toFixed(2)} against a payout of $${(split.payoutCents / 100).toFixed(2)}`);
  if (split.reversalCents) blockers.push(`this batch contains a returned earlier payout of $${(split.reversalCents / 100).toFixed(2)} — a bank transfer, not income. Code this one by hand.`);

  // ── Academy payments that belong to a child's invoice ───────────────────
  // One match only: the child's name AND the exact amount, on an invoice that is
  // still open (to be paid) or was paid in the last 3 weeks (already applied by
  // hand). Two candidates, or none, and the payment stays a normal income line —
  // with the child named, so it is visible on the Receive Money.
  const academy = (items as WalkedItem[]).filter((it) =>
    it.resolved?.source === "registrations" && it.resolved?.programType === "academy" && it.grossCents > 0);
  const names = await childNames(academy.map((it) => Number(it.resolved!.recordId)).filter(Number.isFinite));
  const invoiced: PostPlan["invoiced"] = [];
  const pendingInvoice: WalkedItem[] = [];
  const skip = new Set<WalkedItem>();
  const toInvoice: NonNullable<PostPlan["toInvoice"]> = [];
  if (academy.length) {
    let invs: Awaited<ReturnType<typeof academyInvoices>> = [];
    try { invs = await academyInvoices(orgId); }
    catch (e: any) { blockers.push(`could not read the academy invoices to check for double-counting: ${e?.message ?? e}`); }
    const used = new Set<string>();
    void used;
    const recentCut = new Date(Date.parse(split.arrivalDate) - 21 * 86400_000).toISOString().slice(0, 10);
    for (const it of academy) {
      const child = (names.get(Number(it.resolved!.recordId)) ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!child) continue;
      const hits = invs.filter((v) => !used.has(v.id) && v.child === child && (
        (v.status === "AUTHORISED" && v.dueCents === it.grossCents) ||
        (v.status === "PAID" && v.totalCents === it.grossCents && v.paidOn !== null && v.paidOn >= recentCut)));
      if (hits.length !== 1) {
        if (INVOICED_PROGRAMMES.has(Number(it.resolved!.programId)) && hits.length === 0) pendingInvoice.push(it);
        continue;
      }
      used.add(hits[0].id);
      skip.add(it);
      invoiced.push({ invoiceNumber: hits[0].number, child: names.get(Number(it.resolved!.recordId))!, amountCents: it.grossCents, alreadyPaid: hits[0].status === "PAID" });
    }
  }

  // Pre-Academy with no invoice → raise one in Olga's shape at post time.
  if (pendingInvoice.length) {
    const info = await invoiceInfo(pendingInvoice.map((it) => Number(it.resolved!.recordId)));
    for (const it of pendingInvoice) {
      const i = info.get(Number(it.resolved!.recordId));
      if (!i || !i.grade) { blockers.push(`Pre-Academy payment $${(it.grossCents / 100).toFixed(2)} (registration ${it.resolved!.recordId}) — no age group to invoice it under`); continue; }
      skip.add(it);
      toInvoice.push({ regId: Number(it.resolved!.recordId), child: i.child, grade: i.grade, amountCents: it.grossCents,
        termLabel: i.termLabel, parentFirst: i.parentFirst, parentLast: i.parentLast, parentEmail: i.parentEmail });
    }
  }

  // Group by the account each item resolves to, summing refunds against sales in
  // the same account exactly as a hand-coded entry does.
  const groups = new Map<string, { account: string; tax: string; cents: number; what: Set<string>; n: number; kids: string[] }>();
  for (const it of items as WalkedItem[]) {
    if (skip.has(it)) continue;
    const cat = it.category as XeroCategoryKey;
    const progId = (it.resolved as any)?.programId ?? null;
    const compId = (it.resolved as any)?.competitionId ?? null;
    const rule = (progId != null && map.byProgram.get(`${cat}:${progId}`))
      || (compId != null && map.byCompetition.get(`${cat}:${compId}`))
      || map.byCategory.get(cat);
    if (!rule?.xero_account_code) {
      const label = it.resolved?.description ?? cat;
      const msg = `nothing tells us where "${label}" goes ($${(it.grossCents / 100).toFixed(2)})`;
      if (!blockers.includes(msg)) blockers.push(msg);
      continue;
    }
    const key = `${rule.xero_account_code}|${rule.xero_tax_type}`;
    const g = groups.get(key) ?? { account: rule.xero_account_code, tax: rule.xero_tax_type, cents: 0, what: new Set<string>(), n: 0, kids: [] as string[] };
    g.cents += it.grossCents; g.n++;
    if (it.resolved?.description) g.what.add(it.resolved.description);
    // An academy payment with no invoice is named, so it is never invoiced later.
    const kid = academy.includes(it) ? names.get(Number(it.resolved!.recordId)) : undefined;
    if (kid) g.kids.push(kid);
    groups.set(key, g);
  }

  const lines: PostLine[] = [];
  for (const g of Array.from(groups.values()).sort((a, b) => b.cents - a.cents)) {
    if (g.cents === 0) continue;   // a sale fully refunded in the same payout nets to nothing
    const what = Array.from(g.what).slice(0, 2).join(", ") || "Stripe";
    const kids = g.kids.length ? ` (no invoice: ${g.kids.join(", ")})` : "";
    lines.push({ accountCode: g.account, taxType: g.tax, amountCents: g.cents,
      description: `${what}${g.n > 1 ? ` — ${g.n} payments` : ""}${kids}`.slice(0, 400) });
  }
  const feeCents = split.feeCents + split.stripeChargeCents;
  if (feeCents) lines.push({ accountCode: FEE_ACCOUNT, taxType: FEE_TAX, amountCents: -feeCents, description: "Stripe fee" });

  // 🔴 Every code must exist and be ACTIVE in Xero TODAY. A renumbered chart
  // otherwise surfaces as one opaque "validation exception" per payout, every
  // hour, for weeks — the alert must say which code went where.
  const live = await activeAccountCodes(orgId);
  for (const l of lines) {
    if (!live.has(l.accountCode)) {
      const msg = `account ${l.accountCode} is not an active account in Xero any more (used for "${l.description}") — update the mapping`;
      if (!blockers.includes(msg)) blockers.push(msg);
    }
  }

  // 🔴 The document must add up to the payout to the cent, or the bank line will
  // never match it and someone is left with a half-finished entry to unpick.
  // The Receive Money plus the invoice payments must make the deposit, exactly.
  const lineTotal = lines.reduce((s, l) => s + l.amountCents, 0);
  const invoicedCents = invoiced.reduce((s, v) => s + v.amountCents, 0) + toInvoice.reduce((s, v) => s + v.amountCents, 0);
  if (lines.length && lineTotal + invoicedCents !== split.payoutCents)
    blockers.push(`the lines total $${(lineTotal / 100).toFixed(2)} + invoices $${(invoicedCents / 100).toFixed(2)} but the payout is $${(split.payoutCents / 100).toFixed(2)}`);

  const prior = await db.execute(sql`
    SELECT xero_bank_txn_id, posted_at, status FROM xero_payout_posts
     WHERE stripe_payout_id = ${payoutId} AND stripe_account = 'club'`);
  const p: any = (prior.rows as any[])[0];

  // 🔴 THE GUARD THAT MATTERS MOST. Our own table only knows what WE posted. Olga
  // and Natalia have been coding these by hand all year, and a payout they have
  // already done would otherwise be posted a second time — two Receive Moneys for
  // one deposit, one of which can never reconcile, silently inflating income.
  // So ask XERO whether an entry for this exact payout already exists, every time.
  let existing: string | null = null;
  try {
    existing = await findExistingEntry(orgId, split.arrivalDate, split.payoutCents, payoutId);
  } catch (e: any) {
    // 🔴 FAIL CLOSED: a check that could not run is not a "no".
    blockers.push(`could not check whether this payout was already coded by hand: ${e?.message ?? e}`);
  }
  if (existing) blockers.push(`Xero already has an entry for this payout on ${split.arrivalDate} for $${(split.payoutCents / 100).toFixed(2)} (${existing}) — almost certainly coded by hand. Posting again would duplicate the deposit.`);

  return {
    payoutId, arrivalDate: split.arrivalDate, payoutCents: split.payoutCents, currency: split.currency,
    lines, invoiced, toInvoice, blockers,
    alreadyPosted: p && p.status === "posted" ? { xeroBankTxnId: p.xero_bank_txn_id, postedAt: p.posted_at } : null,
  };
}

/**
 * Is there already a bank transaction in Xero for this payout?
 *
 * Matched on the bank account, the date and the exact amount — the same three
 * things a person uses to recognise it on the reconcile screen. Deliberately
 * does NOT require our reference, because a hand-coded entry has none.
 */
async function findExistingEntry(orgId: number, arrivalDate: string, payoutCents: number, payoutId = ""): Promise<string | null> {
  const { xero, tenantId } = await getXeroForOrg(orgId);
  const bank = await stripeBankAccount(orgId);
  // 🔴 No bank = cannot check = refuse. Returning null here is what let a
  // renumbered account read as "nobody has coded this".
  if (!bank) throw new Error(`no active Xero bank account with number ${BANK_ACCOUNT_NUMBER}`);
  const res = await xeroCall(() => xero.accountingApi.getBankTransactions(
    tenantId, undefined,
    `BankAccount.AccountID==Guid("${bank.accountID}") AND Date==DateTime(${arrivalDate.slice(0,4)},${Number(arrivalDate.slice(5,7))},${Number(arrivalDate.slice(8,10))})`));
  for (const t of res.body.bankTransactions ?? []) {
    if (String(t.status) !== "AUTHORISED") continue;
    // 🔴 Exact amount is NOT enough: Olga SPLITS a deposit — a Receive Money for
    // the camps/leagues and invoice payments for the academy children — so her
    // entry for 24 Sep is $1,938.62 against a $2,343.62 deposit. Any Stripe
    // receive on the same day means a person has handled that deposit.
    // Our OWN post for a DIFFERENT payout (two payouts can land on one day) is
    // not a person handling this one.
    const ref = String(t.reference ?? "");
    const otherPayout = /Stripe payout (po_[A-Za-z0-9]+)/.exec(ref)?.[1];
    if (otherPayout && otherPayout !== payoutId) continue;
    const isStripe = /stripe/i.test(`${t.contact?.name ?? ""} ${ref}`);
    if (Math.round(Number(t.total) * 100) === payoutCents || isStripe)
      return `${t.bankTransactionID} "${t.contact?.name ?? ""}" $${t.total}`.trim();
  }
  return null;
}

/** Send it. Refuses on any blocker, and refuses to post the same payout twice. */
export async function postPayout(payoutId: string, opts: { orgId?: number; by: string }): Promise<{ xeroId: string; url: string }> {
  const orgId = opts.orgId ?? 1;
  const plan = await planPayout(payoutId, orgId);
  if (plan.alreadyPosted) throw new Error(`${payoutId} was already posted as ${plan.alreadyPosted.xeroBankTxnId}`);
  if (plan.blockers.length) throw new Error(`refusing to post ${payoutId}:\n  - ${plan.blockers.join("\n  - ")}`);
  if (!plan.lines.length) throw new Error(`${payoutId} has no lines to post`);

  // Claim the payout BEFORE calling Xero. The unique index is what stops two
  // runs creating two documents for the same money; claiming after the call
  // would leave a real Xero document with no record of it here.
  await db.execute(sql`
    INSERT INTO xero_payout_posts (organization_id, stripe_payout_id, stripe_account, arrival_date, currency, payout_cents, split_json, status)
    VALUES (${orgId}, ${payoutId}, 'club', ${plan.arrivalDate}, ${plan.currency}, ${plan.payoutCents}, ${JSON.stringify(plan)}::jsonb, 'pending')
    ON CONFLICT (stripe_account, stripe_payout_id) DO UPDATE SET split_json = EXCLUDED.split_json, updated_at = now()
    WHERE xero_payout_posts.status <> 'posted'`);

  const { xero, tenantId } = await getXeroForOrg(orgId);
  const bank = await stripeBankAccount(orgId);
  if (!bank) throw new Error(`refusing to post ${payoutId}: no active Xero bank account with number ${BANK_ACCOUNT_NUMBER}`);
  // Raise the missing Pre-Academy invoices FIRST. Re-running after a failure is
  // safe: the next plan finds them open and matches instead of raising again.
  for (const v of plan.toInvoice ?? []) {
    const number = await raiseAcademyInvoice(orgId, v, plan.arrivalDate);
    plan.invoiced.push({ invoiceNumber: number, child: v.child, amountCents: v.amountCents, alreadyPaid: false });
  }
  try {
    const res = await xero.accountingApi.createBankTransactions(tenantId, {
      bankTransactions: [{
        type: "RECEIVE" as any,
        contact: { name: CONTACT_NAME },
        bankAccount: { accountID: bank.accountID },
        date: plan.arrivalDate,
        lineAmountTypes: "Inclusive" as any,
        // The invoices this deposit also pays, so the match is one search away.
        reference: (`Stripe payout ${plan.payoutId}` + (plan.invoiced.length
          ? ` · plus invoices: ${plan.invoiced.map((v) => `${v.invoiceNumber} ${v.child} $${(v.amountCents / 100).toFixed(2)}${v.alreadyPaid ? " (paid)" : ""}`).join("; ")}`
          : "")).slice(0, 255),
        lineItems: plan.lines.map(l => ({
          description: l.description, accountCode: l.accountCode, taxType: l.taxType,
          quantity: 1, unitAmount: l.amountCents / 100,
        })),
      }],
    });
    const created = res.body.bankTransactions?.[0];
    const id = created?.bankTransactionID;
    if (!id) throw new Error("Xero accepted the call but returned no transaction id");
    await db.execute(sql`
      UPDATE xero_payout_posts SET status='posted', xero_bank_txn_id=${id}, posted_at=now(), posted_by=${opts.by}, error=NULL, updated_at=now()
       WHERE stripe_payout_id=${payoutId} AND stripe_account='club'`);
    return { xeroId: id, url: `https://go.xero.com/Bank/ViewTransaction.aspx?bankTransactionID=${id}` };
  } catch (e: any) {
    const detail = e?.response?.body ? JSON.stringify(e.response.body).slice(0, 900) : (e?.message ?? String(e));
    await db.execute(sql`
      UPDATE xero_payout_posts SET status='failed', error=${detail}, updated_at=now()
       WHERE stripe_payout_id=${payoutId} AND stripe_account='club'`);
    throw new Error(detail);
  }
}

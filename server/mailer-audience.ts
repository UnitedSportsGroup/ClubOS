/**
 * Who a Mailer campaign goes to, and WHOSE NAMES ride on each address.
 *
 * Zach, 2026-10-05: "are you able to create a personalised tag for Players
 * name on the email template, please. Would be useful for academy
 * invitations etc." An academy invitation is addressed to the player, but it
 * lands in the parent's inbox — so an email address has to know two things:
 * the parent it belongs to ({{first_name}}) and the registered children it
 * stands for ({{player_first_name}}). This module is the ONE place both are
 * decided; the preview count, the live send and the test send all read it.
 *
 * What the data actually looks like (probed on production, 2026-10-06):
 *
 *  • Two registration shapes. A camp booking is a guardian contact plus one
 *    registration_items line per child per day (the child is a `children`
 *    row). An academy/term enrolment's registrant contact IS the player
 *    (`contacts.type = 'player'`) and the parent sits on `guardian_id`.
 *  • 🔴 THE PLAYER ROW USUALLY CARRIES THE PARENT'S EMAIL — and the newest
 *    families carry it on the GUARDIAN row ONLY (reg 2728: player Ryan, email
 *    blank; guardian Kat, email set). The old "By Camp" audience read the
 *    registrant's email alone, so every one of those families was missing
 *    from an academy programme's list. Both rows are read now.
 *  • 🔴 2,773 addresses sit on more than one contact row. The old first-name
 *    lookup took whichever row an unordered scan returned first, so
 *    "Hi {{first_name}}" could print the CHILD's name to the parent. Here the
 *    parent's name comes from the registration's own guardian, then a
 *    guardian-typed contact carrying the address, then a contact_relationships
 *    link — in that order, every time.
 *  • 8% of parents have two or more children in the same programme. One
 *    address is one recipient (the broadcast queue keys on it, and so does
 *    the resume-never-resend guard), so those read "Hi Jack and Lily" rather
 *    than getting two emails.
 *
 * Only REAL registrations are read (@shared/registrations): an unfinished
 * checkout is not a player and never reaches a list.
 */
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "./db";
import {
  children,
  contactRelationships,
  contacts,
  registrationItems,
  registrations,
} from "@shared/schema";
import { REAL_REGISTRATION_STATUSES } from "@shared/registrations";

export type MailerPlayer = { firstName: string; lastName: string };

export type MailerRecipient = {
  email: string;
  /** The PARENT — the person whose inbox this is. Null when nobody knows. */
  firstName: string | null;
  lastName: string | null;
  /** The registered children this address stands for, within the audience's
   *  scope (a day segment lists only the children booked on that day). */
  players: MailerPlayer[];
};

export type MailerAudience = {
  /** Deduplicated, lowercased, in a stable order. */
  emails: string[];
  byEmail: Map<string, MailerRecipient>;
};

/** The same lenient rule the queue and the old resolver used — trimmed,
 *  lowercased, must contain an "@". Stricter validation here would silently
 *  drop addresses the list has always carried. */
export function cleanMailerEmail(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  return s.includes("@") ? s : null;
}

/** "Jack" · "Jack and Lily" · "Jack, Lily and Tom" — defined once, in the
 *  renderer that prints it. */
export { joinNames } from "./mailer-render";

type Scope =
  | { kind: "all" }
  | { kind: "program"; programId: number }
  | { kind: "items"; programId: number; campDateId: number; productType: string | null }
  | { kind: "none" };

function scopeOf(segmentType: string, cfg: any): Scope {
  if (segmentType === "all") return { kind: "all" };
  const programId = Number(cfg?.campId);
  if (segmentType === "camp" && programId) return { kind: "program", programId };
  const campDateId = Number(cfg?.campDateId);
  if (segmentType === "day" && programId && campDateId) {
    return { kind: "items", programId, campDateId, productType: null };
  }
  if (segmentType === "session" && programId && campDateId && cfg?.sessionType) {
    return { kind: "items", programId, campDateId, productType: String(cfg.sessionType).toUpperCase() };
  }
  return { kind: "none" };
}

type Acc = MailerRecipient & {
  /** 2 = the registration's own guardian · 1 = a non-player registrant ·
   *  0 = nothing yet. Higher wins; a tie keeps the first. */
  parentRank: number;
  playerKeys: Set<string>;
};

function acc(byEmail: Map<string, Acc>, email: string): Acc {
  let a = byEmail.get(email);
  if (!a) {
    a = { email, firstName: null, lastName: null, players: [], parentRank: 0, playerKeys: new Set() };
    byEmail.set(email, a);
  }
  return a;
}

function addPlayer(a: Acc, key: string, firstName: string | null, lastName: string | null) {
  if (a.playerKeys.has(key)) return;
  const first = (firstName || "").trim();
  if (!first) return;
  const last = (lastName || "").trim();
  // 🔴 One child, stored twice (the duplicate-children problem the Families
  // work keeps merging), must not read "Levi, Max and Levi" — the live
  // verifier found exactly that on FUNiño. Two rows with the same name on the
  // same address are the same child.
  const nameKey = `n:${first.toLowerCase()} ${last.toLowerCase()}`.trim();
  if (a.playerKeys.has(nameKey)) {
    a.playerKeys.add(key);
    return;
  }
  a.playerKeys.add(key);
  a.playerKeys.add(nameKey);
  a.players.push({ firstName: first, lastName: last });
}

function setParent(a: Acc, rank: number, firstName: string | null, lastName: string | null) {
  const first = (firstName || "").trim();
  if (!first || rank <= a.parentRank) return;
  a.parentRank = rank;
  a.firstName = first;
  a.lastName = (lastName || "").trim() || null;
}

const REAL = [...REAL_REGISTRATION_STATUSES];

/** Load the registrations a scope covers (optionally only those touching a
 *  set of addresses), with registrant + guardian, and the children on their
 *  items — then fold them into one recipient per address. */
async function foldRegistrations(
  byEmail: Map<string, Acc>,
  scope: Exclude<Scope, { kind: "none" }>,
  onlyEmails?: Set<string>,
): Promise<void> {
  const guardian = alias(contacts, "mailer_guardian");

  const itemFilter =
    scope.kind === "items"
      ? and(
          eq(registrationItems.campDateId, scope.campDateId),
          scope.productType ? eq(registrationItems.productType, scope.productType) : undefined,
        )
      : undefined;

  const regWhere = and(
    inArray(registrations.status, REAL),
    scope.kind !== "all" ? eq(registrations.programId, scope.programId) : undefined,
    scope.kind === "items"
      ? inArray(
          registrations.id,
          db.select({ id: registrationItems.registrationId }).from(registrationItems).where(itemFilter),
        )
      : undefined,
    // 🔴 Never `IN ${array}` inside sql`` — drizzle expands an array to a bare
    // parameter list (the `= ANY()` footgun in CLAUDE.md). inArray() on an
    // expression builds the parenthesised list.
    onlyEmails && onlyEmails.size
      ? or(
          inArray(sql`lower(trim(${contacts.email}))`, Array.from(onlyEmails)),
          inArray(sql`lower(trim(${guardian.email}))`, Array.from(onlyEmails)),
        )
      : undefined,
  );

  const regRows = await db
    .select({
      regId: registrations.id,
      registrantId: contacts.id,
      registrantType: contacts.type,
      registrantFirst: contacts.firstName,
      registrantLast: contacts.lastName,
      registrantEmail: contacts.email,
      guardianFirst: guardian.firstName,
      guardianLast: guardian.lastName,
      guardianEmail: guardian.email,
    })
    .from(registrations)
    .innerJoin(contacts, eq(registrations.contactId, contacts.id))
    .leftJoin(guardian, eq(registrations.guardianId, guardian.id))
    .where(regWhere)
    .orderBy(registrations.id);

  if (regRows.length === 0) return;

  // Which addresses each registration reaches — the children below fan out
  // to the same ones.
  const emailsByReg = new Map<number, string[]>();
  for (const r of regRows) {
    const emails = Array.from(
      new Set([cleanMailerEmail(r.guardianEmail), cleanMailerEmail(r.registrantEmail)].filter((e): e is string => !!e)),
    );
    if (emails.length === 0) continue;
    emailsByReg.set(r.regId, emails);
    for (const email of emails) {
      const a = acc(byEmail, email);
      if (r.guardianFirst) setParent(a, 2, r.guardianFirst, r.guardianLast);
      else if (r.registrantType !== "player") setParent(a, 1, r.registrantFirst, r.registrantLast);
    }
  }

  // Camp shape: the children on the registration's items. A day/session
  // scope keeps only the children booked on that day/session — "Hi Jack" on
  // a Tuesday-morning email must not name the sister who comes on Thursday.
  const regsWithChildren = new Set<number>();
  const regIds = Array.from(emailsByReg.keys());
  for (let i = 0; i < regIds.length; i += 1000) {
    const chunk = regIds.slice(i, i + 1000);
    const childRows = await db
      .select({
        regId: registrationItems.registrationId,
        childId: children.id,
        firstName: children.firstName,
        lastName: children.lastName,
      })
      .from(registrationItems)
      .innerJoin(children, eq(registrationItems.childId, children.id))
      .where(and(inArray(registrationItems.registrationId, chunk), isNotNull(registrationItems.childId), itemFilter))
      .orderBy(registrationItems.registrationId, children.id);
    for (const c of childRows) {
      regsWithChildren.add(c.regId);
      for (const email of emailsByReg.get(c.regId) ?? []) {
        addPlayer(acc(byEmail, email), `k${c.childId}`, c.firstName, c.lastName);
      }
    }
  }

  // Academy shape: the registrant contact IS the player — but only on a
  // registration that carries no child lines. A camp booking whose registrant
  // row happens to be typed 'player' (a parent's mis-typed contact, found live
  // on camp 30) would otherwise put the PARENT's name in {{player_first_name}}
  // beside the children who are actually booked.
  for (const r of regRows) {
    if (r.registrantType !== "player" || regsWithChildren.has(r.regId)) continue;
    for (const email of emailsByReg.get(r.regId) ?? []) {
      addPlayer(acc(byEmail, email), `c${r.registrantId}`, r.registrantFirst, r.registrantLast);
    }
  }
}

/** Parent names for addresses that no registration named: first a
 *  guardian-typed contact carrying the address, then the guardian linked to
 *  one of its players through contact_relationships. Never a player row —
 *  that is the child, and the child is what {{player_first_name}} is for. */
async function fillParentNames(byEmail: Map<string, Acc>): Promise<void> {
  const unnamed = Array.from(byEmail.values()).filter((a) => !a.firstName);
  if (unnamed.length === 0) return;

  const emails = unnamed.map((a) => a.email);
  for (let i = 0; i < emails.length; i += 1000) {
    const chunk = emails.slice(i, i + 1000);
    const rows = await db
      .select({ email: contacts.email, firstName: contacts.firstName, lastName: contacts.lastName, type: contacts.type })
      .from(contacts)
      .where(and(inArray(sql`lower(trim(${contacts.email}))`, chunk), sql`${contacts.type} <> 'player'`))
      .orderBy(sql`CASE WHEN ${contacts.type} = 'guardian' THEN 0 ELSE 1 END`, contacts.id);
    for (const r of rows) {
      const email = cleanMailerEmail(r.email);
      if (!email) continue;
      const a = byEmail.get(email);
      if (a && !a.firstName) setParent(a, 1, r.firstName, r.lastName);
    }
  }

  // Still nameless, but we know a player on the address → their linked guardian.
  const stillUnnamed = Array.from(byEmail.values()).filter((a) => !a.firstName && a.playerKeys.size > 0);
  const playerIdToEmails = new Map<number, string[]>();
  for (const a of stillUnnamed) {
    for (const key of Array.from(a.playerKeys)) {
      if (!key.startsWith("c")) continue; // contact-shaped players only; children have no relationships row
      const id = Number(key.slice(1));
      playerIdToEmails.set(id, [...(playerIdToEmails.get(id) ?? []), a.email]);
    }
  }
  const playerIds = Array.from(playerIdToEmails.keys());
  for (let i = 0; i < playerIds.length; i += 1000) {
    const chunk = playerIds.slice(i, i + 1000);
    const rows = await db
      .select({
        playerId: contactRelationships.playerId,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        primary: contactRelationships.isPrimaryContact,
      })
      .from(contactRelationships)
      .innerJoin(contacts, eq(contactRelationships.guardianId, contacts.id))
      .where(inArray(contactRelationships.playerId, chunk))
      .orderBy(sql`CASE WHEN ${contactRelationships.isPrimaryContact} THEN 0 ELSE 1 END`, contactRelationships.id);
    for (const r of rows) {
      for (const email of playerIdToEmails.get(r.playerId) ?? []) {
        const a = byEmail.get(email);
        if (a && !a.firstName) setParent(a, 1, r.firstName, r.lastName);
      }
    }
  }
}

function finish(byEmail: Map<string, Acc>, order: string[]): MailerAudience {
  const out = new Map<string, MailerRecipient>();
  const emails: string[] = [];
  for (const email of order) {
    if (out.has(email)) continue;
    const a = byEmail.get(email);
    out.set(email, {
      email,
      firstName: a?.firstName ?? null,
      lastName: a?.lastName ?? null,
      players: a?.players ?? [],
    });
    emails.push(email);
  }
  return { emails, byEmail: out };
}

/** Names for a handful of addresses with no segment behind them (a custom
 *  list, or a test send): everything REAL they are the guardian or registrant
 *  of, across every programme. */
async function resolveForEmails(emails: string[]): Promise<MailerAudience> {
  const wanted = Array.from(new Set(emails.map(cleanMailerEmail).filter((e): e is string => !!e)));
  const byEmail = new Map<string, Acc>();
  for (const e of wanted) acc(byEmail, e);
  if (wanted.length) {
    await foldRegistrations(byEmail, { kind: "all" }, new Set(wanted));
    await fillParentNames(byEmail);
  }
  return finish(byEmail, wanted);
}

/**
 * The audience for a Mailer segment, plus any addresses typed in by hand.
 *
 *   all      — every guardian contact with an address, plus every address a
 *              REAL registration reaches (the old list read guardian rows
 *              alone, so a family whose address lives on the player row was
 *              never on it).
 *   camp     — everyone with a REAL registration on the programme.
 *   day /    — everyone with a REAL registration carrying a line on that camp
 *   session    day (and session).
 *   custom   — the typed list only.
 *
 * `manualEmails` on a non-custom segment are ADDED; on `custom` they are the
 * list (the page sends them both ways).
 */
export async function resolveMailerAudience(
  segmentType: string,
  segmentConfig?: any,
  manualEmails?: string[] | null,
): Promise<MailerAudience> {
  const cfg = segmentConfig
    ? typeof segmentConfig === "string"
      ? JSON.parse(segmentConfig)
      : segmentConfig
    : {};
  const scope = scopeOf(segmentType, cfg);

  const typed: string[] = Array.from(
    new Set(
      [...(Array.isArray(cfg?.emails) ? cfg.emails : []), ...(Array.isArray(manualEmails) ? manualEmails : [])]
        .map(cleanMailerEmail)
        .filter((e): e is string => !!e),
    ),
  );

  if (segmentType === "custom" || scope.kind === "none") {
    return resolveForEmails(segmentType === "custom" ? typed : []);
  }

  const byEmail = new Map<string, Acc>();
  const order: string[] = [];
  const seen = new Set<string>();
  const push = (e: string | null) => {
    if (e && !seen.has(e)) {
      seen.add(e);
      order.push(e);
    }
  };

  if (scope.kind === "all") {
    // The list the segment has always had, in the order it always came —
    // each address gets its record HERE, named from its own guardian row.
    // (The first cut only noted the address and left naming to the pass at
    // the end, which walks records that exist: 3,200 parents read "Hi there".)
    const rows = await db
      .select({ email: contacts.email, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(and(eq(contacts.type, "guardian"), sql`${contacts.email} IS NOT NULL AND ${contacts.email} != ''`))
      .orderBy(contacts.id);
    for (const r of rows) {
      const email = cleanMailerEmail(r.email);
      if (!email) continue;
      push(email);
      setParent(acc(byEmail, email), 1, r.firstName, r.lastName);
    }
  }

  await foldRegistrations(byEmail, scope);
  for (const email of Array.from(byEmail.keys())) push(email);

  // Typed extras ride on the end, named from everything they are tied to.
  const extras = typed.filter((e) => !seen.has(e));
  if (extras.length) {
    const named = await resolveForEmails(extras);
    for (const e of named.emails) {
      const r = named.byEmail.get(e)!;
      const a = acc(byEmail, e);
      a.firstName = r.firstName;
      a.lastName = r.lastName;
      a.parentRank = r.firstName ? 1 : 0;
      for (const p of r.players) addPlayer(a, `x${e}:${p.firstName} ${p.lastName}`, p.firstName, p.lastName);
      push(e);
    }
  }

  await fillParentNames(byEmail);
  return finish(byEmail, order);
}

/** One address, every programme — what a test send uses, so the person
 *  pressing Send sees their own children's names where a family would. */
export async function lookupMailerRecipient(email: string): Promise<MailerRecipient> {
  const clean = cleanMailerEmail(email);
  if (!clean) return { email: String(email ?? ""), firstName: null, lastName: null, players: [] };
  const aud = await resolveForEmails([clean]);
  return aud.byEmail.get(clean) ?? { email: clean, firstName: null, lastName: null, players: [] };
}

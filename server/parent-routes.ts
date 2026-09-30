// ─────────────────────────────────────────────────────────────────────────────
// PARENT ACCOUNTS — the family's own view of the club (cufc.co.nz/account)
//
// Built 2026-08-04 to replace the one thing Friendly Manager still did better:
// a parent could log in, see their kids, see what they owed, and re-register
// next term without retyping everything. v2 (2026-09-28) adds, on Daniel's
// word — "they either enter their email and it's a one-time passcode, or they
// set up an email and password … see the history … select U9 and pay … save
// payment methods":
//
//   POST /api/public/parent/request-code    — email → a 6-digit code
//   POST /api/public/parent/verify          — code → a session
//   POST /api/public/parent/login-password  — email + password → a session
//   POST /api/public/parent/password        — set or change the password
//   POST /api/public/parent/logout          — end THIS session
//   POST /api/public/parent/logout-all      — end every session for the family
//   GET  /api/public/parent/me              — the whole family, offers, history
//   PATCH /api/public/parent/profile        — the parent's own details
//   PATCH /api/public/parent/children/:key  — one child's details
//   GET  /api/public/parent/prefill         — what the checkout pre-fills from
//   GET  /api/public/parent/payment-methods — cards the family chose to save
//   DELETE /api/public/parent/payment-methods/:id
//
// ── The rules this file exists to enforce ────────────────────────────────────
//
// 1. A SESSION ANCHORS ON GUARDIAN ROWS ONLY. A child's contact row is stamped
//    with the parent's email (4,662 of 6,508 player rows carry one), so
//    "the contact with this email" can be a child. Anchoring on type='guardian'
//    is what stops a login from resolving to a child's record.
//
// 2. THE FAMILY IS THE UNION ACROSS EVERY GUARDIAN ROW SHARING THE ADDRESS.
//    One human commonly has several guardian rows — one per time they
//    registered before this existed. The session carries the verified EMAIL,
//    never a contact id, and the guardian set is re-resolved on every request.
//
// 3. OWNERSHIP IS CHECKED SERVER-SIDE ON EVERY READ AND WRITE. The client
//    sends a child key; the server answers only if that child is in this
//    login's family, and a key outside it is 404 — never 403.
//
// 4. (v2) SESSIONS LIVE IN THE DATABASE AND CAN BE REVOKED. v1 signed a token
//    nobody could take back, so a phone left signed in at a relative's house
//    stayed signed in for 30 days whatever the family did. Only a hash of the
//    token is stored. Changing the password ends every other session.
//
// 5. (v2) A PASSWORD IS A SECOND DOOR, NEVER A REPLACEMENT. The emailed code
//    keeps working for every family and is how a forgotten password is
//    replaced — signing in with a code proves the inbox, which is all a reset
//    link would prove. One message for every password failure, so the form
//    cannot be used to learn who has an account.
//
// 6. (v2) A CARD IS SHOWN BACK ONLY TO A SIGNED-IN FAMILY. The checkout offers
//    "save this card" and redisplays saved cards only when a parent session
//    exists AND its address is the one being registered under — a stranger who
//    types a family's email into the checkout sees nothing of theirs.
//
// This is a PARENT credential and never a staff session (the CIC referee
// doctrine): its own cookie, its own table, and it grants nothing beyond these
// endpoints and the checkout pre-fill.
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { sendCufcParentLoginCode, sendCufcParentPasswordSet } from "./email";
import { nzTodayIso } from "@shared/housing";
import {
  parsePersonKey, mergeChildRecords, ageFromDob,
  type FamilyChild, type ChildRecord, type PersonHistory,
} from "@shared/family";
import { checkEligibility } from "@shared/academy";
import { resolveFamily } from "./family-routes";
import {
  PARENT_SESSION_TTL_MS, PARENT_CODE_TTL_MS, PARENT_CODE_MAX_ATTEMPTS,
  PARENT_CODE_MAX_PER_EMAIL_HOUR, PARENT_CODE_MAX_PER_IP_HOUR, PARENT_COOKIE,
  PARENT_MIN_PASSWORD, PARENT_PASSWORD_MAX_FAILS_PER_EMAIL, PARENT_PASSWORD_MAX_FAILS_PER_IP,
  PARENT_PASSWORD_WINDOW_MIN,
  normalizeParentEmail, looksLikeEmail, owingFor, feeStateFor, ageGradeFor, gradesForOptionName,
  type ParentMe, type ParentChild, type ParentRegistration, type ParentOffer,
  type ParentHistory, type ParentSavedCard, type ParentSecurity, type ParentOpenProgramme,
} from "@shared/parent";

const s = (v: any, max = 300): string | null => {
  const out = String(v ?? "").trim().slice(0, max);
  return out === "" ? null : out;
};

/** Where every "Register" button and the checkout live. */
const JOIN_BASE = process.env.CUFC_JOIN_BASE_URL || "https://join.cufc.co.nz";

/** The Stripe account academy fees are taken on. A customer id is only
 *  meaningful on the account that minted it. */
const STRIPE_ACCOUNT = "club";

/** Saved cards are on unless explicitly switched off — the one-line kill switch
 *  if Stripe ever misbehaves at checkout (PARENT_SAVED_CARDS=0 on Fly). */
export const savedCardsEnabled = () => process.env.PARENT_SAVED_CARDS !== "0";

/** One message for every password sign-in failure. Nothing distinguishes an
 *  unknown address, a wrong password, or a family with no password set. */
const SIGNIN_FAILED = "That email and password don't match. Try again, or sign in with an emailed code.";

// ── Passwords ────────────────────────────────────────────────────────────────
// scrypt `s1$salt$hex` — the house scheme (United Prints, Team Pay captains).
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;

function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `s1$${salt}$${crypto.scryptSync(plain, salt, 64, SCRYPT).toString("hex")}`;
}

/** 🔴 False for a NULL or malformed hash, NEVER true — "no password set" must
 *  fail closed, or every family without one could be signed into with any. */
function verifyPassword(candidate: string, stored: string | null): boolean {
  const [scheme, salt, hashHex] = String(stored ?? "").split("$");
  if (scheme !== "s1" || !salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;
  const got = crypto.scryptSync(candidate, salt, expected.length, SCRYPT);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

/** A real scrypt run against a throwaway hash, so an address with no password
 *  takes as long to refuse as a wrong password does. */
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString("hex"));

// ── Cookies ─────────────────────────────────────────────────────────────────

// ClubOS has no cookie-parser mounted — `req.cookies` is silently undefined,
// which fails OPEN if you trust it. Read the raw header.
function readCookie(req: Request, name: string): string | null {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

const isProd = () => process.env.NODE_ENV === "production";

// The session has to work on TWO hosts: cufc.co.nz, where the portal page is
// served, and join.cufc.co.nz, where the checkout reads it to pre-fill. So it
// is scoped to the shared registrable parent.
//
// 🔴 Deliberately NOT a `__Host-` cookie: that prefix forbids a Domain
// attribute, which is exactly the thing making this work across both hosts.
// Every other subdomain of cufc.co.nz can see this cookie, so nothing untrusted
// may ever be hosted under it.
//
// Omitted outside production: on localhost a Domain of .cufc.co.nz is rejected
// outright and the browser silently drops the cookie.
const PARENT_COOKIE_DOMAIN = ".cufc.co.nz";

function cookieBits(value: string, maxAgeSeconds: number): string {
  const bits = [
    `${PARENT_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",           // survives a top-level hop between the two hosts
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isProd()) {
    bits.push("Secure");
    bits.push(`Domain=${PARENT_COOKIE_DOMAIN}`);
  }
  return bits.join("; ");
}

function clearSessionCookie(res: Response) {
  // Must carry the SAME Domain and Path, or the browser treats it as a
  // different cookie and the original survives the sign-out.
  res.append("Set-Cookie", cookieBits("", 0));
}

const ipOf = (req: Request) =>
  String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || null;
const uaOf = (req: Request) => String(req.headers["user-agent"] || "").slice(0, 300) || null;
const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

// ── Sessions (v2: server-side, revocable) ────────────────────────────────────

type SignInMethod = "code" | "password";

async function createSession(req: Request, res: Response, email: string, method: SignInMethod) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PARENT_SESSION_TTL_MS);
  await db.execute(sql`
    INSERT INTO parent_sessions (email, token_hash, method, expires_at, ip, user_agent)
    VALUES (${email}, ${sha256(token)}, ${method}, ${expiresAt}, ${ipOf(req)}, ${uaOf(req)})`);
  res.append("Set-Cookie", cookieBits(encodeURIComponent(token), Math.floor(PARENT_SESSION_TTL_MS / 1000)));
}

type LiveSession = { id: number; email: string; method: SignInMethod; createdAt: Date };

/**
 * The live session behind this request's cookie, or null. A revoked, expired or
 * unknown token is simply "signed out" — including every v1 `par:` token, which
 * was never stored and so can never be found (only test sessions ever existed).
 */
async function sessionFromRequest(req: Request): Promise<LiveSession | null> {
  const token = readCookie(req, PARENT_COOKIE);
  if (!token || token.length < 20 || token.length > 200) return null;
  const r = await db.execute(sql`
    SELECT id, email, method, created_at FROM parent_sessions
    WHERE token_hash = ${sha256(token)} AND revoked_at IS NULL AND expires_at > now()
    LIMIT 1`);
  const row = rowsOf(r)[0];
  if (!row) return null;
  // Touch, at most every ten minutes — a family's "where am I signed in?" answer
  // without a write on every page load.
  db.execute(sql`
    UPDATE parent_sessions SET last_seen_at = now()
    WHERE id = ${row.id} AND (last_seen_at IS NULL OR last_seen_at < now() - interval '10 minutes')`)
    .catch(() => {});
  return {
    id: Number(row.id),
    email: normalizeParentEmail(row.email),
    method: row.method === "password" ? "password" : "code",
    createdAt: new Date(row.created_at),
  };
}

/** The verified address behind this request, or null. For callers outside this
 *  file (the academy checkout) that must know WHO is signed in. */
export async function parentEmailFromRequest(req: Request): Promise<string | null> {
  try {
    const sess = await sessionFromRequest(req);
    if (!sess) return null;
    const ids = await guardianIdsForEmail(sess.email);
    return ids.length ? sess.email : null;
  } catch (e) {
    console.error("[parent] parentEmailFromRequest", e);
    return null;
  }
}

async function audit(req: Request, email: string | null, action: string, ok: boolean, reason?: string) {
  try {
    await db.execute(sql`
      INSERT INTO parent_auth_events (email, action, ok, reason, ip, user_agent)
      VALUES (${email}, ${action}, ${ok}, ${reason ?? null}, ${ipOf(req)}, ${uaOf(req)})`);
  } catch (e) {
    // An audit failure must never block or leak into the response.
    console.error("[parent] audit", e);
  }
}

/**
 * Durable, per address AND per IP — two Fly machines share no memory. Counts
 * FAILED password attempts only; a family signing in successfully a dozen times
 * is not an attack.
 *
 * 🔴 Fails OPEN on a database error, deliberately: sign-in cannot succeed while
 * the database is down anyway (it must read the credential), and failing closed
 * would lock families out on a blip. `_verify-parent-accounts-live.ts` asserts
 * the limiter really bites, so a broken query cannot fail open unnoticed.
 */
async function passwordRateLimited(email: string, req: Request): Promise<boolean> {
  try {
    const ip = ipOf(req);
    const r = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE lower(email) = ${email})                        AS by_email,
        COUNT(*) FILTER (WHERE ${ip}::text IS NOT NULL AND ip = ${ip})         AS by_ip
      FROM parent_auth_events
      WHERE action = 'password_login' AND ok = false
        AND created_at > now() - make_interval(mins => ${PARENT_PASSWORD_WINDOW_MIN})`);
    const c = rowsOf(r)[0] ?? {};
    return Number(c.by_email ?? 0) >= PARENT_PASSWORD_MAX_FAILS_PER_EMAIL ||
      Number(c.by_ip ?? 0) >= PARENT_PASSWORD_MAX_FAILS_PER_IP;
  } catch (e) {
    console.error("[parent] rate check failed (failing OPEN):", e);
    return false;
  }
}

// ── Guardian resolution ──────────────────────────────────────────────────────

/**
 * Every guardian contact row that carries this address.
 *
 * type='guardian' is the whole security property: a player row stamped with
 * the parent's email is a CHILD, and must never become the account holder.
 */
async function guardianIdsForEmail(email: string): Promise<number[]> {
  const r = await db.execute(sql`
    SELECT id FROM contacts
    WHERE type = 'guardian'
      AND email IS NOT NULL AND LOWER(TRIM(email)) = ${email}
    ORDER BY id`);
  return rowsOf(r).map((x) => Number(x.id)).filter(Number.isFinite);
}

type ParentSession = { email: string; guardianIds: number[]; session: LiveSession };

/**
 * The guard. Re-resolves the guardian set on EVERY request rather than trusting
 * anything baked into the session, so a merge, a new link or a removed record
 * takes effect at once.
 */
async function requireParent(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await sessionFromRequest(req);
    if (!session) {
      clearSessionCookie(res);
      return res.status(401).json({ message: "Please sign in." });
    }
    const guardianIds = await guardianIdsForEmail(session.email);
    if (guardianIds.length === 0) {
      clearSessionCookie(res);
      return res.status(401).json({ message: "We can't find an account for that email any more." });
    }
    (req as any).parent = { email: session.email, guardianIds, session } satisfies ParentSession;
    next();
  } catch (e) {
    console.error("[parent] auth error", e);
    res.status(500).json({ message: "Sign-in check failed." });
  }
}

const sessionOf = (req: Request): ParentSession => (req as any).parent;

// ── The family ───────────────────────────────────────────────────────────────

/** Pool several records' history into one, de-duplicated by entry key — the
 *  same rule as family-routes' mergeHistories. */
function poolHistories(parts: PersonHistory[]): PersonHistory | undefined {
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  const programmes = new Map<string, PersonHistory["programmes"][number]>();
  const payments = new Map<string, PersonHistory["payments"][number]>();
  for (const p of parts) {
    for (const x of p.programmes) programmes.set(x.key, x);
    for (const x of p.payments) payments.set(x.key, x);
  }
  return {
    programmes: Array.from(programmes.values()),
    payments: Array.from(payments.values()),
    // Only termCount and seasons are read from here; recomputed by the caller.
    totals: parts[0].totals,
  };
}

/**
 * Resolve the whole family across every guardian row this login speaks for,
 * then merge duplicate children.
 *
 * resolveFamily() is the Families resolver — the ONE place that knows a family
 * is recorded three different ways. Each call already merges duplicates WITHIN
 * one guardian's family; merging again ACROSS guardians used to overwrite each
 * card's `records` with only the outer keys, dropping the inner records — so a
 * child held twice under one guardian row and once under another lost records
 * here, and an edit to their details missed a row. v2 re-attaches every inner
 * record and pools history across them.
 */
async function familyFor(session: { email: string; guardianIds: number[] }): Promise<FamilyChild[]> {
  const families = await Promise.all(
    session.guardianIds.map((id) => resolveFamily("contact", id).catch((e) => {
      console.error("[parent] resolveFamily failed for guardian", id, e);
      return null;
    })),
  );
  const all: FamilyChild[] = [];
  for (const fam of families) if (fam) all.push(...fam.children);

  // Index what the re-merge would otherwise lose, by the card's own key.
  const innerByKey = new Map<string, ChildRecord[]>();
  const historyByKey = new Map<string, PersonHistory[]>();
  for (const c of all) {
    innerByKey.set(c.key, [...(innerByKey.get(c.key) ?? []), ...(c.records ?? [])]);
    if (c.history) historyByKey.set(c.key, [...(historyByKey.get(c.key) ?? []), c.history]);
  }

  return mergeChildRecords(all).map((card) => {
    const outer = card.records ?? [];
    const recs = new Map<string, ChildRecord>();
    const hist: PersonHistory[] = [];
    for (const o of outer) {
      for (const r of innerByKey.get(o.key) ?? [o]) recs.set(r.key, r);
      hist.push(...(historyByKey.get(o.key) ?? []));
    }
    return {
      ...card,
      records: Array.from(recs.values()).sort((a, b) => a.key.localeCompare(b.key)),
      history: poolHistories(hist) ?? card.history,
    };
  });
}

/** The parent's guardian rows, with the most complete one first. */
async function guardianRowsFor(session: { guardianIds: number[] }) {
  const r = await db.execute(sql`
    SELECT id, first_name, last_name, email, phone, alternate_phone, address,
           address_street, address_suburb, address_city, address_region,
           address_postcode, address_country
    FROM contacts
    WHERE id IN (${sql.join(session.guardianIds.map((i) => sql`${i}`), sql`, `)})`);
  const score = (x: any) =>
    (x.address_street ? 4 : 0) + (x.phone ? 2 : 0) + (x.address ? 1 : 0) + (x.alternate_phone ? 1 : 0);
  return rowsOf(r).slice().sort((a, b) => score(b) - score(a));
}

/** First non-empty value of a field across rows — a detail recorded on one
 *  duplicate row must not be hidden because the card opens another. */
const firstOf = (rows: any[], k: string) =>
  rows.map((x) => x[k]).find((v) => v !== null && v !== undefined && v !== "") ?? null;

/** The parent's own details. A write updates EVERY guardian row so the
 *  duplicates converge instead of drifting further apart. */
async function profileFor(session: ParentSession | { email: string; guardianIds: number[] }) {
  const rows = await guardianRowsFor(session);
  const best = rows[0] ?? {};
  return {
    firstName: best.first_name ?? "",
    lastName: best.last_name ?? "",
    email: session.email,
    phone: firstOf(rows, "phone"),
    alternatePhone: firstOf(rows, "alternate_phone"),
    address: firstOf(rows, "address"),
  };
}

/** The structured address the checkout needs (NZF wants all six parts). Taken
 *  from ONE row — mixing a street from one record with a postcode from another
 *  would assemble an address nobody lives at. */
function addressPartsOf(rows: any[]) {
  const r = rows.find((x) => x.address_street) ?? null;
  if (!r) return null;
  return {
    street: r.address_street ?? "",
    suburb: r.address_suburb ?? "",
    city: r.address_city ?? "",
    region: r.address_region ?? "",
    postcode: r.address_postcode ?? "",
    country: r.address_country ?? "",
  };
}

/**
 * The detail fields a parent can see and correct, and the checkout pre-fills.
 * Fetched in ONE batched query over the contact ids the resolver vouched for —
 * never per child in a loop, which exhausted the connection pool once already.
 */
async function childRowsFor(contactIds: number[]): Promise<Map<number, any>> {
  const map = new Map<number, any>();
  if (contactIds.length === 0) return map;
  const r = await db.execute(sql`
    SELECT id, medical_notes, allergies, emergency_contact, emergency_phone, school,
           photo_consent, medical_consent, country_of_birth, nationality,
           ethnicity, sub_ethnicity, gender::text AS gender,
           country_of_birth_code, nationality_code,
           ethnicity_group_id, ethnicity_selection_ids,
           ethnicity2_group_id, ethnicity2_selection_ids,
           merged_into_contact_id
    FROM contacts
    WHERE id IN (${sql.join(contactIds.map((i) => sql`${i}`), sql`, `)})`);
  for (const row of rowsOf(r)) map.set(Number(row.id), row);
  return map;
}

/** payment_mode per registration — 'weekly' changes what a balance MEANS. */
async function paymentModesFor(regIds: number[]): Promise<Map<number, string | null>> {
  const map = new Map<number, string | null>();
  if (regIds.length === 0) return map;
  const r = await db.execute(sql`
    SELECT id, payment_mode FROM registrations
    WHERE id IN (${sql.join(regIds.map((i) => sql`${i}`), sql`, `)})`);
  for (const row of rowsOf(r)) map.set(Number(row.id), row.payment_mode ?? null);
  return map;
}

/** Registrations → the money, as the club's own ledger sees it.
 *  🔴 `total_cents` is the truth, NOT `amount_paid` (left at 0 by the camp
 *  checkout). amount_paid is DECIMAL DOLLARS; total_cents is integer cents. */
function toParentRegistration(r: any, paymentMode: string | null): ParentRegistration {
  const totalCents = Number(r.totalCents ?? 0) || 0;
  const paidCents = Math.round(Number(r.amountPaid ?? 0) * 100) || 0;
  const status = String(r.status ?? "pending");
  return {
    id: Number(r.id),
    programId: Number(r.programId),
    programName: String(r.programName ?? "Programme"),
    programType: r.programType ?? null,
    status,
    registeredAt: r.registeredAt ? String(r.registeredAt).slice(0, 10) : null,
    totalCents,
    paidCents,
    owingCents: owingFor(totalCents, paidCents, status),
    feeState: feeStateFor(totalCents, paidCents, status),
    paymentMode,
  };
}

/** Every `contact`-shaped record behind a (possibly merged) child card. */
function contactIdsOf(child: FamilyChild): number[] {
  return (child.records ?? [])
    .filter((r) => r.kind === "contact")
    .map((r) => r.id)
    .filter(Number.isFinite);
}

/** Every `children`-shaped (holiday camp) record behind the same card. */
function campChildIdsOf(child: FamilyChild): number[] {
  return (child.records ?? [])
    .filter((r) => r.kind === "child")
    .map((r) => r.id)
    .filter(Number.isFinite);
}

/** Does this card stand for the key the client sent? A merged child answers to
 *  any of the record keys it was merged from, not just its primary key. */
function childMatchesKey(child: FamilyChild, key: string): boolean {
  if (child.key === key) return true;
  return (child.records ?? []).some((r) => r.key === key);
}

/** A child's history as a parent reads it: newest first, no paid/unpaid badge. */
function toParentHistory(h: PersonHistory | undefined): ParentHistory {
  if (!h) return { programmes: [], payments: [], termCount: 0, firstSeason: null };
  const programmes = h.programmes
    .map((p) => ({
      key: p.key,
      programme: p.programme,
      termLabel: p.termLabel,
      seasonYear: p.seasonYear,
      status: p.status,
      registeredAt: p.registeredAt ? String(p.registeredAt).slice(0, 10) : null,
      source: p.source,
    }))
    .sort((a, b) =>
      (b.seasonYear ?? -1) - (a.seasonYear ?? -1) ||
      (b.registeredAt ?? "").localeCompare(a.registeredAt ?? "") ||
      (b.termLabel ?? "").localeCompare(a.termLabel ?? ""));
  const payments = h.payments
    .map((p) => ({
      key: p.key,
      paidOn: p.paidOn ? String(p.paidOn).slice(0, 10) : null,
      amountCents: p.amountCents,
      method: p.method,
      description: p.description,
      termLabel: p.termLabel,
      source: p.source,
    }))
    .sort((a, b) => (b.paidOn ?? "").localeCompare(a.paidOn ?? ""));
  const terms = new Set(programmes.map((p) => `${p.seasonYear ?? ""}:${p.termLabel ?? p.programme}`));
  const seasons = programmes.map((p) => p.seasonYear).filter((y): y is number => typeof y === "number");
  return {
    programmes,
    payments,
    termCount: terms.size,
    firstSeason: seasons.length ? Math.min(...seasons) : null,
  };
}

// ── Offers — "Register Alex for Pre-Academy U9" ──────────────────────────────

/** An open programme, priced by the checkout's own function. Supplied by
 *  routes.ts, which owns the academy pricing helpers. */
export type OpenAcademyProgramme = {
  id: number;
  slug: string;
  name: string;
  section: "core" | "additional";
  ageMin: number | null;
  ageMax: number | null;
  seasonYear: number;
  termId: number | null;
  termLabel: string | null;
  options: {
    id: number;
    name: string;
    scheduleText: string | null;
    fullPriceCents: number;
    priceCents: number;
    sessionsRemaining: number | null;
    totalSessions: number | null;
  }[];
};

export type ParentRouteDeps = {
  openAcademyProgrammes?: () => Promise<OpenAcademyProgramme[]>;
};

/** Which (contact, programme, term) enrolments already exist — so a child
 *  already on Term 4 sees a tick, not a second "Register" button. */
async function enrolledKeys(contactIds: number[], programIds: number[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!contactIds.length || !programIds.length) return out;
  const r = await db.execute(sql`
    SELECT contact_id, program_id, term_id FROM registrations
    WHERE contact_id IN (${sql.join(contactIds.map((i) => sql`${i}`), sql`, `)})
      AND program_id IN (${sql.join(programIds.map((i) => sql`${i}`), sql`, `)})
      AND status IN ('confirmed', 'partially_refunded')`);
  for (const row of rowsOf(r)) out.add(`${row.contact_id}:${row.program_id}:${row.term_id ?? ""}`);
  return out;
}

function offersForChild(
  child: FamilyChild,
  programmes: OpenAcademyProgramme[],
  enrolled: Set<string>,
): ParentOffer[] {
  if (!child.dateOfBirth) return [];   // no DOB → no honest age grade → no buttons
  const contactIds = contactIdsOf(child);
  const out: ParentOffer[] = [];
  for (const p of programmes) {
    const elig = checkEligibility(child.dateOfBirth, p.seasonYear, p.ageMin, p.ageMax);
    if (!elig.eligible || elig.grade === null) continue;
    const grade = elig.grade;
    const named = p.options.filter((o) => gradesForOptionName(o.name) !== null);
    // Options that name grades are offered only to their grades; if none of a
    // programme's options names one, every option is offered.
    const fitting = named.length
      ? p.options.filter((o) => {
          const g = gradesForOptionName(o.name);
          return g ? grade >= g[0] && grade <= g[1] : false;
        })
      : p.options;
    const registered = contactIds.some((cid) => enrolled.has(`${cid}:${p.id}:${p.termId ?? ""}`));
    for (const o of fitting) {
      const url = new URL(`/academy/${encodeURIComponent(p.slug)}`, JOIN_BASE);
      url.searchParams.set("option", String(o.id));
      url.searchParams.set("child", child.key);
      url.searchParams.set("source", "account");
      out.push({
        programmeSlug: p.slug,
        programmeName: p.name,
        section: p.section,
        termLabel: p.termLabel,
        optionId: o.id,
        optionName: o.name,
        scheduleText: o.scheduleText,
        priceCents: o.priceCents,
        fullPriceCents: o.fullPriceCents,
        sessionsRemaining: o.sessionsRemaining,
        totalSessions: o.totalSessions,
        registered,
        registerUrl: url.toString(),
      });
    }
  }
  // The core pathway first, then the add-ons.
  return out.sort((a, b) => (a.section === b.section ? 0 : a.section === "core" ? -1 : 1));
}

// ── Stripe — the family's customer and their saved cards ─────────────────────

async function stripeClient() {
  const { stripe } = await import("./stripe");
  return stripe;
}

/** The family's Stripe customer id on the club account. Created on demand
 *  (`create`) — idempotent on the address, so two tabs racing mint one. */
async function stripeCustomerFor(email: string, create: boolean, name?: string | null): Promise<string | null> {
  const found = await db.execute(sql`
    SELECT stripe_customer_id FROM parent_stripe_customers
    WHERE email = ${email} AND stripe_account = ${STRIPE_ACCOUNT}`);
  const existing = rowsOf(found)[0]?.stripe_customer_id;
  if (existing) return String(existing);
  if (!create) return null;

  const stripe = await stripeClient();
  const customer = await stripe.customers.create(
    { email, ...(name ? { name } : {}), metadata: { source: "cufc_parent_account" } },
    { idempotencyKey: `cufc-parent-customer:${email}` },
  );
  await db.execute(sql`
    INSERT INTO parent_stripe_customers (email, stripe_account, stripe_customer_id)
    VALUES (${email}, ${STRIPE_ACCOUNT}, ${customer.id})
    ON CONFLICT (email, stripe_account) DO NOTHING`);
  const again = await db.execute(sql`
    SELECT stripe_customer_id FROM parent_stripe_customers
    WHERE email = ${email} AND stripe_account = ${STRIPE_ACCOUNT}`);
  return String(rowsOf(again)[0]?.stripe_customer_id ?? customer.id);
}

/**
 * For the academy checkout: when a signed-in family is registering under their
 * OWN address, attach their Stripe customer to the PaymentIntent and hand the
 * Payment Element a customer session — which is what shows their saved cards
 * and the "save this card" tick.
 *
 * Returns null for everyone else (not signed in, signed in as a different
 * address, feature off, or any Stripe hiccup): the checkout then behaves
 * exactly as before. 🔴 Never throws — a saved-card problem must never block a
 * family from paying.
 */
export async function parentCheckoutCustomer(
  req: Request,
  guardianEmail: string,
  guardianName: string | null,
): Promise<{ customerId: string } | null> {
  try {
    if (!savedCardsEnabled()) return null;
    const email = await parentEmailFromRequest(req);
    if (!email || email !== normalizeParentEmail(guardianEmail)) return null;
    const customerId = await stripeCustomerFor(email, true, guardianName);
    return customerId ? { customerId } : null;
  } catch (e) {
    console.error("[parent] parentCheckoutCustomer", e);
    return null;
  }
}

/** The client secret that lets the Payment Element show and save this
 *  family's cards. Null on any failure — the card form still works without it. */
export async function parentCustomerSessionSecret(customerId: string): Promise<string | null> {
  try {
    const stripe = await stripeClient();
    const cs = await stripe.customerSessions.create({
      customer: customerId,
      components: {
        payment_element: {
          enabled: true,
          features: {
            payment_method_redisplay: "enabled",
            payment_method_save: "enabled",
            // The parent is at the screen whenever a saved card is used.
            payment_method_save_usage: "on_session",
            payment_method_remove: "enabled",
          },
        },
      },
    });
    return cs.client_secret;
  } catch (e) {
    console.error("[parent] customer session", e);
    return null;
  }
}

/** Only cards the family explicitly ticked "save" on. A card attached for any
 *  other reason is not theirs to see here. */
async function savedCardsFor(email: string): Promise<ParentSavedCard[]> {
  const customerId = await stripeCustomerFor(email, false);
  if (!customerId) return [];
  const stripe = await stripeClient();
  const list = await stripe.customers.listPaymentMethods(customerId, { type: "card", limit: 20 });
  return list.data
    .filter((pm) => pm.allow_redisplay === "always" && pm.card)
    .map((pm) => ({
      id: pm.id,
      brand: pm.card!.brand,
      last4: pm.card!.last4,
      expMonth: pm.card!.exp_month,
      expYear: pm.card!.exp_year,
    }));
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function registerParentRoutes(app: Express, deps: ParentRouteDeps = {}) {
  const BASE = "/api/public/parent";

  // The portal briefly lived here before moving onto the club's own domain.
  // 🔴 HOST-AWARE: join.unitedprints.co.nz/account is the United Prints
  // customer portal, so only cufc hosts are bounced.
  app.get("/account", (req, res, next) => {
    const host = String(req.hostname || "").toLowerCase();
    if (host.includes("cufc.co.nz")) return res.redirect(301, "https://cufc.co.nz/account");
    return next();
  });

  // ── Request a code ─────────────────────────────────────────────────────────
  // 🔴 Always answers the same way, whether or not the address is known.
  app.post(`${BASE}/request-code`, async (req, res) => {
    const generic = { ok: true, message: "If that email is on our records, we've sent you a code." };
    try {
      const email = normalizeParentEmail(req.body?.email);
      if (!looksLikeEmail(email)) {
        return res.status(400).json({ message: "That doesn't look like an email address." });
      }
      const ip = s(ipOf(req), 60);

      const since = new Date(Date.now() - 60 * 60 * 1000);
      const counts = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE email = ${email}) AS by_email,
          COUNT(*) FILTER (WHERE request_ip IS NOT NULL AND request_ip = ${ip}) AS by_ip
        FROM parent_login_codes WHERE created_at > ${since}`);
      const c = rowsOf(counts)[0] ?? {};
      if (Number(c.by_email ?? 0) >= PARENT_CODE_MAX_PER_EMAIL_HOUR ||
          Number(c.by_ip ?? 0) >= PARENT_CODE_MAX_PER_IP_HOUR) {
        return res.status(429).json({ message: "Too many attempts. Please try again in an hour." });
      }

      const guardianIds = await guardianIdsForEmail(email);
      if (guardianIds.length === 0) return res.json(generic);   // same shape, no code sent

      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      const codeHash = crypto.createHash("sha256").update(`${code}:${email}`).digest("hex");
      await db.execute(sql`
        INSERT INTO parent_login_codes (email, code_hash, expires_at, request_ip)
        VALUES (${email}, ${codeHash}, ${new Date(Date.now() + PARENT_CODE_TTL_MS)}, ${ip})`);

      const first = rowsOf(await db.execute(sql`
        SELECT first_name FROM contacts WHERE id = ${guardianIds[0]}`))[0];
      await sendCufcParentLoginCode({
        to: email,
        firstName: first?.first_name ?? null,
        code,
        minutes: Math.round(PARENT_CODE_TTL_MS / 60000),
      });

      // Local testing only — ALSO requires a non-production build, so a stray
      // prod env var can never hand out live credentials.
      if (process.env.PARENT_ECHO_CODE === "1" && process.env.NODE_ENV !== "production") {
        console.log(`[parent] DEV echo — code for ${email}: ${code}`);
        return res.json({ ...generic, devCode: code });
      }
      res.json(generic);
    } catch (e: any) {
      console.error("[parent] request-code", e);
      res.json(generic);   // never leak a failure shape that differs from success
    }
  });

  // ── Verify a code ─────────────────────────────────────────────────────────
  app.post(`${BASE}/verify`, async (req, res) => {
    try {
      const email = normalizeParentEmail(req.body?.email);
      const code = String(req.body?.code ?? "").trim();
      if (!looksLikeEmail(email) || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ message: "Enter the 6-digit code from your email." });
      }
      const codeHash = crypto.createHash("sha256").update(`${code}:${email}`).digest("hex");

      // EVERY live code for this address, not just the newest — a parent who
      // taps "email me a code" twice and types the first one holds a code we
      // really did send.
      const rows = rowsOf(await db.execute(sql`
        SELECT id, code_hash FROM parent_login_codes
        WHERE email = ${email} AND consumed_at IS NULL
          AND expires_at > now() AND attempts < ${PARENT_CODE_MAX_ATTEMPTS}
        ORDER BY created_at DESC`));
      if (rows.length === 0) {
        return res.status(400).json({ message: "That code has expired. Please request a new one." });
      }

      const given = Buffer.from(codeHash, "hex");
      const match = rows.find((r) => {
        const stored = Buffer.from(String(r.code_hash), "hex");
        return given.length === stored.length && crypto.timingSafeEqual(given, stored);
      });
      if (!match) {
        const spent = rowsOf(await db.execute(sql`
          SELECT 1 FROM parent_login_codes
          WHERE email = ${email} AND code_hash = ${codeHash} AND consumed_at IS NOT NULL
          LIMIT 1`));
        if (spent.length > 0) {
          return res.status(400).json({ message: "That code has already been used. Please request a new one." });
        }
        // Burn an attempt on every live code, so guessing is bounded across all
        // of them rather than resetting each time a new one is requested.
        await db.execute(sql`
          UPDATE parent_login_codes SET attempts = attempts + 1
          WHERE id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})`);
        await audit(req, email, "code_login", false, "wrong_code");
        return res.status(400).json({ message: "That code isn't right. Please check and try again." });
      }

      // Single-use. Consume BEFORE minting the session, and only if still
      // un-consumed — two requests racing the same code: the loser gets nothing.
      const consumed = rowsOf(await db.execute(sql`
        UPDATE parent_login_codes SET consumed_at = now()
        WHERE id = ${match.id} AND consumed_at IS NULL RETURNING id`));
      if (consumed.length === 0) {
        return res.status(400).json({ message: "That code has already been used. Please request a new one." });
      }

      const guardianIds = await guardianIdsForEmail(email);
      if (guardianIds.length === 0) {
        return res.status(400).json({ message: "We can't find an account for that email." });
      }

      await createSession(req, res, email, "code");
      await audit(req, email, "code_login", true);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[parent] verify", e);
      res.status(500).json({ message: "Something went wrong signing you in." });
    }
  });

  // ── Sign in with a password ───────────────────────────────────────────────
  app.post(`${BASE}/login-password`, async (req, res) => {
    const email = normalizeParentEmail(req.body?.email);
    const password = String(req.body?.password ?? "");
    try {
      if (!looksLikeEmail(email) || !password || password.length > 200) {
        return res.status(400).json({ message: SIGNIN_FAILED });
      }
      if (await passwordRateLimited(email, req)) {
        await audit(req, email, "password_login", false, "rate_limited");
        return res.status(429).json({
          message: "Too many attempts. Wait 15 minutes, or sign in with an emailed code instead.",
        });
      }
      const cred = rowsOf(await db.execute(sql`
        SELECT password_hash FROM parent_credentials WHERE email = ${email}`))[0];
      // Always run scrypt, so "no password set" takes as long as "wrong password".
      const ok = cred?.password_hash
        ? verifyPassword(password, cred.password_hash)
        : (verifyPassword(password, DUMMY_HASH), false);
      if (!ok) {
        await audit(req, email, "password_login", false, cred ? "bad_password" : "no_password");
        return res.status(401).json({ message: SIGNIN_FAILED });
      }
      const guardianIds = await guardianIdsForEmail(email);
      if (guardianIds.length === 0) {
        await audit(req, email, "password_login", false, "no_guardian");
        return res.status(401).json({ message: SIGNIN_FAILED });
      }
      await createSession(req, res, email, "password");
      await audit(req, email, "password_login", true);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[parent] login-password", e);
      res.status(500).json({ message: "Something went wrong signing you in." });
    }
  });

  // ── Set or change the password ────────────────────────────────────────────
  // Signed-in only. Changing an EXISTING password needs either the current one
  // or a session opened in the last 15 minutes (a fresh emailed code — which is
  // exactly the "forgot my password" path). A phone left signed in for a month
  // must not be enough to lock the family out of their own account.
  app.post(`${BASE}/password`, requireParent, async (req, res) => {
    try {
      const { email, session } = sessionOf(req);
      const next = String(req.body?.password ?? "");
      if (next.length < PARENT_MIN_PASSWORD) {
        return res.status(400).json({ message: `Use at least ${PARENT_MIN_PASSWORD} characters.` });
      }
      if (next.length > 200) return res.status(400).json({ message: "That password is too long." });

      const cred = rowsOf(await db.execute(sql`
        SELECT password_hash FROM parent_credentials WHERE email = ${email}`))[0];
      if (cred?.password_hash) {
        const fresh = Date.now() - session.createdAt.getTime() < 15 * 60 * 1000;
        const current = String(req.body?.currentPassword ?? "");
        if (!fresh && !(current && verifyPassword(current, cred.password_hash))) {
          await audit(req, email, "password_set", false, "needs_current");
          return res.status(403).json({
            code: "needs_current",
            message: "Enter your current password, or sign in again with an emailed code to set a new one.",
          });
        }
      }

      await db.execute(sql`
        INSERT INTO parent_credentials (email, password_hash, password_set_at, updated_at)
        VALUES (${email}, ${hashPassword(next)}, now(), now())
        ON CONFLICT (email) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          password_set_at = EXCLUDED.password_set_at,
          updated_at = now()`);
      // Every OTHER session ends: whoever else was signed in is out.
      const revoked = rowsOf(await db.execute(sql`
        UPDATE parent_sessions SET revoked_at = now()
        WHERE email = ${email} AND revoked_at IS NULL AND id <> ${session.id}
        RETURNING id`));
      await audit(req, email, "password_set", true, cred?.password_hash ? "changed" : "created");

      // Tell the inbox. If this was not them, the email is how they find out.
      const first = rowsOf(await db.execute(sql`
        SELECT first_name FROM contacts WHERE id = ${sessionOf(req).guardianIds[0]}`))[0];
      sendCufcParentPasswordSet({
        to: email,
        firstName: first?.first_name ?? null,
        changed: !!cred?.password_hash,
      }).catch((e) => console.error("[parent] password email", e));

      res.json({ ok: true, signedOutOthers: revoked.length });
    } catch (e: any) {
      console.error("[parent] password", e);
      res.status(500).json({ message: "Couldn't save your password." });
    }
  });

  // ── Sign out ──────────────────────────────────────────────────────────────
  app.post(`${BASE}/logout`, async (req, res) => {
    try {
      const token = readCookie(req, PARENT_COOKIE);
      if (token) {
        await db.execute(sql`
          UPDATE parent_sessions SET revoked_at = now()
          WHERE token_hash = ${sha256(token)} AND revoked_at IS NULL`);
      }
    } catch (e) {
      console.error("[parent] logout", e);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.post(`${BASE}/logout-all`, requireParent, async (req, res) => {
    try {
      const { email } = sessionOf(req);
      const revoked = rowsOf(await db.execute(sql`
        UPDATE parent_sessions SET revoked_at = now()
        WHERE email = ${email} AND revoked_at IS NULL RETURNING id`));
      await audit(req, email, "logout_all", true, `${revoked.length} sessions`);
      clearSessionCookie(res);
      res.json({ ok: true, signedOut: revoked.length });
    } catch (e: any) {
      console.error("[parent] logout-all", e);
      res.status(500).json({ message: "Couldn't sign out everywhere." });
    }
  });

  // ── Who is signed in — for the site's nav, on every page ─────────────────
  // One cheap query, never the family: the nav only needs a name to show
  // "Daniel" instead of "Login". 200 `signedIn:false` for a visitor.
  app.get(`${BASE}/session`, async (req, res) => {
    try {
      const sess = await sessionFromRequest(req);
      if (!sess) return res.json({ signedIn: false });
      const guardianIds = await guardianIdsForEmail(sess.email);
      if (guardianIds.length === 0) return res.json({ signedIn: false });
      const rows = await guardianRowsFor({ guardianIds });
      const best = rows[0] ?? {};
      res.json({
        signedIn: true,
        email: sess.email,
        firstName: best.first_name ?? "",
        lastName: best.last_name ?? "",
      });
    } catch (e) {
      console.error("[parent] session", e);
      res.json({ signedIn: false });
    }
  });

  // ── The dashboard ─────────────────────────────────────────────────────────
  app.get(`${BASE}/me`, requireParent, async (req, res) => {
    try {
      const session = sessionOf(req);
      const today = nzTodayIso();
      const [profile, children, cred, programmes] = await Promise.all([
        profileFor(session),
        familyFor(session),
        db.execute(sql`SELECT password_set_at FROM parent_credentials
                       WHERE email = ${session.email} AND password_hash IS NOT NULL`).then(rowsOf),
        (deps.openAcademyProgrammes ? deps.openAcademyProgrammes() : Promise.resolve([]))
          .catch((e) => { console.error("[parent] offers", e); return [] as OpenAcademyProgramme[]; }),
      ]);

      // Batched lookups for the whole family, never one per child.
      const allContactIds = children.flatMap(contactIdsOf);
      const [details, modes, enrolled] = await Promise.all([
        childRowsFor(allContactIds),
        paymentModesFor(children.flatMap((c) => (c.registrations ?? []).map((r) => r.id))),
        enrolledKeys(allContactIds, programmes.map((p) => p.id)),
      ]);

      const out: ParentChild[] = children.map((ch) => {
        const regs = (ch.registrations ?? []).map((r) =>
          toParentRegistration(r, modes.get(Number(r.id)) ?? null),
        );
        const rows = contactIdsOf(ch).map((id) => details.get(id)).filter(Boolean) as any[];
        const merged = {
          // The resolver already pooled the medical fields across records.
          medicalNotes: ch.medicalNotes ?? firstOf(rows, "medical_notes"),
          allergies: ch.allergies ?? firstOf(rows, "allergies"),
          emergencyContact: firstOf(rows, "emergency_contact"),
          emergencyPhone: firstOf(rows, "emergency_phone"),
          school: firstOf(rows, "school"),
          // A consent is true only if some record says so — never defaulted true.
          photoConsent: rows.some((r) => !!r.photo_consent),
          medicalConsent: rows.some((r) => !!r.medical_consent),
          countryOfBirth: firstOf(rows, "country_of_birth"),
          nationality: firstOf(rows, "nationality"),
          ethnicity: firstOf(rows, "ethnicity"),
          subEthnicity: firstOf(rows, "sub_ethnicity"),
        };

        return {
          key: ch.key,
          firstName: ch.firstName,
          lastName: ch.lastName,
          dateOfBirth: ch.dateOfBirth ?? null,
          age: ageFromDob(ch.dateOfBirth, today),
          ageGrade: ageGradeFor(ch.dateOfBirth, today),
          registrations: regs,
          owingCents: regs.reduce((n, r) => n + r.owingCents, 0),
          details: merged,
          // A prompt, never a block. The checkout asks for exactly these, and
          // what a family enters there is saved to the child for next time.
          needsIdentity: !(firstOf(rows, "country_of_birth_code") && firstOf(rows, "nationality_code")
            && firstOf(rows, "ethnicity_group_id") !== null) || !ch.dateOfBirth,
          offers: offersForChild(ch, programmes, enrolled),
          history: toParentHistory(ch.history),
        };
      });

      const security: ParentSecurity = {
        hasPassword: cred.length > 0,
        passwordSetAt: cred[0]?.password_set_at ? new Date(cred[0].password_set_at).toISOString() : null,
        signedInWith: session.session.method,
      };
      // Every programme open now, for "Register another child" (a child we
      // do not hold yet, so no age to match — the checkout checks eligibility).
      const openProgrammes: ParentOpenProgramme[] = programmes.map((p) => {
        const url = new URL(`/academy/${encodeURIComponent(p.slug)}`, JOIN_BASE);
        url.searchParams.set("child", "new");
        url.searchParams.set("source", "account");
        return {
          slug: p.slug, name: p.name, section: p.section, ageMin: p.ageMin, ageMax: p.ageMax,
          termLabel: p.termLabel,
          options: p.options.map((o) => ({ id: o.id, name: o.name, scheduleText: o.scheduleText, priceCents: o.priceCents, fullPriceCents: o.fullPriceCents })),
          registerUrl: url.toString(),
        };
      });

      const payload: ParentMe = {
        profile,
        children: out,
        owingCents: out.reduce((n, c) => n + c.owingCents, 0),
        today,
        guardianIds: session.guardianIds,
        security,
        savedCardsEnabled: savedCardsEnabled(),
        openProgrammes,
      };
      res.json(payload);
    } catch (e: any) {
      console.error("[parent] me", e);
      res.status(500).json({ message: "Couldn't load your account." });
    }
  });

  // ── The parent's own details ──────────────────────────────────────────────
  // Writes to EVERY guardian row this login speaks for. The email is NOT
  // editable here: it is the credential.
  app.patch(`${BASE}/profile`, requireParent, async (req, res) => {
    try {
      const session = sessionOf(req);
      const firstName = s(req.body?.firstName, 100);
      const lastName = s(req.body?.lastName, 100);
      const phone = s(req.body?.phone, 40);
      if (!firstName || !lastName) {
        return res.status(400).json({ message: "Please give us your first and last name." });
      }
      if (!phone) {
        return res.status(400).json({ message: "Please give us a contact phone number." });
      }
      await db.execute(sql`
        UPDATE contacts SET
          first_name = ${firstName},
          last_name = ${lastName},
          phone = ${phone},
          alternate_phone = ${s(req.body?.alternatePhone, 40)},
          address = ${s(req.body?.address, 300)}
        WHERE id IN (${sql.join(session.guardianIds.map((i) => sql`${i}`), sql`, `)})`);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[parent] profile", e);
      res.status(500).json({ message: "Couldn't save your details." });
    }
  });

  // ── One child's details ───────────────────────────────────────────────────
  // 🔴 The ownership check is the point: the child is re-resolved from THIS
  // login's family and a key outside it 404s — never 403.
  app.patch(`${BASE}/children/:key`, requireParent, async (req, res) => {
    try {
      const session = sessionOf(req);
      const key = String(req.params.key ?? "");
      if (!parsePersonKey(key)) return res.status(404).json({ message: "Not found" });

      const family = await familyFor(session);
      const mine = family.find((c) => childMatchesKey(c, key));
      if (!mine) return res.status(404).json({ message: "Not found" });

      const contactIds = contactIdsOf(mine);
      const childIds = campChildIdsOf(mine);

      const medicalNotes = s(req.body?.medicalNotes, 2000);
      const allergies = s(req.body?.allergies, 1000);
      const emergencyContact = s(req.body?.emergencyContact, 200);
      const emergencyPhone = s(req.body?.emergencyPhone, 40);
      const school = s(req.body?.school, 200);
      const photoConsent = !!req.body?.photoConsent;
      const medicalConsent = !!req.body?.medicalConsent;

      if (contactIds.length) {
        await db.execute(sql`
          UPDATE contacts SET
            medical_notes = ${medicalNotes},
            allergies = ${allergies},
            emergency_contact = ${emergencyContact},
            emergency_phone = ${emergencyPhone},
            school = ${school},
            photo_consent = ${photoConsent},
            medical_consent = ${medicalConsent}
          WHERE id IN (${sql.join(contactIds.map((i) => sql`${i}`), sql`, `)})`);
      }
      if (childIds.length) {
        await db.execute(sql`
          UPDATE children SET
            medical_notes = ${medicalNotes},
            allergies = ${allergies}
          WHERE id IN (${sql.join(childIds.map((i) => sql`${i}`), sql`, `)})`);
      }
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[parent] child update", e);
      res.status(500).json({ message: "Couldn't save those details." });
    }
  });

  // ── Saved cards ───────────────────────────────────────────────────────────
  app.get(`${BASE}/payment-methods`, requireParent, async (req, res) => {
    try {
      if (!savedCardsEnabled()) return res.json({ enabled: false, cards: [] });
      res.json({ enabled: true, cards: await savedCardsFor(sessionOf(req).email) });
    } catch (e: any) {
      console.error("[parent] payment-methods", e);
      res.status(502).json({ message: "Couldn't load your saved cards right now." });
    }
  });

  app.delete(`${BASE}/payment-methods/:id`, requireParent, async (req, res) => {
    try {
      const id = String(req.params.id ?? "");
      if (!/^pm_[A-Za-z0-9]+$/.test(id)) return res.status(404).json({ message: "Not found" });
      const customerId = await stripeCustomerFor(sessionOf(req).email, false);
      if (!customerId) return res.status(404).json({ message: "Not found" });
      const stripe = await stripeClient();
      // 🔴 Ownership: the card must hang off THIS family's customer. A card id
      // from anywhere else is 404, exactly like another family's child.
      const pm = await stripe.paymentMethods.retrieve(id).catch(() => null);
      const owner = pm ? (typeof pm.customer === "string" ? pm.customer : pm.customer?.id) : null;
      if (!pm || owner !== customerId) return res.status(404).json({ message: "Not found" });
      await stripe.paymentMethods.detach(id);
      await audit(req, sessionOf(req).email, "card_removed", true, `${pm.card?.brand ?? "card"} ${pm.card?.last4 ?? ""}`);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[parent] remove card", e);
      res.status(502).json({ message: "Couldn't remove that card right now." });
    }
  });

  // ── What the checkout pre-fills from ──────────────────────────────────────
  // The whole promise of the account: a returning family types nothing they
  // have already told us. 200 with `signedIn:false` rather than 401, so the
  // checkout can call it unconditionally.
  app.get(`${BASE}/prefill`, async (req, res) => {
    try {
      const sess = await sessionFromRequest(req);
      if (!sess) return res.json({ signedIn: false });
      const guardianIds = await guardianIdsForEmail(sess.email);
      if (guardianIds.length === 0) return res.json({ signedIn: false });

      const session = { email: sess.email, guardianIds };
      const [guardianRows, children] = await Promise.all([guardianRowsFor(session), familyFor(session)]);
      const best = guardianRows[0] ?? {};
      const details = await childRowsFor(children.flatMap(contactIdsOf));
      const today = nzTodayIso();

      res.json({
        signedIn: true,
        parent: {
          firstName: best.first_name ?? "",
          lastName: best.last_name ?? "",
          email: sess.email,
          phone: firstOf(guardianRows, "phone"),
          alternatePhone: firstOf(guardianRows, "alternate_phone"),
          addressParts: addressPartsOf(guardianRows),
        },
        children: children.map((c) => {
          // A merged-away record is kept for history; the live one answers.
          const rows = contactIdsOf(c).map((id) => details.get(id)).filter(Boolean) as any[];
          const live = rows.filter((r) => !r.merged_into_contact_id);
          const src = live.length ? live : rows;
          const ids = (k: string): number[] => {
            const v = firstOf(src, k);
            return Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : [];
          };
          const g1 = firstOf(src, "ethnicity_group_id");
          const g2 = firstOf(src, "ethnicity2_group_id");
          return {
            key: c.key,
            firstName: c.firstName,
            lastName: c.lastName,
            dateOfBirth: c.dateOfBirth ?? null,
            ageGrade: ageGradeFor(c.dateOfBirth, today),
            gender: firstOf(src, "gender"),
            school: firstOf(src, "school"),
            medicalNotes: c.medicalNotes ?? firstOf(src, "medical_notes"),
            allergies: c.allergies ?? firstOf(src, "allergies"),
            emergencyContact: firstOf(src, "emergency_contact"),
            emergencyPhone: firstOf(src, "emergency_phone"),
            photoConsent: src.some((r) => !!r.photo_consent),
            medicalConsent: src.some((r) => !!r.medical_consent),
            // Codes only — the checkout resolves names from NZF's own list.
            identity: {
              countryOfBirthCode: firstOf(src, "country_of_birth_code"),
              nationalityCode: firstOf(src, "nationality_code"),
              ethnicityGroupId: g1 === null ? null : Number(g1),
              ethnicitySelectionIds: ids("ethnicity_selection_ids"),
              ethnicity2GroupId: g2 === null ? null : Number(g2),
              ethnicity2SelectionIds: ids("ethnicity2_selection_ids"),
            },
          };
        }),
      });
    } catch (e: any) {
      console.error("[parent] prefill", e);
      res.json({ signedIn: false });   // a broken prefill must never block a sale
    }
  });
}

/**
 * Resolve a child key the checkout was given against the parent session, for
 * the registration routes.
 *
 * Returns the CONTACT id of an existing child when the signed-in family really
 * owns that key — so the route re-uses the child instead of minting a new
 * contact row (the unconditional createContact is why the database holds 207
 * duplicate children). A merged-away record is never returned when its
 * survivor is on the same card.
 *
 * Returns null for anything it cannot prove, and the caller falls back to
 * creating a child exactly as before: an unprovable claim must never widen
 * access, and must never break the sale either.
 */
export async function resolveOwnedChildContactId(
  req: Request,
  childKey: unknown,
): Promise<number | null> {
  try {
    const key = String(childKey ?? "");
    if (!key || !parsePersonKey(key)) return null;
    const sess = await sessionFromRequest(req);
    if (!sess) return null;
    const guardianIds = await guardianIdsForEmail(sess.email);
    if (guardianIds.length === 0) return null;

    const family = await familyFor({ email: sess.email, guardianIds });
    const mine = family.find((c) => childMatchesKey(c, key));
    if (!mine) return null;

    // Only a `contact`-shaped child can carry an academy registration.
    const ids = contactIdsOf(mine);
    if (!ids.length) return null;
    const rows = await childRowsFor(ids);
    const live = ids.filter((id) => !rows.get(id)?.merged_into_contact_id);
    return (live.length ? live : ids)[0];
  } catch (e) {
    console.error("[parent] resolveOwnedChildContactId", e);
    return null;
  }
}

export { requireParent, guardianIdsForEmail };

/** Read-only internals for script/_verify-parent-family-readonly.ts — the only
 *  way to exercise the family view against real records without a session. */
export const __parentInternals = {
  familyFor, offersForChild, toParentHistory, enrolledKeys, contactIdsOf, guardianIdsForEmail,
};

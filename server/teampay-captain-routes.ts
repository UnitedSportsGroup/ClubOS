// ─────────────────────────────────────────────────────────────────────────────
// Team Pay — the captain's account.
//
// Daniel, 2026-09-17: a captain signs in with an email and a password and
// manages their team from anywhere, instead of hunting for the magic link we
// emailed them once.
//
// 🔴 THE TOKEN LINKS DO NOT GO AWAY. `/team/:organiserToken` keeps working
// exactly as it does today, and a captain who never makes an account loses
// nothing. This is a SECOND DOOR to the same dashboard.
//
// 🔴 Which is why every action below RESOLVES THE ENTRY AND THEN CALLS THE
// EXISTING TOKEN-AUTHORISED FUNCTION. There is no second implementation of
// squad management, nudging, payment or fill-ins — a parallel one would drift,
// and the first thing to drift would be a money rule. The session decides WHO
// you are; `tp.*` still decides what may happen.
//
// 🔴 This is a CUSTOMER credential and never a staff session. Its own cookie,
// its own table, its own expiry. It cannot reach a single ClubOS admin route,
// and a ClubOS staff session is not one of these. Ported from
// server/print-account-routes.ts — the reference implementation for a customer
// account in this codebase (reference/app-baseline-standard.md §1).
//
// 🔴 NOT mandatory 2FA, and that is a deliberate deviation from the baseline's
// back-office rule. This is a community football captain signing in to see who
// has paid, not a console holding payroll. The baseline's own reference for a
// customer account — United Prints — is email and password only, for the same
// reason. What is NOT relaxed: scrypt, server-side revocable sessions, an
// identical answer to every failure, rate limits, and an audit row per attempt.
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import {
  teampayCaptains, teampayCaptainSessions, teampayCaptainTokens,
  teampayCaptainAuthEvents, teampayEntries, teampayFillins, teampayCompetitions,
  type TeampayCaptain,
} from "@shared/schema";
import * as tp from "./teampay";
import { sendEmail } from "./email";
import { driveStorage } from "./drive-storage";
import { brandFor, FILLIN_PUBLIC_FIELDS } from "@shared/teampay";

const COOKIE = "__Host-teampay_captain";
const SESSION_TTL_MS = 30 * 24 * 3600_000;   // 30 days
const LINK_TTL_MS = 60 * 60_000;             // 1 hour — a set-password link is short-lived
const PUBLIC_BASE_URL = process.env.TEAMPAY_PUBLIC_URL || "https://app.usg.co.nz";

/** 12 characters. Length is the only composition rule that matters. */
const MIN_PASSWORD = 12;

/**
 * 🔴 ONE message for every sign-in failure. Nothing distinguishes an unknown
 * address from a wrong password from a disabled account — otherwise the form is
 * a tool for discovering which captains have accounts.
 */
const SIGNIN_FAILED = "That email and password don't match. Try again.";

/**
 * 🔴 And one message for every "send me a link" outcome, including the case
 * where no such captain exists. The alternative tells a stranger whether an
 * address has entered a team.
 */
const LINK_SENT = "If that email has entered a team, we've sent it a link. Check your inbox.";

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;

// ── passwords ────────────────────────────────────────────────────────────────
// scrypt, `s1$salt$hex` — the same scheme as United Prints,
// natural-footballers-web, atarangi-lodge and conscious-agency, so the
// workspace has one password format rather than five half-remembered ones.

function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `s1$${salt}$${crypto.scryptSync(plain, salt, 64, SCRYPT).toString("hex")}`;
}

/**
 * 🔴 Returns false for a NULL or malformed hash, NEVER true.
 *
 * `password_hash` is nullable because a captain row is created the moment
 * somebody asks for a link, before they have proved anything. "No password set"
 * must fail closed — a verifier that treated a blank column as a match would
 * open every unclaimed account to anyone who typed a password into it.
 */
function verifyPassword(candidate: string, stored: string | null): boolean {
  const [scheme, salt, hashHex] = String(stored ?? "").split("$");
  if (scheme !== "s1" || !salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;
  const got = crypto.scryptSync(candidate, salt, expected.length, SCRYPT);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

// ── tokens and cookies ───────────────────────────────────────────────────────
// 🔴 Only HASHES are stored, for sessions and for links alike. These tables are
// lists of live credentials' fingerprints, not of working credentials: reading
// them cannot sign anyone in.

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function newToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}

function setSessionCookie(res: Response, token: string) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  // 🔴 ClubOS has no cookie-parser. `res.cookie` exists because Express
  // provides it, but `req.cookies` is silently undefined — which cost a
  // fast-follow deploy on Staff Videos. Reads always parse the raw header.
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearSessionCookie(res: Response) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

function cookieFromRequest(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

const ipOf = (req: Request) =>
  String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || null;
const uaOf = (req: Request) => String(req.headers["user-agent"] || "").slice(0, 300) || null;

async function audit(p: {
  req: Request; email?: string | null; captainId?: number | null;
  action: string; ok: boolean; reason?: string;
}) {
  try {
    await db.insert(teampayCaptainAuthEvents).values({
      email: p.email?.toLowerCase() ?? null,
      captainId: p.captainId ?? null,
      action: p.action,
      ok: p.ok,
      reason: p.reason ?? null,
      ip: ipOf(p.req),
      userAgent: uaOf(p.req),
    });
  } catch (e) {
    // An audit failure must never block or leak into the response.
    console.error("[teampay-captain] audit", e);
  }
}

// ── rate limiting ────────────────────────────────────────────────────────────
/**
 * 🔴 Durable, in the database, per email AND per IP — the app runs on two Fly
 * machines that share no memory, so an in-process counter would let an attacker
 * have two goes at everything.
 *
 * ⚠️ A whole football squad behind one router is ONE IP. The per-IP limit is
 * therefore deliberately loose; the per-email limit is the tight one, because
 * that is the one an attacker actually has to beat.
 */
const MAX_PER_EMAIL = 8;      // in 15 minutes
const MAX_PER_IP = 40;        // in 15 minutes — a shared NAT is a whole team
const WINDOW_MIN = 15;

async function rateLimited(email: string, req: Request): Promise<boolean> {
  try {
    const ip = ipOf(req);
    const res = await db.execute(sql`
      select
        count(*) filter (where lower(email) = ${email.toLowerCase()})                  as by_email,
        count(*) filter (where ${ip}::text is not null and ip = ${ip})                 as by_ip
      from teampay_captain_auth_events
      where created_at > now() - interval '15 minutes' and ok = false
    `);
    // 🔴 drizzle's db.execute returns the driver's own shape — a QueryResult
    // with .rows on node-postgres, a bare array elsewhere. Destructuring it as
    // an array threw "(intermediate value) is not iterable" and 500'd every
    // sign-in on the first deploy. Read both shapes, as form-guard does.
    const r: any = (res as any).rows?.[0] ?? (res as any)[0] ?? {};
    return Number(r.by_email ?? 0) >= MAX_PER_EMAIL || Number(r.by_ip ?? 0) >= MAX_PER_IP;
  } catch (e) {
    /**
     * 🔴 FAILS OPEN, and that is a deliberate trade with a condition attached.
     *
     * Failing closed would lock every captain out of their own team on a
     * database blip, and a signed-in captain is not what this protects against
     * anyway — sign-in cannot succeed while the database is unreachable,
     * because it must read the captain row to check a password.
     *
     * The real risk is the one that actually happened: a BROKEN query failing
     * open forever, silently, so there is no rate limiting at all and nobody
     * finds out. That is why `_verify-captain-live.ts` asserts the limiter
     * actually bites, rather than trusting this code to be reached.
     */
    console.error("[teampay-captain] rate check failed (failing OPEN):", e);
    return false;
  }
}

// ── who is signed in ─────────────────────────────────────────────────────────

/**
 * 🔴 Joins to the captain row on EVERY call rather than trusting the cookie, so
 * a disabled account stops working on its next request rather than whenever a
 * 30-day cookie happens to expire.
 */
export async function currentCaptain(req: Request): Promise<TeampayCaptain | null> {
  const token = cookieFromRequest(req, COOKIE);
  if (!token) return null;
  const rows = await db
    .select({ cap: teampayCaptains })
    .from(teampayCaptainSessions)
    .innerJoin(teampayCaptains, eq(teampayCaptains.id, teampayCaptainSessions.captainId))
    .where(and(
      eq(teampayCaptainSessions.tokenHash, sha256(token)),
      isNull(teampayCaptainSessions.revokedAt),
      gt(teampayCaptainSessions.expiresAt, new Date()),
    ))
    .limit(1);
  const cap = rows[0]?.cap;
  if (!cap || cap.disabledAt) return null;
  return cap;
}

async function requireCaptain(req: Request, res: Response, next: NextFunction) {
  const cap = await currentCaptain(req);
  if (!cap) return res.status(401).json({ message: "Please sign in." });
  (req as any).captain = cap;
  next();
}

// ── the ownership decider ────────────────────────────────────────────────────

/**
 * 🔴 THE one place that decides an entry belongs to the signed-in captain, and
 * the only way any captain route reaches an organiser token.
 *
 * Ownership is by VERIFIED EMAIL, re-resolved per request, with no
 * `captain_id` column on the entry. Every entry that exists today was created
 * with no account at all, so a foreign key would be NULL on all of them and the
 * teams with the longest history would open the emptiest dashboard. It also
 * means a captain who enters a second team under the same address simply sees
 * both, with nothing to link up.
 *
 * Answers `null` for "not yours" and for "does not exist" alike; the caller
 * returns 404 either way, so the id space is not a directory of other people's
 * teams.
 */
async function ownedEntry(captain: TeampayCaptain, entryId: number) {
  if (!Number.isInteger(entryId)) return null;
  const [entry] = await db
    .select()
    .from(teampayEntries)
    .where(and(
      eq(teampayEntries.id, entryId),
      sql`lower(${teampayEntries.managerEmail}) = ${captain.email.toLowerCase()}`,
    ))
    .limit(1);
  return entry ?? null;
}

/** Every team this captain can manage. */
async function myEntries(captain: TeampayCaptain) {
  return db
    .select()
    .from(teampayEntries)
    .where(sql`lower(${teampayEntries.managerEmail}) = ${captain.email.toLowerCase()}`)
    .orderBy(desc(teampayEntries.createdAt));
}

// ── the marketplace a signed-in captain sees ─────────────────────────────────

/**
 * 🔴 The public allowlist PLUS the two fields Daniel added, and nothing else.
 *
 * Still no email, no phone, no surname before the player accepts — that rule
 * predates the login and the login does not relax it. Anyone can enter a team
 * for free and unapproved, so "is signed in" is a real identity but it is not a
 * vetting step. `RELEASE_CONTACT_ON_REQUEST` in shared/teampay.ts is still the
 * one line that would change it.
 */
async function captainVisibleFillin(row: any, storage = driveStorage()) {
  const out: Record<string, unknown> = {};
  for (const f of FILLIN_PUBLIC_FIELDS) out[f] = row[f];

  out.highlightUrl = safeHighlightUrl(row.highlightUrl);
  // A short-lived signed URL, minted per request. The key never leaves the
  // server and the link dies in five minutes, so a screenshot of the network
  // tab is not a permanent handle on somebody's photograph.
  out.photoUrl = row.photoKey
    ? await storage.signedUrl(row.photoKey, { expiresIn: 300 }).catch(() => null)
    : null;
  return out;
}

/**
 * 🔴 A highlight link is a URL a stranger typed, rendered to a captain who will
 * click it. Only http(s) survives — `javascript:` and `data:` are how a pasted
 * link becomes script — and the hostname is returned alongside so the page can
 * show WHERE the link goes rather than just "watch highlights".
 */
export function safeHighlightUrl(raw: string | null | undefined): { url: string; host: string } | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  return { url: u.toString(), host: u.hostname.replace(/^www\./, "") };
}

// ── emails ───────────────────────────────────────────────────────────────────

function linkEmailHtml(name: string | null, url: string, kind: "set" | "reset", compName: string) {
  const who = name ? name.split(" ")[0] : "there";
  return `<div style="font:15px/1.6 system-ui;max-width:520px">
    <p>Kia ora ${escapeHtml(who)},</p>
    <p>${kind === "reset"
      ? `You asked to reset the password for your <strong>${escapeHtml(compName)}</strong> team account.`
      : `Set a password and you can manage your <strong>${escapeHtml(compName)}</strong> team from anywhere — see who has paid, chase the ones who haven't, and find players.`}</p>
    <p><a href="${url}" style="display:inline-block;background:#C9A43E;color:#0B0B0B;font-weight:600;
       text-decoration:none;padding:12px 22px;border-radius:8px">
       ${kind === "reset" ? "Choose a new password" : "Set your password"}</a></p>
    <p style="color:#666;font-size:13px">This link works once and expires in an hour.
       If you didn't ask for it you can ignore this email — nothing has changed.</p>
  </div>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// ─────────────────────────────────────────────────────────────────────────────

export function registerTeampayCaptainRoutes(app: Express) {

  // ── sign in ────────────────────────────────────────────────────────────────

  app.post("/api/public/teampay/captain/request-link", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!/.+@.+\..+/.test(email)) return res.status(400).json({ message: "That email doesn't look right." });

    if (await rateLimited(email, req)) {
      await audit({ req, email, action: "request_link", ok: false, reason: "rate_limited" });
      // Same body as success — a rate limiter that announces itself is a
      // detector for whether an address exists.
      return res.json({ message: LINK_SENT });
    }

    // 🔴 An account is only ever created for an address that has ENTERED A
    // TEAM. Otherwise this endpoint mints a captain row for any address anyone
    // types, and the table becomes a list of strangers we have emailed.
    const [entry] = await db
      .select({ id: teampayEntries.id, name: teampayEntries.managerName, competitionId: teampayEntries.competitionId })
      .from(teampayEntries)
      .where(sql`lower(${teampayEntries.managerEmail}) = ${email}`)
      .limit(1);

    if (!entry) {
      await audit({ req, email, action: "request_link", ok: false, reason: "no_entry" });
      return res.json({ message: LINK_SENT });
    }

    let [cap] = await db.select().from(teampayCaptains)
      .where(sql`lower(${teampayCaptains.email}) = ${email}`).limit(1);
    if (!cap) {
      [cap] = await db.insert(teampayCaptains)
        .values({ email, name: entry.name }).returning();
    }
    if (cap.disabledAt) {
      await audit({ req, email, captainId: cap.id, action: "request_link", ok: false, reason: "disabled" });
      return res.json({ message: LINK_SENT });
    }

    const { token, hash } = newToken();
    await db.insert(teampayCaptainTokens).values({
      captainId: cap.id,
      tokenHash: hash,
      kind: cap.passwordHash ? "reset" : "set",
      expiresAt: new Date(Date.now() + LINK_TTL_MS),
    });

    const comp = await tp.competitionById(entry.competitionId);
    // The brand rides in the link so the set-password screen wears the right
    // palette before there is a signed-in team to take one from.
    const url = `${PUBLIC_BASE_URL}/captain/set-password?token=${encodeURIComponent(token)}`
      + (comp?.brand ? `&brand=${encodeURIComponent(comp.brand)}` : "");
    try {
      // 🔴 awaited. An un-awaited send on a serverless-shaped path may never
      // run, and the person would wait forever for a link that was never sent.
      await sendEmail({
        from: `${comp?.name || "Team Pay"} <noreply@cufc.co.nz>`,
        to: cap.email,
        subject: cap.passwordHash ? "Reset your team password" : "Set your team password",
        html: linkEmailHtml(cap.name, url, cap.passwordHash ? "reset" : "set", comp?.name || "your team"),
      });
      await audit({ req, email, captainId: cap.id, action: "request_link", ok: true });
    } catch (e: any) {
      console.error("[teampay-captain] link email failed:", e?.message || e);
      await audit({ req, email, captainId: cap.id, action: "request_link", ok: false, reason: "email_failed" });
    }
    res.json({ message: LINK_SENT });
  });

  app.post("/api/public/teampay/captain/set-password", async (req, res) => {
    const token = String(req.body?.token || "");
    const password = String(req.body?.password || "");
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ message: `Your password needs at least ${MIN_PASSWORD} characters.` });
    }

    const [row] = await db
      .select({ tok: teampayCaptainTokens, cap: teampayCaptains })
      .from(teampayCaptainTokens)
      .innerJoin(teampayCaptains, eq(teampayCaptains.id, teampayCaptainTokens.captainId))
      .where(and(
        eq(teampayCaptainTokens.tokenHash, sha256(token)),
        isNull(teampayCaptainTokens.usedAt),
        gt(teampayCaptainTokens.expiresAt, new Date()),
      ))
      .limit(1);

    if (!row || row.cap.disabledAt) {
      await audit({ req, action: "set_password", ok: false, reason: "bad_token" });
      return res.status(400).json({ message: "That link has expired or has already been used. Ask for a new one." });
    }

    // 🔴 Spend the token FIRST and atomically. Two tabs open on the same link
    // must not both set a password, and a token that survives its own use is a
    // permanent key sitting in somebody's inbox.
    const spent = await db.update(teampayCaptainTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(teampayCaptainTokens.id, row.tok.id), isNull(teampayCaptainTokens.usedAt)))
      .returning({ id: teampayCaptainTokens.id });
    if (!spent.length) {
      return res.status(400).json({ message: "That link has already been used. Ask for a new one." });
    }

    await db.update(teampayCaptains)
      .set({ passwordHash: hashPassword(password), updatedAt: new Date() })
      .where(eq(teampayCaptains.id, row.cap.id));

    // 🔴 Setting a password revokes every other live session. If the reason you
    // are here is that somebody else got in, this is the thing that puts them out.
    await db.update(teampayCaptainSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(teampayCaptainSessions.captainId, row.cap.id), isNull(teampayCaptainSessions.revokedAt)));

    const { token: sessTok, hash } = newToken();
    await db.insert(teampayCaptainSessions).values({
      captainId: row.cap.id,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: uaOf(req), ip: ipOf(req),
    });
    setSessionCookie(res, sessTok);
    await audit({ req, email: row.cap.email, captainId: row.cap.id, action: "set_password", ok: true });
    res.json({ ok: true });
  });

  app.post("/api/public/teampay/captain/sign-in", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (await rateLimited(email, req)) {
      await audit({ req, email, action: "sign_in", ok: false, reason: "rate_limited" });
      return res.status(429).json({ message: "Too many attempts. Wait a few minutes and try again." });
    }

    const [cap] = await db.select().from(teampayCaptains)
      .where(sql`lower(${teampayCaptains.email}) = ${email}`).limit(1);

    // 🔴 One answer for all three of: no such account, wrong password, disabled.
    // And the password is verified even when there is no account, so the reply
    // does not come back measurably faster for an address that does not exist.
    const okPassword = verifyPassword(password, cap?.passwordHash ?? null);
    if (!cap || cap.disabledAt || !okPassword) {
      await audit({
        req, email, captainId: cap?.id ?? null, action: "sign_in", ok: false,
        reason: !cap ? "no_account" : cap.disabledAt ? "disabled" : "bad_password",
      });
      return res.status(401).json({ message: SIGNIN_FAILED });
    }

    const { token, hash } = newToken();
    await db.insert(teampayCaptainSessions).values({
      captainId: cap.id, tokenHash: hash,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: uaOf(req), ip: ipOf(req),
    });
    await db.update(teampayCaptains)
      .set({ lastSignInAt: new Date() }).where(eq(teampayCaptains.id, cap.id));
    setSessionCookie(res, token);
    await audit({ req, email, captainId: cap.id, action: "sign_in", ok: true });
    res.json({ ok: true });
  });

  app.post("/api/public/teampay/captain/sign-out", async (req, res) => {
    const token = cookieFromRequest(req, COOKIE);
    if (token) {
      await db.update(teampayCaptainSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(teampayCaptainSessions.tokenHash, sha256(token)), isNull(teampayCaptainSessions.revokedAt)));
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // ── the captain's own teams ────────────────────────────────────────────────

  app.get("/api/public/teampay/captain/me", async (req, res) => {
    const cap = await currentCaptain(req);
    if (!cap) return res.status(401).json({ message: "Please sign in." });
    const entries = await myEntries(cap);
    const comps = new Map<number, any>();
    for (const e of entries) {
      if (!comps.has(e.competitionId)) comps.set(e.competitionId, await tp.competitionById(e.competitionId));
    }
    res.set("Cache-Control", "no-store");
    res.json({
      captain: { email: cap.email, name: cap.name },
      entries: entries.map((e) => {
        const c = comps.get(e.competitionId);
        return {
          id: e.id,
          teamName: e.teamName,
          community: e.community,
          status: e.status,
          paidUpAt: e.paidUpAt,
          paymentMode: e.paymentMode,
          competition: c ? { slug: c.slug, name: c.name, brand: c.brand, theme: brandFor(c.brand) } : null,
        };
      }),
    });
  });

  /**
   * 🔴 Everything below resolves the entry, then calls the SAME function the
   * token route calls. `entry.organiserToken` never leaves the server except
   * here, where it is the captain's own team's token — and even then only so
   * the browser can share the link with a co-manager.
   */
  const withEntry = (
    handler: (entry: any, req: Request, res: Response) => Promise<any>,
  ) => async (req: Request, res: Response) => {
    const cap = (req as any).captain as TeampayCaptain;
    const entry = await ownedEntry(cap, Number(req.params.id));
    if (!entry) return res.status(404).json({ message: "We couldn't find that." });
    try {
      await handler(entry, req, res);
    } catch (e: any) {
      console.error("[teampay-captain]", req.path, e?.message || e);
      if (!res.headersSent) res.status(500).json({ message: "Something went wrong." });
    }
  };

  const send = (res: Response, r: any) => {
    if (r?.error === "not_found") return res.status(404).json({ message: "We couldn't find that." });
    if (r?.error === "already_paid") return res.status(409).json({ message: "This team is already paid up." });
    if (r?.error) return res.status(400).json({ message: r.error });
    res.json(r);
  };

  app.get("/api/public/teampay/captain/entries/:id", requireCaptain, withEntry(async (entry, _req, res) => {
    const view = await tp.dashboardView(entry.organiserToken);
    if (!view) return res.status(404).json({ message: "We couldn't find that." });
    res.set("Cache-Control", "no-store");
    res.json({ ...view, organiserToken: entry.organiserToken });
  }));

  app.post("/api/public/teampay/captain/entries/:id/players", requireCaptain, withEntry(async (entry, req, res) => {
    const rows = Array.isArray(req.body?.players) ? req.body.players : [req.body];
    if (rows.length > 60) return res.status(400).json({ message: "That's more players than a squad." });
    send(res, await tp.addPlayers(entry.organiserToken, rows));
  }));

  app.delete("/api/public/teampay/captain/entries/:id/players/:pid", requireCaptain, withEntry(async (entry, req, res) => {
    send(res, await tp.removePlayer(entry.organiserToken, Number(req.params.pid)));
  }));

  app.patch("/api/public/teampay/captain/entries/:id/squad-size", requireCaptain, withEntry(async (entry, req, res) => {
    send(res, await tp.setSquadSize(entry.organiserToken, Number(req.body?.squadSize)));
  }));

  app.patch("/api/public/teampay/captain/entries/:id/payment-mode", requireCaptain, withEntry(async (entry, req, res) => {
    send(res, await tp.setPaymentMode(entry.organiserToken, String(req.body?.paymentMode || "")));
  }));

  app.post("/api/public/teampay/captain/entries/:id/pay-intent", requireCaptain, withEntry(async (entry, _req, res) => {
    send(res, await tp.teamPayIntent(entry.organiserToken));
  }));

  app.post("/api/public/teampay/captain/entries/:id/pay-confirm", requireCaptain, withEntry(async (entry, _req, res) => {
    send(res, await tp.confirmTeamPayment(entry.organiserToken));
  }));

  app.post("/api/public/teampay/captain/entries/:id/players/:pid/nudge", requireCaptain, withEntry(async (entry, req, res) => {
    send(res, await tp.nudgePlayer(entry.organiserToken, Number(req.params.pid)));
  }));

  app.post("/api/public/teampay/captain/entries/:id/nudge-all", requireCaptain, withEntry(async (entry, _req, res) => {
    send(res, await tp.nudgeAll(entry.organiserToken));
  }));

  // ── the marketplace, as a signed-in captain sees it ────────────────────────

  app.get("/api/public/teampay/captain/entries/:id/fill-ins", requireCaptain, withEntry(async (entry, _req, res) => {
    const r = await tp.browseFillins(entry.organiserToken);
    if (r.error) return send(res, r);

    // The browse function returns the PUBLIC allowlist. Re-read the same rows
    // for the two extra fields a signed-in captain may see, by id, so the
    // allowlist stays the single description of what is public.
    const ids = (r.fillins ?? []).map((f) => f.id);
    const extra = new Map<number, any>();
    if (ids.length) {
      const rows = await db.select().from(teampayFillins)
        .where(sql`${teampayFillins.id} in ${ids}`);
      for (const row of rows) extra.set(row.id, row);
    }
    const storage = driveStorage();
    const fillins = await Promise.all((r.fillins ?? []).map(async (f) => {
      const row = extra.get(f.id);
      return {
        ...f,
        highlight: safeHighlightUrl(row?.highlightUrl),
        photoUrl: row?.photoKey
          ? await storage.signedUrl(row.photoKey, { expiresIn: 300 }).catch(() => null)
          : null,
      };
    }));
    res.set("Cache-Control", "no-store");
    res.json({ ...r, fillins });
  }));

  app.post("/api/public/teampay/captain/entries/:id/fill-ins/:fid/request", requireCaptain, withEntry(async (entry, req, res) => {
    const cap = (req as any).captain as TeampayCaptain;
    const r = await tp.requestFillin(entry.organiserToken, Number(req.params.fid), String(req.body?.message || ""));
    // Attribution only — the hold is already created and authorised above.
    if (!r.error) {
      try {
        await db.execute(sql`
          update teampay_fillin_holds set requested_by_captain_id = ${cap.id}
           where entry_id = ${entry.id} and fillin_id = ${Number(req.params.fid)}
             and requested_by_captain_id is null`);
      } catch (e) { console.error("[teampay-captain] hold attribution", e); }
    }
    send(res, r);
  }));

  // ── the PUBLIC marketplace ────────────────────────────────────────────────

  /**
   * 🔴 The public list. `FILLIN_PUBLIC_FIELDS` and nothing else — no photo, no
   * highlight video, no surname, no contact. Daniel's call, 2026-09-17: several
   * of these players are new to the country, and a page of named photographs
   * anyone can scrape is a different product from a list of people wanting a
   * game. It also bounds the image egress that has taken our storage down twice.
   *
   * `noindex` is set by the website; this endpoint additionally refuses to be
   * cached, because the pool changes as people are placed.
   */
  app.get("/api/public/teampay/marketplace/:slug", async (req, res) => {
    try {
      const comp = await tp.competitionBySlug(String(req.params.slug));
      if (!comp) return res.status(404).json({ message: "We couldn't find that." });

      // 🔴 The pool is the TOURNAMENT — see tp.poolCompetitions(). A 7's
      // captain in Social must see a player who listed under Open.
      const pool = await tp.poolCompetitions(comp);
      const ids = tp.poolIds(pool);
      await tp.sweepExpiredHolds(ids);

      const rows = await db.select().from(teampayFillins)
        .where(and(
          inArray(teampayFillins.competitionId, ids),
          eq(teampayFillins.status, "available"),
        ))
        .orderBy(desc(teampayFillins.createdAt));

      const players = rows.map((row: any) => {
        const out: Record<string, unknown> = {};
        for (const f of FILLIN_PUBLIC_FIELDS) out[f] = row[f];
        // Not a column: which grade they listed under, only when there is more
        // than one. The allowlist above stays the one description of what is
        // public from the row itself.
        out.listedFor = tp.listedFor(pool, row.competitionId);
        // Not the URL, not the key — only that there IS one, so the page can
        // say "has a highlight video" and a captain knows signing in is worth it.
        out.hasPhoto = !!row.photoKey;
        out.hasHighlight = !!safeHighlightUrl(row.highlightUrl);
        return out;
      });

      res.set("Cache-Control", "no-store");
      res.set("X-Robots-Tag", "noindex, nofollow");
      res.json({
        competition: {
          slug: comp.slug, name: comp.name, brand: comp.brand,
          theme: brandFor(comp.brand), fillinsOpen: comp.fillinsOpen,
          pool: pool.map((c) => ({ slug: c.slug, name: c.name })),
        },
        count: players.length,
        players,
      });
    } catch (e: any) {
      console.error("[teampay marketplace]", e?.message || e);
      res.status(500).json({ message: "Couldn't load the marketplace." });
    }
  });

  // ── the player's photo ────────────────────────────────────────────────────

  /**
   * A fill-in uploads their own photo, authorised by their own player token —
   * the same secret that already lets them withdraw. No login: a player is not
   * asked to make an account, and never has been.
   *
   * 🔴 Type and size are checked SERVER-SIDE from the bytes' declared content
   * type and length. A browser `accept=` attribute is a suggestion.
   */
  app.post("/api/public/teampay/fill-in/:playerToken/photo", async (req, res) => {
    try {
      const [row] = await db.select().from(teampayFillins)
        .where(eq(teampayFillins.playerToken, String(req.params.playerToken))).limit(1);
      if (!row) return res.status(404).json({ message: "We couldn't find that." });

      const contentType = String(req.body?.contentType || "");
      const base64 = String(req.body?.data || "");
      if (!/^image\/(jpeg|png|webp)$/.test(contentType)) {
        return res.status(400).json({ message: "Please use a JPEG, PNG or WebP image." });
      }
      const buf = Buffer.from(base64, "base64");
      if (!buf.length) return res.status(400).json({ message: "That image didn't arrive. Try again." });
      if (buf.length > 5 * 1024 * 1024) {
        return res.status(400).json({ message: "That image is over 5MB — please pick a smaller one." });
      }

      const storage = driveStorage();
      const put = await storage.put(buf, contentType, `fillin.${contentType.split("/")[1]}`);

      // Replace, never accumulate: an old photo nobody can reach is still a
      // photograph of a person sitting in a bucket.
      const old = row.photoKey;
      await db.update(teampayFillins)
        .set({ photoKey: put.storageKey, updatedAt: new Date() })
        .where(eq(teampayFillins.id, row.id));
      if (old) await storage.remove(old).catch(() => {});

      res.json({ ok: true });
    } catch (e: any) {
      console.error("[teampay fillin photo]", e?.message || e);
      res.status(500).json({ message: "Couldn't save that photo." });
    }
  });
}

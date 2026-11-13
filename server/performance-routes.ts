/**
 * SIU Performance Hub — the staff API and the player's own phone check-in.
 *
 * Daniel, 2026-11-14: "a player monitoring system like smartabase … web app and
 * mobile app … SIU branded … linked into siu clubos workspace … all data
 * sources plugged into one dashboard".
 *
 * Every rule about what a number MEANS lives in shared/performance.ts; this file
 * only reads, writes and decides who may see what.
 *
 * WHO MAY SEE WHAT
 *  🔴 South Island United workspace only — any other X-Workspace-Slug gets 404,
 *     because requireTab lets an admin of ANY workspace through (Partners lesson).
 *  🔴 The tab is in SUPER_ADMIN_ONLY_TABS: a person sees it only by a per-person
 *     grant (user_organizations.unlocked_tabs), never because they are an SIU admin.
 *  🔴 Clinical notes and a player's private "tell the physio" note go ONLY to a
 *     holder of the `performance-medical` grant — and there is NO super-admin
 *     bypass. Daniel, 14 Nov: "medical staff only".
 *  🔴 Without access the answer is 404, not 403: the route does not exist for them.
 *
 * THE PLAYER
 *  🔴 A customer-shaped credential (Team Pay captain pattern): its own cookie,
 *     its own tables, and it reaches only /api/public/athlete/*. Staff create it
 *     by inviting a player on the roster; a stranger cannot make one.
 *  🔴 A player writes only TODAY's check-in and today's/yesterday's RPE, for
 *     themself. The date is the server's NZ date, never the phone's.
 */
import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { canAccessTab } from "@shared/tabs";
import {
  DATA_SOURCES, FORMULAS, METRICS, PERFORMANCE_MEDICAL_GRANT, PERFORMANCE_TAB, SIU_ORG_SLUG,
  SORE_AREAS, WELLNESS_ITEMS, addDays, availabilityOn, dailyLoads, daysLost, isIsoDate, loadSummary,
  metricByKey, nzToday, readiness, sessionLoad, sourceByKey, wellnessFlag, wellnessScore,
  type AvailabilitySpell, type AvailabilityStatus, type WellnessRow,
} from "@shared/performance";
import { parseCsv, planImport } from "@shared/perf-csv";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { sendEmail, SIU_FROM } from "./email";
import { storage } from "./storage";

const BASE = "/api/admin/performance";
const PUB = "/api/public/athlete";
const ATHLETE_BASE_URL = process.env.SIU_ATHLETE_URL || "https://join.southislandunited.com";

type Row = Record<string, any>;
const q = async <T = Row>(text: string, params: unknown[] = []): Promise<T[]> => (await pool.query(text, params)).rows as T[];
const one = async <T = Row>(text: string, params: unknown[] = []): Promise<T | undefined> => (await q<T>(text, params))[0];
const isoOf = (d: unknown): string | null => {
  if (d == null) return null;
  if (typeof d === "string") return d.slice(0, 10);
  // pg returns DATE as a local-midnight Date; read its LOCAL parts.
  const x = d as Date;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const nameOf = (r: Row) => [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || null;

let siuOrgId: number | null = null;
async function siuOrg(): Promise<number> {
  if (siuOrgId != null) return siuOrgId;
  const r = await one<{ id: number }>(`select id from organizations where slug = $1`, [SIU_ORG_SLUG]);
  if (!r) throw new Error("South Island United organisation not found");
  siuOrgId = r.id;
  return siuOrgId;
}

function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try { await fn(req, res); } catch (e: any) {
      console.error(`[Performance] ${req.method} ${req.path} failed:`, e?.message ?? e);
      if (e?.code === "23P01") return res.status(409).json({ message: "That player is already marked out for part of those dates. Close or edit that spell first." });
      if (e?.code === "23505") return res.status(409).json({ message: "That already exists." });
      res.status(500).json({ message: "That could not be done. Try again." });
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Access
// ─────────────────────────────────────────────────────────────────────────────

interface Viewer { userId: number; medical: boolean; org: number }

/** Re-read on every request, so a revoked grant bites on the next call. */
async function viewerFor(req: Request): Promise<Viewer | null> {
  if (req.headers["x-workspace-slug"] !== SIU_ORG_SLUG) return null;
  const user = await storage.getUser(req.session.userId!);
  if (!user) return null;
  const membership = (await storage.getUserOrganizations(user.id)).find((o: any) => o.slug === SIU_ORG_SLUG) as any;
  const allowed = canAccessTab({
    globalRole: user.role,
    membershipRole: membership?.userRole,
    membershipTabs: membership?.userTabs,
    membershipUnlockedTabs: membership?.userUnlockedTabs,
    tabSlug: PERFORMANCE_TAB,
  });
  if (!allowed) return null;
  // 🔴 Explicit grant only. A super admin is NOT medical unless granted.
  const medical = Array.isArray(membership?.userUnlockedTabs) && membership.userUnlockedTabs.includes(PERFORMANCE_MEDICAL_GRANT);
  return { userId: user.id, medical, org: await siuOrg() };
}

async function requirePerformance(req: Request, res: Response, next: NextFunction) {
  try {
    const v = await viewerFor(req);
    if (!v) return res.status(404).json({ message: "Not found" });
    (req as any).perf = v;
    next();
  } catch (e) {
    console.error("[Performance] access check failed:", e);
    res.status(500).json({ message: "Could not check access." });
  }
}
const viewer = (req: Request): Viewer => (req as any).perf;

// ─────────────────────────────────────────────────────────────────────────────
// Roster — the SIU squads in club_squads (org 2), active members only.
// ─────────────────────────────────────────────────────────────────────────────

interface RosterPlayer { contactId: number; name: string; firstName: string | null; lastName: string | null; position: string | null; squadNumber: number | null; squad: string; email: string | null; dob: string | null }

async function roster(org: number): Promise<RosterPlayer[]> {
  const rows = await q(`
    select distinct on (c.id) c.id, c.first_name, c.last_name, c.email, c.date_of_birth, m.position, m.squad_number, s.name squad
    from club_squads s
    join club_squad_members m on m.squad_id = s.id and m.left_at is null and m.role = 'player'
    join contacts c on c.id = m.contact_id
    where s.organization_id = $1 and s.is_active
    order by c.id, s.season_year desc`, [org]);
  return rows.map((r) => ({
    contactId: r.id, name: nameOf(r) ?? `Player ${r.id}`, firstName: r.first_name, lastName: r.last_name,
    position: r.position, squadNumber: r.squad_number, squad: r.squad, email: r.email, dob: isoOf(r.date_of_birth),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

async function onRoster(org: number, contactId: number): Promise<boolean> {
  const r = await one(`
    select 1 from club_squads s join club_squad_members m on m.squad_id = s.id
    where s.organization_id = $1 and s.is_active and m.left_at is null and m.contact_id = $2 limit 1`, [org, contactId]);
  return !!r;
}

// ─────────────────────────────────────────────────────────────────────────────
// Readers shared by the board and the player page
// ─────────────────────────────────────────────────────────────────────────────

const toWellness = (r: Row): WellnessRow & { medicalFlag: boolean | null; note: string | null; soreAreas: string[]; byAthlete: boolean } => ({
  date: isoOf(r.date)!, sleep: r.sleep, fatigue: r.fatigue, soreness: r.soreness, stress: r.stress, mood: r.mood,
  sleepHours: num(r.sleep_hours), medicalFlag: r.medical_flag, note: r.note, soreAreas: r.sore_areas ?? [], byAthlete: !!r.entered_by_athlete,
});

async function loadsFor(org: number, ids: number[], from: string, to: string) {
  if (!ids.length) return new Map<number, { rows: { date: string; load: number | null }[]; first: string | null }>();
  const rpe = await q(`select contact_id, date, rpe, minutes from perf_rpe where organization_id = $1 and contact_id = any($2::int[]) and date between $3 and $4`, [org, ids, from, to]);
  const firsts = await q(`select contact_id, min(date) first from perf_rpe where organization_id = $1 and contact_id = any($2::int[]) group by 1`, [org, ids]);
  const map = new Map<number, { rows: { date: string; load: number | null }[]; first: string | null }>();
  for (const id of ids) map.set(id, { rows: [], first: null });
  for (const r of rpe) map.get(r.contact_id)!.rows.push({ date: isoOf(r.date)!, load: sessionLoad({ date: isoOf(r.date)!, rpe: r.rpe, minutes: r.minutes }) });
  for (const f of firsts) map.get(f.contact_id)!.first = isoOf(f.first);
  return map;
}

async function spellsFor(org: number, ids: number[]) {
  if (!ids.length) return [] as Row[];
  return q(`select a.*, u.first_name rf, u.last_name rl from perf_availability a left join users u on u.id = a.recorded_by
            where a.organization_id = $1 and a.contact_id = any($2::int[]) order by a.started_on desc`, [org, ids]);
}

const spellOut = (r: Row, medical: boolean) => ({
  id: r.id, contactId: r.contact_id, status: r.status as AvailabilityStatus, startedOn: isoOf(r.started_on)!,
  endedOn: isoOf(r.ended_on), expectedReturn: isoOf(r.expected_return), reason: r.reason, bodyArea: r.body_area,
  // 🔴 clinical
  notes: medical ? r.notes : undefined,
  hasNotes: !!r.notes,
  recordedBy: [r.rf, r.rl].filter(Boolean).join(" ") || null,
});

// ─────────────────────────────────────────────────────────────────────────────
// Athlete-account crypto (Team Pay captain scheme)
// ─────────────────────────────────────────────────────────────────────────────

const COOKIE = "__Host-siu_athlete";
const SESSION_TTL_MS = 60 * 24 * 3600_000;   // 60 days — a daily check-in must not ask for a password every week
const LINK_TTL_MS = 72 * 3600_000;           // 3 days for an invite; players read email slowly
const MIN_PASSWORD = 10;
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const SIGNIN_FAILED = "That email and password don't match. Try again.";
const LINK_SENT = "If that email belongs to a South Island United player, we've sent it a link.";
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const newToken = () => { const token = crypto.randomBytes(32).toString("base64url"); return { token, hash: sha256(token) }; };
function hashPassword(plain: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `s1$${salt}$${crypto.scryptSync(plain, salt, 64, SCRYPT).toString("hex")}`;
}
function verifyPassword(candidate: string, stored: string | null): boolean {
  const [scheme, salt, hex] = String(stored ?? "s1$x$00").split("$");
  const expected = Buffer.from(hex || "00", "hex");
  const got = crypto.scryptSync(candidate, salt || "x", expected.length || 1, SCRYPT);
  if (scheme !== "s1" || !salt || !hex || stored == null) return false;
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}
function cookieFrom(req: Request): string | null {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
const setCookie = (res: Response, token: string) =>
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
const clearCookie = (res: Response) => res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
const ipOf = (req: Request) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || null;
const uaOf = (req: Request) => String(req.headers["user-agent"] || "").slice(0, 300) || null;

async function audit(req: Request, p: { email?: string | null; accountId?: number | null; action: string; ok: boolean; reason?: string }) {
  try {
    await pool.query(`insert into perf_athlete_auth_events (email, account_id, action, ok, reason, ip, user_agent) values ($1,$2,$3,$4,$5,$6,$7)`,
      [p.email?.toLowerCase() ?? null, p.accountId ?? null, p.action, p.ok, p.reason ?? null, ipOf(req), uaOf(req)]);
  } catch (e) { console.error("[athlete] audit", e); }
}

/** Durable, per email and per IP. Fails OPEN (a DB blip must not lock a squad out); the verifier proves it bites. */
async function rateLimited(req: Request, email: string): Promise<boolean> {
  try {
    const r = await one(`select count(*) filter (where lower(email) = $1) e, count(*) filter (where $2::text is not null and ip = $2) i
      from perf_athlete_auth_events where created_at > now() - interval '15 minutes' and ok = false`, [email.toLowerCase(), ipOf(req)]);
    return Number(r?.e ?? 0) >= 8 || Number(r?.i ?? 0) >= 40;
  } catch (e) { console.error("[athlete] rate check failed (failing OPEN)", e); return false; }
}

async function sendLink(accountId: number, email: string, firstName: string | null, kind: "set" | "reset") {
  const { token, hash } = newToken();
  await pool.query(`insert into perf_athlete_tokens (account_id, token_hash, kind, expires_at) values ($1,$2,$3,$4)`,
    [accountId, hash, kind, new Date(Date.now() + LINK_TTL_MS)]);
  const url = `${ATHLETE_BASE_URL}/athlete/set-password?token=${encodeURIComponent(token)}`;
  const hi = firstName ? `Kia ora ${escapeHtml(firstName)},` : "Kia ora,";
  const body = kind === "set"
    ? `<p>${hi}</p><p>You've been set up on the South Island United player check-in. It takes 30 seconds a day: how you slept and how you feel before training, and how hard the session was afterwards.</p><p>Only the performance staff see your answers. Anything you mark for the physio goes to the medical staff only.</p>`
    : `<p>${hi}</p><p>Here is the link to set a new password for your South Island United check-in.</p>`;
  return sendEmail({
    from: SIU_FROM,
    to: email,
    subject: kind === "set" ? "Your SIU player check-in" : "Reset your SIU check-in password",
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#161616">${body}
      <p><a href="${url}" style="display:inline-block;background:#C59949;color:#111;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Set my password</a></p>
      <p style="color:#666;font-size:13px">The link works once and lasts 3 days. Then add the page to your home screen.</p></div>`,
  });
}
function escapeHtml(s: string) { return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)); }

interface Athlete { accountId: number; contactId: number; org: number; email: string; firstName: string | null; lastName: string | null }

async function currentAthlete(req: Request): Promise<Athlete | null> {
  const token = cookieFrom(req);
  if (!token) return null;
  const r = await one(`
    select a.id, a.contact_id, a.organization_id, a.email, c.first_name, c.last_name
    from perf_athlete_sessions s join perf_athlete_accounts a on a.id = s.account_id join contacts c on c.id = a.contact_id
    where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and a.disabled_at is null`, [sha256(token)]);
  if (!r) return null;
  // 🔴 Off the roster = signed out, on the next request.
  if (!(await onRoster(r.organization_id, r.contact_id))) return null;
  return { accountId: r.id, contactId: r.contact_id, org: r.organization_id, email: r.email, firstName: r.first_name, lastName: r.last_name };
}

async function requireAthlete(req: Request, res: Response, next: NextFunction) {
  try {
    const a = await currentAthlete(req);
    if (!a) return res.status(401).json({ message: "Please sign in." });
    (req as any).athlete = a;
    next();
  } catch (e) { console.error("[athlete] session", e); res.status(500).json({ message: "Could not check your sign-in." }); }
}
const athleteOf = (req: Request): Athlete => (req as any).athlete;

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

const score1to5 = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw Object.assign(new Error("bad"), { status: 400, msg: "Each answer is 1 to 5." });
  return n;
};
function parseWellnessBody(b: any) {
  const out: Record<string, any> = {};
  for (const i of WELLNESS_ITEMS) out[i.key] = score1to5(b?.[i.key]);
  const sh = b?.sleepHours;
  out.sleep_hours = sh == null || sh === "" ? null : Number(sh);
  if (out.sleep_hours != null && (!Number.isFinite(out.sleep_hours) || out.sleep_hours < 0 || out.sleep_hours > 16)) throw Object.assign(new Error("bad"), { status: 400, msg: "Sleep hours must be between 0 and 16." });
  const areas = Array.isArray(b?.soreAreas) ? b.soreAreas.map(String) : [];
  out.sore_areas = areas.filter((a: string) => (SORE_AREAS as readonly string[]).includes(a));
  out.note = typeof b?.note === "string" && b.note.trim() ? b.note.trim().slice(0, 1000) : null;
  out.medical_flag = b?.medicalFlag == null ? null : !!b.medicalFlag;
  if (WELLNESS_ITEMS.every((i) => out[i.key] == null) && out.sleep_hours == null) throw Object.assign(new Error("bad"), { status: 400, msg: "Answer at least one question." });
  return out;
}
function parseRpeBody(b: any) {
  const rpe = Number(b?.rpe);
  if (!Number.isInteger(rpe) || rpe < 0 || rpe > 10) throw Object.assign(new Error("bad"), { status: 400, msg: "Effort is 0 to 10." });
  const kind = ["training", "match", "gym", "other"].includes(b?.kind) ? b.kind : null;
  if (!kind) throw Object.assign(new Error("bad"), { status: 400, msg: "Choose training, match, gym or other." });
  const m = b?.minutes == null || b.minutes === "" ? null : Number(b.minutes);
  if (m != null && (!Number.isInteger(m) || m < 1 || m > 300)) throw Object.assign(new Error("bad"), { status: 400, msg: "Minutes must be between 1 and 300." });
  return { rpe, kind, minutes: m, note: typeof b?.note === "string" && b.note.trim() ? b.note.trim().slice(0, 500) : null };
}
const badRequest = (res: Response, e: any) => res.status(e?.status ?? 400).json({ message: e?.msg ?? "That doesn't look right." });

// ─────────────────────────────────────────────────────────────────────────────

export function registerPerformanceRoutes(app: Express) {
  const gate = [requireAuth, requirePerformance] as const;

  // ── catalogue ──────────────────────────────────────────────────────────────
  app.get(`${BASE}/catalogue`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const last = await q(`select source, max(observed_on) last, count(*)::int n from perf_metric_values where organization_id = $1 group by 1`, [v.org]);
    const lastW = await one(`select max(date) last, count(*)::int n from perf_wellness where organization_id = $1`, [v.org]);
    const lastR = await one(`select max(date) last, count(*)::int n from perf_rpe where organization_id = $1`, [v.org]);
    const lastA = await one(`select max(started_on) last, count(*)::int n from perf_availability where organization_id = $1`, [v.org]);
    const lastT = await one(`select max(r.tested_on) last, count(*)::int n from perf_test_results r join perf_tests t on t.id = r.test_id where t.organization_id = $1`, [v.org]);
    const lastM = await one(`select max(created_at) last, count(*)::int n from perf_media where organization_id = $1 and archived_at is null`, [v.org]);
    const bySource = new Map(last.map((r) => [r.source, { last: isoOf(r.last), readings: r.n }]));
    const special: Record<string, { last: string | null; readings: number }> = {
      wellness: { last: isoOf(lastW?.last), readings: lastW?.n ?? 0 },
      rpe: { last: isoOf(lastR?.last), readings: lastR?.n ?? 0 },
      availability: { last: isoOf(lastA?.last), readings: lastA?.n ?? 0 },
      testing: { last: isoOf(lastT?.last), readings: lastT?.n ?? 0 },
      video: { last: lastM?.last ? new Date(lastM.last).toISOString().slice(0, 10) : null, readings: lastM?.n ?? 0 },
    };
    res.json({
      today: nzToday(),
      medical: v.medical,
      sources: DATA_SOURCES.map((s) => ({ ...s, ...(special[s.key] ?? bySource.get(s.key) ?? { last: null, readings: 0 }) })),
      metrics: METRICS, formulas: FORMULAS, wellnessItems: WELLNESS_ITEMS, soreAreas: SORE_AREAS,
    });
  }));

  // ── the board: everything about today, one request ─────────────────────────
  app.get(`${BASE}/overview`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const today = isIsoDate(req.query.date) ? (req.query.date as string) : nzToday();
    const players = await roster(v.org);
    const ids = players.map((p) => p.contactId);
    const from = addDays(today, -41);
    const [wellRows, spells, loads, accounts, latestGps, unlinked] = await Promise.all([
      ids.length ? q(`select * from perf_wellness where organization_id = $1 and contact_id = any($2::int[]) and date between $3 and $4`, [v.org, ids, addDays(today, -35), today]) : [],
      spellsFor(v.org, ids),
      loadsFor(v.org, ids, from, today),
      ids.length ? q(`select contact_id, password_hash is not null active, disabled_at, last_sign_in_at from perf_athlete_accounts where organization_id = $1 and contact_id = any($2::int[])`, [v.org, ids]) : [],
      ids.length ? q(`
        select distinct on (contact_id, metric_key) contact_id, metric_key, value, observed_on, source
        from perf_metric_values where organization_id = $1 and contact_id = any($2::int[]) and observed_on between $3 and $4
          and metric_key in ('total_distance_m','hsr_distance_m','sprint_distance_m','top_speed_kmh','player_load','recovery_pct','hrv_ms')
        order by contact_id, metric_key, observed_on desc`, [v.org, ids, addDays(today, -7), today]) : [],
      q(`select a.id, a.source, a.source_athlete_key, a.source_name, (select count(*)::int from perf_metric_values m where m.athlete_id = a.id) readings
         from perf_athletes a where a.organization_id = $1 and a.contact_id is null order by a.last_seen_at desc`, [v.org]),
    ]);
    const rpeToday = ids.length ? await q(`select contact_id, kind, rpe, minutes, date from perf_rpe where organization_id = $1 and contact_id = any($2::int[]) and date between $3 and $4`, [v.org, ids, addDays(today, -1), today]) : [];

    const out = players.map((p) => {
      const mine = wellRows.filter((w) => w.contact_id === p.contactId).map(toWellness);
      const todayW = mine.find((w) => w.date === today) ?? null;
      const flag = todayW ? wellnessFlag(todayW, mine) : null;
      const sp = spells.filter((s) => s.contact_id === p.contactId);
      const av = availabilityOn(sp.map((s) => ({ status: s.status, startedOn: isoOf(s.started_on)!, endedOn: isoOf(s.ended_on) })), today);
      const openSpell = sp.find((s) => isoOf(s.started_on)! <= today && (s.ended_on == null || isoOf(s.ended_on)! >= today));
      const l = loads.get(p.contactId)!;
      const ls = loadSummary(dailyLoads(l.rows, from, today), l.first, today);
      const acct = accounts.find((a) => a.contact_id === p.contactId);
      const gps: Record<string, { value: number; date: string; source: string }> = {};
      for (const g of latestGps.filter((g) => g.contact_id === p.contactId)) gps[g.metric_key] = { value: Number(g.value), date: isoOf(g.observed_on)!, source: g.source };
      return {
        ...p,
        availability: { state: av.state, since: av.since, expectedReturn: openSpell ? isoOf(openSpell.expected_return) : null, bodyArea: openSpell?.body_area ?? null },
        wellness: todayW ? {
          score: wellnessScore(todayW).score, flag: flag?.level ?? null, reasons: flag?.reasons ?? [],
          items: Object.fromEntries(WELLNESS_ITEMS.map((i) => [i.key, todayW[i.key]])), sleepHours: todayW.sleepHours,
          soreAreas: todayW.soreAreas, byAthlete: todayW.byAthlete,
          // 🔴 medical only
          medicalFlag: v.medical ? todayW.medicalFlag : undefined, note: v.medical ? todayW.note : undefined,
        } : null,
        rpe: rpeToday.filter((r) => r.contact_id === p.contactId).map((r) => ({ date: isoOf(r.date), kind: r.kind, rpe: r.rpe, minutes: r.minutes })),
        load: ls,
        readiness: readiness({ availability: av.state, wellness: flag, load: ls }),
        gps,
        account: acct ? (acct.disabled_at ? "disabled" : acct.active ? "active" : "invited") : "none",
        lastSignIn: acct?.last_sign_in_at ? new Date(acct.last_sign_in_at).toISOString() : null,
      };
    });
    res.json({
      today, medical: v.medical, players: out,
      counts: {
        squad: out.length,
        available: out.filter((p) => p.availability.state === "available").length,
        modified: out.filter((p) => p.availability.state === "modified").length,
        out: out.filter((p) => ["injured", "ill", "unavailable"].includes(p.availability.state)).length,
        checkedIn: out.filter((p) => p.wellness).length,
        flagged: out.filter((p) => p.wellness?.flag).length,
        accounts: out.filter((p) => p.account === "active").length,
      },
      unlinked,
    });
  }));

  // ── one player ─────────────────────────────────────────────────────────────
  app.get(`${BASE}/players/:contactId`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const id = Number(req.params.contactId);
    const today = nzToday();
    if (!Number.isInteger(id) || !(await onRoster(v.org, id))) return res.status(404).json({ message: "Not found" });
    const p = (await roster(v.org)).find((x) => x.contactId === id)!;
    const from = addDays(today, -83);
    const [well, spells, loads, rpe, values, tests, media, acct] = await Promise.all([
      q(`select * from perf_wellness where organization_id = $1 and contact_id = $2 and date >= $3 order by date desc`, [v.org, id, from]),
      spellsFor(v.org, [id]),
      loadsFor(v.org, [id], from, today),
      q(`select * from perf_rpe where organization_id = $1 and contact_id = $2 and date >= $3 order by date desc, kind`, [v.org, id, from]),
      q(`select metric_key, value, observed_on, source, session_id from perf_metric_values where organization_id = $1 and contact_id = $2 and observed_on >= $3 order by observed_on`, [v.org, id, addDays(today, -365)]),
      q(`select t.id test_id, t.name, t.unit, t.higher_is_better, t.band_red, t.band_green, r.value, r.tested_on, r.notes
         from perf_test_results r join perf_tests t on t.id = r.test_id where t.organization_id = $1 and r.contact_id = $2 order by r.tested_on desc`, [v.org, id]),
      q(`select id, title, url, source, clip_date, tags, start_seconds, note from perf_media where organization_id = $1 and archived_at is null and $2 = any(contact_ids) order by clip_date desc nulls last, id desc limit 50`, [v.org, id]),
      one(`select email, password_hash is not null active, disabled_at, invited_at, last_sign_in_at from perf_athlete_accounts where organization_id = $1 and contact_id = $2`, [v.org, id]),
    ]);
    const wRows = well.map(toWellness);
    const l = loads.get(id)!;
    const series = dailyLoads(l.rows, from, today);
    const spellList = spells.map((s) => spellOut(s, v.medical));
    const av = availabilityOn(spellList as AvailabilitySpell[], today);
    const todayW = wRows.find((w) => w.date === today) ?? null;
    const flag = todayW ? wellnessFlag(todayW, wRows) : null;
    const ls = loadSummary(series, l.first, today);
    // Every metric's history, grouped — the one dashboard every source feeds.
    const metrics: Record<string, { date: string; value: number; source: string }[]> = {};
    for (const r of values) (metrics[r.metric_key] ??= []).push({ date: isoOf(r.observed_on)!, value: Number(r.value), source: r.source });
    res.json({
      today, medical: v.medical, player: p,
      availability: { state: av.state, since: av.since, spells: spellList, daysLost: daysLost(spellList as AvailabilitySpell[], today) },
      readiness: readiness({ availability: av.state, wellness: flag, load: ls }),
      wellness: wRows.map((w) => ({
        ...w, score: wellnessScore(w).score, flag: wellnessFlag(w, wRows).level,
        medicalFlag: v.medical ? w.medicalFlag : undefined, note: v.medical ? w.note : undefined,
      })),
      rpe: rpe.map((r) => ({ id: r.id, date: isoOf(r.date), kind: r.kind, rpe: r.rpe, minutes: r.minutes, load: sessionLoad({ date: "", rpe: r.rpe, minutes: r.minutes }), byAthlete: r.entered_by_athlete })),
      load: { summary: ls, series: series.slice(-42) },
      metrics,
      tests: tests.map((t) => ({ testId: t.test_id, name: t.name, unit: t.unit, higherIsBetter: t.higher_is_better, bandRed: num(t.band_red), bandGreen: num(t.band_green), value: Number(t.value), date: isoOf(t.tested_on), notes: t.notes })),
      media: media.map((m) => ({ ...m, clip_date: isoOf(m.clip_date) })),
      account: acct ? { email: acct.email, state: acct.disabled_at ? "disabled" : acct.active ? "active" : "invited", invitedAt: acct.invited_at, lastSignIn: acct.last_sign_in_at } : null,
    });
  }));

  // ── staff entry of a check-in / RPE (for a player without a phone) ─────────
  app.post(`${BASE}/wellness`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const id = Number(req.body?.contactId);
    const date = isIsoDate(req.body?.date) ? req.body.date : nzToday();
    if (!(await onRoster(v.org, id))) return res.status(404).json({ message: "That player is not on the squad." });
    let w; try { w = parseWellnessBody(req.body); } catch (e) { return badRequest(res, e); }
    await pool.query(`
      insert into perf_wellness (organization_id, contact_id, date, sleep, fatigue, soreness, stress, mood, sleep_hours, sore_areas, note, medical_flag, entered_by, entered_by_athlete)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false)
      on conflict (contact_id, date) do update set sleep=excluded.sleep, fatigue=excluded.fatigue, soreness=excluded.soreness, stress=excluded.stress,
        mood=excluded.mood, sleep_hours=excluded.sleep_hours, sore_areas=excluded.sore_areas, note=excluded.note, medical_flag=excluded.medical_flag,
        entered_by=excluded.entered_by, entered_by_athlete=false, entered_at=now()`,
      [v.org, id, date, w.sleep, w.fatigue, w.soreness, w.stress, w.mood, w.sleep_hours, w.sore_areas, w.note, w.medical_flag, v.userId]);
    res.json({ ok: true });
  }));

  app.post(`${BASE}/rpe`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const ids: number[] = Array.isArray(req.body?.contactIds) ? req.body.contactIds.map(Number) : [Number(req.body?.contactId)];
    const date = isIsoDate(req.body?.date) ? req.body.date : nzToday();
    let r; try { r = parseRpeBody(req.body); } catch (e) { return badRequest(res, e); }
    let written = 0;
    for (const id of ids) {
      if (!(await onRoster(v.org, id))) continue;
      await pool.query(`
        insert into perf_rpe (organization_id, contact_id, date, kind, rpe, minutes, note, entered_by, entered_by_athlete)
        values ($1,$2,$3,$4,$5,$6,$7,$8,false)
        on conflict (contact_id, date, kind) do update set rpe=excluded.rpe, minutes=excluded.minutes, note=excluded.note, entered_by=excluded.entered_by, entered_by_athlete=false, entered_at=now()`,
        [v.org, id, date, r.kind, r.rpe, r.minutes, r.note, v.userId]);
      written++;
    }
    res.json({ ok: true, written });
  }));

  // ── availability ───────────────────────────────────────────────────────────
  app.get(`${BASE}/availability`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const players = await roster(v.org);
    const spells = await spellsFor(v.org, players.map((p) => p.contactId));
    const today = nzToday();
    res.json({
      today, medical: v.medical,
      spells: spells.map((s) => ({ ...spellOut(s, v.medical), player: players.find((p) => p.contactId === s.contact_id)?.name ?? null })),
      daysLost: players.map((p) => ({
        contactId: p.contactId, name: p.name,
        days: daysLost(spells.filter((s) => s.contact_id === p.contactId).map((s) => ({ status: s.status, startedOn: isoOf(s.started_on)!, endedOn: isoOf(s.ended_on) })), today),
      })).filter((d) => d.days > 0).sort((a, b) => b.days - a.days),
    });
  }));

  app.post(`${BASE}/availability`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const b = req.body ?? {};
    const id = Number(b.contactId);
    if (!(await onRoster(v.org, id))) return res.status(404).json({ message: "That player is not on the squad." });
    if (!["injured", "ill", "modified", "unavailable"].includes(b.status)) return res.status(400).json({ message: "Choose a status." });
    if (!isIsoDate(b.startedOn)) return res.status(400).json({ message: "Choose the date it started." });
    if (b.endedOn != null && b.endedOn !== "" && (!isIsoDate(b.endedOn) || b.endedOn < b.startedOn)) return res.status(400).json({ message: "The end date must be on or after the start." });
    if (b.notes && !v.medical) return res.status(403).json({ message: "Only medical staff can write clinical notes." });
    const r = await one(`
      insert into perf_availability (organization_id, contact_id, status, started_on, ended_on, expected_return, reason, body_area, notes, recorded_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [v.org, id, b.status, b.startedOn, b.endedOn || null, isIsoDate(b.expectedReturn) ? b.expectedReturn : null,
        (b.reason || "").trim().slice(0, 200) || null, (b.bodyArea || "").trim().slice(0, 80) || null, v.medical ? (b.notes || "").trim() || null : null, v.userId]);
    res.json({ ok: true, id: r!.id });
  }));

  app.patch(`${BASE}/availability/:id`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const cur = await one(`select * from perf_availability where id = $1 and organization_id = $2`, [Number(req.params.id), v.org]);
    if (!cur) return res.status(404).json({ message: "Not found" });
    const b = req.body ?? {};
    const sets: string[] = [], vals: unknown[] = [];
    const set = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if ("status" in b) { if (!["injured", "ill", "modified", "unavailable"].includes(b.status)) return res.status(400).json({ message: "Choose a status." }); set("status", b.status); }
    if ("endedOn" in b) {
      if (b.endedOn && (!isIsoDate(b.endedOn) || b.endedOn < isoOf(cur.started_on)!)) return res.status(400).json({ message: "The end date must be on or after the start." });
      set("ended_on", b.endedOn || null);
    }
    if ("expectedReturn" in b) set("expected_return", isIsoDate(b.expectedReturn) ? b.expectedReturn : null);
    if ("reason" in b) set("reason", (b.reason || "").trim().slice(0, 200) || null);
    if ("bodyArea" in b) set("body_area", (b.bodyArea || "").trim().slice(0, 80) || null);
    if ("notes" in b) { if (!v.medical) return res.status(403).json({ message: "Only medical staff can write clinical notes." }); set("notes", (b.notes || "").trim() || null); }
    if (!sets.length) return res.json({ ok: true });
    vals.push(cur.id);
    await pool.query(`update perf_availability set ${sets.join(", ")}, updated_at = now() where id = $${vals.length}`, vals);
    res.json({ ok: true });
  }));

  // ── testing ────────────────────────────────────────────────────────────────
  app.get(`${BASE}/tests`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const tests = await q(`select * from perf_tests where organization_id = $1 order by name`, [v.org]);
    const results = await q(`select r.*, c.first_name, c.last_name from perf_test_results r join perf_tests t on t.id = r.test_id join contacts c on c.id = r.contact_id
                             where t.organization_id = $1 order by r.tested_on desc`, [v.org]);
    res.json({
      tests: tests.map((t) => ({ id: t.id, name: t.name, unit: t.unit, higherIsBetter: t.higher_is_better, bandRed: num(t.band_red), bandGreen: num(t.band_green) })),
      results: results.map((r) => ({ id: r.id, testId: r.test_id, contactId: r.contact_id, name: nameOf(r), value: Number(r.value), date: isoOf(r.tested_on), notes: r.notes })),
    });
  }));

  app.post(`${BASE}/tests`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const b = req.body ?? {};
    const name = String(b.name || "").trim().slice(0, 80);
    if (!name) return res.status(400).json({ message: "Name the test." });
    if (typeof b.higherIsBetter !== "boolean") return res.status(400).json({ message: "Say whether higher is better." });
    const band = (x: unknown) => (x == null || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);
    const r = await one(`insert into perf_tests (organization_id, name, unit, higher_is_better, band_red, band_green, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [v.org, name, String(b.unit || "").trim().slice(0, 20) || null, b.higherIsBetter, band(b.bandRed), band(b.bandGreen), v.userId]);
    res.json({ ok: true, id: r!.id });
  }));

  app.post(`${BASE}/tests/:id/results`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const t = await one(`select id from perf_tests where id = $1 and organization_id = $2`, [Number(req.params.id), v.org]);
    if (!t) return res.status(404).json({ message: "Not found" });
    const date = req.body?.date;
    if (!isIsoDate(date)) return res.status(400).json({ message: "Choose the test date." });
    const rows: { contactId: number; value: unknown }[] = Array.isArray(req.body?.results) ? req.body.results : [];
    let written = 0;
    for (const r of rows) {
      if (r.value == null || r.value === "") continue;          // blank = not tested, never 0
      const value = Number(r.value);
      if (!Number.isFinite(value) || !(await onRoster(v.org, Number(r.contactId)))) continue;
      await pool.query(`insert into perf_test_results (test_id, contact_id, tested_on, value, entered_by) values ($1,$2,$3,$4,$5)
                        on conflict (test_id, contact_id, tested_on) do update set value = excluded.value, entered_by = excluded.entered_by, entered_at = now()`,
        [t.id, Number(r.contactId), date, value, v.userId]);
      written++;
    }
    res.json({ ok: true, written });
  }));

  // ── imports: preview, then save ────────────────────────────────────────────
  const readImport = (req: Request) => {
    const b = req.body ?? {};
    const source = String(b.source || "");
    if (!sourceByKey(source) || ["wellness", "rpe", "availability", "video"].includes(source)) throw Object.assign(new Error("bad"), { status: 400, msg: "Choose where the file came from." });
    const csv = String(b.csv || "");
    if (!csv.trim()) throw Object.assign(new Error("bad"), { status: 400, msg: "The file is empty." });
    if (Buffer.byteLength(csv) > 5 * 1024 * 1024) throw Object.assign(new Error("bad"), { status: 413, msg: "That file is over 5 MB — export the session summary, not the raw 10 Hz data." });
    const fallbackDate = isIsoDate(b.date) ? b.date : null;
    const mapping = b.mapping && typeof b.mapping === "object" ? b.mapping : undefined;
    return { source, csv, fallbackDate, mapping, filename: typeof b.filename === "string" ? b.filename.slice(0, 200) : null };
  };

  async function linksFor(org: number, source: string, names: string[]) {
    const players = await roster(org);
    const known = names.length ? await q(`select id, source_athlete_key, contact_id from perf_athletes where organization_id = $1 and source = $2 and source_athlete_key = any($3::text[])`, [org, source, names]) : [];
    return names.map((n) => {
      const k = known.find((a) => a.source_athlete_key === n);
      if (k?.contact_id) return { player: n, contactId: k.contact_id, how: "linked before" as const };
      // A FULL-NAME or email match is offered as a suggestion; initials never are.
      const lc = n.toLowerCase();
      const exact = players.filter((p) => p.name.toLowerCase() === lc || (p.email && p.email.toLowerCase() === lc));
      return { player: n, contactId: exact.length === 1 ? exact[0].contactId : null, how: exact.length === 1 ? ("same name" as const) : ("needs linking" as const) };
    });
  }

  app.post(`${BASE}/imports/preview`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    let input; try { input = readImport(req); } catch (e) { return badRequest(res, e); }
    const plan = planImport(parseCsv(input.csv), { source: input.source, fallbackDate: input.fallbackDate, mapping: input.mapping });
    const sha = sha256(input.csv);
    const dupe = await one(`select i.uploaded_at, u.first_name, u.last_name from perf_imports i left join users u on u.id = i.uploaded_by where i.organization_id = $1 and i.sha256 = $2`, [v.org, sha]);
    const names = Array.from(new Set(plan.rows.map((r) => r.player)));
    res.json({
      plan: { ...plan, rows: plan.rows.slice(0, 200) }, totalRows: plan.rows.length,
      links: await linksFor(v.org, input.source, names),
      squad: (await roster(v.org)).map((p) => ({ contactId: p.contactId, name: p.name })),
      duplicate: dupe ? { at: dupe.uploaded_at, by: nameOf(dupe) } : null,
    });
  }));

  app.post(`${BASE}/imports`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    let input; try { input = readImport(req); } catch (e) { return badRequest(res, e); }
    const plan = planImport(parseCsv(input.csv), { source: input.source, fallbackDate: input.fallbackDate, mapping: input.mapping });
    if (plan.problems.length) return res.status(400).json({ message: plan.problems[0], problems: plan.problems });
    if (plan.rows.some((r) => !r.date)) return res.status(400).json({ message: "Some rows have no date. Choose the session date." });
    const sha = sha256(input.csv);
    const links: Record<string, number | null> = req.body?.links && typeof req.body.links === "object" ? req.body.links : {};
    const squad = new Set((await roster(v.org)).map((p) => p.contactId));
    const client = await pool.connect();
    try {
      await client.query("begin");
      const dupe = await client.query(`select id from perf_imports where organization_id = $1 and sha256 = $2`, [v.org, sha]);
      if (dupe.rowCount) { await client.query("rollback"); return res.json({ ok: true, duplicate: true, written: 0 }); }
      const { rows: [imp] } = await client.query(
        `insert into perf_imports (organization_id, source, filename, sha256, bytes, rows_read, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [v.org, input.source, input.filename, sha, Buffer.from(input.csv), plan.rows.length, v.userId]);
      const athleteIds = new Map<string, { id: number; contactId: number | null }>();
      for (const name of Array.from(new Set(plan.rows.map((r) => r.player)))) {
        const chosen = links[name];
        const contactId = chosen != null && squad.has(Number(chosen)) ? Number(chosen) : null;
        const { rows: [a] } = await client.query(`
          insert into perf_athletes (organization_id, source, source_athlete_key, source_name, contact_id, linked_by, linked_at)
          values ($1,$2,$3,$3,$4,$5,case when $4::int is null then null else now() end)
          on conflict (organization_id, source, source_athlete_key) do update set last_seen_at = now(),
            contact_id = coalesce(perf_athletes.contact_id, excluded.contact_id),
            linked_by = coalesce(perf_athletes.linked_by, excluded.linked_by),
            linked_at = coalesce(perf_athletes.linked_at, excluded.linked_at)
          returning id, contact_id`, [v.org, input.source, name, contactId, contactId ? v.userId : null]);
        athleteIds.set(name, { id: a.id, contactId: a.contact_id });
      }
      // One session per (date, session name) for GPS-shaped sources.
      const sessionIds = new Map<string, number>();
      let written = 0;
      for (const r of plan.rows) {
        const sKey = `${r.date}|${r.session ?? ""}`;
        let sessionId = sessionIds.get(sKey);
        if (sessionId == null) {
          const { rows: [s] } = await client.query(`
            insert into perf_sessions (organization_id, source, external_key, session_date, name)
            values ($1,$2,$3,$4,$5)
            on conflict (organization_id, source, external_key) do update set last_synced_at = now() returning id`,
            [v.org, input.source, sKey, r.date, r.session]);
          sessionId = s.id;
          sessionIds.set(sKey, sessionId!);
        }
        const a = athleteIds.get(r.player)!;
        for (const [metric, value] of Object.entries(r.values)) {
          await client.query(`
            insert into perf_metric_values (organization_id, contact_id, athlete_id, observed_on, metric_key, value, source, external_key, session_id, import_id, entered_by)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            on conflict (organization_id, source, external_key, metric_key) do update set value = excluded.value, contact_id = coalesce(excluded.contact_id, perf_metric_values.contact_id),
              import_id = excluded.import_id, updated_at = now()`,
            [v.org, a.contactId, a.id, r.date, metric, value, input.source, `${sKey}|${r.player}`, sessionId, imp.id, v.userId]);
          written++;
        }
      }
      await client.query(`update perf_sessions s set player_count = (select count(distinct athlete_id) from perf_metric_values m where m.session_id = s.id) where s.id = any($1::int[])`, [Array.from(sessionIds.values())]);
      await client.query(`update perf_imports set values_written = $1 where id = $2`, [written, imp.id]);
      await client.query("commit");
      res.json({ ok: true, written, sessions: sessionIds.size, importId: imp.id });
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally { client.release(); }
  }));

  app.get(`${BASE}/imports`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const rows = await q(`select i.id, i.source, i.filename, i.rows_read, i.values_written, i.uploaded_at, u.first_name, u.last_name
                          from perf_imports i left join users u on u.id = i.uploaded_by where i.organization_id = $1 order by i.uploaded_at desc limit 50`, [v.org]);
    res.json({ imports: rows.map((r) => ({ id: r.id, source: r.source, filename: r.filename, rows: r.rows_read, values: r.values_written, at: r.uploaded_at, by: nameOf(r) })) });
  }));

  // Link a source identity ("HH") to a player — attaches all its history.
  app.post(`${BASE}/athletes/:id/link`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const contactId = Number(req.body?.contactId);
    if (!(await onRoster(v.org, contactId))) return res.status(400).json({ message: "Choose a player on the squad." });
    const a = await one(`update perf_athletes set contact_id = $1, linked_by = $2, linked_at = now() where id = $3 and organization_id = $4 and contact_id is null returning id`, [contactId, v.userId, Number(req.params.id), v.org]);
    if (!a) return res.status(404).json({ message: "Not found, or already linked." });
    const r = await pool.query(`update perf_metric_values set contact_id = $1, updated_at = now() where athlete_id = $2 and contact_id is null`, [contactId, a.id]);
    res.json({ ok: true, attached: r.rowCount });
  }));

  // ── video ──────────────────────────────────────────────────────────────────
  app.get(`${BASE}/media`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const rows = await q(`select * from perf_media where organization_id = $1 and archived_at is null order by clip_date desc nulls last, id desc limit 200`, [v.org]);
    res.json({ media: rows.map((m) => ({ id: m.id, title: m.title, url: m.url, source: m.source, clipDate: isoOf(m.clip_date), contactIds: m.contact_ids, tags: m.tags, startSeconds: m.start_seconds, note: m.note })) });
  }));

  app.post(`${BASE}/media`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const b = req.body ?? {};
    let url: URL;
    try { url = new URL(String(b.url || "")); } catch { return res.status(400).json({ message: "Paste the clip's full link." }); }
    if (url.protocol !== "https:") return res.status(400).json({ message: "The link must start with https://" });
    const title = String(b.title || "").trim().slice(0, 140);
    if (!title) return res.status(400).json({ message: "Give the clip a title." });
    const host = url.hostname.replace(/^www\./, "");
    const source = /spiideo/.test(host) ? "spiideo" : /veo/.test(host) ? "veo" : /hudl/.test(host) ? "hudl" : /wyscout/.test(host) ? "wyscout" : /youtu/.test(host) ? "youtube" : /vimeo/.test(host) ? "vimeo" : "other";
    const squad = new Set((await roster(v.org)).map((p) => p.contactId));
    const ids = (Array.isArray(b.contactIds) ? b.contactIds : []).map(Number).filter((n: number) => squad.has(n));
    const tags = (Array.isArray(b.tags) ? b.tags : []).map((t: unknown) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 10);
    const start = b.startSeconds == null || b.startSeconds === "" ? null : Math.max(0, Math.floor(Number(b.startSeconds)));
    const r = await one(`insert into perf_media (organization_id, title, url, source, clip_date, contact_ids, tags, start_seconds, note, created_by)
                         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [v.org, title, url.toString(), source, isIsoDate(b.clipDate) ? b.clipDate : null, ids, tags, Number.isFinite(start) ? start : null, (b.note || "").trim().slice(0, 500) || null, v.userId]);
    res.json({ ok: true, id: r!.id });
  }));

  app.delete(`${BASE}/media/:id`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    await pool.query(`update perf_media set archived_at = now() where id = $1 and organization_id = $2`, [Number(req.params.id), v.org]);
    res.json({ ok: true });
  }));

  // ── player accounts ────────────────────────────────────────────────────────
  app.post(`${BASE}/players/:contactId/invite`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const id = Number(req.params.contactId);
    if (!(await onRoster(v.org, id))) return res.status(404).json({ message: "Not found" });
    const c = await one(`select first_name, email from contacts where id = $1`, [id]);
    const email = String(req.body?.email || c?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "This player needs an email address first." });
    const clash = await one(`select contact_id from perf_athlete_accounts where lower(email) = $1 and contact_id <> $2`, [email, id]);
    if (clash) return res.status(409).json({ message: "Another player already uses that email." });
    const acct = await one(`
      insert into perf_athlete_accounts (organization_id, contact_id, email, invited_by) values ($1,$2,$3,$4)
      on conflict (organization_id, contact_id) do update set email = excluded.email, disabled_at = null, invited_at = now(), updated_at = now()
      returning id, password_hash`, [v.org, id, email, v.userId]);
    const sent = await sendLink(acct!.id, email, c?.first_name ?? null, acct!.password_hash ? "reset" : "set");
    res.json({ ok: true, emailed: sent });
  }));

  app.post(`${BASE}/players/:contactId/disable`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const a = await one(`update perf_athlete_accounts set disabled_at = now(), updated_at = now() where organization_id = $1 and contact_id = $2 returning id`, [v.org, Number(req.params.contactId)]);
    if (a) await pool.query(`update perf_athlete_sessions set revoked_at = now() where account_id = $1 and revoked_at is null`, [a.id]);
    res.json({ ok: true });
  }));

  // ════════════════════════════════════════════════════════════════════════
  // The player's phone
  // ════════════════════════════════════════════════════════════════════════

  app.post(`${PUB}/sign-in`, async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      if (await rateLimited(req, email)) {
        await audit(req, { email, action: "sign_in", ok: false, reason: "rate_limited" });
        return res.status(429).json({ message: "Too many attempts. Wait a few minutes and try again." });
      }
      const a = await one(`select id, password_hash, disabled_at, contact_id, organization_id from perf_athlete_accounts where lower(email) = $1`, [email]);
      const good = verifyPassword(password, a?.password_hash ?? null);
      const listed = a ? await onRoster(a.organization_id, a.contact_id) : false;
      if (!a || a.disabled_at || !good || !listed) {
        await audit(req, { email, accountId: a?.id, action: "sign_in", ok: false, reason: !a ? "no_account" : a.disabled_at ? "disabled" : !good ? "bad_password" : "off_roster" });
        return res.status(401).json({ message: SIGNIN_FAILED });
      }
      const { token, hash } = newToken();
      await pool.query(`insert into perf_athlete_sessions (account_id, token_hash, expires_at, ip, user_agent) values ($1,$2,$3,$4,$5)`,
        [a.id, hash, new Date(Date.now() + SESSION_TTL_MS), ipOf(req), uaOf(req)]);
      await pool.query(`update perf_athlete_accounts set last_sign_in_at = now() where id = $1`, [a.id]);
      setCookie(res, token);
      await audit(req, { email, accountId: a.id, action: "sign_in", ok: true });
      res.json({ ok: true });
    } catch (e) { console.error("[athlete] sign-in", e); res.status(500).json({ message: "Could not sign in. Try again." }); }
  });

  app.post(`${PUB}/request-link`, async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      if (await rateLimited(req, email)) return res.json({ message: LINK_SENT });
      const a = await one(`select a.id, a.disabled_at, c.first_name, a.password_hash from perf_athlete_accounts a join contacts c on c.id = a.contact_id where lower(a.email) = $1`, [email]);
      if (!a || a.disabled_at) { await audit(req, { email, action: "request_link", ok: false, reason: a ? "disabled" : "no_account" }); return res.json({ message: LINK_SENT }); }
      await sendLink(a.id, email, a.first_name, a.password_hash ? "reset" : "set");
      await audit(req, { email, accountId: a.id, action: "request_link", ok: true });
      res.json({ message: LINK_SENT });
    } catch (e) { console.error("[athlete] request-link", e); res.json({ message: LINK_SENT }); }
  });

  app.post(`${PUB}/set-password`, async (req, res) => {
    try {
      const token = String(req.body?.token || "");
      const password = String(req.body?.password || "");
      if (password.length < MIN_PASSWORD) return res.status(400).json({ message: `Your password needs at least ${MIN_PASSWORD} characters.` });
      // 🔴 Spend the token atomically FIRST.
      const t = await one(`update perf_athlete_tokens set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning account_id`, [sha256(token)]);
      if (!t) { await audit(req, { action: "set_password", ok: false, reason: "bad_token" }); return res.status(400).json({ message: "That link has expired or has already been used. Ask for a new one." }); }
      const a = await one(`select id, email, disabled_at from perf_athlete_accounts where id = $1`, [t.account_id]);
      if (!a || a.disabled_at) return res.status(400).json({ message: "That link has expired or has already been used. Ask for a new one." });
      await pool.query(`update perf_athlete_accounts set password_hash = $1, updated_at = now() where id = $2`, [hashPassword(password), a.id]);
      await pool.query(`update perf_athlete_sessions set revoked_at = now() where account_id = $1 and revoked_at is null`, [a.id]);
      const { token: st, hash } = newToken();
      await pool.query(`insert into perf_athlete_sessions (account_id, token_hash, expires_at, ip, user_agent) values ($1,$2,$3,$4,$5)`,
        [a.id, hash, new Date(Date.now() + SESSION_TTL_MS), ipOf(req), uaOf(req)]);
      setCookie(res, st);
      await audit(req, { email: a.email, accountId: a.id, action: "set_password", ok: true });
      res.json({ ok: true });
    } catch (e) { console.error("[athlete] set-password", e); res.status(500).json({ message: "Could not set your password. Try again." }); }
  });

  app.post(`${PUB}/sign-out`, async (req, res) => {
    const token = cookieFrom(req);
    if (token) await pool.query(`update perf_athlete_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null`, [sha256(token)]).catch(() => {});
    clearCookie(res);
    res.json({ ok: true });
  });

  app.get(`${PUB}/me`, requireAthlete, async (req, res) => {
    try {
      const a = athleteOf(req);
      const today = nzToday();
      const [w, r, spells, pos] = await Promise.all([
        q(`select * from perf_wellness where contact_id = $1 and organization_id = $2 and date >= $3 order by date desc`, [a.contactId, a.org, addDays(today, -27)]),
        q(`select date, kind, rpe, minutes from perf_rpe where contact_id = $1 and organization_id = $2 and date >= $3 order by date desc`, [a.contactId, a.org, addDays(today, -27)]),
        q(`select status, started_on, ended_on, expected_return from perf_availability where contact_id = $1 and organization_id = $2`, [a.contactId, a.org]),
        one(`select m.position from club_squad_members m join club_squads s on s.id = m.squad_id where s.organization_id = $1 and m.contact_id = $2 and m.left_at is null limit 1`, [a.org, a.contactId]),
      ]);
      const wRows = w.map(toWellness);
      const av = availabilityOn(spells.map((s) => ({ status: s.status, startedOn: isoOf(s.started_on)!, endedOn: isoOf(s.ended_on) })), today);
      res.json({
        today, firstName: a.firstName, lastName: a.lastName, position: pos?.position ?? null,
        availability: av.state,
        todayCheckIn: wRows.find((x) => x.date === today) ?? null,
        // A player sees their OWN answers, including their own note.
        history: wRows.map((x) => ({ date: x.date, score: wellnessScore(x).score, sleepHours: x.sleepHours })),
        rpe: r.map((x) => ({ date: isoOf(x.date), kind: x.kind, rpe: x.rpe, minutes: x.minutes })),
        items: WELLNESS_ITEMS, soreAreas: SORE_AREAS,
        streak: (() => { let n = 0; for (let d = today; wRows.some((x) => x.date === d); d = addDays(d, -1)) n++; return n; })(),
      });
    } catch (e) { console.error("[athlete] me", e); res.status(500).json({ message: "Could not load your check-in." }); }
  });

  app.post(`${PUB}/wellness`, requireAthlete, async (req, res) => {
    try {
      const a = athleteOf(req);
      let w; try { w = parseWellnessBody(req.body); } catch (e) { return badRequest(res, e); }
      // 🔴 Today only, decided by the server's NZ clock.
      await pool.query(`
        insert into perf_wellness (organization_id, contact_id, date, sleep, fatigue, soreness, stress, mood, sleep_hours, sore_areas, note, medical_flag, entered_by, entered_by_athlete)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,null,true)
        on conflict (contact_id, date) do update set sleep=excluded.sleep, fatigue=excluded.fatigue, soreness=excluded.soreness, stress=excluded.stress,
          mood=excluded.mood, sleep_hours=excluded.sleep_hours, sore_areas=excluded.sore_areas, note=excluded.note, medical_flag=excluded.medical_flag,
          entered_by=null, entered_by_athlete=true, entered_at=now()`,
        [a.org, a.contactId, nzToday(), w.sleep, w.fatigue, w.soreness, w.stress, w.mood, w.sleep_hours, w.sore_areas, w.note, w.medical_flag]);
      res.json({ ok: true });
    } catch (e) { console.error("[athlete] wellness", e); res.status(500).json({ message: "Could not save. Try again." }); }
  });

  app.post(`${PUB}/rpe`, requireAthlete, async (req, res) => {
    try {
      const a = athleteOf(req);
      let r; try { r = parseRpeBody(req.body); } catch (e) { return badRequest(res, e); }
      const today = nzToday();
      const date = req.body?.date === addDays(today, -1) ? addDays(today, -1) : today;   // today or yesterday, nothing else
      await pool.query(`
        insert into perf_rpe (organization_id, contact_id, date, kind, rpe, minutes, note, entered_by, entered_by_athlete)
        values ($1,$2,$3,$4,$5,$6,$7,null,true)
        on conflict (contact_id, date, kind) do update set rpe=excluded.rpe, minutes=excluded.minutes, note=excluded.note, entered_by=null, entered_by_athlete=true, entered_at=now()`,
        [a.org, a.contactId, date, r.kind, r.rpe, r.minutes, r.note]);
      res.json({ ok: true });
    } catch (e) { console.error("[athlete] rpe", e); res.status(500).json({ message: "Could not save. Try again." }); }
  });
}

// Exported for the verifiers.
export const __test = { hashPassword, verifyPassword, sha256 };
export { metricByKey };

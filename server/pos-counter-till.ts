// ─────────────────────────────────────────────────────────────────────────────
// The counter reader as a TILL (Daniel, 2026-10-31).
//
// "do the whole process off the eftpos machine and have it logged to ClubOS
// without needing phone or laptop or iPad … pick and search items on the touch
// screen … quickly choose existing player or type in and enter new player."
//
// The S710 already runs our app and takes cards. Until now it could only show
// a sale a laptop built. Now a staff member unlocks it with their own PIN and
// builds the sale on it; the card is taken on the same device.
//
//   Device (paired, see pos-counter.ts) — everything below also needs a PIN
//   GET    /api/public/pos/counter/till/staff         who can unlock this reader
//   POST   /api/public/pos/counter/till/unlock        { userId, pin }
//   POST   /api/public/pos/counter/till/lock
//   GET    /api/public/pos/counter/till/me
//   GET    /api/public/pos/counter/till/catalogue     ?q=
//   GET    /api/public/pos/counter/till/sale          the sale being built (or null)
//   POST   /api/public/pos/counter/till/sale/lines    { variantId, qty }
//   PATCH  /api/public/pos/counter/till/sale/lines/:lineId   { qty }
//   DELETE /api/public/pos/counter/till/sale/lines/:lineId
//   POST   /api/public/pos/counter/till/sale/charge   card on THIS reader
//   POST   /api/public/pos/counter/till/sale/payments/:pid/cancel
//   POST   /api/public/pos/counter/till/sale/void
//   POST   /api/public/pos/counter/till/sale/next     clear a paid sale off the reader
//   GET    /api/public/pos/counter/till/people        ?q= (Contacts access only)
//   GET    /api/public/pos/counter/till/quote         ?programId&programOptionId&termId&priceMode
//   POST   /api/public/pos/counter/till/registrations a player into a programme, added to the sale
//
//   Staff (signed in to ClubOS)
//   GET    /api/admin/pos/my-counter-pin              has one?
//   PUT    /api/admin/pos/my-counter-pin              { pin }
//
// 🔴 ONE implementation of every rule. Sales, lines, the card and the
// registration all run the laptop's OWN handlers (posHandlers in pos-routes.ts,
// officeRegistration in routes.ts) with the PIN's person as the signed-in
// user — nothing here prices, totals or confirms anything itself.
// 🔴 A device is still not a person. The PIN names the person for one sale at a
// time; the reader re-locks after TILL_IDLE_MINUTES. Every unlock, wrong PIN
// and lock is logged to pos_counter_events.
// 🔴 The person is re-checked on EVERY request — still active, still holds the
// POS tab — so removing someone's access bites on their next tap.
// 🔴 A shared screen at a public counter shows no parent email or phone and no
// full date of birth. The server fills the registration from the family record
// it already holds; the reader only ever sends a person KEY.
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireTabAnywhere } from "./auth";
import { storage } from "./storage";
import { posCounterDevices, posRegisters, posSales, posShifts, posStaffPins, users, programs } from "@shared/schema";
import { canAccessTabAnywhere } from "@shared/tabs";
import { parsePersonKey, personKey } from "@shared/family";
import { ageGradeFor, nzTodayIso } from "@shared/academy";
import {
  TILL_IDLE_MINUTES, TILL_PIN_LOCK_MINUTES, TILL_PIN_MAX_FAILS, tillPinError,
  type TillMe, type TillPerson, type TillSale, type TillStaff,
} from "@shared/pos-counter-till";
import { requirePairedDevice, logEvent, showOnCounter, type DeviceReq } from "./pos-counter";
import { posHandlers, loadSale, readerAccountForRegister, moneyAccountForOrg } from "./pos-routes";
import { officeRegistration } from "./office-registration-handlers";
import { searchPeople, familySummaries, resolveFamily } from "./family-routes";

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ── PINs: the house scrypt scheme ────────────────────────────────────────────
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `s1$${salt}$${crypto.scryptSync(pin, salt, 64, SCRYPT).toString("hex")}`;
}
/** False for anything malformed — never true by default. */
function pinMatches(pin: string, stored: string | null | undefined): boolean {
  const [scheme, salt, hex] = String(stored ?? "").split("$");
  if (scheme !== "s1" || !salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  if (!expected.length) return false;
  const got = crypto.scryptSync(pin, salt, expected.length, SCRYPT);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

// ── Who may use the reader as a till ─────────────────────────────────────────
async function holdsTab(userId: number, tab: string): Promise<boolean> {
  const [u] = await db.select({ role: users.role, active: users.active }).from(users).where(eq(users.id, userId));
  if (!u || !u.active) return false;
  if (u.role === "super_admin") return true;
  const orgs = await storage.getUserOrganizations(userId);
  return canAccessTabAnywhere(u.role, orgs as any, tab);
}
function initialsOf(first: string, last: string) {
  return `${(first || "?").slice(0, 1)}${(last || "").slice(0, 1)}`.toUpperCase();
}
async function staffView(userId: number): Promise<TillStaff | null> {
  const [u] = await db.select({ id: users.id, f: users.firstName, l: users.lastName, a: users.avatarUrl }).from(users).where(eq(users.id, userId));
  if (!u) return null;
  return { id: u.id, name: [u.f, u.l].filter(Boolean).join(" "), initials: initialsOf(u.f, u.l), photo: u.a ?? null };
}

interface TillReq extends DeviceReq { tillUserId?: number }

/** Paired device + an unexpired PIN unlock + that person still holds POS. Slides the expiry. */
async function requireTill(req: TillReq, res: Response, next: NextFunction) {
  await requirePairedDevice(req, res, async () => {
    try {
      const d = req.counter!;
      if (!d.tillUserId || !d.tillUntil || d.tillUntil.getTime() < Date.now()) {
        if (d.tillUserId) await db.update(posCounterDevices).set({ tillUserId: null, tillUntil: null }).where(eq(posCounterDevices.id, d.id));
        return res.status(401).json({ code: "TILL_LOCKED", message: "Locked — enter your PIN." });
      }
      if (!(await holdsTab(d.tillUserId, "pos"))) {
        await db.update(posCounterDevices).set({ tillUserId: null, tillUntil: null }).where(eq(posCounterDevices.id, d.id));
        await logEvent(d.id, "warn", "Till locked: that person no longer has Register access", { kind: "till_lock", userId: d.tillUserId });
        return res.status(401).json({ code: "TILL_LOCKED", message: "You no longer have access to the Register." });
      }
      // Slide the expiry, written at most every 20 s.
      const until = new Date(Date.now() + TILL_IDLE_MINUTES * 60_000);
      if (until.getTime() - d.tillUntil.getTime() > 20_000) await db.update(posCounterDevices).set({ tillUntil: until }).where(eq(posCounterDevices.id, d.id));
      req.tillUserId = d.tillUserId;
      next();
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}

// ── Running the laptop's own handlers as the PIN's person ───────────────────
/**
 * A request that looks, to a till handler, like the PIN's person signed in.
 * 🔴 `session` here is a PLAIN OBJECT, never the express-session store: nothing
 * is saved, no cookie is issued, and the device leaves this call exactly as
 * un-signed-in as it arrived.
 */
function asStaff(req: Request, userId: number, opts: { params?: Record<string, string>; body?: unknown; query?: Record<string, string> } = {}): Request {
  const r = Object.create(req) as any;
  Object.defineProperty(r, "session", { value: { userId }, enumerable: true });
  Object.defineProperty(r, "user", { value: { id: userId }, enumerable: true });
  Object.defineProperty(r, "params", { value: opts.params ?? {}, enumerable: true });
  Object.defineProperty(r, "body", { value: opts.body ?? {}, enumerable: true });
  Object.defineProperty(r, "query", { value: opts.query ?? {}, enumerable: true });
  return r as Request;
}
/** Capture a handler's answer instead of sending it, so we can check and shape it. */
async function run(handler: ((req: Request, res: Response) => Promise<unknown>) | undefined, req: Request): Promise<{ status: number; body: any }> {
  if (!handler) return { status: 503, body: { message: "That part of ClubOS isn't loaded yet." } };
  let status = 200; let body: any = null;
  const res: any = {
    status(c: number) { status = c; return res; },
    json(b: unknown) { body = b; return res; },
    send(b: unknown) { body = b; return res; },
    end() { return res; },
    setHeader() { return res; }, set() { return res; }, append() { return res; },
  };
  await handler(req, res as Response);
  return { status, body };
}

// ── Shaping a sale for the reader ───────────────────────────────────────────
function tillSaleView(s: Awaited<ReturnType<typeof loadSale>>): TillSale | null {
  if (!s) return null;
  const pending = s.payments.find((p: any) => p.status === "pending");
  return {
    id: s.id, number: s.saleNumber, status: s.status,
    lines: s.lines.map((l: any) => ({
      id: l.id, kind: l.kind, title: l.title,
      detail: l.detail ? String(l.detail).replace(/^Default\s*·\s*/i, "") || null : null,
      qty: l.qty, unitCents: l.unitCents, lineCents: l.lineCents,
      image: (l.meta as any)?.imageUrl ?? null, brand: l.brand,
    })),
    subtotalCents: s.subtotalCents, discountCents: s.discountCents, totalCents: s.totalCents, gstCents: s.gstCents,
    paidCents: s.paidCents, remainingCents: s.remainingCents, pendingPaymentId: pending?.id ?? null,
  };
}

/** The sale this reader is building — only ever one of its own register's, and only while open or just paid. */
async function currentSale(d: { id: number; registerId: number | null; tillSaleId: number | null }) {
  if (!d.tillSaleId) return null;
  const s = await loadSale(d.tillSaleId);
  if (!s || s.registerId !== d.registerId || s.status === "void") {
    await db.update(posCounterDevices).set({ tillSaleId: null }).where(eq(posCounterDevices.id, d.id));
    return null;
  }
  return s;
}

/** The open sale, or a new one served by the PIN's person. Opens a shift if none is open. */
async function ensureSale(d: NonNullable<DeviceReq["counter"]>, userId: number) {
  const cur = await currentSale(d);
  if (cur && cur.status === "open") return cur;
  const [register] = await db.select().from(posRegisters).where(eq(posRegisters.id, d.registerId!));
  let [shift] = await db.select().from(posShifts).where(and(eq(posShifts.registerId, register.id), isNull(posShifts.closedAt)));
  if (!shift) {
    // The club is cashless (handles_cash defaults false), so a shift needs no
    // float counted — opening one is bookkeeping, not a drawer.
    try {
      [shift] = await db.insert(posShifts).values({ registerId: register.id, openedByUserId: userId, openingFloatCents: 0 }).returning();
      await logEvent(d.id, "info", "Opened a shift for the reader", { kind: "till_shift", shiftId: shift.id, userId });
    } catch {
      // A laptop opened one in the same moment — use theirs.
      [shift] = await db.select().from(posShifts).where(and(eq(posShifts.registerId, register.id), isNull(posShifts.closedAt)));
    }
  }
  const [sale] = await db.insert(posSales).values({
    registerId: register.id, shiftId: shift.id, moneyAccount: await readerAccountForRegister(register), servedByUserId: userId,
  }).returning();
  await db.update(posCounterDevices).set({ tillSaleId: sale.id }).where(eq(posCounterDevices.id, d.id));
  return (await loadSale(sale.id))!;
}

// ── Wrong-PIN accounting, per device as well as per person ──────────────────
const deviceFails = new Map<number, number[]>();
function deviceTooMany(deviceId: number): boolean {
  const now = Date.now();
  const recent = (deviceFails.get(deviceId) ?? []).filter((t) => now - t < 10 * 60_000);
  deviceFails.set(deviceId, recent);
  return recent.length >= 12;
}

export function registerPosCounterTillRoutes(app: Express) {
  const noStore = (_req: Request, res: Response, next: NextFunction) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Robots-Tag", "noindex"); next(); };
  const P = "/api/public/pos/counter/till";
  const dev = [noStore, requirePairedDevice as any] as const;
  const till = [noStore, requireTill as any] as const;

  // ── Who can unlock this reader ────────────────────────────────────────────
  // Everyone with a PIN who still holds the Register tab. Names and photos
  // only — it is the same list a staff room door would show.
  app.get(`${P}/staff`, ...dev, async (_req: DeviceReq, res) => {
    try {
      const rows = await db.select({ id: users.id, f: users.firstName, l: users.lastName, a: users.avatarUrl })
        .from(posStaffPins).innerJoin(users, eq(users.id, posStaffPins.userId)).where(eq(users.active, true)).orderBy(asc(users.firstName));
      const out: TillStaff[] = [];
      for (const u of rows) if (await holdsTab(u.id, "pos")) out.push({ id: u.id, name: [u.f, u.l].filter(Boolean).join(" "), initials: initialsOf(u.f, u.l), photo: u.a ?? null });
      res.json({ staff: out });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post(`${P}/unlock`, ...dev, async (req: DeviceReq, res) => {
    try {
      const d = req.counter!;
      const userId = num(req.body?.userId);
      const pin = str(req.body?.pin, 10);
      const wrong = "That PIN isn't right.";
      if (deviceTooMany(d.id)) return res.status(429).json({ message: "Too many wrong PINs on this reader. Wait ten minutes." });
      const [row] = Number.isFinite(userId) ? await db.select().from(posStaffPins).where(eq(posStaffPins.userId, userId)) : [];
      if (!row) return res.status(401).json({ message: wrong });
      if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
        return res.status(423).json({ message: `Your PIN is locked after too many tries. Try again after ${row.lockedUntil.toLocaleTimeString("en-NZ", { timeZone: "Pacific/Auckland", hour: "numeric", minute: "2-digit" })}, or reset it in ClubOS.` });
      }
      if (!pinMatches(pin, row.pinHash) || !(await holdsTab(userId, "pos"))) {
        deviceFails.get(d.id)!.push(Date.now());
        const fails = row.failedCount + 1;
        const lock = fails >= TILL_PIN_MAX_FAILS;
        await db.update(posStaffPins).set({ failedCount: lock ? 0 : fails, lockedUntil: lock ? new Date(Date.now() + TILL_PIN_LOCK_MINUTES * 60_000) : null }).where(eq(posStaffPins.userId, userId));
        await logEvent(d.id, "warn", lock ? "PIN locked after repeated wrong tries" : "Wrong PIN", { kind: "till_pin_fail", userId, fails });
        return res.status(401).json({ message: lock ? `Too many wrong tries — your PIN is locked for ${TILL_PIN_LOCK_MINUTES} minutes.` : wrong });
      }
      await db.update(posStaffPins).set({ failedCount: 0, lockedUntil: null }).where(eq(posStaffPins.userId, userId));
      await db.update(posCounterDevices).set({ tillUserId: userId, tillUntil: new Date(Date.now() + TILL_IDLE_MINUTES * 60_000) }).where(eq(posCounterDevices.id, d.id));
      const who = await staffView(userId);
      await logEvent(d.id, "info", `Unlocked by ${who?.name ?? `user ${userId}`}`, { kind: "till_unlock", userId });
      res.json({ ok: true });
    } catch (e: any) { console.error("[TILL] unlock", e); res.status(500).json({ message: e.message }); }
  });

  app.post(`${P}/lock`, ...dev, async (req: DeviceReq, res) => {
    try {
      const d = req.counter!;
      if (d.tillUserId) {
        await db.update(posCounterDevices).set({ tillUserId: null, tillUntil: null }).where(eq(posCounterDevices.id, d.id));
        await logEvent(d.id, "info", "Locked", { kind: "till_lock", userId: d.tillUserId, reason: str(req.body?.reason, 40) || "manual" });
      }
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get(`${P}/me`, ...till, async (req: TillReq, res) => {
    try {
      const d = req.counter!;
      const user = await staffView(req.tillUserId!);
      const sale = await currentSale(d);
      const me: TillMe = {
        user: user!, until: new Date(Date.now() + TILL_IDLE_MINUTES * 60_000).toISOString(),
        saleId: sale && sale.status === "open" ? sale.id : null,
        canRegister: await holdsTab(req.tillUserId!, "contacts"),
        handlesCash: await db.select({ h: posRegisters.handlesCash }).from(posRegisters).where(eq(posRegisters.id, d.registerId!)).then((x) => x[0]?.h === true),
      };
      res.json(me);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── Catalogue: the laptop's own, narrowed to what THIS reader can sell ──
  app.get(`${P}/catalogue`, ...till, async (req: TillReq, res) => {
    try {
      const d = req.counter!;
      const r = await run(posHandlers.catalogue, asStaff(req, req.tillUserId!, { query: { q: str(req.query.q, 80), code: str(req.query.code, 80) } }));
      if (r.status >= 400) return res.status(r.status).json(r.body);
      // 🔴 One sale banks with ONE account and the reader takes cards for ONE
      // (the register's). Showing United Gymnastics kit on the club's reader
      // would only end in Postgres refusing the line, so it isn't offered.
      const [register] = await db.select().from(posRegisters).where(eq(posRegisters.id, d.registerId!));
      const account = await readerAccountForRegister(register);
      const accountByOrg = new Map<number, string | null>();
      const sameAccount = async (orgId: number) => {
        if (!accountByOrg.has(orgId)) accountByOrg.set(orgId, await moneyAccountForOrg(orgId));
        return (accountByOrg.get(orgId) ?? "club") === account;
      };
      const products: any[] = [];
      for (const p of r.body.products ?? []) if (await sameAccount(p.orgId)) products.push(p);
      // Term programmes with a fee on file, and holiday camps with a day still
      // to come. A camp sells DAYS, priced from camp_pricing, so it carries no
      // option rows — it is offered when it has pricing and a future date.
      const today = nzTodayIso();
      const campIds = (r.body.programmes ?? []).filter((p: any) => p.type === "holiday_camp").map((p: any) => p.id);
      const campInfo = new Map<number, { nextDate: string; lastDate: string; fromCents: number }>();
      if (campIds.length) {
        const rows = await db.execute(sql`
          SELECT d.camp_id, min(d.date)::text AS next_date, max(d.date)::text AS last_date,
                 (SELECT min(price_cents) FROM camp_pricing cp WHERE cp.camp_id = d.camp_id AND cp.price_cents > 0) AS from_cents
            FROM camp_dates d WHERE d.camp_id IN (${sql.join(campIds.map((id: number) => sql`${id}`), sql`, `)}) AND d.date >= ${today}::date
           GROUP BY d.camp_id`);
        for (const x of rows.rows as any[]) if (x.from_cents) campInfo.set(Number(x.camp_id), { nextDate: x.next_date, lastDate: x.last_date, fromCents: Number(x.from_cents) });
      }
      const programmes: any[] = [];
      for (const p of r.body.programmes ?? []) {
        if (!(await sameAccount(p.orgId))) continue;
        if (p.type === "academy" && p.options.length > 0) programmes.push({ ...p, kind: "academy", fromCents: Math.min(...p.options.map((o: any) => o.fullPriceCents)) });
        else if (p.type === "holiday_camp" && campInfo.has(p.id)) { const c = campInfo.get(p.id)!; programmes.push({ ...p, kind: "camp", fromCents: c.fromCents, firstDate: c.nextDate, lastDate: c.lastDate }); }
      }
      // Camps first in the school holidays is not something to guess — the
      // reader lists camps by their next day, then term programmes by name.
      programmes.sort((x, y) => (x.kind === y.kind ? (x.kind === "camp" ? String(x.firstDate).localeCompare(String(y.firstDate)) : x.name.localeCompare(y.name)) : x.kind === "camp" ? -1 : 1));
      res.json({ products, programmes, codeHit: r.body.codeHit ?? null });
    } catch (e: any) { console.error("[TILL] catalogue", e); res.status(500).json({ message: e.message }); }
  });

  // ── The sale ──────────────────────────────────────────────────────────────
  app.get(`${P}/sale`, ...till, async (req: TillReq, res) => {
    try { res.json({ sale: tillSaleView(await currentSale(req.counter!)) }); }
    catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post(`${P}/sale/lines`, ...till, async (req: TillReq, res) => {
    try {
      const d = req.counter!;
      const sale = await ensureSale(d, req.tillUserId!);
      // Kit only. A registration line is added by /registrations, which made it.
      const r = await run(posHandlers.addLine, asStaff(req, req.tillUserId!, { params: { id: String(sale.id) }, body: { kind: "variant", variantId: num(req.body?.variantId), qty: num(req.body?.qty ?? 1) } }));
      if (r.status >= 400) return res.status(r.status).json(r.body);
      res.status(201).json({ sale: tillSaleView(await loadSale(sale.id)) });
    } catch (e: any) { console.error("[TILL] add line", e); res.status(500).json({ message: e.message }); }
  });

  app.patch(`${P}/sale/lines/:lineId`, ...till, async (req: TillReq, res) => {
    try {
      const sale = await currentSale(req.counter!);
      if (!sale) return res.status(404).json({ message: "Nothing in progress." });
      const r = await run(posHandlers.updateLine, asStaff(req, req.tillUserId!, { params: { id: String(sale.id), lineId: String(req.params.lineId) }, body: { qty: num(req.body?.qty) } }));
      if (r.status >= 400) return res.status(r.status).json(r.body);
      res.json({ sale: tillSaleView(await loadSale(sale.id)) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete(`${P}/sale/lines/:lineId`, ...till, async (req: TillReq, res) => {
    try {
      const sale = await currentSale(req.counter!);
      if (!sale) return res.status(404).json({ message: "Nothing in progress." });
      const r = await run(posHandlers.deleteLine, asStaff(req, req.tillUserId!, { params: { id: String(sale.id), lineId: String(req.params.lineId) } }));
      if (r.status >= 400) return res.status(r.status).json(r.body);
      res.json({ sale: tillSaleView(await loadSale(sale.id)) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // The card, on this reader. The laptop's card handler sees this reader as the
  // register's live counter screen and puts the payment on it — the existing
  // claim/collect/result path then runs exactly as it does for the laptop.
  app.post(`${P}/sale/charge`, ...till, async (req: TillReq, res) => {
    try {
      const d = req.counter!;
      const sale = await currentSale(d);
      if (!sale || sale.status !== "open") return res.status(404).json({ message: "Nothing to charge." });
      if (!sale.lines.length) return res.status(409).json({ message: "Add something first." });
      const r = await run(posHandlers.cardPayment, asStaff(req, req.tillUserId!, { params: { id: String(sale.id) }, body: {} }));
      if (r.status >= 400) {
        // Already waiting on this reader: show it again rather than fail.
        if (r.body?.code === "POS_CARD_PENDING") { await showOnCounter(d.registerId!, sale.id); return res.json({ ok: true, paymentId: r.body.paymentId }); }
        return res.status(r.status).json(r.body);
      }
      if (!r.body?.viaCounter) {
        // Should never happen: this reader IS the register's counter. Say so
        // rather than leave a payment waiting on some other device.
        await run(posHandlers.cancelPayment, asStaff(req, req.tillUserId!, { params: { id: String(sale.id), pid: String(r.body?.paymentId) } }));
        return res.status(409).json({ message: "This reader isn't the register's card screen. Re-link it from the Register." });
      }
      await logEvent(d.id, "info", `Charge ${sale.saleNumber} on the reader`, { kind: "till_charge", saleId: sale.id, paymentId: r.body.paymentId, amountCents: sale.remainingCents, userId: req.tillUserId });
      res.json({ ok: true, paymentId: r.body.paymentId });
    } catch (e: any) { console.error("[TILL] charge", e); res.status(500).json({ message: e.message }); }
  });

  app.post(`${P}/sale/payments/:pid/cancel`, ...till, async (req: TillReq, res) => {
    try {
      const d = req.counter!;
      const sale = await currentSale(d);
      if (!sale) return res.status(404).json({ message: "Nothing in progress." });
      const r = await run(posHandlers.cancelPayment, asStaff(req, req.tillUserId!, { params: { id: String(sale.id), pid: String(req.params.pid) } }));
      if (r.status >= 400) return res.status(r.status).json(r.body);
      await showOnCounter(d.registerId!, null);
      res.json({ sale: tillSaleView(await loadSale(sale.id)) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post(`${P}/sale/void`, ...till, async (req: TillReq, res) => {
    try {
      const d = req.counter!;
      const sale = await currentSale(d);
      if (!sale) return res.json({ sale: null });
      const r = await run(posHandlers.voidSale, asStaff(req, req.tillUserId!, { params: { id: String(sale.id) }, body: { reason: str(req.body?.reason, 200) || "Cleared on the counter reader" } }));
      if (r.status >= 400) return res.status(r.status).json(r.body);
      await db.update(posCounterDevices).set({ tillSaleId: null }).where(eq(posCounterDevices.id, d.id));
      await showOnCounter(d.registerId!, null);
      res.json({ sale: null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** After the thank-you: take the paid sale off the reader and start clean. */
  app.post(`${P}/sale/next`, ...till, async (req: TillReq, res) => {
    try {
      const d = req.counter!;
      const sale = await currentSale(d);
      if (sale && sale.status === "open" && sale.lines.length) return res.status(409).json({ message: "That sale isn't paid — finish or clear it first." });
      await db.update(posCounterDevices).set({ tillSaleId: null }).where(eq(posCounterDevices.id, d.id));
      const [reg] = await db.select().from(posRegisters).where(eq(posRegisters.id, d.registerId!));
      if (sale && reg?.counterSaleId === sale.id) await showOnCounter(d.registerId!, null);
      res.json({ sale: null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── Players: the same search the laptop uses, less on the screen ──────────
  app.get(`${P}/people`, ...till, async (req: TillReq, res) => {
    try {
      if (!(await holdsTab(req.tillUserId!, "contacts"))) return res.status(403).json({ message: "Registering players needs Contacts access. You can still sell kit." });
      const q = str(req.query.q, 80);
      if (q.length < 2) return res.json({ people: [] });
      const { rows } = await searchPeople(q, "players", 8, 0);
      const fam = await familySummaries(rows);
      const season = Number(nzTodayIso().slice(0, 4));
      const people: TillPerson[] = rows.map((r: any) => {
        const key = personKey(r.kind, Number(r.id));
        const dob = r.date_of_birth ? String(r.date_of_birth instanceof Date ? r.date_of_birth.toISOString() : r.date_of_birth).slice(0, 10) : null;
        const grade = dob ? ageGradeFor(dob, season) : null;
        const f = fam.get(key);
        return {
          key,
          name: [r.first_name, r.last_name].filter(Boolean).join(" "),
          hint: dob ? `${grade ? `U${grade} · ` : ""}born ${dob.slice(0, 4)}` : null,
          parents: (f?.parents ?? []).slice(0, 2),
        };
      });
      res.json({ people });
    } catch (e: any) { console.error("[TILL] people", e); res.status(500).json({ message: e.message }); }
  });

  app.get(`${P}/quote`, ...till, async (req: TillReq, res) => {
    try {
      const query: Record<string, string> = {};
      for (const k of ["programId", "programOptionId", "termId", "priceMode", "plan"]) { const v = str(req.query[k], 20); if (v) query[k] = v; }
      const r = await run(officeRegistration.quote, asStaff(req, req.tillUserId!, { query }));
      res.status(r.status).json(r.body);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /**
   * A family, as the reader may show it: the parent's NAME (never their email
   * or phone) and each child with an age hint. Used to add a sibling, and to
   * pick which children go to a camp.
   */
  app.get(`${P}/family/:key`, ...till, async (req: TillReq, res) => {
    try {
      if (!(await holdsTab(req.tillUserId!, "contacts"))) return res.status(403).json({ message: "Registering players needs Contacts access." });
      const parsed = parsePersonKey(String(req.params.key));
      const fam: any = parsed ? await resolveFamily(parsed.kind, parsed.id) : null;
      if (!fam) return res.status(404).json({ message: "Not found." });
      const season = Number(nzTodayIso().slice(0, 4));
      const isChild = (x: any) => x && (x.kind === "child" || x.type === "player");
      const kids: any[] = isChild(fam.person) ? [fam.person, ...(fam.children ?? []).filter((c: any) => c.key !== fam.person.key)] : (fam.children ?? []);
      const seen = new Set<string>();
      const children: TillPerson[] = [];
      for (const c of kids) {
        // The resolver can return one child as a contact AND a camp child row.
        const sig = `${String(c.firstName).trim().toLowerCase()}|${String(c.lastName).trim().toLowerCase()}|${c.dateOfBirth ?? ""}`;
        if (seen.has(sig)) continue; seen.add(sig);
        const dob = c.dateOfBirth ? String(c.dateOfBirth).slice(0, 10) : null;
        const grade = dob ? ageGradeFor(dob, season) : null;
        children.push({ key: c.key, name: [c.firstName, c.lastName].filter(Boolean).join(" "), hint: dob ? `${grade ? `U${grade} · ` : ""}born ${dob.slice(0, 4)}` : null, parents: [] });
      }
      const g = (fam.guardians ?? []).find((x: any) => x?.email) ?? (isChild(fam.person) ? null : fam.person);
      res.json({ guardian: g ? { name: [g.firstName, g.lastName].filter(Boolean).join(" "), hasEmail: !!g.email } : null, children });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** A camp's days still to come and its prices — what the day picker draws. */
  app.get(`${P}/camp/:programId`, ...till, async (req: TillReq, res) => {
    try {
      const id = num(req.params.programId);
      const [prog] = Number.isFinite(id) ? await db.select({ id: programs.id, type: programs.type, name: programs.name }).from(programs).where(eq(programs.id, id)) : [];
      if (!prog || prog.type !== "holiday_camp") return res.status(404).json({ message: "Not a holiday camp." });
      const today = nzTodayIso();
      const [pricing, dates, discounts] = await Promise.all([storage.getCampPricing(id), storage.getCampDates(id), storage.getProgramDiscounts(id)]);
      res.json({
        name: prog.name,
        pricing: pricing.filter((p: any) => p.priceCents > 0).map((p: any) => ({ productType: p.productType, priceCents: p.priceCents })),
        // 🔴 The DATE column is an ISO day; compare it as text, never through a Date.
        dates: dates.map((d: any) => ({ id: d.id, date: String(d.date).slice(0, 10), name: d.name ?? null })).filter((d: any) => d.date >= today).sort((a: any, b: any) => a.date.localeCompare(b.date)),
        discounts: discounts.map((x: any) => ({ minBookings: x.minBookings, discountPercent: Number(x.discountPercent) })),
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /** The parent the reader names by a person key — the first guardian WITH an email. */
  async function guardianFromKey(key: unknown): Promise<{ firstName: string; lastName: string; email: string; phone: string } | null> {
    const parsed = parsePersonKey(String(key ?? ""));
    const fam: any = parsed ? await resolveFamily(parsed.kind, parsed.id) : null;
    if (!fam) return null;
    const isChild = fam.person && (fam.person.kind === "child" || fam.person.type === "player");
    const g = (fam.guardians ?? []).find((x: any) => x?.email) ?? (!isChild && fam.person?.email ? fam.person : null);
    return g ? { firstName: g.firstName, lastName: g.lastName, email: String(g.email).toLowerCase(), phone: g.phone ?? "" } : null;
  }
  /** A child the reader names by a person key, with what the club already holds about them. */
  async function childFromKey(key: unknown): Promise<any | null> {
    const parsed = parsePersonKey(String(key ?? ""));
    const fam: any = parsed ? await resolveFamily(parsed.kind, parsed.id) : null;
    const p = fam?.person;
    return p && (p.kind === "child" || p.type === "player") ? p : null;
  }
  /** A refused registration is checkout scaffolding: unlinked and cancelled, never deleted. */
  async function abandonRegistration(id: number) {
    await db.execute(sql`UPDATE registrations SET status = 'cancelled', pos_sale_id = NULL WHERE id = ${id} AND status = 'pending'`);
  }

  /**
   * Register into a programme and put it on the sale. ONE endpoint for both
   * shapes ClubOS has:
   *   academy — one player per registration (`personKey`, or `player` typed,
   *             with the parent from `guardianFromKey` or typed `guardian`)
   *   camp    — one parent, one or more children, the days chosen
   * The body the office route receives is built HERE; the reader never sends
   * an email or phone of a family we already hold, and never a price.
   * Answers `code` hdyhau_required / nzf_incomplete / age_warning /
   * already_registered when it needs one more answer; the reader asks and
   * sends again.
   */
  app.post(`${P}/registrations`, ...till, async (req: TillReq, res) => {
    try {
      const d = req.counter!;
      const userId = req.tillUserId!;
      if (!(await holdsTab(userId, "contacts"))) return res.status(403).json({ message: "Registering players needs Contacts access." });
      const b = req.body ?? {};
      const programId = num(b.programId);
      const [prog] = Number.isFinite(programId) ? await db.select({ id: programs.id, type: programs.type, name: programs.name, orgId: programs.organizationId }).from(programs).where(eq(programs.id, programId)) : [];
      if (!prog || (prog.type !== "academy" && prog.type !== "holiday_camp")) return res.status(400).json({ message: "Choose a programme." });

      // The parent: an existing family's (by key) or typed.
      const typedGuardian = (g: any) => ({ firstName: str(g?.firstName, 60), lastName: str(g?.lastName, 60), email: str(g?.email, 200).toLowerCase(), phone: str(g?.phone, 40) });
      let guardian = b.guardianFromKey ? await guardianFromKey(b.guardianFromKey) : null;
      if (b.guardianFromKey && !guardian) return res.status(409).json({ code: "no_guardian", message: "No parent with an email is linked to this family. Type the parent's details instead." });

      const sale = await ensureSale(d, userId);
      // One visit = one group, so the registrations of one sale read back together.
      const registrationGroupId = `till-sale-${String(sale.id).padStart(6, "0")}`;
      const common = {
        programId, registrationGroupId,
        referralSource: b.referralSource || undefined, referralDetail: b.referralDetail || undefined,
        policyAccepted: b.policyAccepted === true,
        payment: { isPaid: false }, servedByUserId: userId, posSaleId: sale.id,
      };

      let body: any; let who = "";
      if (prog.type === "academy") {
        let player: Record<string, unknown>;
        if (b.personKey) {
          const p = await childFromKey(b.personKey);
          if (!p) return res.status(404).json({ message: "Pick the player, not a parent." });
          if (!guardian) guardian = await guardianFromKey(b.personKey);
          if (!guardian) return res.status(409).json({ code: "no_guardian", message: "No parent with an email is linked to this player. Add them as a new player with the parent's details." });
          player = {
            firstName: p.firstName, lastName: p.lastName, dateOfBirth: p.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : "",
            gender: p.gender ?? undefined, school: p.school ?? undefined,
            countryOfBirthCode: p.countryOfBirthCode ?? undefined, nationalityCode: p.nationalityCode ?? undefined,
            ethnicityGroupId: p.ethnicityGroupId ?? undefined, ethnicitySelectionIds: p.ethnicitySelectionIds ?? undefined,
            ethnicity2GroupId: p.ethnicity2GroupId ?? undefined, ethnicity2SelectionIds: p.ethnicity2SelectionIds ?? undefined,
            addressParts: { street: p.addressStreet ?? "", suburb: p.addressSuburb ?? "", city: p.addressCity ?? "", region: p.addressRegion ?? "", postcode: p.addressPostcode ?? "", country: p.addressCountry ?? "NZL" },
          };
        } else {
          const np = b.player ?? {};
          player = { firstName: str(np.firstName, 60), lastName: str(np.lastName, 60), dateOfBirth: str(np.dateOfBirth, 10), gender: str(np.gender, 20) || undefined };
          if (!guardian) guardian = typedGuardian(b.guardian);
        }
        if (b.deferReason) Object.assign(player, { deferIdentity: true, deferReason: str(b.deferReason, 80), deferNote: str(b.deferNote, 200) });
        who = `${player.firstName ?? ""}`.trim();
        body = { ...common, programOptionId: b.programOptionId ?? undefined, termId: b.termId ?? undefined, priceMode: b.priceMode === "prorata" ? "prorata" : "full", paymentPlan: "term", acknowledgeAgeWarning: b.acknowledgeAgeWarning === true, player, guardian, notes: "Registered on the counter reader" };
      } else {
        // ── Camp: one parent, the children, the days ─────────────────────
        const days: { campDateId: number; productType: string }[] = Array.isArray(b.days) ? b.days.slice(0, 40).map((x: any) => ({ campDateId: num(x?.campDateId), productType: str(x?.productType, 30) })).filter((x: any) => Number.isFinite(x.campDateId) && x.productType) : [];
        if (!days.length) return res.status(400).json({ message: "Choose at least one day." });
        const [pricing, dates] = await Promise.all([storage.getCampPricing(programId), storage.getCampDates(programId)]);
        const today = nzTodayIso();
        for (const x of days) {
          const dd: any = dates.find((y: any) => y.id === x.campDateId);
          if (!dd || String(dd.date).slice(0, 10) < today) return res.status(400).json({ message: "One of those days isn't on this camp any more." });
          if (!pricing.some((p: any) => p.productType === x.productType && p.priceCents > 0)) return res.status(400).json({ message: "One of those day options has no price." });
        }
        // 🔴 One booking per child per DAY: two options on one day is a mistake.
        if (new Set(days.map((x) => x.campDateId)).size !== days.length) return res.status(400).json({ message: "Pick one option per day." });
        const kidsIn: any[] = Array.isArray(b.children) ? b.children.slice(0, 8) : [];
        const children: any[] = [];
        for (const k of kidsIn) {
          if (k?.key) {
            const c = await childFromKey(k.key);
            if (!c) return res.status(404).json({ message: "One of those children wasn't found." });
            // What the club already holds carries over, read here — never shown on the reader.
            children.push({ firstName: c.firstName, lastName: c.lastName, dateOfBirth: c.dateOfBirth ? String(c.dateOfBirth).slice(0, 10) : null, allergies: c.allergies ?? null, epiPen: c.epiPen === true, medicalNotes: c.medicalNotes ?? null });
            if (!guardian) guardian = await guardianFromKey(k.key);
          } else {
            const fn = str(k?.firstName, 60), ln = str(k?.lastName, 60), dob = str(k?.dateOfBirth, 10);
            if (!fn || !ln) return res.status(400).json({ message: "Every child needs a first and last name." });
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return res.status(400).json({ message: `${fn}'s date of birth is needed.` });
            children.push({ firstName: fn, lastName: ln, dateOfBirth: dob });
          }
        }
        if (!children.length) return res.status(400).json({ message: "Add at least one child." });
        if (!guardian) guardian = typedGuardian(b.guardian);
        if (!guardian.firstName || !guardian.lastName) return res.status(400).json({ message: "The parent's name is needed." });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(guardian.email)) return res.status(400).json({ message: "A parent email is needed — the booking confirmation goes there." });
        if (!guardian.phone) return res.status(400).json({ message: "A parent phone number is needed." });
        const items = children.flatMap((_c, ci) => days.map((x) => ({ childIndex: ci, campDateId: x.campDateId, productType: x.productType })));
        // 🔴 A child already booked on one of these days, by this parent, is a
        // double booking. Checked BEFORE anything is written.
        if (b.acknowledgeDuplicate !== true) {
          const clash = await db.execute(sql`
            SELECT ch.first_name, cd.date::text AS date
              FROM registration_items ri
              JOIN registrations r ON r.id = ri.registration_id
              JOIN contacts g ON g.id = r.guardian_id
              JOIN children ch ON ch.id = ri.child_id
              JOIN camp_dates cd ON cd.id = ri.camp_date_id
             WHERE r.program_id = ${programId} AND r.status IN ('confirmed','partially_refunded') -- holds a place (see the academy check)
               AND lower(trim(g.email)) = ${guardian.email.trim()}
               AND ri.camp_date_id IN (${sql.join(days.map((x) => sql`${x.campDateId}`), sql`, `)})
               -- 🔴 trim: saved names carry stray spaces ("Liam " on a real booking).
               AND lower(trim(ch.first_name)) IN (${sql.join(children.map((c) => sql`${String(c.firstName).trim().toLowerCase()}`), sql`, `)})
             LIMIT 5`);
          if (clash.rows.length) {
            const r0: any = clash.rows[0];
            // "Mon 21 Dec" from the y-m-d parts — a raw ISO date reads as a code to a parent.
            const [y, m, dd] = String(r0.date).split("-").map(Number);
            const day = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]} ${dd} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`;
            const more = clash.rows.length > 1 ? ` (and ${clash.rows.length - 1} more of those days)` : "";
            return res.status(409).json({ code: "already_registered", message: `${String(r0.first_name).trim()} is already booked and paid for ${day} at this camp${more}.` });
          }
        }
        who = children.map((c) => c.firstName).join(" + ");
        body = { ...common, parent: { ...guardian, emergencyContact: null, emergencyPhone: null }, children, items,
          notes: ["Registered on the counter reader", children.some((c) => !c.allergies && !c.medicalNotes && !c.epiPen) && b.medicalToFollow ? "Medical / allergies to collect — told staff at the counter" : ""].filter(Boolean).join(" · ") };
      }

      const r = await run(officeRegistration.create, asStaff(req, userId, { body }));
      if (r.status >= 400 || !r.body?.registrationId) return res.status(r.status >= 400 ? r.status : 500).json(r.body ?? { message: "That registration didn't save." });
      const regId = Number(r.body.registrationId);

      // ── Duplicates, academy: on this sale already, or already paid for ──
      if (prog.type === "academy") {
        // 🔴 "Holds a place" = confirmed or partially refunded. Deliberately NOT
        // the full REAL_REGISTRATION_STATUSES decider: a fully REFUNDED child
        // gave the place back, and paying again for it is exactly right.
        const twin = await db.execute(sql`
          SELECT r.id, r.status, r.pos_sale_id FROM registrations r, registrations mine
           WHERE mine.id = ${regId} AND r.id <> mine.id AND r.contact_id = mine.contact_id AND r.program_id = mine.program_id
             AND r.term_id IS NOT DISTINCT FROM mine.term_id
             AND (r.pos_sale_id = ${sale.id} AND r.status = 'pending' OR r.status IN ('confirmed','partially_refunded'))
           LIMIT 1`);
        const t: any = twin.rows[0];
        if (t && Number(t.pos_sale_id) === sale.id && t.status === "pending") {
          await abandonRegistration(regId);
          return res.status(409).json({ code: "on_sale_already", message: `${who} is already on this sale for ${prog.name}.` });
        }
        if (t && b.acknowledgeDuplicate !== true) {
          await abandonRegistration(regId);
          return res.status(409).json({ code: "already_registered", message: `${who} is already registered and paid for ${prog.name} this term.` });
        }
      }

      const add = await run(posHandlers.addLine, asStaff(req, userId, { params: { id: String(sale.id) }, body: { kind: "registration", registrationId: regId } }));
      if (add.status >= 400) { await abandonRegistration(regId); return res.status(add.status).json(add.body); }
      // The line names who it is for (a camp booking's contact is the parent).
      const label = prog.type === "holiday_camp" ? `${who} · ${(body.items.length / body.children.length)} day${body.items.length / body.children.length === 1 ? "" : "s"}` : who;
      await db.execute(sql`UPDATE pos_sale_lines SET detail = ${label.slice(0, 200)} WHERE sale_id = ${sale.id} AND registration_id = ${regId} AND kind = 'registration'`);
      await logEvent(d.id, "info", `Registered ${who || "a player"} for ${prog.name} on ${sale.saleNumber}`, { kind: "till_registration", registrationId: regId, saleId: sale.id, userId });
      res.status(201).json({ sale: tillSaleView(await loadSale(sale.id)), nzfMissing: r.body.nzfMissing ?? [], ageWarning: r.body.ageWarning ?? null, guardian: { name: `${guardian?.firstName ?? ""} ${guardian?.lastName ?? ""}`.trim() } });
    } catch (e: any) { console.error("[TILL] registration", e); res.status(500).json({ message: e.message }); }
  });

  /**
   * Paid another way — the bank's EFTPOS terminal (an eftpos-only card the
   * reader cannot take), a bank transfer, or "other". Recorded through the
   * laptop's own manual-tender handler, so the slip number is required and a
   * register that does not take cash refuses cash. The thank-you then shows on
   * the reader exactly as for a card.
   */
  app.post(`${P}/sale/pay-other`, ...till, async (req: TillReq, res) => {
    try {
      const d = req.counter!;
      const sale = await currentSale(d);
      if (!sale || sale.status !== "open") return res.status(404).json({ message: "Nothing to pay." });
      if (sale.payments.some((p: any) => p.status === "pending")) return res.status(409).json({ message: "A card payment is still waiting on the reader — cancel it first." });
      const method = str(req.body?.method, 20);
      const r = await run(posHandlers.manualPayment, asStaff(req, req.tillUserId!, { params: { id: String(sale.id) }, body: { method, amountCents: sale.remainingCents, reference: str(req.body?.reference, 120) } }));
      if (r.status >= 400) return res.status(r.status).json(r.body);
      const after = await loadSale(sale.id);
      if (after?.status === "paid") await showOnCounter(d.registerId!, sale.id);
      await logEvent(d.id, "info", `Recorded ${method} for ${sale.saleNumber} on the reader`, { kind: "till_pay_other", saleId: sale.id, method, userId: req.tillUserId });
      res.json({ sale: tillSaleView(after) });
    } catch (e: any) { console.error("[TILL] pay other", e); res.status(500).json({ message: e.message }); }
  });

  // ── Staff: set your own PIN (from the Register on a laptop or phone) ──────
  const staffGate = [requireAuth, requireTabAnywhere("pos")] as const;
  app.get("/api/admin/pos/my-counter-pin", ...staffGate, async (req, res) => {
    try {
      const [row] = await db.select({ setAt: posStaffPins.setAt, lockedUntil: posStaffPins.lockedUntil }).from(posStaffPins).where(eq(posStaffPins.userId, req.session.userId as number));
      res.json({ hasPin: !!row, setAt: row?.setAt ?? null, locked: !!(row?.lockedUntil && row.lockedUntil.getTime() > Date.now()) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.put("/api/admin/pos/my-counter-pin", ...staffGate, async (req, res) => {
    try {
      const pin = str(req.body?.pin, 10);
      const problem = tillPinError(pin);
      if (problem) return res.status(400).json({ message: problem });
      const me = req.session.userId as number;
      await db.insert(posStaffPins).values({ userId: me, pinHash: hashPin(pin) })
        .onConflictDoUpdate({ target: posStaffPins.userId, set: { pinHash: hashPin(pin), setAt: new Date(), failedCount: 0, lockedUntil: null } });
      await storage.createAuditLog({ userId: me, action: "update", entity: "pos_staff_pin", entityId: me, details: "Set their counter reader PIN" } as any);
      res.json({ hasPin: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}

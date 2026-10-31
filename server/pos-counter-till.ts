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
import { and, asc, eq, isNull } from "drizzle-orm";
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
import { posHandlers, loadSale, readerAccountForRegister } from "./pos-routes";
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
      };
      res.json(me);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── Catalogue: the laptop's own ───────────────────────────────────────────
  app.get(`${P}/catalogue`, ...till, async (req: TillReq, res) => {
    try {
      const r = await run(posHandlers.catalogue, asStaff(req, req.tillUserId!, { query: { q: str(req.query.q, 80), code: str(req.query.code, 80) } }));
      if (r.status >= 400) return res.status(r.status).json(r.body);
      // The reader registers academy players only; a camp sells DAYS and needs
      // the laptop's day picker. Programmes with no fee on file are not sellable.
      const programmes = (r.body.programmes ?? []).filter((p: any) => p.type === "academy" && p.options.length > 0);
      res.json({ products: r.body.products ?? [], programmes, codeHit: r.body.codeHit ?? null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
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
   * Register a player into an academy programme and put it on the sale.
   * The body the office route receives is built HERE from the family record
   * (existing player) or from what staff typed (new player). It comes back
   * with `code` hdyhau_required / nzf_incomplete / age_warning when it needs
   * one more answer; the reader asks and sends again.
   */
  app.post(`${P}/registrations`, ...till, async (req: TillReq, res) => {
    try {
      const d = req.counter!;
      const userId = req.tillUserId!;
      if (!(await holdsTab(userId, "contacts"))) return res.status(403).json({ message: "Registering players needs Contacts access." });
      const b = req.body ?? {};
      const programId = num(b.programId);
      const [prog] = Number.isFinite(programId) ? await db.select({ id: programs.id, type: programs.type }).from(programs).where(eq(programs.id, programId)) : [];
      if (!prog || prog.type !== "academy") return res.status(400).json({ message: "Choose a term programme." });

      let player: Record<string, unknown>;
      let guardian: Record<string, unknown>;
      if (b.personKey) {
        const parsed = parsePersonKey(String(b.personKey));
        const fam: any = parsed ? await resolveFamily(parsed.kind, parsed.id) : null;
        if (!fam) return res.status(404).json({ message: "That player wasn't found." });
        const p = fam.person ?? {};
        if (!(p.kind === "child" || p.type === "player")) return res.status(400).json({ message: "Pick the player, not a parent." });
        const g = (fam.guardians ?? []).find((x: any) => x?.email) ?? null;
        if (!g) return res.status(409).json({ code: "no_guardian", message: "No parent with an email is linked to this player. Add them as a new player with the parent's details." });
        player = {
          firstName: p.firstName, lastName: p.lastName,
          dateOfBirth: p.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : "",
          gender: p.gender ?? undefined, school: p.school ?? undefined,
          countryOfBirthCode: p.countryOfBirthCode ?? undefined, nationalityCode: p.nationalityCode ?? undefined,
          ethnicityGroupId: p.ethnicityGroupId ?? undefined, ethnicitySelectionIds: p.ethnicitySelectionIds ?? undefined,
          ethnicity2GroupId: p.ethnicity2GroupId ?? undefined, ethnicity2SelectionIds: p.ethnicity2SelectionIds ?? undefined,
          addressParts: { street: p.addressStreet ?? "", suburb: p.addressSuburb ?? "", city: p.addressCity ?? "", region: p.addressRegion ?? "", postcode: p.addressPostcode ?? "", country: p.addressCountry ?? "NZL" },
        };
        guardian = { firstName: g.firstName, lastName: g.lastName, email: g.email, phone: g.phone ?? "" };
      } else {
        const np = b.player ?? {}, ng = b.guardian ?? {};
        player = { firstName: str(np.firstName, 60), lastName: str(np.lastName, 60), dateOfBirth: str(np.dateOfBirth, 10), gender: str(np.gender, 20) || undefined };
        guardian = { firstName: str(ng.firstName, 60), lastName: str(ng.lastName, 60), email: str(ng.email, 200).toLowerCase(), phone: str(ng.phone, 40) };
      }
      if (b.deferReason) {
        Object.assign(player, { deferIdentity: true, deferReason: str(b.deferReason, 80), deferNote: str(b.deferNote, 200) });
      }

      const sale = await ensureSale(d, userId);
      const body = {
        programId, programOptionId: b.programOptionId ?? undefined, termId: b.termId ?? undefined,
        priceMode: b.priceMode === "prorata" ? "prorata" : "full", paymentPlan: "term",
        player, guardian,
        referralSource: b.referralSource || undefined, referralDetail: b.referralDetail || undefined,
        acknowledgeAgeWarning: b.acknowledgeAgeWarning === true,
        policyAccepted: b.policyAccepted === true,
        payment: { isPaid: false },
        servedByUserId: userId,
        posSaleId: sale.id,
        notes: "Registered on the counter reader",
      };
      const r = await run(officeRegistration.create, asStaff(req, userId, { body }));
      if (r.status >= 400 || !r.body?.registrationId) return res.status(r.status >= 400 ? r.status : 500).json(r.body ?? { message: "That registration didn't save." });
      const add = await run(posHandlers.addLine, asStaff(req, userId, { params: { id: String(sale.id) }, body: { kind: "registration", registrationId: r.body.registrationId } }));
      if (add.status >= 400) return res.status(add.status).json(add.body);
      await logEvent(d.id, "info", `Registered ${r.body.player?.firstName ?? "a player"} on ${sale.saleNumber}`, { kind: "till_registration", registrationId: r.body.registrationId, saleId: sale.id, userId });
      res.status(201).json({ sale: tillSaleView(await loadSale(sale.id)), nzfMissing: r.body.nzfMissing ?? [], ageWarning: r.body.ageWarning ?? null });
    } catch (e: any) { console.error("[TILL] registration", e); res.status(500).json({ message: e.message }); }
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

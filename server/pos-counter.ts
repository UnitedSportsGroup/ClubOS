// ─────────────────────────────────────────────────────────────────────────────
// The COUNTER SCREEN — our app on the Stripe S710 (Apps on Devices).
//
// The till is the web register on a staff laptop. The S710 at the counter runs
// apps/clubos-counter: a native shell whose whole screen is the ClubOS page
// /counter, plus the Stripe Terminal SDK in "handoff" mode for the card. This
// file is everything that page and that shell may ask of ClubOS.
//
//   Device (cookie __Host-clubos_counter, or "Authorization: Counter <token>")
//   POST /api/public/pos/counter/start              mint a device + pairing code, or resume
//   GET  /api/public/pos/counter/state              what to show right now (polled ~1s)
//   POST /api/public/pos/counter/payments/:pid/claim    take the card prompt (once)
//   POST /api/public/pos/counter/payments/:pid/result   what the card prompt ended with
//   POST /api/public/pos/counter/sales/:id/receipt  the customer types their email
//   POST /api/public/pos/counter/connection-token   for the native Terminal SDK
//   POST /api/public/pos/counter/log                the reader has no debugger: logs land here
//
//   Staff (the POS tick)
//   GET    /api/admin/pos/registers/:id/counter     status + recent log
//   POST   /api/admin/pos/registers/:id/counter     { code } pair the screen showing that code
//   DELETE /api/admin/pos/registers/:id/counter     unpair (revoke the device)
//
// 🔴 A device is NOT a person. It never holds a staff session and nothing in
// /api/admin answers it. Its token is 256 random bits, stored only as a hash,
// bound to ONE register by a named staff member, revocable on the next request.
// It can read only what its own register is showing, collect a card payment the
// TILL created (it can never create one or choose an amount), and email a
// receipt for a sale it just took.
//
// 🔴 Paid state is read back from Stripe, never trusted from the device: a
// "succeeded" result only makes the server ask Stripe.
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { and, asc, desc, eq, gt, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireTabAnywhere } from "./auth";
import { storage } from "./storage";
import {
  organizations, posRegisters, posSales, posSaleLines, posPayments, posCounterDevices, posCounterEvents,
  shopProducts, shopProductImages, shopVariants, programs, programOptions,
} from "@shared/schema";
import { COUNTER_COOKIE, COUNTER_ONLINE_SECONDS, COUNTER_PAID_SCREEN_SECONDS, maskEmail, type CounterState } from "@shared/pos-counter";

const BASE = process.env.POS_RECEIPT_BASE_URL || "https://app.usg.co.nz";
const absUrl = (u: string | null | undefined): string | null =>
  !u ? null : /^https?:\/\//i.test(u) ? u : `${BASE}${u.startsWith("/") ? "" : "/"}${u}`;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

// No ambiguous characters: a person reads this off a reader and types it.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_TTL_MS = 15 * 60 * 1000;
function newCode(): string {
  const b = crypto.randomBytes(6);
  return Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

// ── Who is asking ────────────────────────────────────────────────────────────
function tokenFrom(req: Request): string | null {
  const auth = String(req.headers.authorization ?? "");
  const m = auth.match(/^Counter\s+([a-f0-9]{64})$/i);
  if (m) return m[1].toLowerCase();
  // ClubOS has no cookie-parser — read the raw header.
  const raw = String(req.headers.cookie ?? "");
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COUNTER_COOKIE) { const t = decodeURIComponent(v.join("=")); if (/^[a-f0-9]{64}$/i.test(t)) return t.toLowerCase(); }
  }
  return null;
}
function setCookie(res: Response, token: string) {
  // __Host-: Secure, Path=/, no Domain — first-party to app.usg.co.nz only.
  res.append("Set-Cookie", `${COUNTER_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${5 * 365 * 24 * 3600}`);
}

type Device = typeof posCounterDevices.$inferSelect;
async function deviceFor(req: Request): Promise<Device | null> {
  const t = tokenFrom(req);
  if (!t) return null;
  const [d] = await db.select().from(posCounterDevices).where(eq(posCounterDevices.tokenHash, sha(t)));
  return d && !d.revokedAt ? d : null;
}
interface DeviceReq extends Request { counter?: Device }
async function requireDevice(req: DeviceReq, res: Response, next: NextFunction) {
  try {
    const d = await deviceFor(req);
    if (!d) return res.status(401).json({ code: "COUNTER_UNKNOWN", message: "This screen is not linked." });
    req.counter = d; next();
  } catch (e: any) { res.status(500).json({ message: e.message }); }
}
async function requirePairedDevice(req: DeviceReq, res: Response, next: NextFunction) {
  await requireDevice(req, res, () => {
    if (!req.counter!.pairedAt || !req.counter!.registerId) return res.status(409).json({ code: "COUNTER_UNPAIRED", message: "This screen is not linked to a register yet." });
    next();
  });
}

/** Note a heartbeat. Written at most every 10s so a 1s poll is not a write storm. */
async function touch(d: Device, req: Request) {
  const fresh = d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < 10_000;
  const v = str(req.query.v, 40) || null, nv = str(req.query.nv, 40) || null;
  const rid = str(req.query.reader, 60) || null, rs = str(req.query.rs, 40) || null;
  const changed = (v && v !== d.appVersion) || (nv && nv !== d.nativeVersion) || (rid && rid !== d.stripeReaderId) || (rs && rs !== d.readerStatus);
  if (fresh && !changed) return;
  await db.update(posCounterDevices).set({
    lastSeenAt: new Date(),
    ...(v ? { appVersion: v } : {}), ...(nv ? { nativeVersion: nv } : {}),
    ...(rid ? { stripeReaderId: rid } : {}), ...(rs ? { readerStatus: rs } : {}),
    userAgent: str(req.headers["user-agent"], 200) || d.userAgent,
  }).where(eq(posCounterDevices.id, d.id));
}

async function logEvent(deviceId: number, level: string, message: string, meta?: unknown) {
  try {
    await db.insert(posCounterEvents).values({ deviceId, level: ["error", "warn", "info"].includes(level) ? level : "info", message: message.slice(0, 1000), meta: (meta ?? null) as any });
  } catch (e) { console.error("[COUNTER] log", e); }
}

// ── Used by the till (pos-routes.ts) ─────────────────────────────────────────
/** The live (paired, not revoked) counter screen on a register, if any. */
export async function liveCounterFor(registerId: number): Promise<(Device & { online: boolean }) | null> {
  const [d] = await db.select().from(posCounterDevices).where(and(
    eq(posCounterDevices.registerId, registerId), isNotNull(posCounterDevices.pairedAt), isNull(posCounterDevices.revokedAt),
  ));
  if (!d) return null;
  const online = !!d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < COUNTER_ONLINE_SECONDS * 1000;
  return { ...d, online };
}
export async function showOnCounter(registerId: number, saleId: number | null) {
  await db.update(posRegisters).set({ counterSaleId: saleId, counterUpdatedAt: new Date() }).where(eq(posRegisters.id, registerId));
}
export async function counterNoteForPayment(paymentId: number): Promise<string | null> {
  const [e] = await db.select().from(posCounterEvents)
    .where(and(sql`${posCounterEvents.meta}->>'paymentId' = ${String(paymentId)}`, sql`${posCounterEvents.meta}->>'kind' = 'card_result'`))
    .orderBy(desc(posCounterEvents.id)).limit(1);
  return e ? e.message : null;
}

// ── The idle screen: crests, featured kit, what's open ──────────────────────
let idleCache: { at: number; data: NonNullable<CounterState["idle"]> } | null = null;
async function idleContent(): Promise<NonNullable<CounterState["idle"]>> {
  if (idleCache && Date.now() - idleCache.at < 5 * 60 * 1000) return idleCache.data;
  const orgs = await db.select({ id: organizations.id, slug: organizations.slug, name: organizations.name, logo: organizations.logoUrl })
    .from(organizations).where(eq(organizations.active, true)).orderBy(asc(organizations.id));
  const brands = orgs.filter((o) => o.slug !== "sandbox" && o.slug !== "united-sports-group" && o.logo).map((o) => ({ name: o.name, logo: absUrl(o.logo)! }));
  const orgName = (id: number) => orgs.find((o) => o.id === id)?.name ?? "";

  // Kit that is actually in stock, with a photograph, a few per brand.
  const prods = await db.select().from(shopProducts).where(eq(shopProducts.status, "active")).orderBy(asc(shopProducts.sortOrder));
  const ids = prods.map((p) => p.id);
  const [imgs, stock] = ids.length ? await Promise.all([
    db.select().from(shopProductImages).where(inArray(shopProductImages.productId, ids)).orderBy(asc(shopProductImages.sortOrder)),
    db.select({ pid: shopVariants.productId, n: sql<number>`sum(${shopVariants.stock})::int` }).from(shopVariants)
      .where(and(inArray(shopVariants.productId, ids), eq(shopVariants.active, true))).groupBy(shopVariants.productId),
  ]) : [[], []];
  const perBrand = new Map<number, number>();
  const products: NonNullable<CounterState["idle"]>["products"] = [];
  for (const p of prods) {
    const img = imgs.find((i) => i.productId === p.id);
    const inStock = (stock.find((s) => s.pid === p.id)?.n ?? 0) > 0;
    if (!img || !inStock || p.priceCents <= 0) continue;
    const n = perBrand.get(p.organizationId) ?? 0;
    if (n >= 4) continue;
    perBrand.set(p.organizationId, n + 1);
    products.push({ title: p.title, brand: orgName(p.organizationId), priceCents: p.priceCents, image: absUrl(img.url)! });
    if (products.length >= 16) break;
  }

  const progRows = await db.select({ p: programs, o: programOptions }).from(programs)
    .leftJoin(programOptions, and(eq(programOptions.programId, programs.id), eq(programOptions.isActive, true)))
    .where(and(eq(programs.isActive, true), eq((programs as any).registrationOpen, true)));
  const byProg = new Map<number, { name: string; brand: string; fromCents: number | null }>();
  for (const r of progRows) {
    const p: any = r.p;
    if (!["academy", "holiday_camp"].includes(p.type)) continue;
    const cur = byProg.get(p.id) ?? { name: p.name, brand: orgName(p.organizationId), fromCents: null };
    const price = r.o?.fullPriceCents ?? 0;
    if (price > 0 && (cur.fromCents == null || price < cur.fromCents)) cur.fromCents = price;
    byProg.set(p.id, cur);
  }
  const programmes = Array.from(byProg.values()).slice(0, 8);

  const data = { brands, products, programmes };
  idleCache = { at: Date.now(), data };
  return data;
}

// ── What the screen should show right now ───────────────────────────────────
async function stateFor(d: Device): Promise<CounterState> {
  const base = { serverTime: new Date().toISOString(), deviceId: d.id };
  if (!d.pairedAt || !d.registerId) {
    return { ...base, screen: "pair", paired: false, code: d.pairingCode, codeExpiresAt: d.pairingExpiresAt?.toISOString() ?? null, register: null, sale: null, charge: null, idle: null };
  }
  const [register] = await db.select().from(posRegisters).where(eq(posRegisters.id, d.registerId));
  const reg = register ? { id: register.id, name: register.name } : null;
  const idle = await idleContent();
  const none = { ...base, paired: true, code: null, codeExpiresAt: null, register: reg, sale: null, charge: null, idle };
  if (!register?.counterSaleId) return { ...none, screen: "idle" };

  const [sale] = await db.select().from(posSales).where(eq(posSales.id, register.counterSaleId));
  if (!sale || sale.registerId !== register.id || sale.status === "void") return { ...none, screen: "idle" };
  const lines = await db.select().from(posSaleLines).where(eq(posSaleLines.saleId, sale.id)).orderBy(asc(posSaleLines.sort), asc(posSaleLines.id));
  if (!lines.length) return { ...none, screen: "idle" };
  const payments = await db.select().from(posPayments).where(eq(posPayments.saleId, sale.id)).orderBy(asc(posPayments.id));
  const orgIds = Array.from(new Set(lines.map((l) => l.organizationId)));
  const orgs = await db.select({ id: organizations.id, name: organizations.name, logo: organizations.logoUrl }).from(organizations).where(inArray(organizations.id, orgIds));

  const saleView: NonNullable<CounterState["sale"]> = {
    id: sale.id, number: sale.saleNumber, status: sale.status,
    lines: lines.map((l) => {
      const o = orgs.find((x) => x.id === l.organizationId);
      // "Default · L" — a product with one colour names it "Default"; a customer needs only the size.
      return { id: l.id, title: l.title, detail: l.detail ? l.detail.replace(/^Default\s*·\s*/i, "") || null : null, qty: l.qty, unitCents: l.unitCents, lineCents: l.lineCents, image: absUrl((l.meta as any)?.imageUrl) ?? null, brand: o?.name ?? "", brandLogo: absUrl(o?.logo) };
    }),
    subtotalCents: sale.subtotalCents, discountCents: sale.discountCents, totalCents: sale.totalCents, gstCents: sale.gstCents,
    paidCents: sale.paidCents, remainingCents: Math.max(0, sale.totalCents - sale.paidCents),
    paidAt: sale.paidAt?.toISOString() ?? null,
    paidBy: payments.filter((p) => p.status === "succeeded").map((p) => p.method === "card_present" ? "Card" : p.method === "eftpos" ? "EFTPOS" : p.method === "cash" ? "Cash" : p.method === "bank_transfer" ? "Bank transfer" : "Other"),
    receiptSentTo: sale.receiptSentAt && sale.customerEmail ? maskEmail(sale.customerEmail) : null,
  };

  if (sale.status !== "open") {
    const recent = sale.paidAt && Date.now() - new Date(sale.paidAt).getTime() < COUNTER_PAID_SCREEN_SECONDS * 1000;
    return recent ? { ...none, screen: "paid", sale: saleView } : { ...none, screen: "idle" };
  }
  const pending = payments.find((p) => p.status === "pending" && p.channel === "counter");
  if (pending) {
    const note = await counterNoteForPayment(pending.id);
    return {
      ...none, screen: "pay", sale: saleView,
      charge: { paymentId: pending.id, amountCents: pending.amountCents, claimed: !!pending.collectStartedAt, lastError: note },
    };
  }
  return { ...none, screen: "cart", sale: saleView };
}

// ── A small per-IP limiter for the unauthenticated start call ───────────────
const starts = new Map<string, number[]>();
function startAllowed(ip: string): boolean {
  const now = Date.now();
  const recent = (starts.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= 30) { starts.set(ip, recent); return false; }
  recent.push(now); starts.set(ip, recent);
  return true;
}

export function registerPosCounterRoutes(app: Express) {
  const noStore = (_req: Request, res: Response, next: NextFunction) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Robots-Tag", "noindex"); next(); };

  // ── Device: start or resume ────────────────────────────────────────────────
  app.post("/api/public/pos/counter/start", noStore, async (req, res) => {
    try {
      const existing = await deviceFor(req);
      if (existing) {
        // An unpaired screen whose code has lapsed gets a fresh one.
        if (!existing.pairedAt && (!existing.pairingExpiresAt || existing.pairingExpiresAt.getTime() < Date.now())) {
          for (let i = 0; i < 5; i++) {
            try {
              await db.update(posCounterDevices).set({ pairingCode: newCode(), pairingExpiresAt: new Date(Date.now() + CODE_TTL_MS) }).where(eq(posCounterDevices.id, existing.id));
              break;
            } catch (e: any) { if (!/pairing_code_unq/.test(String(e?.message))) throw e; }
          }
        }
        await touch(existing, req);
        const [fresh] = await db.select().from(posCounterDevices).where(eq(posCounterDevices.id, existing.id));
        return res.json(await stateFor(fresh));
      }
      const ip = String(req.headers["fly-client-ip"] ?? req.ip ?? "");
      if (!startAllowed(ip)) return res.status(429).json({ message: "Too many new screens from here. Try again in an hour." });
      // Lapsed codes stop being "outstanding" so they can never collide.
      await db.update(posCounterDevices).set({ pairingCode: null }).where(and(isNull(posCounterDevices.pairedAt), sql`${posCounterDevices.pairingExpiresAt} < now()`));
      const token = crypto.randomBytes(32).toString("hex");
      let device: Device | null = null;
      for (let i = 0; i < 5 && !device; i++) {
        try {
          [device] = await db.insert(posCounterDevices).values({
            tokenHash: sha(token), pairingCode: newCode(), pairingExpiresAt: new Date(Date.now() + CODE_TTL_MS),
            userAgent: str(req.headers["user-agent"], 200) || null, lastSeenAt: new Date(),
          }).returning();
        } catch (e: any) { if (!/pairing_code_unq/.test(String(e?.message))) throw e; }
      }
      if (!device) return res.status(503).json({ message: "Couldn't make a code. Try again." });
      setCookie(res, token);
      await logEvent(device.id, "info", "New counter screen started", { ua: str(req.headers["user-agent"], 200) });
      res.status(201).json({ ...(await stateFor(device)), token });
    } catch (e: any) { console.error("[COUNTER] start", e); res.status(500).json({ message: e.message }); }
  });

  // ── Device: what to show ───────────────────────────────────────────────────
  app.get("/api/public/pos/counter/state", noStore, requireDevice as any, async (req: DeviceReq, res) => {
    try {
      await touch(req.counter!, req);
      res.json(await stateFor(req.counter!));
    } catch (e: any) { console.error("[COUNTER] state", e); res.status(500).json({ message: e.message }); }
  });

  /** The payment must be a pending COUNTER payment on a sale of THIS screen's register. */
  async function paymentForDevice(d: Device, pid: number) {
    const [row] = await db.select({ p: posPayments, s: posSales }).from(posPayments)
      .innerJoin(posSales, eq(posSales.id, posPayments.saleId)).where(eq(posPayments.id, pid));
    if (!row || row.s.registerId !== d.registerId || row.p.channel !== "counter") return null;
    return row;
  }

  // ── Device: claim the card prompt ─────────────────────────────────────────
  // 🔴 One claim per payment. A screen that reloads mid-prompt must never ask
  // the customer to tap twice; the till's Cancel is the way out of a stuck one.
  app.post("/api/public/pos/counter/payments/:pid/claim", noStore, requirePairedDevice as any, async (req: DeviceReq, res) => {
    try {
      const d = req.counter!;
      const row = await paymentForDevice(d, num(req.params.pid));
      if (!row) return res.status(404).json({ message: "No such payment for this screen." });
      if (row.p.status !== "pending") return res.status(409).json({ code: "COUNTER_NOT_PENDING", message: `That payment is ${row.p.status}.` });
      const retry = req.body?.retry === true;
      const claimed = await db.execute(retry
        ? sql`UPDATE pos_payments SET collect_started_at = now() WHERE id = ${row.p.id} AND status = 'pending' RETURNING id`
        : sql`UPDATE pos_payments SET collect_started_at = now() WHERE id = ${row.p.id} AND status = 'pending' AND collect_started_at IS NULL RETURNING id`);
      if (!claimed.rowCount) return res.status(409).json({ code: "COUNTER_CLAIMED", message: "The card prompt is already showing." });
      const { stripeForAccount } = await import("./pos-routes");
      const { stripe, ok, reason } = stripeForAccount(row.s.moneyAccount);
      if (!ok) return res.status(409).json({ message: reason });
      const pi = await stripe.paymentIntents.retrieve(row.p.stripePaymentIntentId!);
      if (pi.status === "succeeded" || pi.status === "canceled") return res.status(409).json({ code: "COUNTER_PI_DONE", message: `That payment is already ${pi.status}.` });
      await logEvent(d.id, "info", `Card prompt shown for ${row.s.saleNumber}`, { kind: "claim", paymentId: row.p.id, amountCents: row.p.amountCents, retry });
      res.json({ paymentId: row.p.id, clientSecret: pi.client_secret, amountCents: row.p.amountCents, saleNumber: row.s.saleNumber });
    } catch (e: any) { console.error("[COUNTER] claim", e); res.status(500).json({ message: e.message }); }
  });

  // ── Device: how the card prompt ended ─────────────────────────────────────
  // "succeeded" only makes us ASK Stripe. A decline or a customer cancel leaves
  // the payment pending and unclaimed, so they can try another card; the till's
  // Cancel ends it for good.
  app.post("/api/public/pos/counter/payments/:pid/result", noStore, requirePairedDevice as any, async (req: DeviceReq, res) => {
    try {
      const d = req.counter!;
      const row = await paymentForDevice(d, num(req.params.pid));
      if (!row) return res.status(404).json({ message: "No such payment for this screen." });
      const outcome = str(req.body?.outcome, 20);
      const message = str(req.body?.message, 300);
      const { stripeForAccount, markPosPaymentSucceededByIntent } = await import("./pos-routes");
      const { stripe } = stripeForAccount(row.s.moneyAccount);
      let pi = await stripe.paymentIntents.retrieve(row.p.stripePaymentIntentId!);
      if (pi.status === "requires_capture") pi = await stripe.paymentIntents.capture(pi.id);
      if (pi.status === "succeeded") {
        await markPosPaymentSucceededByIntent(pi as any);
        await logEvent(d.id, "info", `Paid by card — ${row.s.saleNumber}`, { kind: "card_result", paymentId: row.p.id, outcome: "succeeded" });
        return res.json({ stripeStatus: pi.status });
      }
      if (row.p.status === "pending") await db.update(posPayments).set({ collectStartedAt: null }).where(and(eq(posPayments.id, row.p.id), eq(posPayments.status, "pending")));
      const human = outcome === "canceled" ? "The customer cancelled on the reader."
        : outcome === "unavailable" ? "The card reader wasn't ready — try again in a moment."
        : message ? `Card not accepted: ${message}` : "The card was not accepted.";
      await logEvent(d.id, outcome === "canceled" ? "info" : "warn", human, { kind: "card_result", paymentId: row.p.id, outcome, stripeStatus: pi.status, raw: message });
      res.json({ stripeStatus: pi.status });
    } catch (e: any) { console.error("[COUNTER] result", e); res.status(500).json({ message: e.message }); }
  });

  // ── Device: the customer asks for a receipt ───────────────────────────────
  app.post("/api/public/pos/counter/sales/:id/receipt", noStore, requirePairedDevice as any, async (req: DeviceReq, res) => {
    try {
      const d = req.counter!;
      const [sale] = await db.select().from(posSales).where(eq(posSales.id, num(req.params.id)));
      if (!sale || sale.registerId !== d.registerId || !sale.paidAt) return res.status(404).json({ message: "Not found." });
      if (Date.now() - sale.paidAt.getTime() > 15 * 60 * 1000) return res.status(409).json({ message: "Ask at the counter for this receipt." });
      const email = str(req.body?.email, 200).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ message: "That email address doesn't look right." });
      // A receipt is not a marketing sign-up: marketing_opt_in_at is untouched.
      await db.update(posSales).set({ customerEmail: email }).where(eq(posSales.id, sale.id));
      const { sendPosReceiptForSale } = await import("./pos-routes");
      const sent = await sendPosReceiptForSale(sale.id, email);
      await logEvent(d.id, sent ? "info" : "warn", sent ? `Receipt emailed for ${sale.saleNumber}` : `Receipt failed for ${sale.saleNumber}`, { kind: "receipt", saleId: sale.id });
      res.json({ sent, to: maskEmail(email) });
    } catch (e: any) { console.error("[COUNTER] receipt", e); res.status(500).json({ message: e.message }); }
  });

  // ── Device: a Terminal connection token for the native SDK ────────────────
  app.post("/api/public/pos/counter/connection-token", noStore, requirePairedDevice as any, async (req: DeviceReq, res) => {
    try {
      const d = req.counter!;
      const [register] = await db.select().from(posRegisters).where(eq(posRegisters.id, d.registerId!));
      const { stripeForAccount, readerAccountForRegister } = await import("./pos-routes");
      const { stripe, ok, reason } = stripeForAccount(await readerAccountForRegister(register));
      if (!ok) return res.status(409).json({ message: reason });
      const token = await stripe.terminal.connectionTokens.create(register.stripeLocationId ? { location: register.stripeLocationId } : {});
      res.json({ secret: token.secret });
    } catch (e: any) { console.error("[COUNTER] connection token", e); res.status(500).json({ message: e.message }); }
  });

  // ── Device: logs ──────────────────────────────────────────────────────────
  app.post("/api/public/pos/counter/log", noStore, requireDevice as any, async (req: DeviceReq, res) => {
    try {
      const d = req.counter!;
      const items = Array.isArray(req.body?.events) ? req.body.events.slice(0, 50) : [req.body];
      for (const it of items) {
        const message = str(it?.message, 1000);
        if (message) await logEvent(d.id, str(it?.level, 10), message, it?.meta ?? null);
      }
      // Keep the newest 2,000 per screen.
      if (Math.random() < 0.05) await db.execute(sql`DELETE FROM pos_counter_events WHERE device_id = ${d.id} AND id < (SELECT id FROM pos_counter_events WHERE device_id = ${d.id} ORDER BY id DESC OFFSET 2000 LIMIT 1)`);
      res.status(204).end();
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── Staff: status, pair, unpair ───────────────────────────────────────────
  const gate = [requireAuth, requireTabAnywhere("pos")] as const;

  app.get("/api/admin/pos/registers/:id/counter", ...gate, async (req, res) => {
    try {
      const registerId = num(req.params.id);
      const d = await liveCounterFor(registerId);
      if (!d) return res.json({ counter: null });
      const events = await db.select().from(posCounterEvents).where(eq(posCounterEvents.deviceId, d.id)).orderBy(desc(posCounterEvents.id)).limit(30);
      res.json({
        counter: {
          id: d.id, label: d.label, online: d.online, lastSeenAt: d.lastSeenAt, pairedAt: d.pairedAt,
          appVersion: d.appVersion, nativeVersion: d.nativeVersion, stripeReaderId: d.stripeReaderId, readerStatus: d.readerStatus,
        },
        events: events.map((e) => ({ id: e.id, level: e.level, message: e.message, at: e.createdAt })),
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/admin/pos/registers/:id/counter", ...gate, async (req, res) => {
    try {
      const registerId = num(req.params.id);
      const [register] = await db.select().from(posRegisters).where(eq(posRegisters.id, registerId));
      if (!register) return res.status(404).json({ message: "Register not found." });
      const code = str(req.body?.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (code.length !== 6) return res.status(400).json({ message: "Enter the 6-character code shown on the counter screen." });
      const [d] = await db.select().from(posCounterDevices).where(and(
        eq(posCounterDevices.pairingCode, code), isNull(posCounterDevices.pairedAt), isNull(posCounterDevices.revokedAt),
        gt(posCounterDevices.pairingExpiresAt, new Date()),
      ));
      if (!d) return res.status(404).json({ message: "No screen is showing that code. Codes last 15 minutes — check the screen and try again." });
      const me = req.session.userId as number;
      await db.transaction(async (tx) => {
        // A register has one counter screen: the new one replaces the old.
        await tx.update(posCounterDevices).set({ revokedAt: new Date(), revokedByUserId: me })
          .where(and(eq(posCounterDevices.registerId, registerId), isNotNull(posCounterDevices.pairedAt), isNull(posCounterDevices.revokedAt)));
        await tx.update(posCounterDevices).set({ registerId, pairedAt: new Date(), pairedByUserId: me, pairingCode: null, pairingExpiresAt: null, label: str(req.body?.label, 60) || register.name })
          .where(eq(posCounterDevices.id, d.id));
      });
      await storage.createAuditLog({ userId: me, action: "update", entity: "pos_register", entityId: registerId, details: `Linked counter screen #${d.id} to ${register.name}` } as any);
      await logEvent(d.id, "info", `Linked to ${register.name}`);
      const live = await liveCounterFor(registerId);
      res.status(201).json({ counter: live ? { id: live.id, label: live.label, online: live.online, pairedAt: live.pairedAt } : null });
    } catch (e: any) { console.error("[COUNTER] pair", e); res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/admin/pos/registers/:id/counter", ...gate, async (req, res) => {
    try {
      const registerId = num(req.params.id);
      const d = await liveCounterFor(registerId);
      if (!d) return res.json({ counter: null });
      const me = req.session.userId as number;
      await db.update(posCounterDevices).set({ revokedAt: new Date(), revokedByUserId: me }).where(eq(posCounterDevices.id, d.id));
      await storage.createAuditLog({ userId: me, action: "update", entity: "pos_register", entityId: registerId, details: `Unlinked counter screen #${d.id}` } as any);
      res.json({ counter: null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}

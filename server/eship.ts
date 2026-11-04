// NZ Post eShip for the club shops (4 Nov 2026).
//
// Daniel: "integrate clubos shop … with nz post eship like we had on shopify".
// eShip is NZ Post's white-label of Starshipit, and the Starshipit API is the
// documented way to push orders from a platform eShip has no plug-in for
// (Settings → API in eShip holds the two keys; docs: api-docs.starshipit.com).
//
// The shape, same as Shopify gave us:
//   1. A PAID delivery order is pushed into eShip as an unshipped order.
//   2. Dima prints the label in eShip exactly as before.
//   3. The tracking number comes back onto the order, the order reads
//      "shipped" and the customer gets ONE "on its way" email.
//
// 🔴 Nothing here sits inside the payment path. finalizeShopOrderPaid is
//    untouched; a sweep picks paid orders up afterwards, so eShip being down
//    can never fail, delay or double a payment.
// 🔴 One eShip order per shop order. A push is CLAIMED with an atomic UPDATE
//    (prod runs two machines), and a retry first asks eShip whether the order
//    already landed, so a timeout that actually succeeded is adopted rather
//    than created twice. eship_order_id is unique in Postgres.
// 🔴 The webhook is a doorbell, never a source of truth. Its body is not
//    trusted: it triggers a read of eShip's own shipped list, and only what
//    eShip's API says is written.
// 🔴 INERT until configured: no keys → nothing is sent; auto-push needs
//    ESHIP_AUTO_BRANDS and ESHIP_PUSH_FROM, so orders paid before the switch
//    (already posted by hand) are never pushed in.
// 🔴 International orders are not pushed — the shop holds no country field,
//    so a label would carry a guessed destination. They stay for eShip by hand.

import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { shopOrders, shopOrderItems, shopVariants } from "@shared/schema";
import type { ShopOrder } from "@shared/schema";
import { requireAuth, requireTab } from "./auth";
import { shopBrandForOrg, shopBrandKeys, shopBrandOrgId } from "./shop-routes";
import { sendShopOrderShipped } from "./email";

const API_BASE = (process.env.ESHIP_API_BASE || "https://api.starshipit.com").replace(/\/+$/, "");
const MAX_AUTO_ATTEMPTS = 5;
const CLAIM_TTL_MINUTES = 10;
const PUSHABLE_STATUSES = ["paid", "processing"];

// ─── Config ──────────────────────────────────────────────────────────────────

interface Creds { apiKey: string; subscriptionKey: string }

/** Per brand first (ESHIP_SIU_API_KEY), then the shared pair (ESHIP_API_KEY). */
export function eshipCreds(brandKey: string): Creds | null {
  const up = brandKey.toUpperCase();
  const apiKey = process.env[`ESHIP_${up}_API_KEY`] || process.env.ESHIP_API_KEY || "";
  const subscriptionKey = process.env[`ESHIP_${up}_SUBSCRIPTION_KEY`] || process.env.ESHIP_SUBSCRIPTION_KEY || "";
  return apiKey && subscriptionKey ? { apiKey, subscriptionKey } : null;
}

function autoBrands(): string[] {
  return String(process.env.ESHIP_AUTO_BRANDS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function pushFrom(): Date | null {
  const raw = process.env.ESHIP_PUSH_FROM;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export function isInternational(order: Pick<ShopOrder, "shippingLabel">): boolean {
  return /australia|international|world|overseas/i.test(order.shippingLabel || "");
}

export function trackingUrl(trackingNumber: string): string {
  return `https://www.nzpost.co.nz/tools/tracking/item/${encodeURIComponent(trackingNumber)}`;
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

class EshipError extends Error {
  constructor(message: string, public status: number, public ambiguous = false) { super(message); }
}

async function call(creds: Creds, method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let res: globalThis.Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "StarShipIT-Api-Key": creds.apiKey,
        "Ocp-Apim-Subscription-Key": creds.subscriptionKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    // No answer at all: for a POST we cannot know whether it landed.
    throw new EshipError(`eShip did not answer (${e?.name === "AbortError" ? "timed out" : e?.message || "network"})`, 0, method === "POST");
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok || json?.success === false) {
    const detail = Array.isArray(json?.errors) && json.errors.length
      ? json.errors.map((e: any) => [e.message, e.details].filter(Boolean).join(": ")).join("; ")
      : (json?.message || text.slice(0, 200) || res.statusText);
    // A 5xx on a POST is also ambiguous; a 4xx is a clean refusal.
    throw new EshipError(`eShip ${res.status}: ${detail}`, res.status, method === "POST" && res.status >= 500);
  }
  return json;
}

// ─── Building the order ──────────────────────────────────────────────────────

export async function buildEshipOrder(order: ShopOrder) {
  const brand = shopBrandForOrg(order.organizationId);
  const items = await db.select().from(shopOrderItems).where(eq(shopOrderItems.orderId, order.id));
  const variantIds = items.map((i) => i.variantId).filter((v): v is number => v != null);
  const skus = new Map<number, string | null>();
  if (variantIds.length) {
    for (const v of await db.select({ id: shopVariants.id, sku: shopVariants.sku }).from(shopVariants).where(inArray(shopVariants.id, variantIds))) {
      skus.set(v.id, v.sku);
    }
  }
  // Weight is left to eShip's own Package Setup unless a default is set here;
  // the shop holds no product weights and none is invented.
  const kg = Number(process.env.ESHIP_DEFAULT_ITEM_KG || "");
  return {
    order: {
      order_number: order.orderNumber || `#${order.id}`,
      order_date: new Date(order.paidAt || order.createdAt).toISOString(),
      reference: brand?.storeName || "Club shop",
      shipping_method: order.shippingLabel || undefined,
      signature_required: false,
      currency: order.currency || "NZD",
      destination: {
        name: `${order.firstName} ${order.lastName}`.trim(),
        email: order.email,
        phone: order.phone,
        street: [order.addressLine1, order.addressLine2].filter(Boolean).join(", "),
        suburb: order.suburb || undefined,
        city: order.city || undefined,
        post_code: order.postcode || undefined,
        country: "New Zealand",
      },
      items: items.map((i) => ({
        description: [i.title, [i.colourName, i.size].filter(Boolean).join(" / ")].filter(Boolean).join(" — "),
        sku: (i.variantId != null ? skus.get(i.variantId) : null) || undefined,
        quantity: i.qty,
        value: Math.round(i.lineCents / Math.max(i.qty, 1)) / 100,
        ...(kg > 0 ? { weight: kg } : {}),
      })),
    },
  };
}

// ─── Push ────────────────────────────────────────────────────────────────────

async function findExisting(creds: Creds, orderNumber: string): Promise<number | null> {
  for (const status of ["Unshipped", "Printed", "Shipped"]) {
    try {
      const r = await call(creds, "GET", `/api/orders?order_number=${encodeURIComponent(orderNumber)}&status=${status}`);
      const id = r?.order?.order_id ?? r?.orders?.[0]?.order_id;
      if (id) return Number(id);
    } catch (e: any) {
      if (e instanceof EshipError && e.status === 404) continue;
      throw e;
    }
  }
  return null;
}

export type PushResult =
  | { ok: true; eshipOrderId: number; adopted: boolean }
  | { ok: false; reason: string };

/** Push one paid delivery order. Safe to call from both machines at once. */
export async function pushOrderToEship(orderId: number): Promise<PushResult> {
  const [peek] = await db.select().from(shopOrders).where(eq(shopOrders.id, orderId));
  if (!peek) return { ok: false, reason: "Order not found" };
  const brand = shopBrandForOrg(peek.organizationId);
  if (!brand) return { ok: false, reason: "Not a shop order" };
  const creds = eshipCreds(brand.brandKey);
  if (!creds) return { ok: false, reason: `eShip is not connected for ${brand.storeName}` };
  if (peek.eshipOrderId) return { ok: true, eshipOrderId: peek.eshipOrderId, adopted: true };
  if (!peek.addressLine1) return { ok: false, reason: "This is a pickup order — nothing to post" };
  if (isInternational(peek)) return { ok: false, reason: "International order — create it in eShip by hand (the shop holds no country)" };
  if (!PUSHABLE_STATUSES.includes(peek.status)) return { ok: false, reason: `This order is ${peek.status.replace(/_/g, " ")}` };

  // Claim it. Only one machine gets the row.
  const claimed: any = await db.execute(sql`
    UPDATE shop_orders
       SET eship_claimed_at = now(), eship_attempts = COALESCE(eship_attempts, 0) + 1
     WHERE id = ${orderId} AND eship_order_id IS NULL
       AND (eship_claimed_at IS NULL OR eship_claimed_at < now() - make_interval(mins => ${CLAIM_TTL_MINUTES}))
     RETURNING id, eship_attempts`);
  const claimRow = (Array.isArray(claimed) ? claimed : claimed?.rows ?? [])[0];
  if (!claimRow) return { ok: false, reason: "Already being sent — try again in a minute" };

  const orderNumber = peek.orderNumber || `#${peek.id}`;
  const settle = async (fields: Partial<typeof shopOrders.$inferInsert>) => {
    await db.update(shopOrders).set({ ...fields, eshipClaimedAt: null, updatedAt: new Date() }).where(eq(shopOrders.id, orderId));
  };

  try {
    // A previous attempt may have landed without us hearing back.
    if (Number(claimRow.eship_attempts) > 1 || peek.eshipError) {
      const existing = await findExisting(creds, orderNumber);
      if (existing) {
        await settle({ eshipOrderId: existing, eshipPushedAt: new Date(), eshipError: null });
        return { ok: true, eshipOrderId: existing, adopted: true };
      }
    }
    const payload = await buildEshipOrder(peek);
    const r = await call(creds, "POST", "/api/orders", payload);
    const id = Number(r?.order?.order_id);
    if (!id) throw new EshipError("eShip accepted the order but returned no id", 0, true);
    await settle({ eshipOrderId: id, eshipPushedAt: new Date(), eshipError: null });
    console.log(`[eShip] ${orderNumber} → eShip order ${id}`);
    return { ok: true, eshipOrderId: id, adopted: false };
  } catch (e: any) {
    const msg = e instanceof EshipError
      ? (e.ambiguous ? `${e.message} — will check eShip before trying again` : e.message)
      : `Unexpected error: ${e?.message || e}`;
    await settle({ eshipError: msg.slice(0, 500) }).catch(() => {});
    console.error(`[eShip] push ${orderNumber} failed:`, msg);
    return { ok: false, reason: msg };
  }
}

// ─── Tracking back ───────────────────────────────────────────────────────────

/** Read eShip's shipped list for one brand and write tracking onto our orders. */
export async function syncShippedForBrand(brandKey: string, sinceHours = 72): Promise<{ updated: number; emailed: number }> {
  const creds = eshipCreds(brandKey);
  const brand = shopBrandKeys().includes(brandKey) ? brandKey : null;
  if (!creds || !brand) return { updated: 0, emailed: 0 };
  const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  let updated = 0, emailed = 0;
  for (let page = 1; page <= 10; page++) {
    const r = await call(creds, "GET", `/api/orders/shipped?since_last_updated=${encodeURIComponent(since)}&limit=250&page=${page}`);
    const list: any[] = Array.isArray(r?.orders) ? r.orders : [];
    const ids = list.map((o) => Number(o.order_id)).filter(Boolean);
    if (ids.length) {
      const ours = await db.select().from(shopOrders).where(inArray(shopOrders.eshipOrderId, ids));
      for (const row of ours) {
        const s = list.find((o) => Number(o.order_id) === row.eshipOrderId);
        if (!s?.tracking_number) continue;
        const res = await applyTracking(row, {
          trackingNumber: String(s.tracking_number),
          carrier: s.carrier_name || s.carrier || null,
          status: s.tracking_full_status || s.tracking_short_status || "Shipped",
        });
        if (res.changed) updated++;
        if (res.emailed) emailed++;
      }
    }
    if (!r?.total_pages || page >= Number(r.total_pages)) break;
  }
  return { updated, emailed };
}

async function applyTracking(row: ShopOrder, t: { trackingNumber: string; carrier: string | null; status: string }) {
  const changed = row.trackingNumber !== t.trackingNumber || row.trackingStatus !== t.status;
  if (changed) {
    await db.update(shopOrders).set({
      trackingNumber: t.trackingNumber,
      trackingCarrier: t.carrier,
      trackingStatus: t.status,
      trackingUpdatedAt: new Date(),
      // Fulfilment moves forward only; a completed/refunded order is left alone.
      ...(PUSHABLE_STATUSES.includes(row.status) ? { status: "shipped" } : {}),
      updatedAt: new Date(),
    }).where(eq(shopOrders.id, row.id));
  }
  // The email goes once, whichever machine gets here first.
  let emailed = false;
  const gate: any = await db.execute(sql`
    UPDATE shop_orders SET shipped_email_sent_at = now()
     WHERE id = ${row.id} AND shipped_email_sent_at IS NULL RETURNING id`);
  if ((Array.isArray(gate) ? gate : gate?.rows ?? []).length) {
    emailed = await sendShopOrderShipped({
      to: row.email,
      firstName: row.firstName,
      orderNumber: row.orderNumber || `#${row.id}`,
      trackingNumber: t.trackingNumber,
      carrierName: t.carrier,
      trackingUrl: trackingUrl(t.trackingNumber),
      brandKey: shopBrandForOrg(row.organizationId)?.brandKey,
    }).catch((e) => { console.error("[eShip] shipped email failed:", e); return false; });
  }
  return { changed, emailed };
}

// ─── Sweep ───────────────────────────────────────────────────────────────────

let sweeping = false;
export async function runEshipSweep(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const from = pushFrom();
    const brands = autoBrands().filter((b) => eshipCreds(b));
    if (from && brands.length) {
      const orgIds = brands.map((b) => shopBrandOrgId(b)).filter((n): n is number => n != null);
      if (orgIds.length) {
        const due = await db.select({ id: shopOrders.id }).from(shopOrders).where(and(
          inArray(shopOrders.organizationId, orgIds),
          inArray(shopOrders.status, PUSHABLE_STATUSES),
          isNull(shopOrders.eshipOrderId),
          sql`${shopOrders.addressLine1} IS NOT NULL`,
          sql`${shopOrders.paidAt} >= ${from}`,
          sql`COALESCE(${shopOrders.eshipAttempts}, 0) < ${MAX_AUTO_ATTEMPTS}`,
          sql`NOT (COALESCE(${shopOrders.shippingLabel}, '') ~* 'australia|international|world|overseas')`,
        )).limit(50);
        for (const o of due) await pushOrderToEship(o.id);
      }
    }
    // Tracking for every brand with keys (manual pushes too).
    for (const b of shopBrandKeys()) {
      if (!eshipCreds(b)) continue;
      try { await syncShippedForBrand(b); } catch (e: any) { console.error(`[eShip] tracking sync ${b} failed:`, e?.message || e); }
    }
  } catch (e) {
    console.error("[eShip] sweep error:", e);
  } finally {
    sweeping = false;
  }
}

export function startEshipCron() {
  const anyKeys = shopBrandKeys().some((b) => eshipCreds(b));
  if (!anyKeys) { console.log("[eShip] not configured — sweep off"); return; }
  setInterval(runEshipSweep, 5 * 60 * 1000);
  setTimeout(runEshipSweep, 45 * 1000);
  console.log(`[eShip] sweep on · auto-push: ${autoBrands().join(",") || "none"} from ${pushFrom()?.toISOString() || "(not set)"}`);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const HUB_WORKSPACE = "united-prints";
function hubGuard(req: Request, res: Response, next: NextFunction) {
  if (String(req.headers["x-workspace-slug"] || "") !== HUB_WORKSPACE) return res.status(404).json({ message: "Not found" });
  next();
}

export function registerEshipRoutes(app: Express) {
  const gate = [requireAuth, requireTab("shop-orders"), hubGuard] as const;

  // Dima's "Send to eShip" button on the Shop Orders tab.
  app.post("/api/admin/shop-orders/:id/eship", ...gate, async (req, res) => {
    const id = parseInt(String(req.params.id));
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Bad order id" });
    const r = await pushOrderToEship(id);
    if (r.ok) return res.json(r);
    return res.status(409).json({ message: r.reason });
  });

  // "Check eShip for tracking now" — the same read the sweep does.
  app.post("/api/admin/shop-orders/eship/sync", ...gate, async (_req, res) => {
    let updated = 0, emailed = 0;
    const errors: string[] = [];
    for (const b of shopBrandKeys()) {
      if (!eshipCreds(b)) continue;
      try { const r = await syncShippedForBrand(b, 24 * 14); updated += r.updated; emailed += r.emailed; }
      catch (e: any) { errors.push(`${b}: ${e?.message || e}`); }
    }
    res.json({ updated, emailed, errors });
  });

  app.get("/api/admin/shop-orders/eship/status", ...gate, (_req, res) => {
    res.json({
      brands: shopBrandKeys().map((b) => ({ key: b, connected: !!eshipCreds(b), autoPush: autoBrands().includes(b) })),
      pushFrom: pushFrom()?.toISOString() || null,
    });
  });

  // eShip → Settings → Tracking & notifications → webhook URL.
  // The body is a doorbell only (see top of file); always answer 200 fast.
  let lastRing = 0;
  app.post("/api/public/eship/webhook/:secret", (req, res) => {
    const secret = process.env.ESHIP_WEBHOOK_SECRET || "";
    if (!secret || req.params.secret !== secret) return res.status(404).end();
    res.status(200).json({ ok: true });
    const now = Date.now();
    if (now - lastRing < 15_000) return; // a burst of updates → one read
    lastRing = now;
    setTimeout(() => {
      for (const b of shopBrandKeys()) {
        if (eshipCreds(b)) syncShippedForBrand(b, 48).catch((e) => console.error("[eShip] webhook sync failed:", e?.message || e));
      }
    }, 2000);
  });
}

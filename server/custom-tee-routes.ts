// ─────────────────────────────────────────────────────────────────────────────
// UNITED PRINTS — custom one-off tees (shop.unitedprints.co.nz/print/pet-tees).
//
//   GET  /api/public/unitedprints/custom-tee/:slug          what is sold + prices
//   POST /api/public/unitedprints/custom-tee/cutout         photo in → pet cut out (PNG)
//   POST /api/public/unitedprints/custom-tee/:slug/order    order + files + card payment
//   GET  /api/admin/print-custom-file?k=…                   staff download of a file
//
// 🔴 The order is an ordinary `print_orders` row, so it shows in Dima's Orders
// tab and is paid through the SAME webhook branch as every other print order
// (PaymentIntent metadata.printOrderId → handlePrintPaymentSuccess → the
// customer's confirmation + Dima's "new paid order" email). Nothing is emailed
// before the money lands, so this form cannot be used to mail a stranger.
//
// 🔴 The price is `priceCustomTeeOrder()` from shared/custom-tees.ts, worked out
// here from the sizes sent. The browser never sends an amount.
//
// 🔴 Files go through the Club Drive storage adapter and are opened by staff
// through a signed link — a customer's pet photo is never on a public URL.
//
// The cut-out is fal.ai's background remover (FAL_KEY). It costs a fraction of
// a cent a photo, is rate-limited per visitor and capped per day, and when it
// is unavailable the page still sells the "whole photo" style.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import express, { type Express, type Request, type Response } from "express";
import multer from "multer";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { driveStorage } from "./drive-storage";
import { nextPrintOrderNumber } from "./print-order-number";
import { printOrderFiles } from "@shared/schema";
import {
  CUSTOM_TEE_COLLECTIONS,
  CUSTOM_TEE_COLOURS,
  CUSTOM_TEE_MAX_QTY,
  CUSTOM_TEE_PICKUP_ADDRESS,
  CUSTOM_TEE_PRINT_SIZES,
  CUSTOM_TEE_SHIPPING_CENTS,
  CUSTOM_TEE_SIZES,
  CUSTOM_TEE_STYLES,
  cleanSizeQuantities,
  exGst,
  priceCustomTeeOrder,
} from "@shared/custom-tees";

const FILE_ROUTE = "/api/admin/print-custom-file";

// ── Small in-memory limits. Per machine, which is fine for what they defend
// against (a scripted hammer and a runaway bill, not a precise quota). ────────
type Hit = { count: number; resetAt: number };
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, Hit>();
  return (key: string): boolean => {
    const now = Date.now();
    const hit = hits.get(key);
    if (!hit || now > hit.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 5000) hits.forEach((v, k) => { if (now > v.resetAt) hits.delete(k); });
      return false;
    }
    hit.count += 1;
    return hit.count > max;
  };
}
const ipOf = (req: Request) => String(req.headers["x-forwarded-for"] || req.ip || "unknown").split(",")[0].trim();
const cutoutPerIp = limiter(15, 60 * 60_000);
const cutoutPerDay = limiter(Number(process.env.CUSTOM_TEE_CUTOUTS_PER_DAY || 400), 24 * 60 * 60_000);
const ordersPerIp = limiter(10, 60 * 60_000);

const CUTOUT_MAX_BYTES = 8 * 1024 * 1024;
const PHOTO_MAX_BYTES = 25 * 1024 * 1024;

const orderUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: 3, fields: 4 },
});

async function isImage(buf: Buffer): Promise<{ width: number; height: number; format: string } | null> {
  try {
    const m = await sharp(buf, { failOn: "none" }).metadata();
    if (!m.width || !m.height || !m.format) return null;
    if (!["jpeg", "png", "webp", "heif", "tiff"].includes(m.format)) return null;
    return { width: m.width, height: m.height, format: m.format };
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function registerCustomTeeRoutes(app: Express) {
  // ── What is sold ───────────────────────────────────────────────────────────
  app.get("/api/public/unitedprints/custom-tee/:slug", (req: Request, res: Response) => {
    const collection = CUSTOM_TEE_COLLECTIONS[String(req.params.slug)];
    if (!collection) return res.status(404).json({ message: "Not found" });
    res.json({
      slug: collection.slug,
      productName: collection.productName,
      unitInclGstCents: collection.unitInclGstCents,
      shippingInclGstCents: CUSTOM_TEE_SHIPPING_CENTS,
      maxQuantity: CUSTOM_TEE_MAX_QTY,
      pickupAddress: CUSTOM_TEE_PICKUP_ADDRESS,
      cutoutAvailable: !!process.env.FAL_KEY,
    });
  });

  // ── Cut the pet out of its background ──────────────────────────────────────
  app.post(
    "/api/public/unitedprints/custom-tee/cutout",
    express.raw({ type: () => true, limit: CUTOUT_MAX_BYTES }),
    async (req: Request, res: Response) => {
      try {
        const key = process.env.FAL_KEY;
        if (!key) return res.status(503).json({ code: "cutout_unavailable", message: "Cut-out isn't available right now." });
        if (cutoutPerIp(ipOf(req)) || cutoutPerDay("all")) {
          return res.status(429).json({ code: "cutout_busy", message: "That's a lot of photos — try again in a little while, or use the whole photo." });
        }
        const buf = Buffer.isBuffer(req.body) ? req.body : null;
        if (!buf || buf.length === 0) return res.status(400).json({ message: "That photo was empty." });
        const meta = await isImage(buf);
        if (!meta) return res.status(415).json({ message: "We couldn't read that as a photo — try a JPG or PNG." });

        // One clean JPEG, upright, at most 2400px — what the remover is sent.
        const jpeg = await sharp(buf, { failOn: "none" }).rotate().resize(2400, 2400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 60_000);
        let out: Buffer;
        try {
          const r = await fetch("https://fal.run/fal-ai/birefnet/v2", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Key ${key}` },
            body: JSON.stringify({ image_url: `data:image/jpeg;base64,${jpeg.toString("base64")}` }),
            signal: ctrl.signal,
          });
          if (!r.ok) throw new Error(`remover answered ${r.status}`);
          const j: any = await r.json();
          const url = j?.image?.url;
          if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("remover sent no picture");
          const img = await fetch(url, { signal: ctrl.signal });
          if (!img.ok) throw new Error(`picture fetch ${img.status}`);
          out = Buffer.from(await img.arrayBuffer());
        } finally {
          clearTimeout(timer);
        }
        // Trim the empty margin so the pet fills its print box.
        const trimmed = await sharp(out).trim({ threshold: 2 }).png().toBuffer().catch(() => out);
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store");
        res.send(trimmed);
      } catch (e: any) {
        console.error("[custom-tee] cutout failed:", e?.message ?? e);
        res.status(502).json({ code: "cutout_failed", message: "We couldn't cut that photo out — try another photo, or use the whole photo." });
      }
    },
  );
  app.use("/api/public/unitedprints/custom-tee/cutout", (err: any, _req: Request, res: Response, next: any) => {
    if (err?.type === "entity.too.large") return res.status(413).json({ message: "That photo is too big to cut out here." });
    next(err);
  });

  // ── Place the order and start the card payment ─────────────────────────────
  app.post(
    "/api/public/unitedprints/custom-tee/:slug/order",
    (req, res, next) => {
      orderUpload.fields([{ name: "photo", maxCount: 1 }, { name: "art", maxCount: 1 }, { name: "mockup", maxCount: 1 }])(req, res, (err: any) => {
        if (err) {
          const msg = err?.code === "LIMIT_FILE_SIZE" ? "That photo is over 25MB — try a smaller one." : "We couldn't read that upload.";
          return res.status(400).json({ message: msg });
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      try {
        const collection = CUSTOM_TEE_COLLECTIONS[String(req.params.slug)];
        if (!collection) return res.status(404).json({ message: "Not found" });
        if (ordersPerIp(ipOf(req))) return res.status(429).json({ message: "Too many orders from here — give us a call on 0800 800 199." });

        let body: any;
        try { body = JSON.parse(String((req.body as any)?.payload ?? "")); } catch { return res.status(400).json({ message: "We couldn't read that order." }); }

        // The honeypot: a field no person can see. Answered the same as success-shaped failure.
        if (str(body.website, 200)) return res.status(400).json({ message: "We couldn't take that order — call us on 0800 800 199." });

        const colour = CUSTOM_TEE_COLOURS.find((c) => c.id === body.colour);
        const printSize = CUSTOM_TEE_PRINT_SIZES.find((p) => p.id === body.printSize);
        const style = CUSTOM_TEE_STYLES.find((s) => s.id === body.style);
        if (!colour || !printSize || !style) return res.status(400).json({ message: "Pick a tee colour, a print size and a style." });

        const sizes = cleanSizeQuantities(body.sizes);
        const delivery = body.delivery === "pickup" ? "pickup" : "delivery";
        const price = priceCustomTeeOrder(collection, sizes, delivery);
        if (price.quantity < 1) return res.status(400).json({ message: "Add at least one tee." });
        if (price.quantity > CUSTOM_TEE_MAX_QTY) return res.status(400).json({ message: `For more than ${CUSTOM_TEE_MAX_QTY} tees, ask us for a quote — it will be cheaper.` });

        const firstName = str(body.firstName, 80);
        const lastName = str(body.lastName, 80);
        const email = str(body.email, 200).toLowerCase();
        const phone = str(body.phone, 40);
        const notes = str(body.notes, 1000);
        const petName = str(body.petName, 60);
        if (!firstName || !lastName) return res.status(400).json({ message: "Tell us your first and last name." });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "That email address doesn't look right." });
        if (phone.replace(/\D/g, "").length < 7) return res.status(400).json({ message: "Add a phone number we can reach you on." });

        const addr = {
          line1: str(body.address?.line1, 200),
          suburb: str(body.address?.suburb, 100),
          city: str(body.address?.city, 100),
          postcode: str(body.address?.postcode, 10),
        };
        if (delivery === "delivery" && (!addr.line1 || !addr.city || !/^\d{4}$/.test(addr.postcode))) {
          return res.status(400).json({ message: "Add the street address, town or city and 4-digit postcode to send it to." });
        }
        const addressText = delivery === "delivery" ? [addr.line1, addr.suburb, `${addr.city} ${addr.postcode}`].filter(Boolean).join(", ") : null;

        const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
        const photo = files.photo?.[0];
        const art = files.art?.[0];
        const mockup = files.mockup?.[0];
        if (!photo || !art) return res.status(400).json({ message: "Upload a photo of your pet first." });
        const [photoMeta, artMeta, mockMeta] = await Promise.all([isImage(photo.buffer), isImage(art.buffer), mockup ? isImage(mockup.buffer) : Promise.resolve(null)]);
        if (!photoMeta || !artMeta) return res.status(415).json({ message: "We couldn't read that as a photo — try a JPG or PNG." });

        const sizeLine = CUSTOM_TEE_SIZES.filter((s) => sizes[s]).map((s) => `${sizes[s]} × ${s}`).join(", ");
        const summary = [
          `${collection.productName}${petName ? ` — ${petName}` : ""}`,
          `Tee colour: ${colour.label}`,
          `Sizes: ${sizeLine}`,
          `Print: ${printSize.label} (about ${printSize.widthCm} cm wide), ${style.label.toLowerCase()}`,
          delivery === "delivery" ? `Courier to: ${addressText}` : `Pickup: ${CUSTOM_TEE_PICKUP_ADDRESS}`,
        ].join("\n");

        const orderNumber = await nextPrintOrderNumber();
        const magicLinkToken = crypto.randomBytes(24).toString("hex");
        const order = await storage.createPrintOrder({
          organizationId: 8,
          orderNumber,
          customerName: `${firstName} ${lastName}`,
          customerEmail: email,
          customerPhone: phone,
          title: `${collection.productName} — ${colour.label}`,
          description: summary,
          status: "quote_sent",
          amount: (price.totalCents / 100).toFixed(2),
          subtotalCents: price.subtotalExGstCents,
          gstCents: price.gstCents,
          totalCents: price.totalCents,
          paidCents: 0,
          deliveryMethod: delivery,
          deliveryAddress: addressText,
          deliveryQuoteCents: price.shippingInclGstCents,
          magicLinkToken,
          customerNotes: notes || null,
          notes: `Custom tee (${collection.slug}) ordered on the shop`,
        } as any);

        // One line per size, so the Orders tab and Xero read the same as the tee pile.
        const unitEx = exGst(collection.unitInclGstCents);
        let itemsEx = 0;
        let firstItemId: number | null = null;
        for (const size of CUSTOM_TEE_SIZES) {
          const qty = sizes[size];
          if (!qty) continue;
          const lineEx = exGst(collection.unitInclGstCents * qty);
          itemsEx += lineEx;
          const item = await storage.createPrintOrderItem({
            orderId: order.id,
            materialName: `${collection.productName} — ${colour.label} / ${size}`,
            description: `Print ${printSize.label.toLowerCase()} (about ${printSize.widthCm} cm wide), ${style.label.toLowerCase()}${petName ? ` · ${petName}` : ""}`,
            quantity: qty,
            sides: 1,
            configJson: { kind: "custom_tee", collection: collection.slug, colour: colour.id, size, printSize: printSize.id, printWidthCm: printSize.widthCm, style: style.id, petName: petName || null, artworkPath: "provided" },
            unitPriceCents: unitEx,
            subtotalCents: lineEx,
            breakdownJson: [{ label: `${qty} × $${(collection.unitInclGstCents / 100).toFixed(2)} incl GST`, cents: collection.unitInclGstCents * qty }],
          } as any);
          if (firstItemId === null) firstItemId = item.id;
        }
        if (price.shippingInclGstCents > 0) {
          // Whatever cents rounding left over sits on the courier line, so the lines add to the subtotal.
          await storage.createPrintOrderItem({
            orderId: order.id,
            materialName: "Courier — NZ wide",
            quantity: 1,
            sides: 1,
            configJson: { kind: "shipping", artworkPath: "provided" },
            unitPriceCents: price.subtotalExGstCents - itemsEx,
            subtotalCents: price.subtotalExGstCents - itemsEx,
            breakdownJson: [{ label: "Courier incl GST", cents: price.shippingInclGstCents }],
          } as any);
        }

        // Files: the print file, the customer's original, and the picture they approved.
        const store = driveStorage();
        const safePet = (petName || "pet").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 30) || "pet";
        const toStore: Array<{ buf: Buffer; type: string; name: string; fileType: string }> = [
          { buf: art.buffer, type: "image/png", name: `${orderNumber}-${safePet}-PRINT-${printSize.widthCm}cm.png`, fileType: "artwork" },
          { buf: photo.buffer, type: photo.mimetype || "image/jpeg", name: `${orderNumber}-${safePet}-original.${photoMeta.format === "jpeg" ? "jpg" : photoMeta.format}`, fileType: "reference" },
        ];
        if (mockup && mockMeta) toStore.push({ buf: mockup.buffer, type: "image/jpeg", name: `${orderNumber}-${safePet}-mockup.jpg`, fileType: "proof" });
        for (const f of toStore) {
          const put = await store.put(f.buf, f.type, f.name);
          await storage.createPrintOrderFile({
            orderId: order.id,
            orderItemId: firstItemId,
            objectPath: `${FILE_ROUTE}?k=${encodeURIComponent(put.storageKey)}`,
            filename: f.name,
            fileSize: put.sizeBytes,
            mimeType: f.type,
            uploadedBy: "customer",
            fileType: f.fileType,
          } as any);
        }

        await storage.createPrintOrderEvent({
          orderId: order.id,
          eventType: "created",
          notes: `Custom tee ordered online by ${firstName} ${lastName}`,
          metadataJson: { collection: collection.slug, colour: colour.id, sizes, printSize: printSize.id, style: style.id, delivery },
        } as any);

        const { stripe } = await import("./stripe");
        const intent = await stripe.paymentIntents.create({
          amount: price.totalCents,
          currency: "nzd",
          payment_method_types: ["card"],
          receipt_email: email,
          description: `${orderNumber} — ${collection.productName}`,
          metadata: { printOrderId: String(order.id), orderNumber: orderNumber || "", organizationId: "8" },
        });
        await storage.updatePrintOrder(order.id, { stripePaymentIntentId: intent.id } as any);

        res.status(201).json({ orderNumber, token: magicLinkToken, clientSecret: intent.client_secret, totalCents: price.totalCents });
      } catch (e: any) {
        console.error("[custom-tee] order failed:", e);
        res.status(500).json({ message: "Something went wrong placing that order — call us on 0800 800 199 and we'll sort it." });
      }
    },
  );

  // ── Staff: open a file from the Orders tab (a plain link, so no workspace
  // header — /api/admin is already staff-only, and the key must belong to a
  // real print order file). ─────────────────────────────────────────────────
  app.get(FILE_ROUTE, async (req: Request, res: Response) => {
    try {
      const k = String(req.query.k ?? "");
      if (!/^drive\/[a-z0-9-]+(\.[a-z0-9]+)?$/i.test(k)) return res.status(404).json({ message: "Not found" });
      const [row] = await db.select().from(printOrderFiles).where(eq(printOrderFiles.objectPath, `${FILE_ROUTE}?k=${encodeURIComponent(k)}`));
      if (!row) return res.status(404).json({ message: "Not found" });
      const url = await driveStorage().signedUrl(k, { download: row.filename, expiresIn: 300 });
      res.redirect(302, url);
    } catch (e: any) {
      console.error("[custom-tee] file open failed:", e?.message ?? e);
      res.status(500).json({ message: "Couldn't open that file." });
    }
  });
}

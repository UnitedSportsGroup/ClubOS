// ─────────────────────────────────────────────────────────────────────────────
// UNITED PRINTS — Custom pet tees. shop.unitedprints.co.nz/print/pet-tees
//
// Upload a photo of your pet → we cut the pet out → see it on the tee → pick
// colour, print size and sizes → pay by card → it lands in Dima's Orders tab
// with the print file, the original photo and the mockup the customer approved.
//
// ── How the mockup is made ──────────────────────────────────────────────────
// /up/tee/tee-shade.webp is a photograph of a blank white tee reduced to two
// things: its silhouette (alpha) and its fabric shading (RGB). Every pixel of
// the picture on screen is  tee colour × shading, and the print is laid in with
// the SAME shading over it, so folds and shadows run through the print the way
// they would on cloth. It is worked out per pixel in the browser — instant, and
// it costs nothing per visitor. The maths mirrors the prototype that was
// eyeballed on all five colours before this page was written.
//
// 🔴 The price on screen comes from shared/custom-tees.ts, the same function the
// server charges from. This page never sends an amount.
// 🔴 No `text-white` / dark neutrals — the generated light theme rewrites them
// on public pages. Every colour here is an explicit hex (see up-shell.tsx).
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { UpShell, upBtn, upDisplay, upField, upLabel } from "@/components/up-shell";
import {
  CUSTOM_TEE_COLLECTIONS,
  CUSTOM_TEE_COLOURS,
  CUSTOM_TEE_MAX_QTY,
  CUSTOM_TEE_PICKUP_ADDRESS,
  CUSTOM_TEE_PRINT_SIZES,
  CUSTOM_TEE_SIZES,
  CUSTOM_TEE_STYLES,
  priceCustomTeeOrder,
  type CustomTeeColourId,
  type CustomTeeDelivery,
  type CustomTeePrintSizeId,
  type CustomTeeSize,
  type CustomTeeStyleId,
} from "@shared/custom-tees";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "");
const SLUG = "pet";
const API = "/api/public/unitedprints/custom-tee";

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Mockup geometry, in the shade image's own pixels (1200 × 1490) ───────────
const MW = 1200;
const MH = 1490;
const PX_PER_CM = 9.85; // the tee's chest is ~532px across; drawn as a ~54cm chest
const PRINT_CENTRE_X = 598;
const PRINT_TOP_Y = 438;
const PRINT_MAX_H_CM = 36;

type Shade = { s: Float32Array; alpha: Uint8ClampedArray };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}

async function loadShade(): Promise<Shade> {
  const img = await loadImage("/up/tee/tee-shade.webp");
  const c = document.createElement("canvas");
  c.width = MW;
  c.height = MH;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, MW, MH);
  const d = ctx.getImageData(0, 0, MW, MH).data;
  const s = new Float32Array(MW * MH);
  const alpha = new Uint8ClampedArray(MW * MH);
  for (let i = 0, p = 0; i < s.length; i++, p += 4) {
    s[i] = Math.min(1.06, d[p] / 255 / 0.94); // flat, well-lit cloth ≈ 1
    alpha[i] = d[p + 3];
  }
  return { s, alpha };
}

function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** The blank tee in one colour, as RGBA pixels. */
function paintTee(shade: Shade, hex: string): Uint8ClampedArray {
  const [r, g, b] = hexRgb(hex);
  const dark = 1 - (r + g + b) / 3;
  const gamma = 1 + 0.9 * dark; // folds read deeper on dark cloth
  const out = new Uint8ClampedArray(MW * MH * 4);
  for (let i = 0, p = 0; i < shade.s.length; i++, p += 4) {
    const a = shade.alpha[i];
    if (a === 0) continue;
    const s = shade.s[i];
    const k = Math.pow(s, gamma);
    const sheen = dark * 0.1 * Math.max(0, s - 0.8) * 2.2; // so black is not a flat hole
    out[p] = (r * k + sheen) * 255;
    out[p + 1] = (g * k + sheen) * 255;
    out[p + 2] = (b * k + sheen) * 255;
    out[p + 3] = a;
  }
  return out;
}

type Art = { canvas: HTMLCanvasElement; w: number; h: number };

function drawMockup(
  canvas: HTMLCanvasElement,
  shade: Shade,
  teePixels: Uint8ClampedArray,
  art: Art | null,
  printWidthCm: number,
) {
  const px = new Uint8ClampedArray(teePixels); // copy — the blank tee is cached per colour

  if (art) {
    let w = printWidthCm * PX_PER_CM;
    let h = (w * art.h) / art.w;
    const maxH = PRINT_MAX_H_CM * PX_PER_CM;
    if (h > maxH) {
      w = (w * maxH) / h;
      h = maxH;
    }
    const aw = Math.max(1, Math.round(w));
    const ah = Math.max(1, Math.round(h));
    const x0 = Math.round(PRINT_CENTRE_X - aw / 2);
    const y0 = PRINT_TOP_Y;
    const tmp = document.createElement("canvas");
    tmp.width = aw;
    tmp.height = ah;
    const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
    tctx.imageSmoothingQuality = "high";
    tctx.drawImage(art.canvas, 0, 0, aw, ah);
    const ad = tctx.getImageData(0, 0, aw, ah).data;
    for (let y = 0; y < ah; y++) {
      const my = y0 + y;
      if (my < 0 || my >= MH) continue;
      for (let x = 0; x < aw; x++) {
        const mx = x0 + x;
        if (mx < 0 || mx >= MW) continue;
        const ap = (y * aw + x) * 4;
        const a = (ad[ap + 3] / 255) * 0.97;
        if (a === 0) continue;
        const mi = my * MW + mx;
        const mp = mi * 4;
        const sh = Math.pow(Math.min(1, shade.s[mi]), 1.6); // the cloth's folds run through the ink
        px[mp] = px[mp] * (1 - a) + ad[ap] * sh * a;
        px[mp + 1] = px[mp + 1] * (1 - a) + ad[ap + 1] * sh * a;
        px[mp + 2] = px[mp + 2] * (1 - a) + ad[ap + 2] * sh * a;
      }
    }
  }

  const tee = document.createElement("canvas");
  tee.width = MW;
  tee.height = MH;
  tee.getContext("2d")!.putImageData(new ImageData(px, MW, MH), 0, 0);

  canvas.width = MW;
  canvas.height = MH;
  const ctx = canvas.getContext("2d")!;
  const bg = ctx.createLinearGradient(0, 0, 0, MH);
  bg.addColorStop(0, "#f3f5f9");
  bg.addColorStop(1, "#e3e7ee");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, MW, MH);
  ctx.save();
  ctx.shadowColor = "rgba(1, 37, 131, 0.20)";
  ctx.shadowBlur = 46;
  ctx.shadowOffsetY = 26;
  ctx.drawImage(tee, 0, 0);
  ctx.restore();
}

/** Any image the browser can open → an upright canvas no bigger than `max`. */
async function fileToCanvas(file: Blob, max: number): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("We couldn't open that file. Try a JPG or PNG photo.");
  }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("export failed"))), type, q));

/** The "whole photo" print: the photo itself with soft rounded corners. */
function roundedPhoto(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d")!;
  const r = Math.min(src.width, src.height) * 0.06;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(c.width, 0, c.width, c.height, r);
  ctx.arcTo(c.width, c.height, 0, c.height, r);
  ctx.arcTo(0, c.height, 0, 0, r);
  ctx.arcTo(0, 0, c.width, 0, r);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(src, 0, 0);
  return c;
}

// ── Payment ──────────────────────────────────────────────────────────────────
function PayForm({ token, totalCents, onPaid }: { token: string; totalCents: number; onPaid: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error: err, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/print/order/${token}` },
      redirect: "if_required",
    });
    if (err) {
      setError(err.message || "That payment didn't go through. Try again.");
      setBusy(false);
      return;
    }
    if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") onPaid();
    else setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="pet-tee-pay-form">
      <PaymentElement />
      {error && <div className="rounded-xl border border-[#f3b4b4] bg-[#fff1f1] p-3 text-sm text-[#9b1c1c]">{error}</div>}
      <button type="submit" disabled={!stripe || busy} className={`${upBtn.green} w-full disabled:opacity-50`}>
        {busy ? "Paying…" : `Pay ${money(totalCents)}`}
      </button>
      <p className="text-center text-[12px] text-[#4a5265]/70">Card payment by Stripe. We never see or keep your card number.</p>
    </form>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
type Config = { cutoutAvailable: boolean };

export default function PrintPetTees() {
  const [, setLocation] = useLocation();
  const collection = CUSTOM_TEE_COLLECTIONS[SLUG];

  const { data: config } = useQuery<Config>({
    queryKey: [API, SLUG],
    queryFn: () => fetch(`${API}/${SLUG}`).then((r) => (r.ok ? r.json() : { cutoutAvailable: false })),
  });
  const cutoutAvailable = config?.cutoutAvailable ?? true;

  // What they are buying
  const [colour, setColour] = useState<CustomTeeColourId>("white");
  const [printSize, setPrintSize] = useState<CustomTeePrintSizeId>("medium");
  const [style, setStyle] = useState<CustomTeeStyleId>("cutout");
  const [sizes, setSizes] = useState<Partial<Record<CustomTeeSize, number>>>({ M: 1 });
  const [delivery, setDelivery] = useState<CustomTeeDelivery>("delivery");

  // Their photo
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoCanvas, setPhotoCanvas] = useState<HTMLCanvasElement | null>(null);
  const [cutout, setCutout] = useState<{ canvas: HTMLCanvasElement; blob: Blob } | null>(null);
  const [cutting, setCutting] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [example, setExample] = useState<Art | null>(null);

  // Who and where
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [suburb, setSuburb] = useState("");
  const [city, setCity] = useState("");
  const [postcode, setPostcode] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — no person can see it

  // Order + payment
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [payment, setPayment] = useState<{ token: string; clientSecret: string; totalCents: number; orderNumber: string } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [shade, setShade] = useState<Shade | null>(null);
  const teeCache = useRef(new Map<string, Uint8ClampedArray>());

  useEffect(() => {
    document.title = "Custom pet tees | United Prints";
    loadShade().then(setShade).catch(() => setShade(null));
    loadImage("/up/tee/example-pet.webp")
      .then((img) => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d")!.drawImage(img, 0, 0);
        setExample({ canvas: c, w: c.width, h: c.height });
      })
      .catch(() => {});
  }, []);

  // The print itself: the cut-out when we have one, else the whole photo.
  const usingStyle: CustomTeeStyleId = style === "cutout" && cutout ? "cutout" : "photo";
  const art: Art | null = useMemo(() => {
    if (!photoCanvas) return null;
    if (usingStyle === "cutout" && cutout) return { canvas: cutout.canvas, w: cutout.canvas.width, h: cutout.canvas.height };
    const c = roundedPhoto(photoCanvas);
    return { canvas: c, w: c.width, h: c.height };
  }, [photoCanvas, cutout, usingStyle]);

  const printWidthCm = CUSTOM_TEE_PRINT_SIZES.find((p) => p.id === printSize)!.widthCm;
  const colourDef = CUSTOM_TEE_COLOURS.find((c) => c.id === colour)!;

  useEffect(() => {
    if (!shade || !canvasRef.current) return;
    let tee = teeCache.current.get(colourDef.hex);
    if (!tee) {
      tee = paintTee(shade, colourDef.hex);
      teeCache.current.set(colourDef.hex, tee);
    }
    drawMockup(canvasRef.current, shade, tee, art ?? example, printWidthCm);
  }, [shade, colourDef.hex, art, example, printWidthCm]);

  const runCutout = useCallback(async (src: HTMLCanvasElement) => {
    setCutting(true);
    setPhotoError(null);
    try {
      const jpeg = await toBlob(src, "image/jpeg", 0.92);
      const r = await fetch(`${API}/cutout`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: jpeg });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.message || "We couldn't cut that photo out.");
      }
      const blob = await r.blob();
      const canvas = await fileToCanvas(blob, 2400);
      setCutout({ canvas, blob });
    } catch (e: any) {
      setCutout(null);
      setStyle("photo");
      setPhotoError(`${e.message || "We couldn't cut that photo out."} Showing the whole photo instead.`);
    } finally {
      setCutting(false);
    }
  }, []);

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    if (file.size > 25 * 1024 * 1024) {
      setPhotoError("That photo is over 25MB. Try a smaller one.");
      return;
    }
    try {
      const c = await fileToCanvas(file, 2400);
      setPhotoFile(file);
      setPhotoCanvas(c);
      setCutout(null);
      if (cutoutAvailable && style === "cutout") void runCutout(c);
      else if (!cutoutAvailable) setStyle("photo");
    } catch (e: any) {
      setPhotoError(e.message);
    }
  };

  const chooseStyle = (id: CustomTeeStyleId) => {
    setStyle(id);
    if (id === "cutout" && photoCanvas && !cutout && !cutting && cutoutAvailable) void runCutout(photoCanvas);
  };

  const price = priceCustomTeeOrder(collection, sizes, delivery);
  const setQty = (size: CustomTeeSize, next: number) =>
    setSizes((prev) => {
      const others = CUSTOM_TEE_SIZES.reduce((n, s) => n + (s === size ? 0 : prev[s] ?? 0), 0);
      const qty = Math.max(0, Math.min(next, CUSTOM_TEE_MAX_QTY - others));
      const out = { ...prev };
      if (qty === 0) delete out[size];
      else out[size] = qty;
      return out;
    });

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const missing: string[] = [];
  if (!photoCanvas) missing.push("a photo of your pet");
  if (cutting) missing.push("the cut-out to finish");
  if (price.quantity < 1) missing.push("at least one tee");
  if (!firstName.trim() || !lastName.trim()) missing.push("your name");
  if (!emailOk) missing.push("your email");
  if (phone.replace(/\D/g, "").length < 7) missing.push("your phone number");
  if (delivery === "delivery" && (!line1.trim() || !city.trim() || !/^\d{4}$/.test(postcode.trim()))) missing.push("the delivery address");

  const placeOrder = async () => {
    if (missing.length || !photoFile || !art || !canvasRef.current) return;
    setPlacing(true);
    setOrderError(null);
    try {
      const artBlob = usingStyle === "cutout" && cutout ? cutout.blob : await toBlob(art.canvas, "image/png");
      const mockBlob = await toBlob(canvasRef.current, "image/jpeg", 0.86);
      const fd = new FormData();
      fd.append(
        "payload",
        JSON.stringify({
          colour, printSize, style: usingStyle, sizes, delivery,
          firstName, lastName, email, phone, notes, website,
          address: { line1, suburb, city, postcode: postcode.trim() },
        }),
      );
      fd.append("photo", photoFile, photoFile.name || "photo.jpg");
      fd.append("art", artBlob, "print.png");
      fd.append("mockup", mockBlob, "mockup.jpg");
      const r = await fetch(`${API}/${SLUG}/order`, { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "We couldn't place that order.");
      setPayment({ token: j.token, clientSecret: j.clientSecret, totalCents: j.totalCents, orderNumber: j.orderNumber });
    } catch (e: any) {
      setOrderError(e.message);
    } finally {
      setPlacing(false);
    }
  };

  const locked = !!payment; // once the order exists, the choices above are what was ordered
  const chip = (on: boolean) =>
    `min-h-[44px] rounded-xl border px-4 py-2.5 text-left text-sm font-semibold transition disabled:opacity-60 ${
      on ? "border-[#043bcb] bg-[#043bcb] text-[#ffffff]" : "border-[#cbd1de] bg-[#ffffff] text-[#012583] hover:border-[#043bcb]"
    }`;

  return (
    <UpShell>
      <div className="mx-auto max-w-6xl px-5 pb-10 pt-10 sm:px-8 sm:pt-14">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#043bcb]">Custom pet tees · printed in Christchurch</p>
        <h1 className={`${upDisplay} mt-3 text-4xl text-[#012583] sm:text-6xl`}>
          Your pet <span className="text-[#33cc00]">on a tee</span>
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[#4a5265]">
          Upload a photo, see it on the tee, choose your colour and size. {money(collection.unitInclGstCents)} a tee including GST,
          couriered anywhere in New Zealand or picked up from us.
        </p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-12">
          {/* ── The mockup ── */}
          <div className="lg:sticky lg:top-28 lg:self-start">
            <div className="relative overflow-hidden rounded-3xl border border-[#cbd1de] bg-[#e9ecf2]">
              <canvas
                ref={canvasRef}
                width={MW}
                height={MH}
                className="block h-auto w-full"
                role="img"
                aria-label={`${colourDef.label} tee with ${photoCanvas ? "your photo" : "an example photo"} printed on the chest`}
                data-testid="pet-tee-mockup"
              />
              {!photoCanvas && (
                <span className="absolute left-4 top-4 rounded-full bg-[#012583] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#ffffff]">
                  Example photo
                </span>
              )}
              {cutting && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#f7faff]/70 backdrop-blur-[2px]">
                  <div className="rounded-2xl bg-[#ffffff] px-5 py-4 text-sm font-semibold text-[#012583] shadow-lg">
                    Cutting your pet out of the photo… about 10 seconds
                  </div>
                </div>
              )}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-[#4a5265]/75">
              This picture is a mockup to show placement and size. Colours on fabric can look a little different from a screen.
            </p>
          </div>

          {/* ── The choices ── */}
          <div className="min-w-0 space-y-9">
            <section>
              <span className={upLabel}>1 · Your photo</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  void onPickFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
                data-testid="pet-tee-file"
              />
              <button type="button" disabled={locked || cutting} onClick={() => fileRef.current?.click()} className={`${upBtn.royal} w-full disabled:opacity-50`}>
                {photoCanvas ? "Change photo" : "Upload a photo of your pet"}
              </button>
              <p className="mt-2 text-[12px] leading-relaxed text-[#4a5265]/75">
                A clear, bright photo works best, with your pet's whole face in the shot. JPG or PNG.
              </p>
              {photoError && <div className="mt-3 rounded-xl border border-[#f1d08a] bg-[#fff8e6] p-3 text-sm text-[#7a5200]">{photoError}</div>}

              <div className="mt-4 grid grid-cols-2 gap-2">
                {CUSTOM_TEE_STYLES.map((s) => {
                  const off = s.id === "cutout" && !cutoutAvailable;
                  return (
                    <button key={s.id} type="button" disabled={locked || cutting || off} onClick={() => chooseStyle(s.id)} className={chip(style === s.id)} data-testid={`pet-tee-style-${s.id}`}>
                      <span className="block">{s.label}</span>
                      <span className={`mt-0.5 block text-[11px] font-normal ${style === s.id ? "text-[#ffffff]/80" : "text-[#4a5265]/75"}`}>
                        {off ? "Not available right now" : s.help}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <span className={upLabel}>2 · Tee colour · {colourDef.label}</span>
              <div className="flex flex-wrap gap-3">
                {CUSTOM_TEE_COLOURS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={locked}
                    onClick={() => setColour(c.id)}
                    aria-label={c.label}
                    aria-pressed={colour === c.id}
                    title={c.label}
                    data-testid={`pet-tee-colour-${c.id}`}
                    className={`h-12 w-12 rounded-full border-2 transition ${colour === c.id ? "border-[#043bcb] ring-4 ring-[#043bcb]/20" : "border-[#cbd1de] hover:border-[#043bcb]"}`}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
            </section>

            <section>
              <span className={upLabel}>3 · Print size</span>
              <div className="grid grid-cols-3 gap-2">
                {CUSTOM_TEE_PRINT_SIZES.map((p) => (
                  <button key={p.id} type="button" disabled={locked} onClick={() => setPrintSize(p.id)} className={chip(printSize === p.id)} data-testid={`pet-tee-print-${p.id}`}>
                    <span className="block">{p.label}</span>
                    <span className={`mt-0.5 block text-[11px] font-normal ${printSize === p.id ? "text-[#ffffff]/80" : "text-[#4a5265]/75"}`}>about {p.widthCm} cm wide</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-[#4a5265]/75">Same price whichever size you choose.</p>
            </section>

            <section>
              <span className={upLabel}>4 · Tee sizes and how many</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CUSTOM_TEE_SIZES.map((s) => {
                  const q = sizes[s] ?? 0;
                  return (
                    <div key={s} className={`flex items-center justify-between rounded-xl border bg-[#ffffff] p-1.5 ${q ? "border-[#043bcb]" : "border-[#cbd1de]"}`}>
                      <button type="button" disabled={locked || q === 0} onClick={() => setQty(s, q - 1)} aria-label={`One fewer ${s}`} className="h-11 w-11 rounded-lg text-xl font-bold text-[#012583] transition hover:bg-[#f7faff] disabled:opacity-30">
                        −
                      </button>
                      <div className="text-center leading-tight">
                        <div className="text-sm font-extrabold text-[#012583]">{s}</div>
                        <div className="text-[12px] text-[#4a5265]" data-testid={`pet-tee-qty-${s}`}>{q}</div>
                      </div>
                      <button type="button" disabled={locked || price.quantity >= CUSTOM_TEE_MAX_QTY} onClick={() => setQty(s, q + 1)} aria-label={`One more ${s}`} className="h-11 w-11 rounded-lg text-xl font-bold text-[#012583] transition hover:bg-[#f7faff] disabled:opacity-30">
                        +
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[12px] text-[#4a5265]/75">Adult unisex sizes. Not sure? Add a note below and we'll check with you before printing.</p>
            </section>

            <section>
              <span className={upLabel}>5 · Getting it to you</span>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={locked} onClick={() => setDelivery("delivery")} className={chip(delivery === "delivery")} data-testid="pet-tee-delivery">
                  <span className="block">Courier</span>
                  <span className={`mt-0.5 block text-[11px] font-normal ${delivery === "delivery" ? "text-[#ffffff]/80" : "text-[#4a5265]/75"}`}>
                    {money(priceCustomTeeOrder(collection, { M: 1 }, "delivery").shippingInclGstCents)} anywhere in NZ
                  </span>
                </button>
                <button type="button" disabled={locked} onClick={() => setDelivery("pickup")} className={chip(delivery === "pickup")} data-testid="pet-tee-pickup">
                  <span className="block">Pick up</span>
                  <span className={`mt-0.5 block text-[11px] font-normal ${delivery === "pickup" ? "text-[#ffffff]/80" : "text-[#4a5265]/75"}`}>Free, from our shop</span>
                </button>
              </div>
              {delivery === "pickup" ? (
                <p className="mt-3 text-sm text-[#4a5265]">{CUSTOM_TEE_PICKUP_ADDRESS}. We'll email you when it is ready.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  <input disabled={locked} value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Street address" autoComplete="address-line1" className={upField} data-testid="pet-tee-line1" />
                  <input disabled={locked} value={suburb} onChange={(e) => setSuburb(e.target.value)} placeholder="Suburb (optional)" autoComplete="address-level3" className={upField} />
                  <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
                    <input disabled={locked} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Town or city" autoComplete="address-level2" className={upField} data-testid="pet-tee-city" />
                    <input disabled={locked} value={postcode} onChange={(e) => setPostcode(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Postcode" inputMode="numeric" autoComplete="postal-code" className={upField} data-testid="pet-tee-postcode" />
                  </div>
                </div>
              )}
            </section>

            <section>
              <span className={upLabel}>6 · Your details</span>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input disabled={locked} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" autoComplete="given-name" className={upField} data-testid="pet-tee-first" />
                  <input disabled={locked} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" autoComplete="family-name" className={upField} data-testid="pet-tee-last" />
                </div>
                <input disabled={locked} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="email" className={upField} data-testid="pet-tee-email" />
                <input disabled={locked} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number" autoComplete="tel" className={upField} data-testid="pet-tee-phone" />
                <textarea disabled={locked} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything we should know? (optional)" rows={3} className={upField} />
                <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" name="website" />
              </div>
            </section>

            {/* ── Total, then pay ── */}
            <section className="rounded-3xl border border-[#cbd1de] bg-[#ffffff] p-5 sm:p-6" data-testid="pet-tee-summary">
              {!payment ? (
                <>
                  <button type="button" onClick={placeOrder} disabled={placing || missing.length > 0} className={`${upBtn.green} w-full disabled:opacity-50`} data-testid="pet-tee-continue">
                    {placing ? "Sending your photo…" : price.quantity ? `Continue to payment · ${money(price.totalCents)}` : "Continue to payment"}
                  </button>
                  {missing.length > 0 && <p className="mt-3 text-center text-[13px] text-[#4a5265]">Still needed: {missing.join(", ")}.</p>}
                  {orderError && <div className="mt-3 rounded-xl border border-[#f3b4b4] bg-[#fff1f1] p-3 text-sm text-[#9b1c1c]">{orderError}</div>}
                </>
              ) : (
                <div>
                  <p className="mb-4 text-sm font-semibold text-[#012583]">Order {payment.orderNumber} is saved. Pay to send it to print.</p>
                  <Elements stripe={stripePromise} options={{ clientSecret: payment.clientSecret, appearance: { theme: "stripe" } }}>
                    <PayForm token={payment.token} totalCents={payment.totalCents} onPaid={() => setLocation(`/print/order/${payment.token}`)} />
                  </Elements>
                </div>
              )}

              <div className="mt-5 space-y-1.5 border-t border-[#cbd1de] pt-4 text-sm">
                <div className="flex justify-between text-[#4a5265]">
                  <span>
                    {price.quantity || 0} × {collection.productName}
                  </span>
                  <span data-testid="pet-tee-line-tees">{money(price.teesInclGstCents)}</span>
                </div>
                <div className="flex justify-between text-[#4a5265]">
                  <span>{delivery === "delivery" ? "Courier" : "Pick up"}</span>
                  <span>{price.shippingInclGstCents ? money(price.shippingInclGstCents) : "Free"}</span>
                </div>
                <div className="flex justify-between pt-2 text-base font-extrabold text-[#012583]">
                  <span>Total</span>
                  <span data-testid="pet-tee-total">{money(price.totalCents)}</span>
                </div>
                <p className="text-[12px] text-[#4a5265]/75">Includes {money(price.gstCents)} GST.</p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </UpShell>
  );
}

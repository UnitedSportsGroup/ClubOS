// ─────────────────────────────────────────────────────────────────────────────
// UNITED PRINTS — custom one-off tees (pet tees first; wedding tees etc. later).
//
// shop.unitedprints.co.nz/print/pet-tees. A customer uploads a photo, sees it on
// a tee, picks colour + sizes, pays, and the order lands in Dima's Orders tab
// with the print file attached.
//
// 🔴 THIS FILE IS THE ONE DECIDER FOR THE PRICE. The page shows what
// `priceCustomTeeOrder()` returns and the server charges what the same function
// returns from its own copy of the inputs — the browser never sends an amount.
//
// A NEW IDEA (wedding tees, team-mum tees…) = one entry in CUSTOM_TEE_COLLECTIONS
// plus a route line in App.tsx. Nothing else changes.
//
// ⚠️ DRAFTS for Dima to confirm (24 Nov 2026): the colour list, the size run,
// the three print widths and the courier price. Daniel set $60 a tee.
// ─────────────────────────────────────────────────────────────────────────────

export const CUSTOM_TEE_COLOURS = [
  { id: "white", label: "White", hex: "#ffffff" },
  { id: "black", label: "Black", hex: "#161616" },
  { id: "navy", label: "Navy", hex: "#1c2542" },
  { id: "grey", label: "Grey marle", hex: "#b4b7bd" },
  { id: "sand", label: "Sand", hex: "#d9cbb3" },
] as const;
export type CustomTeeColourId = (typeof CUSTOM_TEE_COLOURS)[number]["id"];

export const CUSTOM_TEE_SIZES = ["S", "M", "L", "XL", "2XL", "3XL"] as const;
export type CustomTeeSize = (typeof CUSTOM_TEE_SIZES)[number];

/** How wide the print is on the chest. Same price whichever is chosen. */
export const CUSTOM_TEE_PRINT_SIZES = [
  { id: "small", label: "Small", widthCm: 20 },
  { id: "medium", label: "Medium", widthCm: 25 },
  { id: "large", label: "Large", widthCm: 30 },
] as const;
export type CustomTeePrintSizeId = (typeof CUSTOM_TEE_PRINT_SIZES)[number]["id"];

export const CUSTOM_TEE_STYLES = [
  { id: "cutout", label: "Cut out", help: "Just your pet, background removed" },
  { id: "photo", label: "Whole photo", help: "The photo as it is, rounded corners" },
] as const;
export type CustomTeeStyleId = (typeof CUSTOM_TEE_STYLES)[number]["id"];

export type CustomTeeCollection = {
  slug: string;
  /** Shown on the order, the emails and Dima's Orders tab. */
  productName: string;
  /** Price of ONE tee, GST included, in cents. */
  unitInclGstCents: number;
};

export const CUSTOM_TEE_COLLECTIONS: Record<string, CustomTeeCollection> = {
  pet: { slug: "pet", productName: "Custom Pet Tee", unitInclGstCents: 6000 },
};

/** NZ-wide courier for the whole order, GST included. Pickup is free. */
export const CUSTOM_TEE_SHIPPING_CENTS = 800;
export const CUSTOM_TEE_MAX_QTY = 20;
export const CUSTOM_TEE_PICKUP_ADDRESS = "United Prints, 466 Yaldhurst Road, Christchurch";

export type CustomTeeDelivery = "delivery" | "pickup";

export type CustomTeePrice = {
  quantity: number;
  unitInclGstCents: number;
  teesInclGstCents: number;
  shippingInclGstCents: number;
  totalCents: number;
  /** GST inside the total (NZ 15% → 3/23 of a GST-inclusive amount). */
  gstCents: number;
  subtotalExGstCents: number;
};

export function cleanSizeQuantities(raw: unknown): Partial<Record<CustomTeeSize, number>> {
  const out: Partial<Record<CustomTeeSize, number>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const size of CUSTOM_TEE_SIZES) {
    const n = Number((raw as Record<string, unknown>)[size]);
    if (Number.isInteger(n) && n > 0) out[size] = n;
  }
  return out;
}

export function priceCustomTeeOrder(
  collection: CustomTeeCollection,
  sizes: Partial<Record<CustomTeeSize, number>>,
  delivery: CustomTeeDelivery,
): CustomTeePrice {
  const quantity = CUSTOM_TEE_SIZES.reduce((n, s) => n + (sizes[s] ?? 0), 0);
  const teesInclGstCents = quantity * collection.unitInclGstCents;
  const shippingInclGstCents = quantity > 0 && delivery === "delivery" ? CUSTOM_TEE_SHIPPING_CENTS : 0;
  const totalCents = teesInclGstCents + shippingInclGstCents;
  const gstCents = Math.round((totalCents * 3) / 23);
  return {
    quantity,
    unitInclGstCents: collection.unitInclGstCents,
    teesInclGstCents,
    shippingInclGstCents,
    totalCents,
    gstCents,
    subtotalExGstCents: totalCents - gstCents,
  };
}

/** Pre-GST cents of a GST-inclusive amount, rounded once. */
export function exGst(inclCents: number): number {
  return inclCents - Math.round((inclCents * 3) / 23);
}

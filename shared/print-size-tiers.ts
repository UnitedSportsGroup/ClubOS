/**
 * Stock sizes — the sheet sizes United Prints already buys, priced per piece.
 *
 * Dima, with Daniel, 2026-09-16: *"we have standard sizes which our sheets
 * already come in, so if someone selects corflute then a secondary appears
 * showing options of custom and if custom they input custom size or pre built
 * options"* — and he adds more himself as suppliers' materials come available.
 *
 * ── Why this is one module ──────────────────────────────────────────────────
 * A tier carries a PRICE, so three places have to agree about it: the Materials
 * tab where Dima types it, the quote engine that charges it, and the website
 * that offers it. The admin PATCH route spreads the request body straight into
 * the row, so without a decider a malformed tier — a price as a string, a
 * negative width, a duplicate id — would reach the public quote form and either
 * crash it or quote the wrong money.
 *
 * 🔴 Prices live here as CENTS and are Dima's to set. Nothing in this file
 * invents one: a tier with no price is refused, never defaulted.
 */

export interface SizeTier {
  /** Stable key the pricing engine matches on. Generated from the size. */
  id: string;
  /** What the customer sees: "600 × 900mm". */
  label: string;
  /** Millimetres. Orientation does not matter — 900×600 is the same sheet. */
  w: number;
  h: number;
  priceCents: number;
}

/** A sheet 1220 × 2440 gets the id "1220x2440", whichever way round it is typed. */
export function sizeTierId(w: number, h: number): string {
  const [a, b] = [Math.min(w, h), Math.max(w, h)];
  return `${a}x${b}`;
}

/** "600 × 900mm" — the label Dima gets for free, and can then overwrite. */
export function sizeTierLabel(w: number, h: number): string {
  return `${w} × ${h}mm`;
}

const MAX_MM = 20_000;      // 20m. Longer than any sheet or roll run we sell.
const MAX_CENTS = 10_000_00; // $10,000 a piece. A typo guard, not a price ceiling.

/**
 * `null` = fine. A string = why it cannot be saved, written for Dima.
 *
 * 🔴 Validated on the SERVER as well as in the form. The Materials PATCH takes
 * the request body and writes it, so the browser is not the gate.
 */
export function sizeTierError(t: Partial<SizeTier>): string | null {
  const w = Number(t.w), h = Number(t.h), c = Number(t.priceCents);
  if (!Number.isFinite(w) || !Number.isInteger(w) || w <= 0) return "Width must be a whole number of millimetres.";
  if (!Number.isFinite(h) || !Number.isInteger(h) || h <= 0) return "Height must be a whole number of millimetres.";
  if (w > MAX_MM || h > MAX_MM) return `That size is over ${MAX_MM / 1000}m — check the millimetres.`;
  // 🔴 A price is required, never defaulted. A stock size with no price would
  // quote $0 on the website the moment Dima saved it.
  if (t.priceCents == null || String(t.priceCents).trim() === "") return "Give the size a price — that is what the website will charge.";
  if (!Number.isFinite(c) || !Number.isInteger(c) || c < 0) return "That price isn't a valid amount.";
  if (c > MAX_CENTS) return "That price looks like a typo — check the dollars.";
  if (!String(t.label ?? "").trim()) return "Give the size a name customers will recognise.";
  return null;
}

/**
 * Clean a whole list for storage. Returns the normalised tiers, or the first
 * problem. Refuses two tiers of the same size: the engine matches by dimension,
 * so a duplicate is a coin toss over which price a customer is charged.
 */
export function normaliseSizeTiers(raw: unknown): { ok: true; tiers: SizeTier[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, tiers: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Stock sizes must be a list." };
  if (raw.length > 40) return { ok: false, error: "That is more than 40 stock sizes — trim the list." };

  const out: SizeTier[] = [];
  const seen = new Set<string>();
  for (const r of raw as Partial<SizeTier>[]) {
    const problem = sizeTierError(r);
    if (problem) return { ok: false, error: problem };
    const w = Number(r.w), h = Number(r.h);
    const id = sizeTierId(w, h);
    if (seen.has(id)) return { ok: false, error: `${sizeTierLabel(w, h)} is in the list twice — the price for a size has to be one number.` };
    seen.add(id);
    out.push({ id, label: String(r.label).trim().slice(0, 80), w, h, priceCents: Number(r.priceCents) });
  }
  // Smallest first, so the customer reads a ladder rather than an arbitrary order.
  out.sort((a, b) => a.w * a.h - b.w * b.h);
  return { ok: true, tiers: out };
}

/**
 * Which half of the shop is this? Used by the website's first question.
 *
 * 🔴 Derived from the category a product ALREADY has, not a new column — the
 * catalog's `category` enum already splits these, and a second taxonomy would
 * drift the first time somebody added a product.
 */
export type PrintShopSide = "signage" | "merch";

export function shopSideFor(category: string | null | undefined): PrintShopSide {
  return category === "garment" ? "merch" : "signage";
}

export const SHOP_SIDE_LABEL: Record<PrintShopSide, string> = {
  signage: "Signage & banners",
  merch: "Clothing & merch",
};
export const SHOP_SIDE_BLURB: Record<PrintShopSide, string> = {
  signage: "Banners, corflute signs, decals — priced by size.",
  merch: "Tees, hoodies and uniforms — printed or embroidered, priced per garment.",
};

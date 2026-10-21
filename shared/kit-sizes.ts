// Kit sizes on a player's profile — what we order uniform from.
//
// Daniel, 2026-10-22: "allow us optionally to add like uniform size and boot
// size … shirt, shorts and boots from which we can calculate socks and
// everything else falls into those categories from trackpants, sweatshirts,
// compression tops, rain jackets".
//
// 🔴 THREE stored facts, everything else DERIVED. A top size covers every top
// (training tee, sweatshirt, compression top, rain jacket); a bottoms size
// covers shorts and trackpants; socks follow the boot. Storing a size per
// garment would be eight boxes a parent never fills and that disagree with
// each other the first time one is updated.
//
// 🔴 OPTIONAL and BLANK ≠ a size. NULL means nobody told us; it is never
// defaulted, and an order sheet must show it as missing rather than guess.
//
// The garment list is the club's own supplier sizing (the CUFC shop: kids
// "8 (130)" … adults XS–4XL), so what is recorded here is what gets ordered.

export const GARMENT_SIZES = [
  "4 (110)", "6 (120)", "8 (130)", "10 (140)", "12 (150)", "14 (160)",
  "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL",
] as const;

// UK sizing, which is how football boots are sold in NZ. Kids sizes carry a K.
export const BOOT_SIZES: string[] = [
  ...["10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5"].map(s => `UK ${s}K`),
  ...Array.from({ length: 25 }, (_, i) => `UK ${1 + i * 0.5}`).map(s => s.replace(".0", "")),
];

export type KitSizes = { shirtSize: string | null; shortsSize: string | null; bootSize: string | null };

export const KIT_SIZE_FIELDS = [
  { key: "shirtSize",  column: "shirt_size",  label: "Shirt size",   covers: "Playing shirt, training tee, sweatshirt, compression top, rain jacket", options: GARMENT_SIZES as readonly string[] },
  { key: "shortsSize", column: "shorts_size", label: "Shorts size", covers: "Shorts, trackpants", options: GARMENT_SIZES as readonly string[] },
  { key: "bootSize",   column: "boot_size",   label: "Boot size",  covers: "Boots, and the sock size below", options: BOOT_SIZES as readonly string[] },
] as const;

/** A size is accepted only if it is on the list, or blank to clear it. */
export function cleanKitSize(field: (typeof KIT_SIZE_FIELDS)[number], v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  const t = String(v ?? "").trim();
  if (!t) return null;
  if (!field.options.includes(t)) throw new Error(`"${t}" isn't a ${field.label.toLowerCase()} we stock.`);
  return t;
}

/** UK boot size → a number on one scale (kids sizes sit below adult 1). */
function bootScale(boot: string): number | null {
  const m = /^UK (\d+(?:\.5)?)(K?)$/.exec(boot);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] ? n - 14 : n; // 13.5K → -0.5, UK 1 → 1
}

/** Football sock size suggested from the boot — a suggestion, labelled as one. */
export function socksFromBoot(boot: string | null | undefined): string | null {
  if (!boot) return null;
  const n = bootScale(boot);
  if (n === null) return null;
  if (n < 3) return "Kids (UK 10K–2.5)";
  if (n < 6) return "Youth (UK 3–5.5)";
  if (n < 9) return "Adult M (UK 6–8.5)";
  if (n < 12) return "Adult L (UK 9–11.5)";
  return "Adult XL (UK 12+)";
}

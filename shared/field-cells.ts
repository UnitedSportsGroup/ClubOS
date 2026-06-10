// Single source of truth for pitch sub-division conflicts, shared by the public
// booking UI (venue-book.tsx) and the server checkout (routes.ts) so the two
// CANNOT diverge — divergence would mean a slot looks free in the UI but
// collides on the server, i.e. a double-booking.
//
// A pitch is modelled as 4 ordered cells (front → back). Every booking occupies
// a set of those cells:
//   full          → 1 2 3 4
//   half  front   → 1 2          half  back → 3 4
//   quarter q1    → 1   q2 → 2   q3 → 3   q4 → 4   (q1,q2 are the front half;
//                                                   q3,q4 are the back half)
// Two bookings on the same facility + overlapping time conflict IFF their cell
// sets intersect. Unknown/legacy positions fall back to the whole pitch, which
// is the safe choice (blocks rather than risks a double-book).

export type FieldSize = "full" | "half" | "quarter";

export function occupiedCells(
  halfFull: string | null | undefined,
  position: string | null | undefined,
): number[] {
  if (halfFull === "quarter") {
    switch (position) {
      case "q1": return [1];
      case "q2": return [2];
      case "q3": return [3];
      case "q4": return [4];
      default: return [1, 2, 3, 4]; // unknown quarter → block the whole pitch
    }
  }
  if (halfFull === "half") {
    if (position === "front") return [1, 2];
    if (position === "back") return [3, 4];
    return [1, 2, 3, 4]; // unknown/legacy half → block both halves
  }
  return [1, 2, 3, 4]; // full, or null/legacy → whole pitch
}

// Do two bookings (each described by its size + position) compete for any of
// the same physical cells?
export function cellsOverlap(
  aHalf: string | null | undefined, aPos: string | null | undefined,
  bHalf: string | null | undefined, bPos: string | null | undefined,
): boolean {
  const a = occupiedCells(aHalf, aPos);
  const b = new Set(occupiedCells(bHalf, bPos));
  return a.some((c) => b.has(c));
}

// Quarter position options, front → back, for the booking UI.
export const QUARTER_POSITIONS: { value: "q1" | "q2" | "q3" | "q4"; label: string }[] = [
  { value: "q1", label: "Q1 (front)" },
  { value: "q2", label: "Q2" },
  { value: "q3", label: "Q3" },
  { value: "q4", label: "Q4 (back)" },
];

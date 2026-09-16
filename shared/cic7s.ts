/**
 * CIC Summer 7's — which EDITION a registration belongs to.
 *
 * 🔴 The edition is STAMPED on the registration when it is taken, never derived
 * from `created_at`. This is the same rule as `registrations.term_id`, and for
 * the same reason: interest in the January 2026 tournament was collected from
 * September 2025, and interest in January 2027 from August 2026. A date rule
 * would need to know each edition's marketing window, and the moment the next
 * edition opened it would silently re-file every past registration under it —
 * which is exactly the bug Daniel caught on the FUNiño Players tab.
 *
 * A row nobody can establish reads "not recorded". It is never filed under an
 * edition on a guess.
 */

/** The edition being sold right now. New registrations are stamped with this. */
export const CIC7S_CURRENT_EDITION = 2027;

/** Editions the club has run or is selling, newest first. Drives the year picker. */
export const CIC7S_EDITIONS = [2027, 2026] as const;

/**
 * 🔴 The grades are NOT the same across editions, so a page must be able to draw
 * both vocabularies. 2026 ran Men's, Masters and Social. 2027 dropped Masters
 * (it is not on Isaac's launch graphic and has no price) and renamed Men's to
 * Open. Normalising them into one set would erase a real change to the product.
 */
export const CIC7S_CATEGORIES_BY_EDITION: Record<number, readonly string[]> = {
  2026: ["Mens", "Masters", "Social"],
  2027: ["Open", "Social"],
};

export function cic7sCategories(edition: number | null | undefined): readonly string[] {
  return (edition != null && CIC7S_CATEGORIES_BY_EDITION[edition]) || ["Open", "Mens", "Masters", "Social"];
}

/**
 * How a 2026 team's entry was paid, read from the tracking sheet's OWN boolean
 * columns (1st deposit / 2nd deposit / full payment).
 *
 * 🔴 Never parsed out of the breakdown text. That column holds "$495 + $495",
 * "*$795", "$250 + $500", "Paul to call" and "TBC" — it is a human's shorthand,
 * it contradicts itself between rows, and turning it into a cents figure would
 * be a reconstruction presented as a record. The breakdown rides verbatim in
 * the notes instead, so anyone can check what was actually written down.
 */
export type Cic7sEntryPayment = "paid" | "part_paid" | "unpaid" | "refunded";

export const CIC7S_ENTRY_PAYMENT_LABEL: Record<Cic7sEntryPayment, string> = {
  paid: "Paid in full",
  part_paid: "Part paid",
  unpaid: "Not paid",
  refunded: "Refunded",
};

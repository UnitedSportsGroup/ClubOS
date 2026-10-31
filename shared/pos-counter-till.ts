// The counter reader as a TILL — the shapes the server sends and the /counter
// page draws. See server/pos-counter-till.ts.

/** An unlocked reader re-locks itself after this long with nothing tapped. */
export const TILL_IDLE_MINUTES = 5;
/** Wrong PINs in a row before that person's PIN locks. */
export const TILL_PIN_MAX_FAILS = 5;
/** How long a locked PIN stays locked. */
export const TILL_PIN_LOCK_MINUTES = 15;

/** Exactly 4 digits, like every till. Not a password: it names who is serving
 *  on a device that is already linked to a register by a named staff member.
 *  🔴 A fixed length is what lets the pad check on the 4th digit — a variable
 *  length would count a short guess as a wrong PIN on every unlock. */
export const TILL_PIN_LENGTH = 4;
export function tillPinError(pin: unknown): string | null {
  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) return "A reader PIN is 4 digits.";
  if (/^(\d)\1+$/.test(pin)) return "Pick a PIN that isn't one digit repeated.";
  if ("0123456789".includes(pin) || "9876543210".includes(pin)) return "Pick a PIN that isn't a straight run of digits.";
  return null;
}

export interface TillStaff { id: number; name: string; initials: string; photo: string | null }

export interface TillMe {
  user: TillStaff;
  until: string;
  saleId: number | null;
  /** May this person look players up and register them? Same rule as the
   *  laptop: the Contacts tab somewhere. Without it the reader sells kit only. */
  canRegister: boolean;
}

export interface TillLine {
  id: number; kind: string; title: string; detail: string | null; qty: number;
  unitCents: number; lineCents: number; image: string | null; brand: string;
}

export interface TillSale {
  id: number; number: string; status: string; lines: TillLine[];
  subtotalCents: number; discountCents: number; totalCents: number; gstCents: number;
  paidCents: number; remainingCents: number;
  /** A card payment waiting on this reader, if any. */
  pendingPaymentId: number | null;
}

export interface TillPerson {
  key: string;
  name: string;
  /** "U11 · born 2015" — enough to pick the right child, no full date of birth on a shared screen. */
  hint: string | null;
  parents: string[];
}

/** Codes the registration step answers with when it needs one more thing. */
export type TillRegistrationNeed = "hdyhau_required" | "nzf_incomplete" | "age_warning";

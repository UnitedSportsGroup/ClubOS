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

/** A typed-in amount, like the bank's own terminal. One line can't exceed this:
 *  a $250 figure typed with one zero too many is the realistic mistake, and a
 *  sale above it is not a counter sale. */
export const TILL_CUSTOM_MAX_CENTS = 1_000_000;
/** What a typed amount is usually for, offered as chips; "Type…" takes anything else. */
export const TILL_CUSTOM_LABELS = ["Counter sale", "Kit", "Camp day", "Programme fee", "Donation", "Hire"] as const;

export interface TillStaff { id: number; name: string; initials: string; photo: string | null }
/** A brand whose money lands in the account this reader takes cards for. */
export interface TillBrand { id: number; name: string }

export interface TillMe {
  user: TillStaff;
  until: string;
  saleId: number | null;
  /** May this person look players up and register them? Same rule as the
   *  laptop: the Contacts tab somewhere. Without it the reader sells kit only. */
  canRegister: boolean;
  /** Cash is offered only on a register that takes it (the club is cashless by default). */
  handlesCash: boolean;
  /** The brands a typed amount may bank under — those on the reader's own account, the register's brand first. */
  brands: TillBrand[];
  defaultBrandId: number | null;
  /** May this person register a gymnast? The gym's Registrations tab somewhere. */
  canRegisterGym: boolean;
}

// ── United Gymnastics on the tills (2026-11-16) ─────────────────────────────
/** One option of a gym programme, priced for the term being sold. */
export interface TillGymOption {
  index: number; label: string;
  fullPriceCents: number; priceCents: number; prorated: boolean; weeksLeft: number;
  /** The class times a family may choose this term ("Tuesday 4:00–4:45pm"); empty = no timetable (invite-only). */
  choices: string[];
}
export interface TillGymProgramme { slug: string; title: string; ages: string; inviteOnly: boolean; options: TillGymOption[] }
/** What a till may sell for the gym today — null when no term is open for enrolment. */
export interface TillGymCatalogue { orgId: number; term: { id: string; name: string }; programmes: TillGymProgramme[] }

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
export type TillRegistrationNeed = "hdyhau_required" | "nzf_incomplete" | "age_warning" | "already_registered";

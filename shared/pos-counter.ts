// The counter screen (our app on the Stripe S710) — the one shape the server
// sends and the /counter page draws. See server/pos-counter.ts.

export const COUNTER_COOKIE = "__Host-clubos_counter";
/** A screen that has polled within this many seconds is "online". */
export const COUNTER_ONLINE_SECONDS = 20;
/** How long the thank-you screen stays up after a sale is paid. */
export const COUNTER_PAID_SCREEN_SECONDS = 90;

export type CounterScreen = "pair" | "idle" | "cart" | "pay" | "paid";

export interface CounterLine {
  id: number; title: string; detail: string | null; qty: number; unitCents: number; lineCents: number;
  image: string | null; brand: string; brandLogo: string | null;
}

export interface CounterState {
  serverTime: string;
  deviceId: number;
  screen: CounterScreen;
  paired: boolean;
  code: string | null;
  codeExpiresAt: string | null;
  register: { id: number; name: string } | null;
  sale: {
    id: number; number: string; status: string; lines: CounterLine[];
    subtotalCents: number; discountCents: number; totalCents: number; gstCents: number;
    paidCents: number; remainingCents: number; paidAt: string | null; paidBy: string[];
    receiptSentTo: string | null;
  } | null;
  /** A card payment the till asked the customer to make on this screen. */
  charge: { paymentId: number; amountCents: number; claimed: boolean; lastError: string | null } | null;
  idle: {
    brands: { name: string; logo: string }[];
    products: { title: string; brand: string; priceCents: number; image: string }[];
    programmes: { name: string; brand: string; fromCents: number | null }[];
  } | null;
  /** Only on the very first start: the native shell keeps it to authenticate its own calls. */
  token?: string;
}

/** d•••@gmail.com — enough for a customer to recognise, not enough to read off a screen. */
export function maskEmail(e: string): string {
  const [user, domain] = e.split("@");
  if (!domain) return "•••";
  return `${user.slice(0, 1)}•••@${domain}`;
}

/** What the till shows about its counter screen. */
export interface CounterStatus {
  id: number; label: string | null; online: boolean; lastSeenAt: string | null; pairedAt: string | null;
  appVersion: string | null; nativeVersion: string | null; stripeReaderId: string | null; readerStatus: string | null;
}

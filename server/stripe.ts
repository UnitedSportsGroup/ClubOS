import Stripe from "stripe";
import { cugcStripe } from "./cugc-stripe";
import type { CampMoneyAccount } from "@shared/camp-money-account";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-04-30.basil",
});

/** The Stripe client for an account. Only a holiday camp owned by United
 *  Gymnastics passes "cugc" (shared/camp-money-account.ts). */
export function stripeForAccount(account?: CampMoneyAccount): Stripe {
  return account === "cugc" ? cugcStripe : stripe;
}

/** A PaymentIntent / refund id the club account has never heard of. */
function isMissingOnClub(e: any): boolean {
  return e?.code === "resource_missing" || /No such (payment_intent|refund)/i.test(String(e?.message || ""));
}

/**
 * Run a lookup against the club account and, ONLY when Stripe answers "no such
 * object" there, against the gymnastics account. PaymentIntent and refund ids
 * are unique across Stripe, so this can never return the wrong account's
 * object — and every club payment behaves exactly as before (one call, same
 * account). It is what lets every existing confirm/refund path work for a
 * gymnastics camp booking without each caller knowing which account it is.
 */
async function clubThenCugc<T>(fn: (s: Stripe) => Promise<T>): Promise<T> {
  try {
    return await fn(stripe);
  } catch (e) {
    if (isMissingOnClub(e) && process.env.CUGC_STRIPE_SECRET_KEY) return fn(cugcStripe);
    throw e;
  }
}

export interface PaymentIntentParams {
  registrationId: number;
  campName: string;
  totalCents: number;
  currency: string;
  parentEmail: string;
  metadata?: Record<string, string>;
  /** Attach an existing Stripe customer (required when saving the card for later, e.g. instalments). */
  customerId?: string;
  /** Set to "off_session" to save the payment method for a future off-session charge (the MFL balance). */
  setupFutureUsage?: "off_session" | "on_session";
  /** Optional idempotency key to make retries safe. */
  idempotencyKey?: string;
  /** Which Stripe account banks it. Omitted = the club account (every caller before 25 Nov 2026). */
  account?: CampMoneyAccount;
}

export async function createPaymentIntent(params: PaymentIntentParams): Promise<Stripe.PaymentIntent> {
  const paymentIntent = await stripeForAccount(params.account).paymentIntents.create(
    {
      amount: params.totalCents,
      currency: params.currency.toLowerCase(),
      receipt_email: params.parentEmail,
      ...(params.customerId ? { customer: params.customerId } : {}),
      ...(params.setupFutureUsage ? { setup_future_usage: params.setupFutureUsage } : {}),
      metadata: {
        registrationId: String(params.registrationId),
        ...params.metadata,
      },
      description: `${params.campName} — Registration #${params.registrationId}`,
      automatic_payment_methods: {
        enabled: true,
      },
    },
    params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined,
  );

  return paymentIntent;
}

/**
 * Find an existing Stripe customer by email or create a new one. Used so the
 * deposit PaymentIntent can save a card on file for the later balance charge.
 */
export async function getOrCreateCustomer(params: {
  email: string;
  name?: string;
  phone?: string;
}): Promise<Stripe.Customer> {
  const existing = await stripe.customers.list({ email: params.email, limit: 1 });
  if (existing.data.length > 0) {
    return existing.data[0];
  }
  return stripe.customers.create({
    email: params.email,
    ...(params.name ? { name: params.name } : {}),
    ...(params.phone ? { phone: params.phone } : {}),
  });
}

/**
 * Create a SetupIntent to save a card on file with NO charge. Used by Split Pay:
 * each squad member saves their card while the split is 'open'; that saved card
 * is then charged its frozen share ONCE, off-session, when the captain locks the
 * roster (via createOffSessionPaymentIntent). usage:"off_session" so the saved
 * method is valid for the later merchant-initiated charge.
 */
export async function createSetupIntent(params: {
  customerId: string;
  metadata?: Record<string, string>;
}): Promise<Stripe.SetupIntent> {
  return stripe.setupIntents.create({
    customer: params.customerId,
    usage: "off_session",
    automatic_payment_methods: { enabled: true },
    metadata: params.metadata || {},
  });
}

/**
 * Charge a saved payment method off-session (no customer present). Used by the
 * MFL balance cron to collect the second instalment on the due date.
 * Throws if the charge requires authentication or is declined — caller handles state.
 */
export async function createOffSessionPaymentIntent(params: {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  description: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}): Promise<Stripe.PaymentIntent> {
  return stripe.paymentIntents.create(
    {
      amount: params.amountCents,
      currency: params.currency.toLowerCase(),
      customer: params.customerId,
      payment_method: params.paymentMethodId,
      off_session: true,
      confirm: true,
      description: params.description,
      metadata: params.metadata || {},
    },
    params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined,
  );
}

export async function retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
  return clubThenCugc((s) => s.paymentIntents.retrieve(id));
}

export async function createRefund(params: {
  paymentIntentId: string;
  amountCents?: number;
  reason?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}): Promise<Stripe.Refund> {
  const refund = await clubThenCugc((s) => s.refunds.create(
    {
      payment_intent: params.paymentIntentId,
      ...(params.amountCents ? { amount: params.amountCents } : {}),
      reason: "requested_by_customer",
      metadata: {
        ...(params.reason ? { admin_reason: params.reason } : {}),
        ...params.metadata,
      },
    },
    params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined
  ));
  return refund;
}

export async function retrieveRefund(id: string): Promise<Stripe.Refund> {
  return clubThenCugc((s) => s.refunds.retrieve(id));
}

export function constructWebhookEvent(payload: string | Buffer, sig: string): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  }
  return stripe.webhooks.constructEvent(payload, sig, webhookSecret);
}

export { stripe };

/**
 * A plain card charge that belongs to no registration.
 *
 * Deliberately separate from createPaymentIntent, for two reasons:
 *
 * 1. createPaymentIntent stamps `registrationId` into metadata unconditionally.
 *    The Stripe webhook's final `else if (registrationId)` branch treats that as
 *    a camp registration — so passing any other kind of id through it means a
 *    payment for one thing quietly finalising another.
 *
 * 2. It enables `automatic_payment_methods`, which turns on whatever Stripe is
 *    promoting that quarter (Klarna showed up on the invoice pages this way).
 *    A team subs payment should be a card, and only a card.
 */
export async function createCardPaymentIntent(params: {
  amountCents: number;
  currency: string;
  receiptEmail?: string | null;
  description: string;
  metadata: Record<string, string>;
  customerId?: string;
  idempotencyKey?: string;
}): Promise<Stripe.PaymentIntent> {
  return stripe.paymentIntents.create(
    {
      amount: params.amountCents,
      currency: params.currency.toLowerCase(),
      ...(params.receiptEmail ? { receipt_email: params.receiptEmail } : {}),
      ...(params.customerId ? { customer: params.customerId } : {}),
      description: params.description,
      metadata: params.metadata,
      payment_method_types: ["card"],
    },
    params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined,
  );
}

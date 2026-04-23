import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-04-30.basil",
});

export interface PaymentIntentParams {
  registrationId: number;
  campName: string;
  totalCents: number;
  currency: string;
  parentEmail: string;
  metadata?: Record<string, string>;
}

export async function createPaymentIntent(params: PaymentIntentParams): Promise<Stripe.PaymentIntent> {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: params.totalCents,
    currency: params.currency.toLowerCase(),
    receipt_email: params.parentEmail,
    metadata: {
      registrationId: String(params.registrationId),
      ...params.metadata,
    },
    description: `${params.campName} — Registration #${params.registrationId}`,
    automatic_payment_methods: {
      enabled: true,
    },
  });

  return paymentIntent;
}

export async function retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
  return stripe.paymentIntents.retrieve(id);
}

export async function createRefund(params: {
  paymentIntentId: string;
  amountCents?: number;
  reason?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}): Promise<Stripe.Refund> {
  const refund = await stripe.refunds.create(
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
  );
  return refund;
}

export function constructWebhookEvent(payload: string | Buffer, sig: string): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  }
  return stripe.webhooks.constructEvent(payload, sig, webhookSecret);
}

export { stripe };

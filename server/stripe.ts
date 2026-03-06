import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-04-30.basil",
});

export interface CheckoutParams {
  registrationId: number;
  campName: string;
  totalCents: number;
  currency: string;
  parentEmail: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export async function createCheckoutSession(params: CheckoutParams): Promise<Stripe.Checkout.Session> {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    customer_email: params.parentEmail,
    line_items: [
      {
        price_data: {
          currency: params.currency.toLowerCase(),
          product_data: {
            name: `${params.campName} — Registration #${params.registrationId}`,
          },
          unit_amount: params.totalCents,
        },
        quantity: 1,
      },
    ],
    metadata: {
      registrationId: String(params.registrationId),
      ...params.metadata,
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });

  return session;
}

export function constructWebhookEvent(payload: string | Buffer, sig: string): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  }
  return stripe.webhooks.constructEvent(payload, sig, webhookSecret);
}

export { stripe };

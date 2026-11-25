import { loadStripe, type Stripe } from "@stripe/stripe-js";

/**
 * Stripe.js for a camp checkout whose PaymentIntent lives on ANOTHER Stripe
 * account than the club's (a United Gymnastics camp → the gym's account; see
 * shared/camp-money-account.ts). The server hands the matching publishable key
 * back from /api/public/checkout/:id. Pages keep their own club loader and use
 * this only when that key is present, so every club checkout is unchanged.
 */
const loaders = new Map<string, Promise<Stripe | null>>();

export function stripeForKey(publishableKey: string): Promise<Stripe | null> {
  if (!loaders.has(publishableKey)) loaders.set(publishableKey, loadStripe(publishableKey));
  return loaders.get(publishableKey)!;
}

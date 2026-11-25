/**
 * Which Stripe account a holiday-camp booking banks with — the ONE decider.
 *
 * United Gymnastics (org 6) is its own business with its own Stripe account
 * (server/cugc-stripe.ts). Daniel, 16 Nov 2026: "anything gymnastics-related
 * goes to the gymnastics payout bank account". Every other club's camps bank
 * with the club account, exactly as before.
 *
 * Read by: POST /api/public/book (creates the PaymentIntent on this account)
 * and GET /api/public/checkout/:id (hands the browser this account's
 * publishable key, or Stripe Elements cannot load the intent at all).
 */
export type CampMoneyAccount = "club" | "cugc";

export const CUGC_ORG_ID = 6;

export function campMoneyAccount(orgId: number | null | undefined): CampMoneyAccount {
  return orgId === CUGC_ORG_ID ? "cugc" : "club";
}

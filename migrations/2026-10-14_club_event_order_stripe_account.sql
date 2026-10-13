-- Each club-event order remembers which Stripe account took its money, so an
-- event can move to the ring-fenced Grants & Sponsorship account without
-- stranding refunds / read-backs of tickets already sold on the club account.
-- Nullable, no default: NULL = no card payment. No CHECK (stale CHECKs have
-- 500'd checkouts before); the app validates the key.
ALTER TABLE club_event_orders ADD COLUMN IF NOT EXISTS stripe_account text;

-- Every card order so far was taken on the event's account at the time, and
-- no event has ever sold on anything but 'club'.
UPDATE club_event_orders o
   SET stripe_account = e.stripe_account
  FROM club_events e
 WHERE e.id = o.event_id
   AND o.stripe_payment_intent_id IS NOT NULL
   AND o.stripe_account IS NULL;

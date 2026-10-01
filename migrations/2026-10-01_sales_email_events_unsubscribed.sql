-- 2026-10-01 — 'unsubscribed' is a journey event too. The type CHECK listed only
-- the six Resend/tracking types, so recording an unsubscribe 500'd AFTER the
-- opt-out had already been saved (found by the live verifier, not a test).
ALTER TABLE sales_email_events DROP CONSTRAINT IF EXISTS sales_email_events_type_check;
ALTER TABLE sales_email_events ADD CONSTRAINT sales_email_events_type_check
  CHECK (type IN ('delivered','bounced','complained','delivery_delayed','opened','clicked','unsubscribed'));

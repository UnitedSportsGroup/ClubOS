-- Academy AutoPay, step 1 (4 Nov 2026): NZ bank direct debit on the Pre-Academy checkout.
-- A bank debit takes 2–3 working days to clear, so a registration can sit "payment
-- clearing" or "bank payment failed" while still status='pending' (unpaid is not
-- registered). These columns record that, nothing else. All nullable, no default:
-- a NULL means "nothing to say" (a card payment, or a registration from before this).
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_method_type text;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_processing_at timestamptz;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_failed_at timestamptz;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_failure_reason text;
CREATE INDEX IF NOT EXISTS registrations_bank_debit_state_idx
  ON registrations (payment_processing_at)
  WHERE payment_processing_at IS NOT NULL;

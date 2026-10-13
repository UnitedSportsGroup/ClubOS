-- When the money was recorded in Xero (the payment row's UpdatedDateUTC — the
-- moment Olga reconciled the bank line), beside paid_on (the bank date).
-- NULL = not paid, or not read yet. Never back-filled with a guess.
ALTER TABLE xero_invoice_registrations ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE xero_invoice_registrations ADD COLUMN IF NOT EXISTS payment_reference text;
CREATE INDEX IF NOT EXISTS xero_invoice_registrations_child_idx ON xero_invoice_registrations (child_contact_id);

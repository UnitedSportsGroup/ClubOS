-- Payments due → Reminder / Escalation emails (Ryan, 2026-11-04: "Reminder button that sends
-- out automatic email with a link to pay. Escalation button that sends out official email from
-- GM, no pay no play. And a link to pay").
-- One row per email sent to a family: who sent it, to whom, which Xero invoices it covered and
-- what they owed at that moment. APPEND-ONLY — a chase record that can be tidied away cannot
-- answer "were they told?". Additive; RLS on like every table.
CREATE TABLE IF NOT EXISTS payment_chase_emails (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  kind             text NOT NULL CHECK (kind IN ('reminder', 'escalation')),
  family_key       text NOT NULL,
  to_email         text NOT NULL CHECK (btrim(to_email) <> ''),
  from_email       text NOT NULL,
  invoice_ids      text[] NOT NULL CHECK (cardinality(invoice_ids) > 0),
  invoice_numbers  text[] NOT NULL,
  owed_cents       integer NOT NULL CHECK (owed_cents > 0),
  note             text,
  sent_by_user_id  integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  resend_id        text,
  sent_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_chase_emails_family ON payment_chase_emails (organization_id, family_key, kind, sent_at DESC);
CREATE INDEX IF NOT EXISTS payment_chase_emails_invoices ON payment_chase_emails USING gin (invoice_ids);
ALTER TABLE payment_chase_emails ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION payment_chase_emails_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'payment_chase_emails is append-only'; END $$;
DROP TRIGGER IF EXISTS payment_chase_emails_no_change ON payment_chase_emails;
CREATE TRIGGER payment_chase_emails_no_change BEFORE UPDATE OR DELETE ON payment_chase_emails
  FOR EACH ROW EXECUTE FUNCTION payment_chase_emails_append_only();

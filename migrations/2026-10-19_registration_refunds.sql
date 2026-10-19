-- Every refund of a registration, one row each, kept forever.
-- Daniel, 2026-10-19: "tracking who issued the refund, whether it's me or Isaac
-- … so we have the historical record and the time and date stamp."
-- registrations.refunded_by / refunded_at hold only the LATEST refund, so a
-- second partial refund overwrote who did the first. This ledger never does.
-- 🔴 issued_by_user_id is NULL only on backfilled rows from before this table,
--    where nobody recorded who did it ("not recorded", never a guess).
-- 🔴 Append-only: UPDATE and DELETE are refused by trigger.
CREATE TABLE IF NOT EXISTS registration_refunds (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registration_id integer NOT NULL REFERENCES registrations(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  reason text,
  mode text,                                   -- full | amount | items | backfill
  issued_by_user_id integer REFERENCES users(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL DEFAULT now(),
  stripe_refund_id text,
  stripe_refund_status text,
  backfilled boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS registration_refunds_reg_idx ON registration_refunds (registration_id, issued_at);
CREATE UNIQUE INDEX IF NOT EXISTS registration_refunds_stripe_uniq ON registration_refunds (stripe_refund_id) WHERE stripe_refund_id IS NOT NULL;
ALTER TABLE registration_refunds ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION registration_refunds_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'registration_refunds is append-only'; END $$;
DROP TRIGGER IF EXISTS registration_refunds_no_change ON registration_refunds;
CREATE TRIGGER registration_refunds_no_change BEFORE UPDATE OR DELETE ON registration_refunds
  FOR EACH ROW EXECUTE FUNCTION registration_refunds_append_only();

-- Backfill: one row per already-refunded registration, from what it recorded.
-- (Several partial refunds before today collapse into one row — the detail was
-- never stored, so it cannot be recovered.)
INSERT INTO registration_refunds (registration_id, amount_cents, reason, mode, issued_by_user_id, issued_at, stripe_refund_id, stripe_refund_status, backfilled)
SELECT r.id, r.refunded_amount_cents, r.refund_reason, 'backfill', r.refunded_by,
       COALESCE(r.refunded_at, now()), r.stripe_refund_id, r.stripe_refund_status, true
FROM registrations r
WHERE COALESCE(r.refunded_amount_cents, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM registration_refunds x WHERE x.registration_id = r.id);

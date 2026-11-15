-- ─────────────────────────────────────────────────────────────────────────────
-- POS — United Gymnastics classes sold on the tills (Daniel, 2026-11-16).
--
--   npx tsx --env-file=.env script/apply-pos-gym.ts [--commit]
--
-- "anything gymnastics-related goes to the gymnastics payout bank account,
-- because we have two different Stripe accounts." A gym class sold at a
-- counter is a cugc_registrations row (the same row cugc.co.nz's enrol form
-- writes, the same row the gym's roll reads) carried on a till sale that banks
-- with the gym's Stripe account. The line names its registration; the
-- registration names its sale.
--
-- ADDITIVE. Nullable columns and one CHECK no existing row can fail.
-- ─────────────────────────────────────────────────────────────────────────────

-- The till line that sells a gym class. RESTRICT: a registration a sale paid
-- for can never be deleted from under it.
ALTER TABLE pos_sale_lines
  ADD COLUMN IF NOT EXISTS cugc_registration_id integer REFERENCES cugc_registrations(id) ON DELETE RESTRICT;
-- One registration is on one line, ever.
CREATE UNIQUE INDEX IF NOT EXISTS pos_sale_lines_cugc_reg_unq
  ON pos_sale_lines (cugc_registration_id) WHERE cugc_registration_id IS NOT NULL;
-- A gym line names a gym registration, and only a gym line does.
DO $$ BEGIN
  ALTER TABLE pos_sale_lines ADD CONSTRAINT pos_sale_lines_gym_pair
    CHECK ((kind = 'cugc_registration') = (cugc_registration_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The registration knows the sale that sold it, how it was paid, and who
-- served (RESTRICT, like registrations.served_by_user_id — deleting a staff
-- member must never erase who took the money).
ALTER TABLE cugc_registrations
  ADD COLUMN IF NOT EXISTS pos_sale_id       integer REFERENCES pos_sales(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method    text,
  ADD COLUMN IF NOT EXISTS served_by_user_id integer REFERENCES users(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS cugc_registrations_pos_sale_idx
  ON cugc_registrations (pos_sale_id) WHERE pos_sale_id IS NOT NULL;

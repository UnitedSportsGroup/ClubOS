-- CIC 2027 packages: one club books SEVERAL age groups at once and pays ONE
-- deposit (Daniel, 26 Nov 2026: "select multiple age groups at once … one booking,
-- one deposit").
--
-- Each team stays an ordinary cic_pkg_bookings row — its own frozen quote, players'
-- join link, balance and instalments — tied to a group. The group carries the
-- manager and the single deposit. One card payment (cic_pkg_group_payments) marks
-- a deposit row on EVERY team paid at once, so every existing rule (the 10%
-- CHECK, one paid deposit per booking, the balance maths) holds per team.
--
-- No BEGIN/COMMIT here: script/apply-cic-packages-groups.ts wraps it.

CREATE TABLE IF NOT EXISTS cic_pkg_groups (
  id               serial PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  token            text NOT NULL UNIQUE,              -- the manager's group page (128 bits, hex)
  club_name        text NOT NULL,
  manager_name     text NOT NULL,
  manager_email    text NOT NULL,
  manager_phone    text NOT NULL,
  deposit_cents    integer NOT NULL CHECK (deposit_cents > 0),  -- = sum of its teams' deposits
  expires_at       timestamptz NOT NULL,
  deposit_paid_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cic_pkg_bookings ADD COLUMN IF NOT EXISTS group_id integer REFERENCES cic_pkg_groups(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS cic_pkg_bookings_group_idx ON cic_pkg_bookings (group_id) WHERE group_id IS NOT NULL;

-- The one card charge for a group's deposit.
CREATE TABLE IF NOT EXISTS cic_pkg_group_payments (
  id                        serial PRIMARY KEY,
  group_id                  integer NOT NULL REFERENCES cic_pkg_groups(id) ON DELETE RESTRICT,
  amount_cents              integer NOT NULL CHECK (amount_cents > 0),
  stripe_payment_intent_id  text UNIQUE,
  paid_at                   timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cic_pkg_group_payments_group_idx ON cic_pkg_group_payments (group_id);
-- One paid deposit per group, ever.
CREATE UNIQUE INDEX IF NOT EXISTS cic_pkg_one_paid_group_deposit
  ON cic_pkg_group_payments (group_id) WHERE paid_at IS NOT NULL;

-- Each team's deposit row points at the group charge that paid it.
ALTER TABLE cic_pkg_payments ADD COLUMN IF NOT EXISTS group_payment_id integer REFERENCES cic_pkg_group_payments(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS cic_pkg_payments_group_payment_idx ON cic_pkg_payments (group_payment_id) WHERE group_payment_id IS NOT NULL;
ALTER TABLE cic_pkg_payments DROP CONSTRAINT IF EXISTS cic_pkg_pay_group_is_deposit;
ALTER TABLE cic_pkg_payments ADD CONSTRAINT cic_pkg_pay_group_is_deposit
  CHECK (group_payment_id IS NULL OR kind = 'deposit');

ALTER TABLE cic_pkg_groups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cic_pkg_group_payments ENABLE ROW LEVEL SECURITY;

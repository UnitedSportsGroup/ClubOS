-- CIC 2027 packages: a team books a package, pays a 10% non-refundable deposit,
-- then each player registers on their own link, pays their share of the balance
-- and can buy extras (merch, meals, attractions).
--
-- Rules (Ryan Edwards, 5 Nov 2026; Daniel, 6 Nov 2026):
--   * deposit = 10% of the CIC invoice total, flights EXCLUDED, non-refundable
--   * a quote holds 14 days; no deposit after expires_at
--   * the 90% balance is due across Jan / Mar / Apr 2027 instalments, paid by
--     the club, by players, or both — ONE balance
--   * extras are their own money and never reduce the team balance
--
-- Deliberately its OWN tables, not teampay_*: Team Pay carries live Ethnic Cup
-- and CIC 7's money with one fee per competition and one team payment per entry;
-- a package has a different locked total per team and a deposit + instalments.
--
-- No BEGIN/COMMIT here: script/apply-cic-packages.ts wraps it (and its dry run).

CREATE TABLE IF NOT EXISTS cic_pkg_bookings (
  id                 serial PRIMARY KEY,
  organization_id    integer NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  token              text NOT NULL UNIQUE,          -- manager's page (128 bits, hex)
  join_token         text NOT NULL UNIQUE,          -- players' sign-up link (a different secret)
  club_name          text NOT NULL,
  team_name          text,
  manager_name       text NOT NULL,
  manager_email      text NOT NULL,
  manager_phone      text NOT NULL,
  origin             text NOT NULL,
  package_id         text NOT NULL,
  age_group          text NOT NULL,
  players            integer NOT NULL CHECK (players BETWEEN 1 AND 40),
  staff              integer NOT NULL CHECK (staff BETWEEN 0 AND 20),
  adults             integer NOT NULL CHECK (adults BETWEEN 0 AND 60),
  input              jsonb NOT NULL,                -- the cleaned QuoteInput, as priced
  lines              jsonb NOT NULL,                -- the quote lines, frozen
  prices_checked_at  text,                          -- the trip-prices file it was priced from
  total_cents        integer NOT NULL CHECK (total_cents > 0),
  flights_cents      integer NOT NULL DEFAULT 0 CHECK (flights_cents >= 0),
  invoice_cents      integer NOT NULL CHECK (invoice_cents > 0),
  deposit_cents      integer NOT NULL,
  per_player_cents   integer NOT NULL CHECK (per_player_cents > 0),     -- incl. their flights
  player_share_cents integer NOT NULL CHECK (player_share_cents >= 0),  -- their share of the BALANCE
  per_adult_cents    integer NOT NULL CHECK (per_adult_cents >= 0),
  terms_accepted_at  timestamptz NOT NULL,
  expires_at         timestamptz NOT NULL,
  deposit_paid_at    timestamptz,
  cancelled_at       timestamptz,
  cancelled_reason   text,
  staff_notes        text,
  source             text,
  quarantined        boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cic_pkg_invoice_le_total CHECK (invoice_cents + flights_cents = total_cents),
  CONSTRAINT cic_pkg_deposit_is_ten_pct CHECK (deposit_cents = round(invoice_cents::numeric / 10)),
  CONSTRAINT cic_pkg_hold_is_14_days CHECK (expires_at <= created_at + interval '14 days 1 minute'),
  CONSTRAINT cic_pkg_package CHECK (package_id IN ('entry','base','legacy')),
  CONSTRAINT cic_pkg_origin CHECK (origin IN ('chch','south','north','overseas'))
);
CREATE INDEX IF NOT EXISTS cic_pkg_bookings_org_idx ON cic_pkg_bookings (organization_id, created_at DESC);

-- Players register themselves on the team's join link and get their own page.
CREATE TABLE IF NOT EXISTS cic_pkg_players (
  id                 serial PRIMARY KEY,
  booking_id         integer NOT NULL REFERENCES cic_pkg_bookings(id) ON DELETE RESTRICT,
  token              text NOT NULL UNIQUE,
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  date_of_birth      date,
  guardian_name      text NOT NULL,
  guardian_email     text NOT NULL,
  guardian_phone     text NOT NULL,
  medical            text,
  shirt_size         text,
  withdrawn_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cic_pkg_players_booking_idx ON cic_pkg_players (booking_id);

-- No more players than the squad that was priced.
CREATE OR REPLACE FUNCTION cic_pkg_enforce_squad() RETURNS trigger AS $$
DECLARE cap integer; n integer;
BEGIN
  SELECT players INTO cap FROM cic_pkg_bookings WHERE id = NEW.booking_id FOR UPDATE;
  SELECT count(*) INTO n FROM cic_pkg_players WHERE booking_id = NEW.booking_id AND withdrawn_at IS NULL;
  IF n >= cap THEN
    RAISE EXCEPTION 'cic_pkg_squad_full' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS cic_pkg_players_squad ON cic_pkg_players;
CREATE TRIGGER cic_pkg_players_squad BEFORE INSERT ON cic_pkg_players
  FOR EACH ROW EXECUTE FUNCTION cic_pkg_enforce_squad();

-- What players can add: merch, meals, attractions, promotions. Data, edited by
-- staff in ClubOS. A NULL price is "not on sale yet" and is never shown.
CREATE TABLE IF NOT EXISTS cic_pkg_extras (
  id               serial PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  category         text NOT NULL CHECK (category IN ('merch','meal','experience','promo')),
  name             text NOT NULL,
  description      text,
  partner          text,
  price_cents      integer CHECK (price_cents IS NULL OR price_cents > 0),
  options          text[] NOT NULL DEFAULT '{}',   -- e.g. sizes; empty = no choice
  source_note      text,                            -- where the price came from
  active           boolean NOT NULL DEFAULT true,
  sort             integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

-- Every payment against a booking. `amount_cents` is what comes OFF the team
-- balance; `extras_cents` is extras on the same charge, which never does.
CREATE TABLE IF NOT EXISTS cic_pkg_payments (
  id                 serial PRIMARY KEY,
  booking_id         integer NOT NULL REFERENCES cic_pkg_bookings(id) ON DELETE RESTRICT,
  player_id          integer REFERENCES cic_pkg_players(id) ON DELETE RESTRICT,
  kind               text NOT NULL CHECK (kind IN ('deposit','instalment','balance','player')),
  amount_cents       integer NOT NULL CHECK (amount_cents >= 0),
  extras_cents       integer NOT NULL DEFAULT 0 CHECK (extras_cents >= 0),
  items              jsonb NOT NULL DEFAULT '[]',   -- [{extraId,name,option,qty,priceCents}]
  stripe_payment_intent_id text UNIQUE,
  paid_at            timestamptz,
  refunded_cents     integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cic_pkg_pay_something CHECK (amount_cents + extras_cents > 0),
  CONSTRAINT cic_pkg_pay_refund_le CHECK (refunded_cents <= amount_cents + extras_cents),
  CONSTRAINT cic_pkg_pay_player_kind CHECK ((kind = 'player') = (player_id IS NOT NULL)),
  CONSTRAINT cic_pkg_pay_extras_player CHECK (extras_cents = 0 OR kind = 'player')
);
CREATE INDEX IF NOT EXISTS cic_pkg_payments_booking_idx ON cic_pkg_payments (booking_id);
-- One deposit per booking that can ever be PAID.
CREATE UNIQUE INDEX IF NOT EXISTS cic_pkg_one_paid_deposit
  ON cic_pkg_payments (booking_id) WHERE kind = 'deposit' AND paid_at IS NOT NULL;

-- 🔴 The deposit must be exactly the booking's deposit, and only inside the hold.
CREATE OR REPLACE FUNCTION cic_pkg_check_payment() RETURNS trigger AS $$
DECLARE b cic_pkg_bookings%ROWTYPE;
BEGIN
  SELECT * INTO b FROM cic_pkg_bookings WHERE id = NEW.booking_id;
  IF NEW.kind = 'deposit' AND NEW.amount_cents <> b.deposit_cents THEN
    RAISE EXCEPTION 'cic_pkg_deposit_amount' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.kind = 'deposit' AND now() > b.expires_at THEN
    RAISE EXCEPTION 'cic_pkg_hold_expired' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.kind <> 'deposit' AND b.deposit_paid_at IS NULL THEN
    RAISE EXCEPTION 'cic_pkg_no_deposit' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.player_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM cic_pkg_players p WHERE p.id = NEW.player_id AND p.booking_id = NEW.booking_id
  ) THEN
    RAISE EXCEPTION 'cic_pkg_player_booking' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS cic_pkg_payments_check ON cic_pkg_payments;
CREATE TRIGGER cic_pkg_payments_check BEFORE INSERT OR UPDATE ON cic_pkg_payments
  FOR EACH ROW EXECUTE FUNCTION cic_pkg_check_payment();
-- 🔴 Deliberately NO trigger capping the paid sum at the invoice. The cap lives at
-- the moment a charge is CREATED (server/cic-packages.ts). A refusal at the
-- moment money is RECORDED would mean a card was charged and nothing written
-- down; an over-collection is visible on the staff board and refundable.

ALTER TABLE cic_pkg_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cic_pkg_players  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cic_pkg_extras   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cic_pkg_payments ENABLE ROW LEVEL SECURITY;

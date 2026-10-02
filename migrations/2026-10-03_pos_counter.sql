-- ─────────────────────────────────────────────────────────────────────────────
-- POS — the COUNTER SCREEN: our own app on the Stripe S710 (Apps on Devices).
--
--   npx tsx --env-file=.env script/apply-pos-counter.ts [--commit]
--
-- Stripe enabled Apps on Devices on the club account on 2026-10-02. The S710
-- now runs a thin native app (apps/clubos-counter) whose screen is a ClubOS
-- page (/counter). The till stays the web register on a laptop; the reader is
-- what the CUSTOMER looks at: the cart with photos, the total, then the card.
--
-- A counter screen is a DEVICE, not a person. It holds a random 256-bit token
-- (stored here only as a SHA-256 hash), is bound to ONE register by a staff
-- member typing the short code it shows, and can be revoked. It never holds a
-- staff session and can only: read what its own register is showing, collect
-- a card payment the till asked for, and send a receipt for a sale it just
-- took. Nothing else in ClubOS answers it.
--
-- ADDITIVE. Two tables, four nullable columns. No existing row changes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pos_counter_devices (
  id                  integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  register_id         integer REFERENCES pos_registers(id) ON DELETE RESTRICT,
  token_hash          text NOT NULL UNIQUE,
  pairing_code        text,
  pairing_expires_at  timestamptz,
  label               text,
  paired_at           timestamptz,
  paired_by_user_id   integer REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at          timestamptz,
  revoked_by_user_id  integer REFERENCES users(id) ON DELETE RESTRICT,
  last_seen_at        timestamptz,
  app_version         text,
  native_version      text,
  stripe_reader_id    text,
  reader_status       text,
  user_agent          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Paired means bound to a register, by a named person.
  CONSTRAINT pos_counter_paired_pair CHECK ((paired_at IS NULL) = (paired_by_user_id IS NULL)),
  CONSTRAINT pos_counter_paired_register CHECK (paired_at IS NULL OR register_id IS NOT NULL),
  CONSTRAINT pos_counter_revoked_pair CHECK ((revoked_at IS NULL) = (revoked_by_user_id IS NULL))
);
-- 🔴 One live counter screen per register. Two screens both answering "pay
-- here" for one sale is a customer tapping a card on the wrong one.
CREATE UNIQUE INDEX IF NOT EXISTS pos_counter_one_per_register
  ON pos_counter_devices (register_id) WHERE paired_at IS NOT NULL AND revoked_at IS NULL;
-- An outstanding code is unique while it is outstanding.
CREATE UNIQUE INDEX IF NOT EXISTS pos_counter_pairing_code_unq
  ON pos_counter_devices (pairing_code) WHERE paired_at IS NULL AND revoked_at IS NULL AND pairing_code IS NOT NULL;

-- The reader has no USB and no debugger in production. Whatever the screen and
-- the native app see goes here, or nobody ever sees it. Rows are trimmed by
-- the server; a device row is never deleted, so CASCADE never fires in practice.
CREATE TABLE IF NOT EXISTS pos_counter_events (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  device_id   integer NOT NULL REFERENCES pos_counter_devices(id) ON DELETE CASCADE,
  level       text NOT NULL DEFAULT 'info',
  message     text NOT NULL,
  meta        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_counter_events_device_idx ON pos_counter_events (device_id, created_at DESC);

-- What the counter screen is showing. Set by the till's existing "display"
-- call, cleared when a sale ends any way but the card on that screen.
ALTER TABLE pos_registers ADD COLUMN IF NOT EXISTS counter_sale_id integer REFERENCES pos_sales(id) ON DELETE SET NULL;
ALTER TABLE pos_registers ADD COLUMN IF NOT EXISTS counter_updated_at timestamptz;

-- How a card payment is being collected: 'reader' (server-driven S710),
-- 'sdk' (the staff app's WisePad), 'counter' (our app on the S710). NULL on
-- every row written before this — "not recorded", never guessed.
ALTER TABLE pos_payments ADD COLUMN IF NOT EXISTS channel text;
-- 🔴 The counter screen CLAIMS a payment before it presents the card prompt.
-- One claim per payment: a screen that reloads mid-sale must never ask the
-- customer to tap twice.
ALTER TABLE pos_payments ADD COLUMN IF NOT EXISTS collect_started_at timestamptz;

ALTER TABLE pos_counter_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_counter_events  ENABLE ROW LEVEL SECURITY;

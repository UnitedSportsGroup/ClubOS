-- ─────────────────────────────────────────────────────────────────────────────
-- POS — the S710 becomes a TILL on its own (Daniel, 2026-10-31).
--
--   npx tsx --env-file=.env script/apply-pos-counter-till.ts [--commit]
--
-- "do the whole process off the eftpos machine and have it logged to ClubOS
-- without needing phone or laptop or iPad." Until now the reader was only the
-- customer's screen; a laptop built the sale. Now a staff member unlocks the
-- reader with their own PIN, builds the sale on it, and the card is taken on
-- the same device.
--
-- 🔴 A device is still NOT a person. The PIN is what names the person: every
-- sale built on the reader is served_by the staff member who unlocked it, the
-- same load-bearing column the laptop till writes. The PIN is per person,
-- stored only as a scrypt hash, and locks after repeated wrong guesses.
--
-- ADDITIVE. One table, three nullable columns. No existing row changes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pos_staff_pins (
  user_id       integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin_hash      text NOT NULL,
  set_at        timestamptz NOT NULL DEFAULT now(),
  failed_count  integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  CONSTRAINT pos_staff_pins_hash_shape CHECK (pin_hash LIKE 's1$%'),
  CONSTRAINT pos_staff_pins_failed_nonneg CHECK (failed_count >= 0)
);
ALTER TABLE pos_staff_pins ENABLE ROW LEVEL SECURITY;

-- Who is using the reader as a till right now, until when, and the sale they
-- are building (so a reload or a power blip resumes it rather than losing it).
ALTER TABLE pos_counter_devices
  ADD COLUMN IF NOT EXISTS till_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS till_until   timestamptz,
  ADD COLUMN IF NOT EXISTS till_sale_id integer REFERENCES pos_sales(id) ON DELETE SET NULL;

-- Unlocked means a person AND an expiry, never one without the other.
DO $$ BEGIN
  ALTER TABLE pos_counter_devices ADD CONSTRAINT pos_counter_till_pair
    CHECK ((till_user_id IS NULL) = (till_until IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

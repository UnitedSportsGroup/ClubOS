-- Energy — every site we pay power, gas or water for; every bill; every payment.
-- Additive. No BEGIN/COMMIT — the apply script owns the transaction.
-- Money is integer cents INCLUDING GST (what the supplier charged); units are
-- what the meter measured (kWh, kg of LPG, m³ of water).

CREATE TABLE IF NOT EXISTS energy_sites (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text NOT NULL,
  address         text,
  utility         text NOT NULL CHECK (utility IN ('electricity','gas','water')),
  area            text,                      -- Residency · Clubrooms · Sports centre · … (a human's label)
  supplier        text,
  account_number  text,
  icp             text UNIQUE,               -- electricity connection id; one site per ICP
  meter           text,
  paid_by         text,                      -- who actually pays, as far as we know — never guessed
  notes           text,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS energy_bills (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id         integer NOT NULL REFERENCES energy_sites(id) ON DELETE RESTRICT,
  source          text NOT NULL CHECK (source IN ('meridian','kiwigas','manual')),
  -- One row per supplier document per site; a re-import is a retry, not a second bill.
  source_key      text NOT NULL UNIQUE,
  invoice_number  text,
  kind            text NOT NULL DEFAULT 'bill' CHECK (kind IN ('bill','credit')),
  period_start    date,
  period_end      date,
  bill_date       date,
  units           numeric(12,3),
  unit            text CHECK (unit IN ('kWh','kg','m3')),
  cents           integer NOT NULL,
  fixed_cents     integer NOT NULL DEFAULT 0,   -- daily / supply charges (paid whatever is used)
  lines           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lines) = 'array'),
  readings        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(readings) = 'array'),
  file            text,
  created_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
  CHECK ((kind = 'credit') = (cents < 0) OR cents = 0)
);
CREATE INDEX IF NOT EXISTS energy_bills_site_idx ON energy_bills (site_id, period_end);

CREATE TABLE IF NOT EXISTS energy_payments (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier        text NOT NULL,
  account_number  text,
  paid_on         date NOT NULL,
  cents           integer NOT NULL CHECK (cents > 0),
  method          text,                        -- "direct debit", "online banking" … as the supplier printed it
  source_key      text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE energy_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE energy_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE energy_payments ENABLE ROW LEVEL SECURITY;

-- A payment line can be a payment, a DISHONOUR (the bank bounced a direct
-- debit — the supplier adds it back to the balance) or a FEE. Amount is always
-- positive; `kind` says which way it moves the balance.
ALTER TABLE energy_payments ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'payment';
DO $$ BEGIN
  ALTER TABLE energy_payments ADD CONSTRAINT energy_payments_kind_chk CHECK (kind IN ('payment','dishonour','fee'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

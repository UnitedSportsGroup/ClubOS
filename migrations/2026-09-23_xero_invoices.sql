-- Every sales invoice raised in Xero, mirrored into ClubOS so staff can see and chase them without a Xero login.
-- 🔴 ClubOS NEVER pulls these itself: the shared "CUFC AIOS" Xero app's 5,000 calls a day are already spent by the
-- nightly pull and the payout sync (they ran out at 11:52 on 23 Sep). The finance app on Daniel's Mac, which holds the
-- granular read scopes and its own quota, pushes a snapshot nightly. This table is a MIRROR, never a source of truth —
-- Xero is. Nothing here is ever edited by a human, so a re-push is a refresh, not a conflict.
CREATE TABLE IF NOT EXISTS xero_invoices (
  invoice_id      text PRIMARY KEY,                    -- Xero's InvoiceID, so a re-push updates in place
  number          text NOT NULL,
  contact_id      text,
  contact         text NOT NULL,
  code            text NOT NULL DEFAULT '',            -- Olga's prefix: S, A U14, MFL, C, Res, OFC …
  person          text NOT NULL DEFAULT '',            -- the name with the prefix stripped
  category        text NOT NULL,                       -- Sponsors · Academy families · Mini Football teams …
  programme       text NOT NULL DEFAULT '',            -- U13, U9–U12 … where the code carries an age group
  status          text NOT NULL,                       -- paid · part paid · unpaid  (DERIVED on push from the money)
  issued          date NOT NULL,
  due             date,
  total_cents     integer NOT NULL,
  paid_cents      integer NOT NULL DEFAULT 0,
  due_cents       integer NOT NULL DEFAULT 0,
  credited_cents  integer NOT NULL DEFAULT 0,
  sent            boolean NOT NULL DEFAULT false,
  reference       text NOT NULL DEFAULT '',
  description     text NOT NULL DEFAULT '',
  accounts        text[] NOT NULL DEFAULT '{}',
  payments        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{date, amount, id}] — the part-payment history
  last_paid       date,
  email           text NOT NULL DEFAULT '',            -- who to chase: the GUARDIAN for a child's invoice
  phone           text NOT NULL DEFAULT '',
  contact_source  text NOT NULL DEFAULT '',            -- 'ClubOS — guardian' · 'ClubOS' · 'Xero contact'
  synced_at       timestamptz NOT NULL DEFAULT now()
);
-- 🔴 overdue is DERIVED on read (due < today AND due_cents > 0), never stored — a stored flag is wrong by morning.
CREATE INDEX IF NOT EXISTS xero_invoices_cat_idx    ON xero_invoices (category, status);
CREATE INDEX IF NOT EXISTS xero_invoices_due_idx    ON xero_invoices (due) WHERE due_cents > 0;
CREATE INDEX IF NOT EXISTS xero_invoices_person_idx ON xero_invoices (lower(person));
CREATE INDEX IF NOT EXISTS xero_invoices_issued_idx ON xero_invoices (issued DESC);
ALTER TABLE xero_invoices ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS xero_invoice_syncs (
  id          serial PRIMARY KEY,
  ran_at      timestamptz NOT NULL DEFAULT now(),
  rows        integer NOT NULL,
  as_at       date,
  source      text NOT NULL DEFAULT 'push_invoices.py'
);
ALTER TABLE xero_invoice_syncs ENABLE ROW LEVEL SECURITY;

-- Xero invoice → ClubOS registration sync (Daniel, 2026-10-14).
--
-- Olga invoices most families by hand and they pay by bank transfer. When she
-- reconciles the transfer, the invoice goes PAID in Xero — and until now
-- nothing told ClubOS, so paid children read "not registered" on the roll.
--
-- Additive only. Three tables; nothing existing is altered.

-- Which Xero contact IS which ClubOS child. Made once — by the strict auto rule
-- (unique name + age fits + parent email belongs to the family) or by a person
-- — and used for every later invoice to that contact.
CREATE TABLE IF NOT EXISTS xero_contact_links (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  xero_contact_id  text    NOT NULL,
  xero_contact_name text,
  -- 🔴 RESTRICT: deleting a child must not silently drop who paid for them.
  contact_id       integer NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  source           text    NOT NULL CHECK (source IN ('auto', 'staff')),
  decided_by_user_id integer REFERENCES users(id) ON DELETE RESTRICT,
  evidence         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- 🔴 A staff link must say WHO made it; an auto link must not pretend to.
  CONSTRAINT xero_contact_links_who CHECK ((source = 'staff') = (decided_by_user_id IS NOT NULL)),
  UNIQUE (organization_id, xero_contact_id)
);
CREATE INDEX IF NOT EXISTS xero_contact_links_contact ON xero_contact_links (contact_id);

-- Every academy invoice the sync has seen, and what it decided. One row per
-- invoice, updated as the invoice changes (unpaid → paid → voided…).
CREATE TABLE IF NOT EXISTS xero_invoice_registrations (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id       text    NOT NULL,
  invoice_number   text,
  xero_contact_id  text    NOT NULL,
  xero_contact_name text,
  parent_email     text,
  reference        text,
  xero_status      text    NOT NULL,
  payment_state    text    NOT NULL,       -- paid | part_paid | unpaid | credited | void | draft
  total_cents      integer NOT NULL,
  amount_paid_cents integer NOT NULL,
  amount_due_cents integer NOT NULL,
  paid_on          date,
  invoice_date     date,
  xero_updated_at  timestamptz,
  programme_key    text,
  program_id       integer REFERENCES programs(id) ON DELETE SET NULL,
  term_id          integer REFERENCES terms(id) ON DELETE SET NULL,
  child_contact_id integer REFERENCES contacts(id) ON DELETE RESTRICT,
  -- registered | would_register | already_registered | awaiting_payment |
  -- part_paid | needs_review | dismissed | void
  decision         text    NOT NULL,
  reason           text,
  candidates       integer[],
  registration_id  integer REFERENCES registrations(id) ON DELETE RESTRICT,
  -- TRUE only when THIS sync created the registration — the only ones it may
  -- ever flag for review if the invoice is later voided or credited.
  registered_by_sync boolean NOT NULL DEFAULT false,
  decided_by_user_id integer REFERENCES users(id) ON DELETE RESTRICT,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS xero_invoice_registrations_decision ON xero_invoice_registrations (organization_id, decision);
CREATE INDEX IF NOT EXISTS xero_invoice_registrations_child ON xero_invoice_registrations (child_contact_id);

-- Where the sync is up to, and a lease so two machines never run it at once.
CREATE TABLE IF NOT EXISTS xero_registration_sync_state (
  organization_id  integer PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  modified_since   timestamptz,
  lease_until      timestamptz,
  last_run_at      timestamptz,
  last_ok_at       timestamptz,
  last_error       text,
  last_counts      jsonb
);

ALTER TABLE xero_contact_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_invoice_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_registration_sync_state ENABLE ROW LEVEL SECURITY;

-- ── Sponsorship Partners — the sponsors we have already SIGNED ──────────────
-- Daniel, 2026-10-23: "Signed is king… a quick list of all of our actual
-- partners… quick link to get the actual signed doc… when they signed on, where
-- their renewal date is. If the renewal date is coming up, it needs to flag
-- that. If they've paid for the first year, but the payment for the second year
-- is coming up, that needs to get flagged."
--
-- A PARTNER is the relationship (the company). A CONTRACT is one signed
-- agreement inside it. PAYMENTS are the instalments a contract promises.
-- Deliverables hang off the CONTRACT (sponsorship_deliverables gains
-- partner_contract_id). Nothing derived is stored: current / renewal due /
-- overdue live in shared/sponsorship-partners.ts.
--
-- Idempotent. Additive. RLS on (the app connects as postgres and bypasses it;
-- RLS is the second wall for a leaked anon key).

create table if not exists sponsorship_partners (
  id integer primary key generated always as identity,
  organization_id integer not null references organizations(id) on delete cascade,
  company text not null,
  trading_name text,
  website text,
  logo_url text,
  brand_tags text[] not null default '{}',
  primary_contact_name text,
  primary_contact_role text,
  primary_contact_email text,
  primary_contact_phone text,
  deal_id integer references sponsorship_deals(id) on delete set null,
  sponsor_link_id integer references sponsors(id) on delete set null,
  xero_contact_name text,
  notes text,
  owner_id integer references users(id) on delete set null,
  created_by integer references users(id) on delete set null,
  archived_at timestamp,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);
create index if not exists sponsorship_partners_org_idx on sponsorship_partners(organization_id);
-- One live partner row per company per workspace. Archive, never duplicate.
create unique index if not exists sponsorship_partners_company_live_idx
  on sponsorship_partners(organization_id, lower(company)) where archived_at is null;

create table if not exists sponsorship_partner_contracts (
  id integer primary key generated always as identity,
  partner_id integer not null references sponsorship_partners(id) on delete restrict,
  title text,
  club_entity text,
  signed_on date,
  start_date date,
  end_date date,
  open_ended boolean not null default false,
  term_months integer,
  term_text text,
  renewal_terms text,
  auto_renews boolean,
  notice_days integer,
  cash_per_year_cents integer,
  cash_total_cents integer,
  gst_note text,
  contra_per_year_cents integer,
  contra_description text,
  payment_terms text,
  exclusivity text,
  termination text,
  other_clauses text,
  contract_node_id integer references drive_nodes(id) on delete restrict,
  contract_source_url text,
  signature_status text not null default 'not_checked',
  signed_by text,
  signature_evidence text,
  signature_checked_at timestamp,
  signature_checked_by integer references users(id) on delete set null,
  flags jsonb not null default '[]'::jsonb,
  source_files jsonb not null default '[]'::jsonb,
  created_by integer references users(id) on delete set null,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  -- a term cannot end before it starts; an open-ended deal carries no end date;
  -- money is never negative
  constraint sponsorship_partner_contracts_term_chk check (start_date is null or end_date is null or end_date >= start_date),
  constraint sponsorship_partner_contracts_open_chk check (not open_ended or end_date is null),
  constraint sponsorship_partner_contracts_money_chk check (
    coalesce(cash_per_year_cents, 0) >= 0 and coalesce(cash_total_cents, 0) >= 0 and coalesce(contra_per_year_cents, 0) >= 0
  ),
  constraint sponsorship_partner_contracts_notice_chk check (notice_days is null or notice_days >= 0)
);
create index if not exists sponsorship_partner_contracts_partner_idx on sponsorship_partner_contracts(partner_id);

create table if not exists sponsorship_partner_payments (
  id integer primary key generated always as identity,
  contract_id integer not null references sponsorship_partner_contracts(id) on delete cascade,
  label text,
  due_on date,
  amount_cents integer not null,
  gst_included boolean not null default false,
  paid_on date,
  paid_cents integer,
  xero_invoice_number text,
  xero_invoice_id text,
  notes text,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  -- an instalment is money; "paid" carries what was paid
  constraint sponsorship_partner_payments_amount_chk check (amount_cents > 0),
  constraint sponsorship_partner_payments_paid_chk check (
    (paid_on is null and paid_cents is null) or (paid_on is not null and paid_cents is not null and paid_cents >= 0)
  )
);
create index if not exists sponsorship_partner_payments_contract_idx on sponsorship_partner_payments(contract_id);

-- A deliverable belongs to a pipeline deal OR a signed partner contract.
alter table sponsorship_deliverables alter column deal_id drop not null;
alter table sponsorship_deliverables add column if not exists partner_contract_id integer
  references sponsorship_partner_contracts(id) on delete cascade;
create index if not exists sponsorship_deliverables_partner_contract_idx on sponsorship_deliverables(partner_contract_id);
alter table sponsorship_deliverables drop constraint if exists sponsorship_deliverables_owner_chk;
alter table sponsorship_deliverables add constraint sponsorship_deliverables_owner_chk
  check (deal_id is not null or partner_contract_id is not null);

alter table sponsorship_partners enable row level security;
alter table sponsorship_partner_contracts enable row level security;
alter table sponsorship_partner_payments enable row level security;

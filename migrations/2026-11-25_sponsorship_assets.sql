-- ── Sponsorship ASSETS — what each sponsor bought, the way the budget sheet lists it ──
-- Daniel, 2026-11-25: "make us be able to sort sponsors by asset like here view"
-- (the Sponsorship tab of "2026 Programme budget - CUFC - SIU MAIN").
--
-- One row = one sellable POSITION in one season: club (cufc / siu …), group
-- (kit / digital / physical / other), the position's name ("Front of Shirt
-- Home", "Pitch-side signboards x2"), who holds it (a signed partner, or just a
-- business name for a prospect), the staff member, and the sheet's three money
-- columns. A position nobody holds is a row with no partner and no business:
-- that is the inventory still for sale.
--
-- 🔴 Money columns are what was TYPED on the sheet (target / contra / actual);
-- the live deal and payments still come from the partner's contract.
-- 🔴 No CHECKs on club/group (a stale CHECK is how the MFL checkout 500'd).
-- Idempotent. Additive. RLS on.
create table if not exists sponsorship_assets (
  id integer primary key generated always as identity,
  organization_id integer not null references organizations(id) on delete cascade,
  season_year integer not null,
  club text not null,
  asset_group text not null,
  name text not null,
  partner_id integer references sponsorship_partners(id) on delete set null,
  business_name text,
  staff_name text,
  target_cents integer,
  contra_cents integer,
  actual_cents integer,
  comments text,
  source text,
  display_order integer not null default 0,
  archived_at timestamptz,
  created_by integer references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sponsorship_assets_org_season_idx on sponsorship_assets (organization_id, season_year);
create index if not exists sponsorship_assets_partner_idx on sponsorship_assets (partner_id);
alter table sponsorship_assets enable row level security;

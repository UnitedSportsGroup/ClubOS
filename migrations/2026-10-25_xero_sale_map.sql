-- Xero coding map, at the level ClubOS actually SELLS things.
--
-- 🔴 Daniel, 2026-10-25: "give me a landing page with all of the codes we
-- currently have on Xero and a tool for me to map them to ClubOS program or
-- regos options — I'll do that exercise manually so it's correct."
--
-- One row = one sellable unit → one Xero account. The unit is the finest thing
-- a family can buy: a programme OPTION (Pre-Academy "U9"), a derived AGE GROUP
-- inside a programme that sells one option across several ages (FUNiño U4–U8 →
-- 101-01-01..05), a Mini Football DIVISION (Monday 5's), a Team Pay
-- COMPETITION (CIC 7's Social), the PROGRAMME itself, or a whole CATEGORY of
-- sale (shop, facility hire). Most specific wins; a blank row inherits.
--
-- 🔴 A unit with no row anywhere up its chain BLOCKS the payout — never a guess.
CREATE TABLE IF NOT EXISTS xero_sale_map (
  id               serial PRIMARY KEY,
  organization_id  integer NOT NULL DEFAULT 1,
  unit_kind        text NOT NULL,
  unit_id          text NOT NULL,
  xero_account_code text,
  xero_tax_type    text,
  line_label       text,
  note             text,
  set_by           text,
  set_at           timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT xero_sale_map_kind_chk CHECK (unit_kind IN
    ('program_option','program_age','program','league_division','teampay_competition','category','fee')),
  CONSTRAINT xero_sale_map_unit_uniq UNIQUE (organization_id, unit_kind, unit_id)
);
ALTER TABLE xero_sale_map ENABLE ROW LEVEL SECURITY;

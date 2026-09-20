-- A league night's USUAL price, shown struck through when the night sells for less.
-- 2026-09-20 · Daniel: "show Tuesday sevens: what's the full price? … show early
-- bird 20% off, and then newly discounted, show whatever that percentage is off
-- the full prices, and then you're showing the whole stack and save concept."
--
-- team_cost_cents stays the price actually charged (the checkout reads only
-- that). list_price_cents is display: NULL means "the usual price IS the
-- price", and a value at or below the cost is ignored by the page — a struck
-- price that is lower than the real one would be a lie.
ALTER TABLE league_divisions
  ADD COLUMN IF NOT EXISTS list_price_cents integer;

ALTER TABLE league_divisions
  DROP CONSTRAINT IF EXISTS league_divisions_list_price_sane;
ALTER TABLE league_divisions
  ADD CONSTRAINT league_divisions_list_price_sane
  CHECK (list_price_cents IS NULL OR list_price_cents >= 0);

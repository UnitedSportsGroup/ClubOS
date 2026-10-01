-- Team Pay competitions get their own column in the Stripe → Xero account map.
-- Victor's chart codes CIC 7's Open (102-02-01), Social (102-02-02) and the Ethnic
-- Cup (102-02-03) separately; program_id references `programs`, which a Team Pay
-- competition is not. Additive: one nullable column + one partial unique index.
ALTER TABLE xero_account_map
  ADD COLUMN IF NOT EXISTS teampay_competition_id integer REFERENCES teampay_competitions(id) ON DELETE RESTRICT;
-- A row is for a programme OR a competition (or neither = the category fallback), never both.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'xero_account_map_one_target') THEN
    ALTER TABLE xero_account_map ADD CONSTRAINT xero_account_map_one_target
      CHECK (program_id IS NULL OR teampay_competition_id IS NULL);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS xero_account_map_org_cat_comp_unq
  ON xero_account_map (organization_id, category, teampay_competition_id) WHERE teampay_competition_id IS NOT NULL;
-- The category fallback is now "no programme AND no competition".
DROP INDEX IF EXISTS xero_account_map_org_cat_fallback_unq;
CREATE UNIQUE INDEX IF NOT EXISTS xero_account_map_org_cat_fallback_unq
  ON xero_account_map (organization_id, category) WHERE program_id IS NULL AND teampay_competition_id IS NULL;

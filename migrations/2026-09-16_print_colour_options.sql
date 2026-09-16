-- Garment colours belong to DIMA, not to the website's bundle.
--
-- Daniel, 2026-09-16: "allow us in backend to be able to edit colour options
-- that get displayed on front end customer facing site."
--
-- Same rule as prices and stock sizes: the shop owns its own catalogue, and a
-- list hardcoded in a React bundle means a colour change is a developer and a
-- deploy. 🔴 NULL/empty means "no list set" and the website falls back to its
-- built-in swatches — an empty array here must not silently remove the colour
-- picker from a live customer page.
ALTER TABLE print_materials
  ADD COLUMN IF NOT EXISTS colour_options_json jsonb NOT NULL DEFAULT '[]'::jsonb;

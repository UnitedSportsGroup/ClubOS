-- Dima (2026-10-02): edit a website quote before approving it — the job grows
-- or changes once he talks to the customer. The website's own total is frozen
-- the first time a quote is edited, so the card can always say what the
-- customer was first quoted. NULL = never edited (every existing quote).
ALTER TABLE print_quotes
  ADD COLUMN IF NOT EXISTS original_subtotal_cents integer,
  ADD COLUMN IF NOT EXISTS original_total_cents    integer,
  ADD COLUMN IF NOT EXISTS edited_at               timestamptz,
  ADD COLUMN IF NOT EXISTS edited_by               integer REFERENCES users(id) ON DELETE SET NULL;
-- Money can never go negative through an edit.
ALTER TABLE print_quotes DROP CONSTRAINT IF EXISTS print_quotes_totals_nonneg;
ALTER TABLE print_quotes ADD CONSTRAINT print_quotes_totals_nonneg CHECK (subtotal_cents >= 0 AND gst_cents >= 0 AND total_cents >= 0);
ALTER TABLE print_quote_items DROP CONSTRAINT IF EXISTS print_quote_items_line_sane;
ALTER TABLE print_quote_items ADD CONSTRAINT print_quote_items_line_sane CHECK (line_ex_gst_cents >= 0 AND quantity >= 1);

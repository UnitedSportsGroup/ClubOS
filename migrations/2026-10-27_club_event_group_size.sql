-- A ticket type that applies only to an order of exactly N seats (a table of 10).
-- price_cents stays PER SEAT, so total = quantity × unit (the orders CHECK) holds.
-- NULL = an ordinary per-person ticket; every existing row keeps meaning that.
ALTER TABLE club_event_ticket_types ADD COLUMN IF NOT EXISTS group_size integer;
DO $$ BEGIN
  ALTER TABLE club_event_ticket_types ADD CONSTRAINT club_event_ticket_types_group_size_sane
    CHECK (group_size IS NULL OR group_size > 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

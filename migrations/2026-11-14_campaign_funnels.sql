-- Funnels — the steps between "saw the ad" and "paid", inside a campaign.
--
-- Daniel, 2026-11-14: "within a campaign there could actually be multiple
-- funnels … they see our ads … go to our landing page … the checkout flow …
-- purchased. At each of those there are percentages."
--
-- United Sports Group → Marketing → Campaigns → a campaign → Funnels.
--
-- 🔴 NOTHING here stores a count. A funnel row says where people come in (a
-- channel of the campaign, or everyone), which pages they land on, which pages
-- hold the booking form, and what is sold. Ad views and clicks, visitors,
-- checkouts and paid bookings are read live every time (server/campaigns/funnels.ts).
--
-- Applied and proven by script/apply-campaign-funnels.ts (dry run by default).
-- No BEGIN/COMMIT here: the applier owns the transaction.

CREATE TABLE IF NOT EXISTS cmp_funnels (
  id             serial PRIMARY KEY,
  campaign_id    integer NOT NULL REFERENCES cmp_campaigns(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (btrim(name) <> ''),
  -- The channel whose people this funnel follows. NULL = everyone who reached
  -- the pages. A removed channel leaves the funnel counting everyone.
  channel_id     integer REFERENCES cmp_channels(id) ON DELETE SET NULL,
  -- What is sold at the end. Empty = everything the campaign sells.
  program_ids    integer[] NOT NULL DEFAULT '{}',
  -- "site/page" strings, lower case, no query string: join.cufc.co.nz/fundamentals
  landing_pages  text[] NOT NULL DEFAULT '{}',
  checkout_pages text[] NOT NULL DEFAULT '{}',
  -- NULL = the campaign's own selling window.
  starts_on      date,
  ends_on        date,
  notes          text,
  position       integer NOT NULL DEFAULT 0,
  created_by     integer REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Archived, never deleted.
  archived_at    timestamptz,
  CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
  CHECK (cardinality(landing_pages) <= 20 AND cardinality(checkout_pages) <= 20)
);
CREATE INDEX IF NOT EXISTS cmp_funnels_campaign_idx ON cmp_funnels (campaign_id);

ALTER TABLE cmp_funnels ENABLE ROW LEVEL SECURITY;

-- The funnel reads page views by page inside a window of days.
CREATE INDEX IF NOT EXISTS web_events_slim_pv_path_ts_idx ON web_events_slim (path, ts) WHERE kind = 'page_view';
-- …and a booking by the visitor who made it.
CREATE INDEX IF NOT EXISTS registrations_program_visitor_idx ON registrations (program_id, visitor_id) WHERE visitor_id IS NOT NULL;

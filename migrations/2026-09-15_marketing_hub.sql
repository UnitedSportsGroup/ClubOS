-- Marketing hub — every marketing number the group has, in one place.
--
-- Daniel, 2026-09-15: "the one-stop dashboard I look at for everything … by
-- each workspace and each programme … Google Analytics, websites, form
-- submissions, ads, organics."
--
-- ClubOS's own numbers (forms, registrations, revenue, first-party traffic) are
-- read LIVE from their own tables and never copied here. These three tables hold
-- only what lives on somebody else's platform — Google Analytics, Meta ads,
-- Facebook and Instagram — pulled by ClubOS itself on a schedule
-- (server/marketing-hub/). The Mac collectors that used to do this died on
-- 2026-05-06 without telling anyone; that is the failure this design is shaped
-- against, which is why every pull is recorded in marketing_sync_runs.
--
-- Applied and proven by script/apply-marketing-hub.ts (dry run by default).
-- No BEGIN/COMMIT here: the applier owns the transaction, and an inner COMMIT
-- would defeat its --dry-run.

-- ── What can be pulled from ─────────────────────────────────────────────────
-- One row per connected account: a GA4 property, a Meta ad account, a Facebook
-- page, an Instagram account. External ids are not secrets; tokens live in env.
CREATE TABLE IF NOT EXISTS marketing_sources (
  id              serial PRIMARY KEY,
  -- ga4 · meta_ads · facebook_page · instagram (· google_ads · tiktok_ads ·
  -- linkedin_ads once connected). Validated in shared/marketing-hub.ts, not by a
  -- CHECK: a stale enum CHECK is how the MFL checkout 500'd.
  platform        text NOT NULL,
  external_id     text NOT NULL,
  label           text NOT NULL,
  -- The workspace this account belongs to. For the CUFC ad account, which also
  -- runs MFL, CIC and Academy campaigns, this is only the fallback — each
  -- campaign is filed by its own name (workspaceForCampaign()).
  organization_id integer REFERENCES organizations(id) ON DELETE RESTRICT,
  -- GA4 only: the website the property measures.
  site            text,
  currency        text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);

-- ── The numbers ─────────────────────────────────────────────────────────────
-- Long and narrow on purpose: one row per source × day × dimension × metric.
-- A new platform or a new metric is a row, never a migration.
--
-- 🔴 Only COUNTS and MONEY are stored — never a ratio. CTR, CPC, engagement
-- rate and cost per lead are derived on read from the sums, because averaging
-- daily ratios gives a wrong answer that looks right.
-- 🔴 The primary key is the natural key, so a re-pull is a retry and never a
-- second copy: every write is an upsert onto it.
CREATE TABLE IF NOT EXISTS marketing_daily (
  source_id  integer NOT NULL REFERENCES marketing_sources(id) ON DELETE RESTRICT,
  day        date NOT NULL,
  -- 'total' (whole account) · 'campaign' · 'channel'
  dim_type   text NOT NULL DEFAULT 'total',
  dim_key    text NOT NULL DEFAULT '',
  dim_label  text,
  metric     text NOT NULL,
  value      bigint NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, day, dim_type, dim_key, metric),
  -- Every stored metric is a count, a sum of money or a follower total. None of
  -- them can be negative; a negative one is a parsing bug, and it should fail
  -- loudly in the sync log rather than quietly subtract from a total.
  CONSTRAINT marketing_daily_value_not_negative CHECK (value >= 0)
);
CREATE INDEX IF NOT EXISTS marketing_daily_day_idx ON marketing_daily (day, source_id);

-- ── Every pull, recorded ────────────────────────────────────────────────────
-- A source that stops working must say so on the page. `status` is running · ok ·
-- error · skipped; `error` carries the platform's own message.
CREATE TABLE IF NOT EXISTS marketing_sync_runs (
  id           bigserial PRIMARY KEY,
  source_id    integer REFERENCES marketing_sources(id) ON DELETE RESTRICT,
  platform     text NOT NULL,
  trigger      text NOT NULL DEFAULT 'schedule',
  status       text NOT NULL,
  range_from   date,
  range_to     date,
  rows_written integer NOT NULL DEFAULT 0,
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX IF NOT EXISTS marketing_sync_runs_source_idx ON marketing_sync_runs (source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS marketing_sync_runs_started_idx ON marketing_sync_runs (started_at DESC);

-- ── One puller at a time ────────────────────────────────────────────────────
-- Production runs TWO Fly machines and each starts the schedule. A single-row
-- lease, claimed with one conditional UPDATE, lets exactly one of them pull;
-- the expiry frees it if that machine dies mid-run. (A session advisory lock
-- would do the same on a direct connection, but not through a pooler.)
CREATE TABLE IF NOT EXISTS marketing_sync_lease (
  id         integer PRIMARY KEY CHECK (id = 1),
  holder     text,
  expires_at timestamptz NOT NULL DEFAULT '-infinity'
);
INSERT INTO marketing_sync_lease (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Website visitors, fast ──────────────────────────────────────────────────
-- The hub counts distinct visitors per site from analytics_events page views.
-- Measured before this index: a year of them took 7 seconds.
CREATE INDEX IF NOT EXISTS analytics_events_page_view_ts_idx
  ON analytics_events ("timestamp") WHERE event_type = 'page_view';

-- New tables default to RLS OFF, and a Supabase anon key is public by design.
-- ClubOS connects as postgres (bypasses RLS), so this changes nothing for the app.
ALTER TABLE marketing_sources   ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_daily     ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_sync_lease ENABLE ROW LEVEL SECURITY;

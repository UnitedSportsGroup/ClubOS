-- Social media — every brand's accounts, posts and follower history in one place.
--
-- Daniel, 2026-11-10: "a social media tab … select the brand … see the Instagram,
-- Facebook, TikTok, YouTube, X, LinkedIn … click into it, see stats, see the
-- posts, see the calendar of all time … an easy way to connect all of those
-- accounts, or connect them automatically."
--
-- United Sports Group → Marketing → Social media (/admin/social-media).
-- Pulled by ClubOS itself (server/social/). Daily account insights for Facebook
-- and Instagram (reach, views, interactions) stay in marketing_daily, where the
-- Marketing hub already pulls them; an account here points at its source row.
--
-- Applied and proven by script/apply-social-media.ts (dry run by default).
-- No BEGIN/COMMIT here: the applier owns the transaction.

-- ── Accounts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_accounts (
  id                  serial PRIMARY KEY,
  -- instagram · facebook · youtube · tiktok · x · linkedin. Validated in
  -- shared/social.ts, not by a CHECK (a stale enum CHECK is how the MFL
  -- checkout 500'd).
  platform            text NOT NULL,
  -- A key from SOCIAL_BRANDS. NULL = found automatically, not yet filed under a
  -- brand by a person. Never guessed.
  brand               text,
  -- The platform's own id (page id, Instagram user id, YouTube channel id).
  -- NULL for an account that is only a saved link.
  external_id         text,
  handle              text NOT NULL,
  display_name        text,
  profile_url         text,
  avatar_url          text,
  -- 'api'  = ClubOS reads this account itself.
  -- 'link' = a saved profile link; the platform gives us no way to read it yet.
  connection          text NOT NULL DEFAULT 'link',
  marketing_source_id integer REFERENCES marketing_sources(id) ON DELETE SET NULL,
  -- True once every post back to the first has been listed.
  history_complete    boolean NOT NULL DEFAULT false,
  last_synced_at      timestamptz,
  last_error          text,
  created_by          integer REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Removed accounts are archived, never deleted: their posts are history.
  archived_at         timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_external_uq
  ON social_accounts (platform, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_handle_uq
  ON social_accounts (platform, lower(handle)) WHERE archived_at IS NULL;

-- ── A reading per account per day ───────────────────────────────────────────
-- Platforms only ever tell us TODAY's follower count, so the history is the
-- readings we keep. NULL = the platform did not give that number; never zero.
CREATE TABLE IF NOT EXISTS social_account_daily (
  account_id  integer NOT NULL REFERENCES social_accounts(id) ON DELETE RESTRICT,
  day         date NOT NULL,
  followers   bigint CHECK (followers IS NULL OR followers >= 0),
  posts_count bigint CHECK (posts_count IS NULL OR posts_count >= 0),
  total_views bigint CHECK (total_views IS NULL OR total_views >= 0),
  -- 'api' = read from the platform · 'manual' = typed in by a person.
  source      text NOT NULL DEFAULT 'api',
  recorded_by integer REFERENCES users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, day)
);

-- ── Posts ───────────────────────────────────────────────────────────────────
-- One row per post, ever. A re-pull updates the same row (natural key).
-- Every metric is nullable: NULL = the platform did not give it.
CREATE TABLE IF NOT EXISTS social_posts (
  id               bigserial PRIMARY KEY,
  account_id       integer NOT NULL REFERENCES social_accounts(id) ON DELETE RESTRICT,
  external_id      text NOT NULL,
  posted_at        timestamptz NOT NULL,
  -- image · video · reel · carousel · story · short · text · link
  kind             text NOT NULL DEFAULT 'image',
  caption          text,
  permalink        text,
  -- Instagram and Facebook picture links expire; thumb_fetched_at says how old
  -- this one is, and the server fetches a fresh one when asked (routes.ts).
  thumb_url        text,
  thumb_fetched_at timestamptz,
  likes            bigint CHECK (likes IS NULL OR likes >= 0),
  comments         bigint CHECK (comments IS NULL OR comments >= 0),
  shares           bigint CHECK (shares IS NULL OR shares >= 0),
  saves            bigint CHECK (saves IS NULL OR saves >= 0),
  views            bigint CHECK (views IS NULL OR views >= 0),
  reach            bigint CHECK (reach IS NULL OR reach >= 0),
  clicks           bigint CHECK (clicks IS NULL OR clicks >= 0),
  -- When the listed numbers (likes, comments) were last read.
  metrics_at       timestamptz,
  -- When the per-post insights (reach, views, saves, shares) were last read,
  -- and why not if the platform refused (posts older than the business
  -- account have none).
  insights_at      timestamptz,
  insights_error   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_id)
);
CREATE INDEX IF NOT EXISTS social_posts_account_posted_idx ON social_posts (account_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS social_posts_posted_idx ON social_posts (posted_at DESC);

-- ── Every pull is recorded ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_sync_runs (
  id            bigserial PRIMARY KEY,
  account_id    integer NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  trigger       text NOT NULL,
  status        text NOT NULL DEFAULT 'running',
  posts_written integer NOT NULL DEFAULT 0,
  error         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX IF NOT EXISTS social_sync_runs_account_idx ON social_sync_runs (account_id, started_at DESC);

ALTER TABLE social_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_account_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_posts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_sync_runs     ENABLE ROW LEVEL SECURITY;

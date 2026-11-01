-- ClubOS Websites, phase 1 — the club's sites read their news from ClubOS.
--
-- Daniel, 2026-11-01: "I'm holding too many of these keys and I'm kind of the
-- bottleneck … give my people the keys, but be able to have the super admin
-- control … revert it to what it was."
--
-- Additive only. Five tables:
--   site_sites     one row per public website (cufc.co.nz first)
--   site_members   who may do what on ONE site — granted by name, never
--                  inherited from being an admin of a workspace
--   site_articles  the news; the site rebuilds from these rows
--   site_versions  every save of an article, append-only, so any change reverts
--   site_events    the audit log (who published, who granted whom), append-only
--   site_ai_usage  Rambo prompts on the Website tab (counted in the one allowance)
--
-- Rehearse with: npx tsx --env-file=.env script/apply-site-articles.ts

CREATE TABLE IF NOT EXISTS site_sites (
  id                  integer      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  key                 text         NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  brand               text         NOT NULL CHECK (brand ~ '^[a-z0-9-]{2,20}$'),
  domain              text         NOT NULL CHECK (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  name                text         NOT NULL CHECK (length(btrim(name)) > 0),
  -- A Vercel deploy hook, when the site's project is connected to git. NULL is
  -- normal: cufc.co.nz is built on a Mac (its prerender drives Chrome) and is
  -- rebuilt by a watcher that reads content_changed_at instead.
  deploy_hook_url     text         CHECK (deploy_hook_url IS NULL OR deploy_hook_url ~ '^https://api\.vercel\.com/'),
  owner_user_id       integer      REFERENCES users(id) ON DELETE SET NULL,
  owner_note          text,
  settings            jsonb        NOT NULL DEFAULT '{}'::jsonb,
  -- Bumped whenever something the public can see changes. The rebuild watcher
  -- and the "is it live yet" check both read it.
  content_changed_at  timestamptz,
  last_hook_at        timestamptz,
  last_hook_status    text,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  archived_at         timestamptz
);

CREATE TABLE IF NOT EXISTS site_members (
  id                  integer      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  site_id             integer      NOT NULL REFERENCES site_sites(id) ON DELETE RESTRICT,
  user_id             integer      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level               text         NOT NULL CHECK (level IN ('writer','editor','manager','approver')),
  granted_by_user_id  integer      REFERENCES users(id) ON DELETE SET NULL,
  granted_at          timestamptz  NOT NULL DEFAULT now(),
  revoked_at          timestamptz,
  revoked_by_user_id  integer      REFERENCES users(id) ON DELETE SET NULL,
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);
-- One live grant per person per site. A revoked grant stays as history.
CREATE UNIQUE INDEX IF NOT EXISTS site_members_one_live
  ON site_members (site_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS site_members_user ON site_members (user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS site_articles (
  id                    integer      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  site_id               integer      NOT NULL REFERENCES site_sites(id) ON DELETE RESTRICT,
  -- Slugs carry ten years of SEO and the 301 table; they are kept exactly.
  slug                  text         NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,159}$'),
  title                 text         NOT NULL CHECK (length(btrim(title)) > 0 AND length(title) <= 300),
  summary               text         NOT NULL DEFAULT '' CHECK (length(summary) <= 1000),
  body                  text         NOT NULL DEFAULT '',
  hero_image            text         CHECK (hero_image IS NULL OR hero_image ~ '^(https://|/)'),
  author_name           text         CHECK (author_name IS NULL OR length(author_name) <= 120),
  tags                  text[]       NOT NULL DEFAULT '{}',
  status                text         NOT NULL DEFAULT 'draft'
                                     CHECK (status IN ('draft','scheduled','published','unpublished')),
  -- The date the site shows and sorts by. May be in the past (backdated).
  display_date          date         NOT NULL,
  -- When a scheduled article goes public. Required to schedule.
  publish_at            timestamptz,
  seo_title             text         CHECK (seo_title IS NULL OR length(seo_title) <= 200),
  seo_description       text         CHECK (seo_description IS NULL OR length(seo_description) <= 400),
  -- Where it came from: 'clubos' (written here) or the in-code file it was
  -- imported from ('editorial' · 'archive' · 'history').
  source                text         NOT NULL DEFAULT 'clubos',
  source_extra          jsonb,
  review_requested_at   timestamptz,
  review_requested_by   integer      REFERENCES users(id) ON DELETE SET NULL,
  -- The first moment the public could read it. Set once, never cleared:
  -- it is how the site knows an unpublished article must be withdrawn.
  first_published_at    timestamptz,
  version               integer      NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by_user_id    integer      REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id    integer      REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (site_id, slug),
  CHECK (status <> 'scheduled' OR publish_at IS NOT NULL),
  CHECK (status NOT IN ('published','unpublished') OR first_published_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS site_articles_site_status ON site_articles (site_id, status, display_date DESC);
CREATE INDEX IF NOT EXISTS site_articles_due ON site_articles (publish_at) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS site_versions (
  id                  bigint       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  article_id          integer      NOT NULL REFERENCES site_articles(id) ON DELETE CASCADE,
  version             integer      NOT NULL CHECK (version >= 1),
  action              text         NOT NULL,
  snapshot            jsonb        NOT NULL,
  saved_by_user_id    integer      REFERENCES users(id) ON DELETE SET NULL,
  saved_by_label      text,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (article_id, version)
);

CREATE TABLE IF NOT EXISTS site_events (
  id                  bigint       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  site_id             integer      NOT NULL REFERENCES site_sites(id) ON DELETE RESTRICT,
  article_id          integer      REFERENCES site_articles(id) ON DELETE SET NULL,
  user_id             integer      REFERENCES users(id) ON DELETE SET NULL,
  user_label          text,
  action              text         NOT NULL,
  detail              jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_events_site ON site_events (site_id, created_at DESC);

CREATE TABLE IF NOT EXISTS site_ai_usage (
  id                  integer       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  site_id             integer       REFERENCES site_sites(id) ON DELETE SET NULL,
  user_id             integer       REFERENCES users(id) ON DELETE SET NULL,
  user_label          text,
  model               text          NOT NULL,
  instruction         text          NOT NULL DEFAULT '',
  input_tokens        integer       NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens       integer       NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens   integer       NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens  integer       NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cost_usd_cents      numeric(12,4) NOT NULL DEFAULT 0 CHECK (cost_usd_cents >= 0),
  duration_ms         integer,
  ok                  boolean       NOT NULL DEFAULT false,
  error               text,
  created_at          timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_ai_usage_user_day ON site_ai_usage (user_id, created_at);

-- History is written, never rewritten.
CREATE OR REPLACE FUNCTION site_refuse_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS site_versions_append_only ON site_versions;
CREATE TRIGGER site_versions_append_only BEFORE UPDATE ON site_versions
  FOR EACH ROW EXECUTE FUNCTION site_refuse_update();
-- An event outlives its article: the one update allowed is the foreign key's
-- own ON DELETE SET NULL, which clears article_id and touches nothing else.
CREATE OR REPLACE FUNCTION site_events_refuse_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.article_id IS NULL AND OLD.article_id IS NOT NULL
     AND (to_jsonb(NEW) - 'article_id') = (to_jsonb(OLD) - 'article_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'site_events is append-only';
END $$;
DROP TRIGGER IF EXISTS site_events_append_only ON site_events;
CREATE TRIGGER site_events_append_only BEFORE UPDATE ON site_events
  FOR EACH ROW EXECUTE FUNCTION site_events_refuse_update();

-- The second wall: ClubOS connects as postgres (bypasses RLS); a leaked anon
-- key reads nothing.
ALTER TABLE site_sites    ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_ai_usage ENABLE ROW LEVEL SECURITY;

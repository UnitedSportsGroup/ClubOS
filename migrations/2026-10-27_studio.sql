-- Content Studio (2026-10-27).
--
-- Daniel: "Our staff can create really nice graphics … one-shot landing pages
-- … videos from phone clips … on our domains … nobody deleting or overriding
-- other people's content … the person can edit the text themselves."
--
-- Additive and idempotent.
--
--   studio_pieces      — one row per graphic, landing page or video request;
--                        the DOCUMENT (jsonb) is what the renderer draws; the
--                        words in it are what a person edits. Owned by the
--                        person who made it: only they (or a super admin)
--                        change it; everyone else may duplicate it.
--   studio_versions    — every document ever saved for a piece, numbered.
--                        Nothing is overwritten in place; "undo" is a version.
--   studio_renders     — the PNG a graphic was exported to, by version, so a
--                        WhatsApp-able link exists without the browser.
--   studio_generations — every paid call: who, which piece, the model, the
--                        tokens, the cents. Counted into the person's daily
--                        allowance with the Mailer's prompts and Rambo's chat.

CREATE TABLE IF NOT EXISTS studio_pieces (
  id                  integer      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id     integer      NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  brand               text         NOT NULL CHECK (brand IN ('cufc','siu','mfl','cic','cugc','usc','usg','prints')),
  kind                text         NOT NULL CHECK (kind IN ('graphic','page','video')),
  title               text         NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  -- Pages only: the public address under the brand's host. Unique per brand.
  slug                text         CHECK (slug IS NULL OR slug ~ '^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$'),
  size                text         CHECK (size IS NULL OR size IN ('square','portrait','story','landscape')),
  status              text         NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  -- Search engines stay off a page unless its owner says otherwise.
  unlisted            boolean      NOT NULL DEFAULT true,
  doc                 jsonb        NOT NULL,
  version             integer      NOT NULL DEFAULT 1 CHECK (version >= 1),
  brief               text,
  created_by_user_id  integer      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  published_at        timestamptz,
  public_views        integer      NOT NULL DEFAULT 0 CHECK (public_views >= 0),
  -- A page is the only kind with an address; a published page always has one.
  CHECK (kind = 'page' OR slug IS NULL),
  CHECK (kind <> 'page' OR status <> 'published' OR slug IS NOT NULL),
  -- Only a page can be published; a graphic or a video is a draft or archived.
  CHECK (kind = 'page' OR status <> 'published'),
  -- A graphic has a size; nothing else does.
  CHECK ((kind = 'graphic') = (size IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_pieces_brand_slug_unq ON studio_pieces (brand, slug) WHERE slug IS NOT NULL AND status <> 'archived';
CREATE INDEX IF NOT EXISTS studio_pieces_org_idx ON studio_pieces (organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS studio_pieces_owner_idx ON studio_pieces (created_by_user_id);
ALTER TABLE studio_pieces ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS studio_versions (
  id                  integer      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  piece_id            integer      NOT NULL REFERENCES studio_pieces(id) ON DELETE CASCADE,
  version             integer      NOT NULL CHECK (version >= 1),
  doc                 jsonb        NOT NULL,
  -- 'made' (the first generation) · 'asked' (a re-prompt) · 'edited' (a field) · 'duplicated'
  how                 text         NOT NULL CHECK (how IN ('made','asked','edited','duplicated')),
  note                text,
  created_by_user_id  integer      REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (piece_id, version)
);
ALTER TABLE studio_versions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS studio_renders (
  id                  integer      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  piece_id            integer      NOT NULL REFERENCES studio_pieces(id) ON DELETE CASCADE,
  version             integer      NOT NULL CHECK (version >= 1),
  key                 text         NOT NULL CHECK (key ~ '^[a-f0-9]{24}$'),
  mime                text         NOT NULL CHECK (mime IN ('image/png','image/jpeg')),
  width               integer      NOT NULL CHECK (width BETWEEN 1 AND 4000),
  height              integer      NOT NULL CHECK (height BETWEEN 1 AND 4000),
  bytes               integer      NOT NULL CHECK (bytes BETWEEN 1 AND 8388608),
  data                bytea        NOT NULL,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (key)
);
CREATE INDEX IF NOT EXISTS studio_renders_piece_idx ON studio_renders (piece_id, version DESC);
ALTER TABLE studio_renders ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS studio_generations (
  id                  integer       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  piece_id            integer       REFERENCES studio_pieces(id) ON DELETE SET NULL,
  user_id             integer       REFERENCES users(id) ON DELETE SET NULL,
  user_label          text,
  organization_id     integer       NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  brand               text,
  kind                text          NOT NULL CHECK (kind IN ('graphic','page','video')),
  model               text          NOT NULL,
  instruction         text          NOT NULL DEFAULT '',
  input_tokens        integer       NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens       integer       NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens   integer       NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens  integer       NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cost_usd_cents      numeric(12,4) NOT NULL DEFAULT 0 CHECK (cost_usd_cents >= 0),
  duration_ms         integer       NOT NULL DEFAULT 0,
  ok                  boolean       NOT NULL DEFAULT true,
  error               text,
  created_at          timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_generations_user_day_idx ON studio_generations (user_id, created_at);
ALTER TABLE studio_generations ENABLE ROW LEVEL SECURITY;

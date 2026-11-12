-- Social media labels (2026-11-13).
--
-- A label is either a CONTENT TYPE ("Starting line-up") or a SPONSOR ("Fusion5").
-- A post carries any number of them. Totals per label are DERIVED from the
-- posts' own numbers at read time; nothing here stores a view count.
--
-- Rambo may SUGGEST a label. A suggestion counts for nothing until a person
-- confirms it (confirmed_at). A rejected suggestion is kept (rejected_at) so it
-- is never offered again.
--
-- Additive. Kinds are validated in shared/social-labels.ts, not by an enum CHECK.

CREATE TABLE IF NOT EXISTS social_labels (
  id          serial PRIMARY KEY,
  kind        text NOT NULL,                     -- asset · sponsor
  name        text NOT NULL,
  hint        text,                              -- what to look for; Rambo reads it
  partner_id  integer REFERENCES sponsorship_partners(id) ON DELETE SET NULL,
  created_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT social_labels_partner_is_sponsor CHECK (partner_id IS NULL OR kind = 'sponsor')
);
CREATE UNIQUE INDEX IF NOT EXISTS social_labels_name_live_uq
  ON social_labels (kind, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS social_post_labels (
  post_id      bigint  NOT NULL REFERENCES social_posts(id)  ON DELETE CASCADE,
  label_id     integer NOT NULL REFERENCES social_labels(id) ON DELETE RESTRICT,
  source       text NOT NULL DEFAULT 'person',   -- person · rambo
  reason       text,                             -- Rambo's one line on why
  confirmed_at timestamptz,
  confirmed_by integer REFERENCES users(id) ON DELETE SET NULL,
  rejected_at  timestamptz,
  rejected_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, label_id),
  -- Confirmed and rejected at once describes nothing.
  CONSTRAINT social_post_labels_one_verdict CHECK (confirmed_at IS NULL OR rejected_at IS NULL),
  -- A label a person put on is confirmed by being put on; only Rambo's can wait.
  CONSTRAINT social_post_labels_person_is_confirmed
    CHECK (source = 'rambo' OR (confirmed_at IS NOT NULL AND rejected_at IS NULL))
);
CREATE INDEX IF NOT EXISTS social_post_labels_label_idx ON social_post_labels (label_id, post_id);

-- When Rambo last looked at a post (NULL = never), so a search never pays to
-- look at the same post twice.
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS label_checked_at timestamptz;
CREATE INDEX IF NOT EXISTS social_posts_label_unchecked_idx ON social_posts (account_id, posted_at DESC) WHERE label_checked_at IS NULL;

-- Every search Rambo runs: who pressed it, how far it got, what it cost.
CREATE TABLE IF NOT EXISTS social_label_runs (
  id            bigserial PRIMARY KEY,
  started_by    integer REFERENCES users(id) ON DELETE SET NULL,
  scope         jsonb NOT NULL DEFAULT '{}'::jsonb,
  model         text NOT NULL,
  status        text NOT NULL DEFAULT 'running',  -- running · done · failed · stopped
  total         integer NOT NULL DEFAULT 0,
  done          integer NOT NULL DEFAULT 0,
  suggested     integer NOT NULL DEFAULT 0,
  input_tokens  bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cents         numeric(12,4) NOT NULL DEFAULT 0,
  error         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  heartbeat_at  timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

ALTER TABLE social_labels      ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_post_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_label_runs  ENABLE ROW LEVEL SECURITY;

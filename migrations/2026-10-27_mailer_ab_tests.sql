-- A/B tests in the Mailer, and the click tracking they stand on (2026-10-27).
--
-- Daniel: "add the subject line A/B test, that's super important … an A/B test
-- on calls to action in the email and being able to test different kinds of
-- wording and see which one gets more clicks."
--
-- Additive and idempotent. Three things:
--
--   1. email_campaign_recipients learns WHICH VERSION each person got and
--      whether they clicked. A row can now be 'queued' — written BEFORE the
--      send so every tracked link can carry the recipient's id instead of
--      their address, and so the people waiting for a winner are on the list
--      from the start ("3,040 waiting", never an empty table).
--   2. email_campaign_tests — one row per campaign that ran a test: the two
--      versions, the share of the list, the wait, and the verdict when it comes.
--      The verdict is DERIVED from opens/clicks and then STAMPED with who/why,
--      so the history can always say "B won by opens at 11:42".
--   3. email_campaign_links + email_campaign_clicks — the links an email went
--      out with and every click on them, with the scanner clicks flagged.
--      A link's destination is stored here, so the public redirect can only
--      ever send someone to a URL that was in the email — never a URL in the
--      query string (an open redirect with a club domain on it).

ALTER TABLE email_campaign_recipients ADD COLUMN IF NOT EXISTS variant text;
ALTER TABLE email_campaign_recipients ADD COLUMN IF NOT EXISTS in_test boolean NOT NULL DEFAULT false;
ALTER TABLE email_campaign_recipients ADD COLUMN IF NOT EXISTS first_clicked_at timestamptz;
ALTER TABLE email_campaign_recipients ADD COLUMN IF NOT EXISTS click_count integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_campaign_recipients_variant_chk') THEN
    ALTER TABLE email_campaign_recipients ADD CONSTRAINT email_campaign_recipients_variant_chk CHECK (variant IS NULL OR variant IN ('A','B'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_campaign_recipients_clicks_chk') THEN
    ALTER TABLE email_campaign_recipients ADD CONSTRAINT email_campaign_recipients_clicks_chk CHECK (click_count >= 0);
  END IF;
END $$;

-- One row per person per campaign. Proven empty of duplicates on prod before
-- this was written (19,899 rows, 0 pairs); the send path upserts on it.
CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_recipients_campaign_email_unq
  ON email_campaign_recipients (campaign_id, lower(email));

CREATE TABLE IF NOT EXISTS email_campaign_tests (
  id                  integer      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  campaign_id         integer      NOT NULL UNIQUE REFERENCES email_campaigns(id) ON DELETE CASCADE,
  kind                text         NOT NULL CHECK (kind IN ('subject','link')),
  metric              text         NOT NULL CHECK (metric IN ('opens','clicks')),
  variant_a           text         NOT NULL CHECK (length(variant_a) > 0),
  variant_b           text         NOT NULL CHECK (length(variant_b) > 0 AND variant_b <> variant_a),
  sample_pct          integer      NOT NULL CHECK (sample_pct BETWEEN 1 AND 100),
  wait_minutes        integer      NOT NULL CHECK (wait_minutes >= 0),
  a_count             integer      NOT NULL DEFAULT 0 CHECK (a_count >= 0),
  b_count             integer      NOT NULL DEFAULT 0 CHECK (b_count >= 0),
  rest_count          integer      NOT NULL DEFAULT 0 CHECK (rest_count >= 0),
  -- When the winner is picked. NULL when nobody waits (everyone was in the test).
  decide_at           timestamptz,
  -- A machine's claim on the decision, so two Fly machines never both send the rest.
  deciding_at         timestamptz,
  decided_at          timestamptz,
  winner              text         CHECK (winner IS NULL OR winner IN ('A','B')),
  decided_by          text         CHECK (decided_by IS NULL OR decided_by IN ('opens','clicks','tie','hand')),
  decided_by_user_id  integer      REFERENCES users(id) ON DELETE SET NULL,
  rest_sent_at        timestamptz,
  -- The attachments the rest must carry hours later (same files, same cap).
  attachments         jsonb,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  -- A verdict names a winner, a reason and a time, or none of them.
  CHECK ((decided_at IS NULL) = (winner IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL)),
  -- The rest cannot have gone out before a winner was picked.
  CHECK (rest_sent_at IS NULL OR decided_at IS NOT NULL)
);
ALTER TABLE email_campaign_tests ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS email_campaign_links (
  id            integer      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  campaign_id   integer      NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  idx           integer      NOT NULL CHECK (idx >= 0),
  url           text         NOT NULL CHECK (url ~* '^https?://'),
  label         text         NOT NULL DEFAULT '',
  kind          text         NOT NULL DEFAULT 'link' CHECK (kind IN ('button','link','image')),
  UNIQUE (campaign_id, idx)
);
ALTER TABLE email_campaign_links ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS email_campaign_clicks (
  id             integer      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  campaign_id    integer      NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  link_id        integer      NOT NULL REFERENCES email_campaign_links(id) ON DELETE CASCADE,
  recipient_id   integer      NOT NULL REFERENCES email_campaign_recipients(id) ON DELETE CASCADE,
  variant        text         CHECK (variant IS NULL OR variant IN ('A','B')),
  clicked_at     timestamptz  NOT NULL DEFAULT now(),
  user_agent     text,
  suspected_bot  boolean      NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS email_campaign_clicks_campaign_idx ON email_campaign_clicks (campaign_id, link_id);
CREATE INDEX IF NOT EXISTS email_campaign_clicks_recipient_idx ON email_campaign_clicks (recipient_id, clicked_at);
ALTER TABLE email_campaign_clicks ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS email_campaign_tests_due_idx ON email_campaign_tests (decide_at) WHERE decided_at IS NULL;

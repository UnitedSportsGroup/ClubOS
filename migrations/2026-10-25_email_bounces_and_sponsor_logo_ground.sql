-- ── Email bounces (every sender) + a sponsor logo's ground ───────────────────
-- Daniel, 2026-10-25: "feed back the bounces as that's useful data" and
-- "all the existing signed on sponsors essentially have to be treated as the
-- sponsor's profile so need to add their logos there".
--
-- email_bounces is ONE suppression list for every address ClubOS has ever
-- mailed, fed by Resend's webhook (email.bounced / email.complained) whatever
-- feature sent the email. A PERMANENT bounce or a complaint is a mailbox that
-- will never take our mail; the Mailer flags it and skips it at send.
-- A transient bounce (full mailbox, greylisting) is recorded, flagged, and
-- still sent to — it is information, not a verdict.
--
-- logo_ground says which background a sponsor's artwork was drawn for: most
-- site files are WHITE marks for a dark page and vanish on the light admin.
-- 'light' = full-colour / dark ink, draw on white · 'dark' = white artwork,
-- draw on the club navy. Text with no CHECK (a stale CHECK is how the MFL
-- checkout 500'd); validated in code.
--
-- Idempotent. Additive. RLS on.

CREATE TABLE IF NOT EXISTS email_bounces (
  email            text        PRIMARY KEY,                -- lowercased, trimmed
  -- 'permanent' | 'transient' | 'complaint'
  kind             text        NOT NULL,
  bounce_type      text,                                   -- Resend's type ("Permanent")
  bounce_subtype   text,                                   -- Resend's subType ("General", "NoEmail", …)
  reason           text,                                   -- Resend's message, verbatim
  count            integer     NOT NULL DEFAULT 1,
  first_at         timestamptz NOT NULL DEFAULT now(),
  last_at          timestamptz NOT NULL DEFAULT now(),
  last_subject     text,
  last_provider_id text,
  -- A human can clear a record ("they fixed their mailbox"); the next bounce re-opens it.
  cleared_at       timestamptz,
  cleared_by_user_id integer   REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT email_bounces_email_lower CHECK (email = lower(btrim(email)) AND position('@' in email) > 1),
  CONSTRAINT email_bounces_count_positive CHECK (count >= 1)
);
CREATE INDEX IF NOT EXISTS email_bounces_open_idx ON email_bounces(kind) WHERE cleared_at IS NULL;
ALTER TABLE email_bounces ENABLE ROW LEVEL SECURITY;

ALTER TABLE sponsorship_partners ADD COLUMN IF NOT EXISTS logo_ground text NOT NULL DEFAULT 'light';

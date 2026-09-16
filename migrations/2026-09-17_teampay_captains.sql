-- Team Pay — captain accounts, and the player's football CV.
--
-- Daniel, 2026-09-17. Two halves of one idea:
--
--   1. A captain signs in with an email and a password and manages their team
--      from anywhere, instead of hunting for the magic link we emailed them
--      once. Same email they entered the team under.
--   2. A player with no team fills in a short football CV — a photo and a
--      highlight video on top of what the fill-in form already asks — and goes
--      into a marketplace captains browse.
--
-- 🔴 THE TOKEN LINKS DO NOT GO AWAY. `/team/:organiserToken` keeps working
-- exactly as it does today. A captain who never makes an account loses
-- nothing, and the whole live Ethnic Cup entry flow is untouched. The session
-- is a SECOND DOOR to the same dashboard, never a replacement — which is also
-- why every action behind it reuses the token-authorised functions rather than
-- growing a parallel implementation of squad management.
--
-- 🔴 This is a CUSTOMER credential, not a staff one. Its own cookie, its own
-- table, its own expiry. It can never reach ClubOS admin, and a ClubOS staff
-- session can never be one of these. Modelled on the United Prints customer
-- accounts (server/print-account-routes.ts), which is the reference
-- implementation for this shape in this codebase — scrypt `s1$salt$hex`,
-- server-side revocable sessions, an audit row per attempt.
--
-- 🔴 No BEGIN/COMMIT here on purpose: the apply script owns the transaction, and
-- a COMMIT inside the file ends it early so --dry-run would roll back nothing.

-- ── the captain ──────────────────────────────────────────────────────────────
--
-- 🔴 There is deliberately NO foreign key from an entry to a captain.
--
-- Every entry that exists today was created with no account at all, so a
-- captain_id column would be NULL on all of them — the teams with the longest
-- history would open the emptiest dashboard. An entry belongs to whoever can
-- prove control of its manager_email, resolved on every request (the same rule
-- United Prints uses to find a customer's orders). That also means a captain
-- who enters a second team under the same address simply sees both.
CREATE TABLE IF NOT EXISTS teampay_captains (
  id             integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- Stored lower-cased by the app; the index enforces it so a second row can
  -- never appear for the same person with a capital letter in it.
  email          text NOT NULL,

  -- 🔴 NULLABLE, and a NULL must FAIL CLOSED. An account is created the moment
  -- somebody asks to set a password, before they have proved anything; until
  -- they follow the emailed link this row is a placeholder and must not sign
  -- anyone in. A verifier that treated a blank column as a match would open
  -- every unclaimed account to anyone who typed anything.
  password_hash  text,

  name           text,
  phone          text,

  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now(),
  last_sign_in_at timestamp,

  -- Retire, never delete: a captain's entries and payments outlive their
  -- account, and a deleted row would orphan the audit trail of who did what.
  disabled_at    timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS teampay_captains_email_unique
  ON teampay_captains (lower(email));


-- ── sessions ─────────────────────────────────────────────────────────────────
--
-- 🔴 Only the HASH of the token is stored. This table is a list of live
-- sessions, not a list of working credentials — reading it cannot sign anyone
-- in. Server-side so "sign out everywhere" is true rather than a hopeful
-- sentence: a stateless signed token cannot be revoked before it expires.
CREATE TABLE IF NOT EXISTS teampay_captain_sessions (
  id          integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  captain_id  integer NOT NULL REFERENCES teampay_captains(id) ON DELETE CASCADE,
  token_hash  text    NOT NULL,
  created_at  timestamp NOT NULL DEFAULT now(),
  expires_at  timestamp NOT NULL,
  revoked_at  timestamp,
  user_agent  text,
  ip          text,

  CONSTRAINT teampay_captain_sessions_window CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS teampay_captain_sessions_token_unique
  ON teampay_captain_sessions (token_hash);
CREATE INDEX IF NOT EXISTS teampay_captain_sessions_captain_idx
  ON teampay_captain_sessions (captain_id);


-- ── set-password and reset links ─────────────────────────────────────────────
--
-- 🔴 This is how control of the email address is PROVEN, and it is the only
-- thing standing between "I know a captain's address" and "I can read their
-- squad's phone numbers". Setting a password is never something a signed-out
-- stranger can just do; they receive a single-use link at that address.
--
-- Hash-only and single-use (`used_at`), so a link in a mail archive is spent.
CREATE TABLE IF NOT EXISTS teampay_captain_tokens (
  id          integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  captain_id  integer NOT NULL REFERENCES teampay_captains(id) ON DELETE CASCADE,
  token_hash  text    NOT NULL,
  -- 'set' (first password) | 'reset' (forgotten). Same machinery, different
  -- wording in the email. No CHECK — enum-ish columns are validated in app code.
  kind        text    NOT NULL DEFAULT 'set',
  created_at  timestamp NOT NULL DEFAULT now(),
  expires_at  timestamp NOT NULL,
  used_at     timestamp,

  CONSTRAINT teampay_captain_tokens_window CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS teampay_captain_tokens_token_unique
  ON teampay_captain_tokens (token_hash);
CREATE INDEX IF NOT EXISTS teampay_captain_tokens_captain_idx
  ON teampay_captain_tokens (captain_id, created_at);


-- ── the audit trail ──────────────────────────────────────────────────────────
--
-- 🔴 A row for EVERY attempt, success and failure. It is both the rate-limit
-- store and the record of who got in — and it is keyed on the typed email,
-- not on a captain id, because the interesting failures are the ones against
-- addresses that do not exist.
CREATE TABLE IF NOT EXISTS teampay_captain_auth_events (
  id         integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email      text,
  captain_id integer REFERENCES teampay_captains(id) ON DELETE SET NULL,
  action     text NOT NULL,          -- sign_in | set_password | request_link | sign_out
  ok         boolean NOT NULL,
  reason     text,
  ip         text,
  user_agent text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teampay_captain_auth_events_email_idx
  ON teampay_captain_auth_events (lower(email), created_at);
CREATE INDEX IF NOT EXISTS teampay_captain_auth_events_ip_idx
  ON teampay_captain_auth_events (ip, created_at);


-- ── the player's football CV ─────────────────────────────────────────────────
--
-- The fill-in row already carries position, ability, highest level, where they
-- are from, what they are after and a free note. These two are what Daniel
-- asked for on top.
--
-- 🔴 NEITHER IS PUBLIC. Daniel's call, 2026-09-17: the marketplace page on
-- ethniccup.com lists the pool — first name, position, ability, where they are
-- from — and the photo and video appear only to a signed-in captain. Several of
-- these players are new to the country; a page of named photographs that Google
-- can index is a different product from a list of people looking for a game.
-- It also bounds image egress, which has taken this project's storage down
-- twice. `FILLIN_PUBLIC_FIELDS` in shared/teampay.ts stays exactly as it is.
ALTER TABLE teampay_fillins
  ADD COLUMN IF NOT EXISTS photo_key     text;
ALTER TABLE teampay_fillins
  ADD COLUMN IF NOT EXISTS highlight_url text;

-- 🔴 An opaque storage key, never a URL. Everything above the storage adapter
-- addresses an object by key and never parses it, which is what lets the club's
-- files move from Supabase to R2 without touching a route. A stored URL would
-- freeze the bucket into the database.
COMMENT ON COLUMN teampay_fillins.photo_key IS
  'Opaque storage key for the drive adapter. Served ONLY as a short-lived signed URL, to signed-in captains.';


-- ── linking a fill-in to the captain who invited them ────────────────────────
--
-- The hold row already records which ENTRY asked. This records which captain
-- account did it, when there was one — so an invite is attributable to a person
-- rather than to whoever was holding a link.
ALTER TABLE teampay_fillin_holds
  ADD COLUMN IF NOT EXISTS requested_by_captain_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teampay_fillin_holds_captain_fkey'
  ) THEN
    ALTER TABLE teampay_fillin_holds
      ADD CONSTRAINT teampay_fillin_holds_captain_fkey
      FOREIGN KEY (requested_by_captain_id) REFERENCES teampay_captains(id) ON DELETE SET NULL;
  END IF;
END $$;


-- ── RLS ──────────────────────────────────────────────────────────────────────
--
-- 🔴 A new table defaults to RLS OFF, and the Supabase anon key is PUBLIC by
-- design — it ships in a browser bundle. Off + a public key means the world can
-- read the table. These four hold password hashes and live session tokens, so
-- they are the worst possible candidates for that mistake.
--
-- No policies: our own code connects as postgres / service-role, both of which
-- carry rolbypassrls, so nothing about the app changes. This is the second wall
-- that catches a leaked anon key. Caught by scripts/security/rls_guard.mjs,
-- which is why that guard runs after every migration.
ALTER TABLE teampay_captains            ENABLE ROW LEVEL SECURITY;
ALTER TABLE teampay_captain_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE teampay_captain_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE teampay_captain_auth_events ENABLE ROW LEVEL SECURITY;

-- Parent accounts v2 — a password as a second way in, sessions the club can
-- revoke, an audit row per sign-in attempt, and the link between a family and
-- the cards they chose to save.
--
-- Daniel, 2026-09-28: "click login. They either enter their email, and it's
-- like a one-time passcode, or they actually set up an email and password …
-- They can save payment methods." Said the day two parents emailed the office
-- because sign-in was dead (a missing rewrite on cufc.co.nz, fixed the same
-- morning — nothing in this file).
--
-- Additive only: four new tables. No existing column is added, altered or
-- dropped, and no existing row is written.
--
-- ── Why the identity is the EMAIL, not a contact id ─────────────────────────
-- A family is the union of every guardian row sharing a verified address
-- (2,761 addresses map to more than one contact row). A password, a session
-- and a Stripe customer all belong to the PERSON who controls that inbox, so
-- all four tables key on the normalised address — exactly as the existing
-- parent_login_codes does. A contact_id here would bind the account to one of
-- several duplicate rows and strand it the day that row is merged away.

-- A password is OPTIONAL. The emailed code keeps working for every family,
-- and is also how a forgotten password is replaced: signing in with a code IS
-- proof of the inbox, which is all a reset link would prove.
CREATE TABLE IF NOT EXISTS parent_credentials (
  email           text        PRIMARY KEY,
  -- scrypt `s1$salt$hex` — the house scheme (United Prints, Team Pay captains).
  -- NULL = no password set; the verifier fails CLOSED on NULL.
  password_hash   text,
  password_set_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- An address is stored the way the login normalises it, or two rows could
  -- exist for one family and the wrong one would answer.
  CONSTRAINT parent_credentials_email_normalised CHECK (email = lower(btrim(email)) AND email <> ''),
  -- A hash and its timestamp arrive and leave together.
  CONSTRAINT parent_credentials_hash_pair CHECK ((password_hash IS NULL) = (password_set_at IS NULL))
);

-- Server-side sessions. The v1 cookie was a signed token nobody could revoke:
-- changing a password could not sign out a phone left at a relative's house.
-- Only a HASH of the token is stored — reading this table signs nobody in.
CREATE TABLE IF NOT EXISTS parent_sessions (
  id            bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email         text        NOT NULL,
  token_hash    text        NOT NULL UNIQUE,
  -- 'code' | 'password'. Deliberately no CHECK: a stale enum CHECK is how the
  -- MFL checkout 500'd; the app writes exactly these two values.
  method        text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  last_seen_at  timestamptz,
  ip            text,
  user_agent    text,
  CONSTRAINT parent_sessions_expiry_after_start CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS parent_sessions_email_live_idx
  ON parent_sessions (email) WHERE revoked_at IS NULL;

-- One row per sign-in attempt, successful or not — the password limiter reads
-- it (durable, because two Fly machines share no memory) and it answers "did
-- somebody try to get into my account?" when a family asks.
CREATE TABLE IF NOT EXISTS parent_auth_events (
  id          bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email       text,
  action      text        NOT NULL,   -- password_login | password_set | code_login | logout | logout_all
  ok          boolean     NOT NULL,
  reason      text,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parent_auth_events_email_idx
  ON parent_auth_events (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS parent_auth_events_ip_idx
  ON parent_auth_events (ip, created_at DESC) WHERE ip IS NOT NULL;

-- The Stripe customer a family's saved cards hang off. Per Stripe ACCOUNT,
-- because a customer id means nothing on another account and the club runs
-- more than one ('club' today; 'trust' exists for club events).
CREATE TABLE IF NOT EXISTS parent_stripe_customers (
  email               text        NOT NULL,
  stripe_account      text        NOT NULL,
  stripe_customer_id  text        NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, stripe_account),
  CONSTRAINT parent_stripe_customers_email_normalised CHECK (email = lower(btrim(email)) AND email <> '')
);

-- RLS, per the standing rule. ClubOS connects as the owner (rolbypassrls), so
-- this changes nothing for the app; it is the second wall. Login material and
-- payment links get no policy at all: nothing but the owner may read them.
ALTER TABLE parent_credentials      ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_auth_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_stripe_customers ENABLE ROW LEVEL SECURITY;

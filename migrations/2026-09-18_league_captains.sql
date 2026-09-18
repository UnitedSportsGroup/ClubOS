-- ═══════════════════════════════════════════════════════════════════════════
-- MFL captain's dashboard — the squad list, and fill-ins for a night or a term
-- 2026-09-18 · Daniel: "the same team captain dashboard and login we created
-- for ethnic cup needs to be built for MFL"
--
-- Additive. Nothing that carries live MFL money is touched: registrations,
-- split_sessions, split_members and league_teams are only READ by the code
-- that uses these tables. The captain login itself is the existing
-- teampay_captains account — an MFL captain and an Ethnic Cup captain are the
-- same kind of person, so they get the same door.
--
-- 🔴 Why a NEW roster table rather than league_team_members: that table keys
-- every row on a ClubOS `users` account (NOT NULL) — it was built for the MFL
-- app's "follow a team" feature and has never held a row. A captain types a
-- mate's name and maybe a phone number; nobody on a Wednesday 7's side has a
-- ClubOS login, and giving them one is the biggest access change the club
-- could make, made sideways.
--
-- 🔴 And not teampay_players: that roster row IS a payment link on a
-- teampay_entries row. MFL teams are paid through their registration
-- (upfront, weekly plan, or Player Pay), and pretending each one were a
-- teampay entry would model the same money twice.
--
-- 🔴 NO transaction control in this file. script/apply-league-captains.ts
-- wraps it; a BEGIN/COMMIT here would defeat its --dry-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the squad list ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS league_squad_members (
  id                    integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  team_id               integer NOT NULL REFERENCES league_teams(id) ON DELETE CASCADE,

  name                  text    NOT NULL,
  email                 text,
  phone                 text,

  -- "player numbers optional for now" — Daniel, 2026-09-18. Nullable, no
  -- default; a blank is "not given", never 0.
  shirt_number          integer,
  position              text,

  is_captain            boolean NOT NULL DEFAULT false,
  -- 'captain' (typed in) | 'fillin' (accepted a season ask) | 'split' (paid
  -- through Player Pay and was adopted onto the list). Validated in app code,
  -- not a CHECK — a stale CHECK 500'd the MFL checkout once already.
  source                text    NOT NULL DEFAULT 'captain',
  fillin_id             integer REFERENCES teampay_fillins(id)  ON DELETE SET NULL,
  added_by_captain_id   integer REFERENCES teampay_captains(id) ON DELETE SET NULL,

  removed_at            timestamp,
  created_at            timestamp NOT NULL DEFAULT now(),
  updated_at            timestamp NOT NULL DEFAULT now(),

  CONSTRAINT league_squad_members_name_present CHECK (length(btrim(name)) > 0),
  -- A shirt number is 0–99 or nothing. 100 does not fit on a shirt.
  CONSTRAINT league_squad_members_shirt_range CHECK (
    shirt_number IS NULL OR (shirt_number >= 0 AND shirt_number <= 99)
  )
);

CREATE INDEX IF NOT EXISTS league_squad_members_team_idx
  ON league_squad_members (team_id) WHERE removed_at IS NULL;

-- One live row per email per squad. Re-adding a mate reactivates the row the
-- app finds, rather than listing them twice.
CREATE UNIQUE INDEX IF NOT EXISTS league_squad_members_team_email_unique
  ON league_squad_members (team_id, lower(email))
  WHERE email IS NOT NULL AND removed_at IS NULL;

-- Two players cannot wear the same number on the same night.
CREATE UNIQUE INDEX IF NOT EXISTS league_squad_members_team_number_unique
  ON league_squad_members (team_id, shirt_number)
  WHERE shirt_number IS NOT NULL AND removed_at IS NULL;

-- Exactly one captain row per team.
CREATE UNIQUE INDEX IF NOT EXISTS league_squad_members_one_captain
  ON league_squad_members (team_id)
  WHERE is_captain AND removed_at IS NULL;

-- 🔴 A fill-in joins ONE team for the term (Isaac's double-booking rule,
-- carried over). A night's fill-in is not a roster row, so this only bites on
-- season asks, which is the case it was written for.
CREATE UNIQUE INDEX IF NOT EXISTS league_squad_members_one_team_per_fillin
  ON league_squad_members (fillin_id)
  WHERE fillin_id IS NOT NULL AND removed_at IS NULL;

-- 🔴 A squad list that cannot be capped fills with everyone the captain has
-- ever met. Thirty is well past any 7's side and its subs. The DATABASE
-- decides, so two taps on "Add" cannot both squeeze in.
CREATE OR REPLACE FUNCTION league_squad_cap() RETURNS trigger AS $$
DECLARE
  taken integer;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.removed_at IS NOT DISTINCT FROM OLD.removed_at
     AND NEW.team_id    IS NOT DISTINCT FROM OLD.team_id
  THEN
    RETURN NEW;
  END IF;
  IF NEW.removed_at IS NOT NULL THEN RETURN NEW; END IF;

  PERFORM 1 FROM league_teams WHERE id = NEW.team_id FOR UPDATE;
  SELECT count(*) INTO taken
    FROM league_squad_members
   WHERE team_id = NEW.team_id AND removed_at IS NULL AND id <> NEW.id;
  IF taken + 1 > 30 THEN
    RAISE EXCEPTION 'league squad: 30 players is the most a squad list can hold (team %)', NEW.team_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS league_squad_members_cap ON league_squad_members;
CREATE TRIGGER league_squad_members_cap
  BEFORE INSERT OR UPDATE ON league_squad_members
  FOR EACH ROW EXECUTE FUNCTION league_squad_cap();

-- ── the fill-in list learns which nights a player can do ────────────────────
-- A social league runs six nights; a captain short for Wednesday does not
-- want to read thirty profiles to find who is free on Wednesday. NULL means
-- the question was never asked (every Ethnic Cup fill-in), never "no nights".
ALTER TABLE teampay_fillins
  ADD COLUMN IF NOT EXISTS available_days text[];

-- ── a captain's ask: join for the term, or cover one night ──────────────────
--
-- 🔴 Deliberately NOT teampay_fillin_holds. A hold there belongs to a
-- teampay_entries row (NOT NULL), hides the player from every other team while
-- it is open, and knows nothing about dates. A league ask belongs to a
-- league_teams row and comes in two shapes — and a player asked to cover
-- Wednesday must stay visible to a captain who needs them on Thursday.
CREATE TABLE IF NOT EXISTS league_fillin_requests (
  id                       integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  team_id                  integer NOT NULL REFERENCES league_teams(id)     ON DELETE CASCADE,
  fillin_id                integer NOT NULL REFERENCES teampay_fillins(id)  ON DELETE CASCADE,

  -- 'season' — join the squad for the rest of the term.
  -- 'game'   — cover one night. Carries the date; the game row when fixtures
  --            exist, or nothing when the captain picked a night off the
  --            division's calendar before the draw was generated.
  kind                     text    NOT NULL,
  game_id                  integer REFERENCES league_games(id) ON DELETE SET NULL,
  game_date                date,

  -- active | accepted | declined | expired | cancelled
  state                    text    NOT NULL DEFAULT 'active',
  request_token            text    NOT NULL,

  requested_at             timestamp NOT NULL DEFAULT now(),
  expires_at               timestamp NOT NULL,
  responded_at             timestamp,
  manager_note             text,

  requested_by_captain_id  integer REFERENCES teampay_captains(id)      ON DELETE SET NULL,
  -- The roster row a season ask created when it was accepted.
  squad_member_id          integer REFERENCES league_squad_members(id)  ON DELETE SET NULL,

  created_at               timestamp NOT NULL DEFAULT now(),

  -- A night ask carries its night; a season ask carries no night at all. This
  -- is the relationship between two columns, not an enum list, which is why
  -- it is a CHECK.
  CONSTRAINT league_fillin_requests_shape CHECK (
    (kind = 'season' AND game_date IS NULL AND game_id IS NULL)
    OR (kind = 'game' AND game_date IS NOT NULL)
  ),
  CONSTRAINT league_fillin_requests_window CHECK (expires_at > requested_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS league_fillin_requests_token_unique
  ON league_fillin_requests (request_token);
CREATE INDEX IF NOT EXISTS league_fillin_requests_team_idx
  ON league_fillin_requests (team_id, state);
CREATE INDEX IF NOT EXISTS league_fillin_requests_fillin_idx
  ON league_fillin_requests (fillin_id);

-- 🔴 THE two double-booking guards, in the database where a race cannot walk
-- through them. One open "join us for the term" per player at a time; and one
-- team per player per NIGHT — open or already accepted — because a player who
-- said yes to Wednesday is playing Wednesday.
CREATE UNIQUE INDEX IF NOT EXISTS league_fillin_requests_one_season_open
  ON league_fillin_requests (fillin_id)
  WHERE kind = 'season' AND state = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS league_fillin_requests_one_per_night
  ON league_fillin_requests (fillin_id, game_date)
  WHERE kind = 'game' AND state IN ('active', 'accepted');

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- New tables default to RLS OFF and the Supabase anon key is public by design.
-- These hold players' phone numbers. RLS on, no policies: our own server
-- connects as service-role and bypasses it; a leaked anon key reaches nothing.
ALTER TABLE league_squad_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_fillin_requests  ENABLE ROW LEVEL SECURITY;

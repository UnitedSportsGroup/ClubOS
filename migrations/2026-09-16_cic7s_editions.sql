-- CIC Summer 7's — which edition a registration is for, and the team it became.
--
-- Isaac asked (via Daniel, 2026-09-16) for last year's registrations of interest
-- to be in ClubOS so the mailer can reach them, separated from this year's, plus
-- the 2026 registered teams as historical data.
--
-- 🔴 edition_year is NULLABLE with NO DEFAULT. A registration nobody can place
-- reads "not recorded" rather than being filed under an edition on a guess —
-- and a default would quietly stamp every future insert with today's answer.
-- The edition is decided by the code that takes the registration
-- (CIC7S_CURRENT_EDITION in shared/cic7s.ts), never by created_at.
ALTER TABLE cic7s_registrations
  ADD COLUMN IF NOT EXISTS edition_year   integer,
  ADD COLUMN IF NOT EXISTS team_name      text,
  ADD COLUMN IF NOT EXISTS entry_payment  text;

-- The filter the tab runs constantly.
CREATE INDEX IF NOT EXISTS cic7s_registrations_org_edition_idx
  ON cic7s_registrations (organization_id, edition_year);

-- 🔴 There is deliberately NO unique index on (org, edition, email).
-- Email is not a person key here, and the data proves it twice over. The live
-- 2027 form has already taken two people's submissions twice (Mustafa Karimi
-- two minutes apart, Jeroen Dunnink five hours apart), and inside the 2026
-- sheet twelve addresses appear more than once — including two MAILBOXES SHARED
-- BY DIFFERENT PEOPLE (Cody Lamond and Leo Lamond Okeefe; Idrees Hamid and
-- Samuel Pickering). A unique index would have refused the backfill, and
-- de-duplicating to satisfy it would have deleted real registrations of real
-- people. Every submission is kept; the mailer already dedupes by address when
-- it builds an audience, which is the only place it actually matters.

-- Only the four states the tracking sheet can actually evidence.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cic7s_registrations_entry_payment_chk') THEN
    ALTER TABLE cic7s_registrations
      ADD CONSTRAINT cic7s_registrations_entry_payment_chk
      CHECK (entry_payment IS NULL OR entry_payment IN ('paid','part_paid','unpaid','refunded'));
  END IF;
END $$;

-- A payment state describes a TEAM entry. Without a team it describes nothing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cic7s_registrations_payment_needs_team_chk') THEN
    ALTER TABLE cic7s_registrations
      ADD CONSTRAINT cic7s_registrations_payment_needs_team_chk
      CHECK (entry_payment IS NULL OR team_name IS NOT NULL);
  END IF;
END $$;

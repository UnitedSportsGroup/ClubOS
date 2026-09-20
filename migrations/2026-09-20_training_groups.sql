-- ── Which training group a player is in ─────────────────────────────────────
-- Daniel, 2026-09-20: Pre-Academy U9–U12 trains as four groups, and the
-- Players tab has to show which players are in which.
--
-- 🔴 The group is DERIVED from date of birth by the club's own NZF rule
-- (`shared/training-groups.ts`). This column exists only for the exception: a
-- coach moving one player up or down a grade. NULL therefore means "nobody has
-- overridden anything" — it does NOT mean the player has no group.
--
-- 🔴 No DEFAULT: a default would assert that somebody made a decision about
-- every existing registration, and none of them did.
--
-- 🔴 No CHECK constraint on the value. A stale CHECK is how the MFL checkout
-- started 500ing; the vocabulary lives in shared/training-groups.ts and an
-- unreadable label falls back to the derived grade rather than blanking a
-- player off the roll.
alter table registrations add column if not exists training_group text;

-- 🔴 Who moved them, and when. Playing UP a grade is normal; playing DOWN is
-- what gets a club sanctioned, so the decision carries a name. ON DELETE SET
-- NULL rather than RESTRICT: this is a coaching note, not a money trail, and it
-- reads honestly as "we don't know" once a staff member is gone.
alter table registrations add column if not exists training_group_set_by integer references users(id) on delete set null;
alter table registrations add column if not exists training_group_set_at timestamptz;

-- The Players tab reads one programme and one term at a time.
create index if not exists idx_registrations_training_group
  on registrations (program_id, term_id) where training_group is not null;

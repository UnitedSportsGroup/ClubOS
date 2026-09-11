-- School-holiday pricing for venue hire.
--
-- 🔴 NO BEGIN/COMMIT IN THIS FILE. `apply-venue-holiday-pricing.ts --dry-run`
-- wraps the whole thing in a transaction it rolls back; an inner COMMIT would
-- end that transaction and the ROLLBACK would then run in autocommit, i.e. the
-- rehearsal would silently be the real thing. (14 migrations in this repo still
-- have that hole. This is not one of them.)
--
-- Additive only. Every existing pricing rule becomes applies_to = 'always',
-- which is the branch the resolver already took, so a database that gets this
-- migration and no seed rows prices exactly as it did the minute before.

-- ── 1. The date ranges that ARE the school holidays ──────────────────────────
-- Deliberately a table and not a hard-coded calendar: the Ministry publishes
-- term dates two years out and a school can move its own Term 1 start inside a
-- gazetted window, so this has to be editable without a deploy.
CREATE TABLE IF NOT EXISTS venue_holiday_periods (
  id              integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text    NOT NULL,
  starts_on       date    NOT NULL,
  ends_on         date    NOT NULL,
  -- Where the dates came from. A rate that raises a customer's price should be
  -- able to name its source; "someone typed it in" is not good enough.
  source_note     text,
  created_at      timestamp NOT NULL DEFAULT now(),

  -- A period that ends before it starts is not a period.
  CONSTRAINT venue_holiday_periods_dates_ordered CHECK (ends_on >= starts_on)
);

-- Two holiday periods for one venue must not overlap. Harmless to the resolver
-- (it asks "is this date in ANY period"), but an overlap always means somebody
-- entered the same break twice, and the second copy is the one that will later
-- be edited and disagree.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE venue_holiday_periods
  DROP CONSTRAINT IF EXISTS venue_holiday_periods_no_overlap;
ALTER TABLE venue_holiday_periods
  ADD CONSTRAINT venue_holiday_periods_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  );

CREATE INDEX IF NOT EXISTS venue_holiday_periods_org_dates_idx
  ON venue_holiday_periods (organization_id, starts_on, ends_on);

-- ── 2. Which season a pricing rule belongs to ────────────────────────────────
-- 🔴 NOT a CHECK constraint and NOT a pg enum. The values are validated in
-- shared/venue-pricing.ts. A stale CHECK on an enum-ish column is exactly what
-- 500'd the MFL checkout; the cost of a bad value here is a rule that never
-- matches, which is visible and recoverable, and nothing like a dead checkout.
ALTER TABLE facility_pricing_rules
  ADD COLUMN IF NOT EXISTS applies_to text NOT NULL DEFAULT 'always';

CREATE INDEX IF NOT EXISTS facility_pricing_rules_facility_season_idx
  ON facility_pricing_rules (facility_id, applies_to);

-- New tables default to RLS OFF. The club's own apps connect as an owner role
-- that bypasses RLS, so this changes nothing for them — it is the second wall
-- that catches a leaked key, per the standing post-migration guard.
ALTER TABLE venue_holiday_periods ENABLE ROW LEVEL SECURITY;

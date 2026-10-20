-- "How did you hear about us?" — the free text behind an "Other" answer.
-- (Daniel, 2026-10-20: required of every NEW buyer on every sale path.)
--
-- The answer itself stays in registrations.referral_source (already there,
-- 2,300+ rows written by the camp survey and the success-screen card).
--
-- Nullable, NO default: a blank means "no Other text was given", and a
-- default would assert something nobody said. No CHECK: the vocabulary lives
-- in shared/hdyhau.ts and is enforced by the routes; a stale CHECK is how the
-- MFL checkout once 500'd.
--
-- Safe in either deploy order: server/hdyhau.ts reads and writes this column
-- with raw SQL and falls back to the legacy "Other: …" form in referral_source
-- when the column is missing (42703).
--
-- No BEGIN/COMMIT here on purpose — script/apply-hdyhau.ts owns the transaction,
-- so its --dry-run really rolls back.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS referral_detail text;
COMMENT ON COLUMN registrations.referral_detail IS
  'Free text for referral_source = ''other'' ("How did you hear about us?"). Written only via server/hdyhau.ts.';

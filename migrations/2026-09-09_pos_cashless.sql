-- ─────────────────────────────────────────────────────────────────────────────
-- POS — the club is CASHLESS (Daniel, 2026-09-09).
--
--   npx tsx --env-file=.env script/apply-pos-cashless.ts [--commit]
--
-- The register shipped demanding "Open the till — count the float in the
-- drawer" before the first sale, at a counter with no drawer. Cash is now a
-- capability a register OPTS INTO, defaulting to false, because that is the
-- club's normal. The machinery is kept rather than deleted: a CIC merch stand
-- or a sausage sizzle is exactly where cash reappears, and turning it back on
-- must be a tick rather than a migration.
--
-- ADDITIVE. One column, one relaxed CHECK.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE pos_registers
  ADD COLUMN IF NOT EXISTS handles_cash boolean NOT NULL DEFAULT false;

-- 🔴 A cashless shift has no drawer to count, so "closed" can no longer mean
-- "somebody counted the cash". The pair that must hold together is now
-- closed_at + closed_by; the counted figure is optional, and NULL means "not
-- counted" rather than a fabricated zero — the same rule as a blank equipment
-- count or an unmarked roll.
ALTER TABLE pos_shifts DROP CONSTRAINT IF EXISTS pos_shifts_close_pair;
ALTER TABLE pos_shifts ADD CONSTRAINT pos_shifts_close_pair CHECK (
  (closed_at IS NULL) = (closed_by_user_id IS NULL)
);

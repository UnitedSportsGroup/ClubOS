-- Kit sizes on a player's profile (Daniel, 2026-10-22). Optional, nullable, no
-- default and no CHECK: blank means nobody told us, and the allowed list lives
-- in shared/kit-sizes.ts (a stale CHECK is how the MFL checkout once 500'd).
-- A player is a `contacts` row (academy) or a `children` row (camps) — both.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS shirt_size text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS shorts_size text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS boot_size text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS kit_sizes_updated_at timestamptz;
ALTER TABLE children ADD COLUMN IF NOT EXISTS shirt_size text;
ALTER TABLE children ADD COLUMN IF NOT EXISTS shorts_size text;
ALTER TABLE children ADD COLUMN IF NOT EXISTS boot_size text;
ALTER TABLE children ADD COLUMN IF NOT EXISTS kit_sizes_updated_at timestamptz;

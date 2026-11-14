-- Club Drive share links: a short code for a clean address (2026-11-14).
--   media.southislandunited.com/the-drifter/k7Qx2m9aB3xZ
-- The sponsor's name in the address is decoration; the 12-character code is the
-- key (62^12, about 71 bits, never guessable in practice). The long token keeps
-- working, so links already sent do not break. Additive.
ALTER TABLE drive_share_links ADD COLUMN IF NOT EXISTS short_code text;
CREATE UNIQUE INDEX IF NOT EXISTS drive_share_links_short_code_uq ON drive_share_links (short_code) WHERE short_code IS NOT NULL;
ALTER TABLE drive_share_links DROP CONSTRAINT IF EXISTS drive_share_links_short_code_len;
ALTER TABLE drive_share_links ADD CONSTRAINT drive_share_links_short_code_len CHECK (short_code IS NULL OR short_code ~ '^[A-Za-z0-9]{12,20}$');

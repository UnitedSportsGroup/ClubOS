-- ── Pictures uploaded into the Mailer — hosted by ClubOS, shrunk on the way in ─
-- Daniel, 2026-10-26: "We need to be able to do the file upload and then also
-- need to figure out a way so that it doesn't become big and slow to load."
--
-- A picture is never embedded in an email; it is stored here (already rotated,
-- stripped of camera/GPS data, shrunk to ≤1200px and re-encoded) and served at
-- https://app.usg.co.nz/mailer/img/<key>.<ext> with a year-long immutable
-- cache. The key is the first 24 hex characters of the stored bytes' SHA-256,
-- so the same picture uploaded twice is ONE row and the address is unguessable.
--
-- 🔴 Deliberately NOT the Supabase storage bucket Club Drive uses: that project
-- is egress-restricted and answered 402 twice (the shop images, the salon).
-- Bytes live in Postgres behind one adapter (server/mailer-images.ts) so R2
-- can take over without touching a caller. The CHECKs are the shrinking rules
-- made structural: nothing wider than 1200px or heavier than 2MB can be stored.
--
-- Idempotent. Additive. RLS on (the app connects as postgres and bypasses it).

CREATE TABLE IF NOT EXISTS mailer_images (
  id               integer     PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id  integer     NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  uploaded_by      integer     REFERENCES users(id) ON DELETE SET NULL,
  key              text        NOT NULL UNIQUE CHECK (key ~ '^[a-f0-9]{24}$'),
  mime             text        NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/gif')),
  width            integer     NOT NULL CHECK (width > 0 AND width <= 1200),
  height           integer     NOT NULL CHECK (height > 0 AND height <= 1800),
  bytes            integer     NOT NULL CHECK (bytes > 0 AND bytes <= 2097152),
  data             bytea       NOT NULL,
  original_name    text,
  original_bytes   integer     CHECK (original_bytes IS NULL OR original_bytes >= 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mailer_images_org_idx ON mailer_images (organization_id, created_at);

ALTER TABLE mailer_images ENABLE ROW LEVEL SECURITY;

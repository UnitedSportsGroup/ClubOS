-- Club Drive share links (2026-11-14).
--
-- A share link lets someone OUTSIDE the club open ONE folder of Club Drive,
-- read-only, with nothing but a random token in the URL (the invoice-page rule:
-- a token, never a slug, so links cannot be enumerated).
--
-- 🔴 Only a folder inside the "Sponsor Content" root may ever carry a link.
-- That is enforced in server/drive-share.ts on create AND on every public read,
-- because Club Drive also holds contracts, payroll and children's records.
-- A link is switched off by stamping revoked_at; the row is kept.
--
-- Additive.

CREATE TABLE IF NOT EXISTS drive_share_links (
  id             serial PRIMARY KEY,
  token          text NOT NULL UNIQUE,
  node_id        integer NOT NULL REFERENCES drive_nodes(id) ON DELETE RESTRICT,
  label          text,
  created_by     integer REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz,
  revoked_at     timestamptz,
  revoked_by     integer REFERENCES users(id) ON DELETE SET NULL,
  view_count     integer NOT NULL DEFAULT 0,
  download_count integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  CONSTRAINT drive_share_links_token_len CHECK (length(token) >= 32)
);
-- One live link per folder: "copy the link" always gives the same one.
CREATE UNIQUE INDEX IF NOT EXISTS drive_share_links_live_node_uq
  ON drive_share_links (node_id) WHERE revoked_at IS NULL;

ALTER TABLE drive_share_links ENABLE ROW LEVEL SECURITY;

-- Club Drive: share a file or folder with ONE staff member (Daniel, 16 Nov 2026:
-- "like Google Drive … select a person to share it with").
-- A share is READ access to the node and everything under it, for that person,
-- even when the node sits behind a gate they do not hold. It never grants
-- anything else, and the person cannot pass it on (only someone who can read
-- the node through their own access may share it).
-- Kept, never deleted: removing access stamps revoked_at.
CREATE TABLE IF NOT EXISTS drive_node_shares (
  id          serial PRIMARY KEY,
  node_id     integer NOT NULL REFERENCES drive_nodes(id) ON DELETE RESTRICT,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  granted_by  integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  revoked_by  integer REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT drive_node_shares_revoke_pair CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
-- One live share per person per node.
CREATE UNIQUE INDEX IF NOT EXISTS drive_node_shares_live_uq ON drive_node_shares (node_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS drive_node_shares_user_idx ON drive_node_shares (user_id) WHERE revoked_at IS NULL;
ALTER TABLE drive_node_shares ENABLE ROW LEVEL SECURITY;

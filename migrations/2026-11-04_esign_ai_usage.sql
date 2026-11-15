-- Rambo drafting e-Sign agreement templates (2026-11-04). One row per prompt so
-- it counts toward the one daily Rambo allowance (server/rambo-usage.ts) and its
-- cost is visible. Additive; RLS on like every table.
CREATE TABLE IF NOT EXISTS esign_ai_usage (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            integer REFERENCES users(id) ON DELETE SET NULL,
  organization_id    integer REFERENCES organizations(id) ON DELETE SET NULL,
  model              text NOT NULL,
  instruction        text,
  input_tokens       integer NOT NULL DEFAULT 0,
  output_tokens      integer NOT NULL DEFAULT 0,
  cache_read_tokens  integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  cost_usd_cents     double precision NOT NULL DEFAULT 0,
  duration_ms        integer,
  ok                 boolean NOT NULL DEFAULT false,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS esign_ai_usage_user_day ON esign_ai_usage (user_id, created_at);
ALTER TABLE esign_ai_usage ENABLE ROW LEVEL SECURITY;

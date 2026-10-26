-- ── The Mailer's assistant — usage log + per-person daily cap ────────────────
-- Daniel, 2026-10-26: "make it agentic like chatbox type so i can prompt it …
-- maybe we could add limit per staff member per day also".
--
-- Every prompt is a paid API call on the club's Anthropic account, so every one
-- is a row here: who, which workspace, the model, the tokens, the cost. The cap
-- is COUNTED from these rows per NZ day — never a counter that can drift across
-- two Fly machines. A failed call still cost money and is still a row (ok=false).
--
-- users.mailer_ai_daily_limit: NULL = the default (shared/mailer-ai.ts, 50);
-- 0 = switched off for that person. Set in /admin/team, no deploy.
--
-- Idempotent. Additive. RLS on (the app connects as postgres and bypasses it).

ALTER TABLE users ADD COLUMN IF NOT EXISTS mailer_ai_daily_limit integer;

CREATE TABLE IF NOT EXISTS mailer_ai_usage (
  id                  integer       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id             integer       REFERENCES users(id) ON DELETE SET NULL,
  user_label          text,
  organization_id     integer       NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  brand               text,
  model               text          NOT NULL,
  instruction         text          NOT NULL DEFAULT '',
  input_tokens        integer       NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens       integer       NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens   integer       NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens  integer       NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cost_usd_cents      numeric(12,4) NOT NULL DEFAULT 0 CHECK (cost_usd_cents >= 0),
  duration_ms         integer       NOT NULL DEFAULT 0,
  ok                  boolean       NOT NULL DEFAULT true,
  changed             boolean       NOT NULL DEFAULT false,
  error               text,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mailer_ai_usage_user_idx ON mailer_ai_usage (user_id, created_at);
CREATE INDEX IF NOT EXISTS mailer_ai_usage_org_idx  ON mailer_ai_usage (organization_id, created_at);

ALTER TABLE mailer_ai_usage ENABLE ROW LEVEL SECURITY;

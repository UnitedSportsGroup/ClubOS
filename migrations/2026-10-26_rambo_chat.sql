-- ── Rambo's own page: chats that remember their workspace and what they cost ─
-- Daniel, 2026-10-26 (night): "make Rambo a separate thing on the side … like
-- ChatGPT and Claude, where it has your different chats … limit usage … I can
-- monitor the usage".
--
-- The Knowledge Base tab's kb_chat_sessions / kb_chat_messages ARE the chats;
-- Rambo's page and the home prompt box write the same tables. Two additions:
-- a session knows the workspace it started in (the club-data tools answer
-- about that organisation), and an assistant message carries its tokens and
-- US cents, so one person's prompts across every door are one number.
--
-- Idempotent. Additive. RLS already on both tables; re-asserted.

ALTER TABLE kb_chat_sessions ADD COLUMN IF NOT EXISTS workspace_slug text;

ALTER TABLE kb_chat_messages ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE kb_chat_messages ADD COLUMN IF NOT EXISTS input_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE kb_chat_messages ADD COLUMN IF NOT EXISTS output_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE kb_chat_messages ADD COLUMN IF NOT EXISTS cache_read_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE kb_chat_messages ADD COLUMN IF NOT EXISTS cache_write_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE kb_chat_messages ADD COLUMN IF NOT EXISTS cost_usd_cents numeric(12,4) NOT NULL DEFAULT 0;
ALTER TABLE kb_chat_messages ADD COLUMN IF NOT EXISTS duration_ms integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_chat_messages_tokens_nonneg') THEN
    ALTER TABLE kb_chat_messages ADD CONSTRAINT kb_chat_messages_tokens_nonneg
      CHECK (input_tokens >= 0 AND output_tokens >= 0 AND cache_read_tokens >= 0 AND cache_write_tokens >= 0 AND cost_usd_cents >= 0);
  END IF;
END $$;

-- The daily count joins messages → sessions by user and filters by created_at.
CREATE INDEX IF NOT EXISTS kb_chat_messages_created_idx ON kb_chat_messages (created_at);

ALTER TABLE kb_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_chat_messages ENABLE ROW LEVEL SECURITY;

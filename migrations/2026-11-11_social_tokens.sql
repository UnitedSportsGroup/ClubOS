-- Social media — sign-in tokens for platforms that need the account itself to
-- approve reading (TikTok now; LinkedIn later).
--
-- One row per account. Both tokens are stored ENCRYPTED (AES-256-GCM, key held
-- only by the server), never in the clear. TikTok replaces the refresh token on
-- every refresh and the old one stops working at once, so the row is rewritten
-- in the same step as the refresh.
CREATE TABLE IF NOT EXISTS social_account_tokens (
  account_id         integer PRIMARY KEY REFERENCES social_accounts(id) ON DELETE CASCADE,
  access_token_enc   text NOT NULL,
  refresh_token_enc  text,
  access_expires_at  timestamptz NOT NULL,
  -- NULL = the platform did not say when the sign-in itself runs out.
  refresh_expires_at timestamptz,
  scope              text,
  connected_by       integer REFERENCES users(id) ON DELETE SET NULL,
  connected_at       timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE social_account_tokens ENABLE ROW LEVEL SECURITY;

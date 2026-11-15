-- One Mailer for every workspace (2026-11-14). Additive and nullable: the
-- campaigns that already exist keep NULL and are placed by their segment
-- prefix (cugc_* → Gymnastics, league_* → MFL, cic_* → CIC, the rest → CUFC).
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS organization_id integer
  REFERENCES organizations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS email_campaigns_org_created_idx ON email_campaigns (organization_id, created_at DESC);

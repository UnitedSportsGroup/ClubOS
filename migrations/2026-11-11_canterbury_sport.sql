-- Canterbury Sport (United Sports Group Limited, the land company) — the analysis model, built on Daniel's Mac from the
-- company's own Xero (outputs/usg-ltd-finance/build_model.py) and pushed with FINANCE_INSIGHT_UPLOAD_TOKEN. One row per
-- push; the newest row is what the tab shows. RLS on (service-role connections bypass it; a leaked anon key gets nothing).
CREATE TABLE IF NOT EXISTS usg_ltd_snapshots (
  id            serial PRIMARY KEY,
  generated_at  timestamptz NOT NULL,
  as_of         date NOT NULL,
  source        text NOT NULL,
  model         jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usg_ltd_snapshots_generated_idx ON usg_ltd_snapshots (generated_at DESC);
ALTER TABLE usg_ltd_snapshots ENABLE ROW LEVEL SECURITY;

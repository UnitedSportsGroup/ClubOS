-- Financial Insight — the club's cash P&L model (built nightly on Daniel's Mac from Xero, Xero Payroll and ClubOS), stored as
-- one JSON snapshot per refresh so the Financial Insight tab always serves the latest and keeps the history.
-- Read behind requireTab("finance-insight") AND a password unlock held in the session; written only by the nightly job
-- with FINANCE_INSIGHT_UPLOAD_TOKEN. RLS on (service-role connections bypass it; a leaked anon key gets nothing).
CREATE TABLE IF NOT EXISTS finance_insight_snapshots (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  generated_at  timestamptz NOT NULL,
  source        text NOT NULL DEFAULT 'export_model.py',
  model         jsonb NOT NULL,
  node_count    integer GENERATED ALWAYS AS (jsonb_array_length(model -> 'nodes')) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- COALESCE: a MISSING key makes jsonb_typeof NULL, and a NULL check passes — the shape must be asserted, not assumed
  CONSTRAINT finance_insight_model_shape CHECK (COALESCE(jsonb_typeof(model -> 'nodes'), '') = 'array' AND COALESCE(jsonb_typeof(model -> 'months'), '') = 'array')
);
CREATE INDEX IF NOT EXISTS finance_insight_snapshots_generated_idx ON finance_insight_snapshots (generated_at DESC);
ALTER TABLE finance_insight_snapshots ENABLE ROW LEVEL SECURITY;

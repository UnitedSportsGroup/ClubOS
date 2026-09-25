-- ─────────────────────────────────────────────────────────────────────────────
-- CIC Youth — registrations of interest become a LEAD PIPELINE (2026-09-25)
--
-- Daniel: "add this pipeline view for cic youth registrations of interest so
-- isaac can actually workflow, action, track and project manage very easily all
-- the leads we getting and like disqualify some leads if just spam."
--
-- 243 rows sat at status 'new' with nothing to move them on. `status` becomes
-- the pipeline STAGE (validated app-side in shared/cic-leads.ts — deliberately
-- no CHECK: a stale CHECK is how the MFL checkout 500'd). Nothing else reads
-- the column's values (dashboard counts all rows, the dossier/marketing ingest
-- read contact fields only), so the legacy values are simply re-mapped.
--
-- ADDITIVE. No BEGIN/COMMIT here — script/apply-cic-lead-pipeline.ts wraps it,
-- and an inner COMMIT would defeat its --dry-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE cic_interest_registrations
  ADD COLUMN IF NOT EXISTS closed_reason     text,
  ADD COLUMN IF NOT EXISTS priority          text,
  ADD COLUMN IF NOT EXISTS next_follow_up_on date,
  ADD COLUMN IF NOT EXISTS owner_user_id     integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage_changed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_at  timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now();

-- Legacy statuses → stages. (Zero rows carried these on 2026-09-25.)
UPDATE cic_interest_registrations SET status = 'entered'      WHERE status = 'confirmed';
UPDATE cic_interest_registrations SET status = 'not_coming'   WHERE status = 'declined';
UPDATE cic_interest_registrations SET status = 'disqualified', closed_reason = COALESCE(closed_reason, 'other')
  WHERE status = 'archived';

CREATE INDEX IF NOT EXISTS cic_interest_stage_idx
  ON cic_interest_registrations (organization_id, status);

-- Every call, email, WhatsApp, note and stage move — with WHO did it.
-- Append-only by use; rows go only when their lead goes.
CREATE TABLE IF NOT EXISTS cic_interest_activities (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  registration_id  integer NOT NULL REFERENCES cic_interest_registrations(id) ON DELETE CASCADE,
  type             text NOT NULL,
  outcome          text,
  note             text,
  from_stage       text,
  to_stage         text,
  created_by       integer REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cic_interest_activities_reg_idx
  ON cic_interest_activities (registration_id, created_at);

-- A stage move must record where it went; a note must say something.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cic_interest_activities_stage_move') THEN
    ALTER TABLE cic_interest_activities ADD CONSTRAINT cic_interest_activities_stage_move
      CHECK (type <> 'stage_change' OR to_stage IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cic_interest_activities_note_body') THEN
    ALTER TABLE cic_interest_activities ADD CONSTRAINT cic_interest_activities_note_body
      CHECK (type <> 'note' OR length(btrim(coalesce(note, ''))) > 0);
  END IF;
END $$;

ALTER TABLE cic_interest_activities ENABLE ROW LEVEL SECURITY;

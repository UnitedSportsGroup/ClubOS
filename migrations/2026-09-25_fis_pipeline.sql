-- ─────────────────────────────────────────────────────────────────────────────
-- Football in Schools — the outreach PIPELINE (2026-09-25)
--
-- Daniel: "in additional programs add Football In Schools and create full
-- pipeline view … with all school and early learning centres that we created
-- presentations for … so connor can start workflowing this."
--
-- One row per school or early learning centre that has a proposal page on
-- cufc.co.nz (44 schools + 115 centres, seeded from the outreach database by
-- script/seed-fis-pipeline.ts). (kind, slug) IS the page: the slug is the one
-- in cufc.co.nz/football-in-schools/{slug} or /football-in-early-learning/{slug}.
--
-- 🔴 Stage values are validated app-side (shared/fis-leads.ts) — deliberately
--    no CHECK: a stale CHECK is how the MFL checkout 500'd.
-- 🔴 `background` holds the outreach database's INTERNAL columns (providers,
--    fee signals, our notes). Staff-only, never sent to a school.
--
-- ADDITIVE. No BEGIN/COMMIT — script/apply-fis-pipeline.ts wraps it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fis_leads (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id    integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind               text NOT NULL,              -- 'school' | 'elc'
  slug               text NOT NULL,
  name               text NOT NULL,
  suburb             text,
  address            text,
  website            text,
  drive_min          integer,
  worked_with_us     boolean NOT NULL DEFAULT false,
  delivered_text     text,
  lead_group         text,
  phone              text,
  email              text,
  contact_name       text,
  contact_role       text,
  contact_email      text,
  contact_phone      text,
  sheet_status       text,
  background         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- the pipeline
  status             text NOT NULL DEFAULT 'new',
  closed_reason      text,
  priority           text,
  next_follow_up_on  date,
  owner_user_id      integer REFERENCES users(id) ON DELETE SET NULL,
  notes              text,
  stage_changed_at   timestamptz,
  last_activity_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- One school, one row: a re-seed is an update, never a second card.
CREATE UNIQUE INDEX IF NOT EXISTS fis_leads_org_kind_slug_uq ON fis_leads (organization_id, kind, slug);
CREATE INDEX IF NOT EXISTS fis_leads_stage_idx ON fis_leads (organization_id, status);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fis_leads_kind') THEN
    -- Two kinds only, and the page URL is built from it — this one is a real invariant.
    ALTER TABLE fis_leads ADD CONSTRAINT fis_leads_kind CHECK (kind IN ('school', 'elc'));
  END IF;
END $$;

-- Every call, email, note and stage move — with WHO did it.
CREATE TABLE IF NOT EXISTS fis_lead_activities (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id          integer NOT NULL REFERENCES fis_leads(id) ON DELETE CASCADE,
  type             text NOT NULL,
  outcome          text,
  note             text,
  from_stage       text,
  to_stage         text,
  created_by       integer REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fis_lead_activities_lead_idx ON fis_lead_activities (lead_id, created_at);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fis_lead_activities_stage_move') THEN
    ALTER TABLE fis_lead_activities ADD CONSTRAINT fis_lead_activities_stage_move
      CHECK (type <> 'stage_change' OR to_stage IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fis_lead_activities_note_body') THEN
    ALTER TABLE fis_lead_activities ADD CONSTRAINT fis_lead_activities_note_body
      CHECK (type <> 'note' OR length(btrim(coalesce(note, ''))) > 0);
  END IF;
END $$;

ALTER TABLE fis_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE fis_lead_activities ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Task Board — Daniel + Isaac's MFL project board (2026-09-25)
--
-- Daniel: "a tab in MFL workspace called task tracker underneath dashboard …
-- me and isaac's project management dashboard … make it completely separate
-- and unattached to task tracker in system, i want to start fresh and redesign
-- the whole ui/ux and fundamentals of it."
--
-- Deliberately NOT tt_* (the org-wide System tracker): own tables, own tab
-- (`task-board`), workspace-scoped by organization_id so it can grow into other
-- areas later without a schema change.
--
-- 🔴 status / priority are validated app-side (shared/task-board.ts), no CHECK:
--    a stale CHECK is how the MFL checkout 500'd.
-- 🔴 A task that came from a meeting keeps WHERE it came from (source_*), so a
--    suggestion can always be traced back to the recording.
-- 🔴 Nothing is hard-deleted by the app — archived_at hides it.
--
-- ADDITIVE. No BEGIN/COMMIT — script/apply-task-board.ts wraps it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tb_projects (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  color            text NOT NULL DEFAULT 'gold',
  position         integer NOT NULL DEFAULT 0,
  created_by       integer REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz
);
CREATE INDEX IF NOT EXISTS tb_projects_org_idx ON tb_projects (organization_id, position);

CREATE TABLE IF NOT EXISTS tb_tasks (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id       integer REFERENCES tb_projects(id) ON DELETE SET NULL,
  title            text NOT NULL,
  notes            text,
  status           text NOT NULL DEFAULT 'todo',      -- todo | doing | waiting | done
  priority         text NOT NULL DEFAULT 'normal',    -- high | normal
  owner_user_id    integer REFERENCES users(id) ON DELETE SET NULL,
  due_on           date,
  position         integer NOT NULL DEFAULT 0,
  source_label     text,                              -- e.g. "MFL meeting · Fri 18 Sep"
  source_url       text,                              -- the Fireflies recording
  source_quote     text,                              -- what was actually said / captured
  created_by       integer REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  archived_at      timestamptz
);
CREATE INDEX IF NOT EXISTS tb_tasks_org_idx ON tb_tasks (organization_id, status, position);
CREATE INDEX IF NOT EXISTS tb_tasks_project_idx ON tb_tasks (project_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_tasks_title_present') THEN
    ALTER TABLE tb_tasks ADD CONSTRAINT tb_tasks_title_present CHECK (length(btrim(title)) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_projects_name_present') THEN
    ALTER TABLE tb_projects ADD CONSTRAINT tb_projects_name_present CHECK (length(btrim(name)) > 0);
  END IF;
END $$;

ALTER TABLE tb_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tb_tasks ENABLE ROW LEVEL SECURITY;

-- Marketing → Ideas: the ideas backlog and the plan (see shared/marketing-ideas.ts).
--
-- One row per idea. `section` is the Marketing tab it belongs to (validated in
-- shared code, not by a CHECK — the list of tabs grows). `stage` is 'idea'
-- (backlog) or 'plan' (promoted), with who promoted it and when.
--
-- 🔴 A blank cost or time is NULL, never zero. 🔴 Removed ideas are archived.
CREATE TABLE IF NOT EXISTS marketing_ideas (
  id            serial PRIMARY KEY,
  title         text NOT NULL,
  description   text,
  section       text NOT NULL,
  stage         text NOT NULL DEFAULT 'idea',
  cost_cents    integer CHECK (cost_cents IS NULL OR cost_cents >= 0),
  time_estimate text,
  created_by    integer REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  promoted_by   integer REFERENCES users(id) ON DELETE SET NULL,
  promoted_at   timestamptz,
  archived_at   timestamptz,
  -- In the plan exactly when it carries the time it was promoted.
  CONSTRAINT marketing_ideas_plan_stamp CHECK ((stage = 'plan') = (promoted_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS marketing_ideas_section_idx ON marketing_ideas (section, archived_at);

ALTER TABLE marketing_ideas ENABLE ROW LEVEL SECURITY;

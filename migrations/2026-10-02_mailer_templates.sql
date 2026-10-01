-- Mailer templates — an email you write once and send again.
--
-- Zach, 2026-09-30, building the parents' email in the Mailer: the builder had
-- starter layouts but nowhere to KEEP your own, so the same Term letter was
-- rebuilt from scratch each time. A template is a design plus the subject it
-- usually goes with. It belongs to a WORKSPACE (CUFC's are not SIU's).
--
-- Additive only: one new table.
CREATE TABLE IF NOT EXISTS mailer_templates (
  id                  integer     PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id     integer     NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name                text        NOT NULL,
  subject             text,
  -- body_doc is the editable design; body_html the compiled email. Both, for
  -- the same reason as email_campaigns: a design that fails to load must never
  -- stop the email itself being reused.
  body_doc            jsonb       NOT NULL,
  body_html           text        NOT NULL,
  created_by_user_id  integer     REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id  integer     REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Retired, never deleted: a template someone else is halfway through using
  -- must not vanish under them.
  archived_at         timestamptz,
  CONSTRAINT mailer_templates_name_present CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT mailer_templates_html_present CHECK (length(btrim(body_html)) > 0)
);

-- One live template per name per workspace, so "Term 4 welcome" means one thing.
CREATE UNIQUE INDEX IF NOT EXISTS mailer_templates_org_name_live
  ON mailer_templates (organization_id, lower(btrim(name))) WHERE archived_at IS NULL;

ALTER TABLE mailer_templates ENABLE ROW LEVEL SECURITY;

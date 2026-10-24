-- ── Mailer Automations — emails that send themselves ─────────────────────────
-- Daniel, 2026-10-25: "build out the automations page … whether it is a single
-- email or a flow of like after purchase, after 1 day, after 3 days, 1 week,
-- 30 days, on birthday etc … if it's like an abandoned cart flow … if bought
-- then stop the sequence". First testing ground: U4–U8 (FUNiño).
--
-- AUTOMATION  = a trigger (what starts it), a scope (which programmes), rules
--               (stop when they pay, quiet hours) and a status (off/test/on).
-- STEP        = one email, timed FROM THE TRIGGER ("3 days after they pay"),
--               never from the previous email — so reordering, adding or
--               removing an email can never shift the others.
-- ENROLLMENT  = one family going through one automation once. The dedupe key
--               makes "once" a database fact, not a hope (two Fly machines).
-- SEND        = one email to one enrollment: scheduled → sent / skipped /
--               failed / cancelled, ALWAYS with a plain-English reason, because
--               "why didn't it send?" is the question every platform gets most.
--
-- Trigger, unit, status and kind values are validated in
-- shared/mailer-automations.ts and deliberately carry NO CHECK constraint here:
-- a stale CHECK is how the MFL checkout once 500'd.
--
-- Idempotent. Additive. RLS on (the app connects as postgres and bypasses it).

CREATE TABLE IF NOT EXISTS mailer_automations (
  id                  integer     PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id     integer     NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name                text        NOT NULL,
  description         text,
  trigger_type        text        NOT NULL,
  -- NULL = every programme in the workspace; otherwise only these.
  program_ids         integer[],
  trigger_config      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  stop_on_payment     boolean     NOT NULL DEFAULT false,
  -- 'operational' (booking info — always sends) | 'marketing' (respects unsubscribes)
  email_kind          text        NOT NULL DEFAULT 'operational',
  -- 'off' | 'test' (emails go to test_emails only) | 'on'
  status              text        NOT NULL DEFAULT 'off',
  test_emails         text[]      NOT NULL DEFAULT '{}',
  quiet_hours         boolean     NOT NULL DEFAULT true,
  from_email          text,
  reply_to            text,
  -- Families enter from this moment forward. Set every time it leaves 'off'.
  activated_at        timestamptz,
  created_by_user_id  integer     REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id  integer     REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  archived_at         timestamptz,
  CONSTRAINT mailer_automations_name_present CHECK (length(btrim(name)) BETWEEN 1 AND 120)
);
CREATE INDEX IF NOT EXISTS mailer_automations_org_idx ON mailer_automations(organization_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS mailer_automation_steps (
  id                integer     PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  automation_id     integer     NOT NULL REFERENCES mailer_automations(id) ON DELETE CASCADE,
  -- 'immediately' | 'minutes' | 'hours' | 'days' | 'weeks'
  timing_unit       text        NOT NULL DEFAULT 'immediately',
  timing_amount     integer     NOT NULL DEFAULT 0,
  -- 'after' | 'before' (before only makes sense for a date trigger)
  timing_direction  text        NOT NULL DEFAULT 'after',
  -- 'HH:MM' NZ time, for day/week timings ("1 day after, at 9:00am"). NULL = same time of day.
  send_time         text,
  subject           text        NOT NULL DEFAULT '',
  preheader         text,
  body_html         text        NOT NULL DEFAULT '',
  body_doc          jsonb,
  enabled           boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT mailer_automation_steps_amount_sane CHECK (timing_amount >= 0 AND timing_amount <= 100000)
);
CREATE INDEX IF NOT EXISTS mailer_automation_steps_auto_idx ON mailer_automation_steps(automation_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mailer_automation_enrollments (
  id               bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  automation_id    integer     NOT NULL REFERENCES mailer_automations(id) ON DELETE CASCADE,
  organization_id  integer     NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  -- e.g. 'reg:2731', 'start:4:parent@example.com', 'bday:child-88:2026'
  dedupe_key       text        NOT NULL,
  email            text        NOT NULL,
  registration_id  integer     REFERENCES registrations(id) ON DELETE SET NULL,
  program_id       integer     REFERENCES programs(id) ON DELETE SET NULL,
  -- The moment every step is timed from (paid at, started at, the birthday, the start date).
  anchor_at        timestamptz NOT NULL,
  -- Names and programme details for the merge tags, captured on entry.
  context          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- 'active' | 'completed' | 'stopped'
  status           text        NOT NULL DEFAULT 'active',
  stop_reason      text,
  test             boolean     NOT NULL DEFAULT false,
  entered_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  CONSTRAINT mailer_automation_enrollments_once UNIQUE (automation_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS mailer_automation_enrollments_active_idx ON mailer_automation_enrollments(automation_id, status);

CREATE TABLE IF NOT EXISTS mailer_automation_sends (
  id              bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  enrollment_id   bigint      NOT NULL REFERENCES mailer_automation_enrollments(id) ON DELETE CASCADE,
  step_id         integer     NOT NULL REFERENCES mailer_automation_steps(id) ON DELETE CASCADE,
  due_at          timestamptz NOT NULL,
  -- 'scheduled' | 'sending' | 'sent' | 'skipped' | 'failed' | 'cancelled'
  status          text        NOT NULL DEFAULT 'scheduled',
  reason          text,
  sent_to         text,
  sent_at         timestamptz,
  provider_id     text,
  attempts        integer     NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- One email per step per family. A retry is an UPDATE, never a second row.
  CONSTRAINT mailer_automation_sends_once UNIQUE (enrollment_id, step_id)
);
CREATE INDEX IF NOT EXISTS mailer_automation_sends_due_idx ON mailer_automation_sends(due_at) WHERE status = 'scheduled';

ALTER TABLE mailer_automations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailer_automation_steps       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailer_automation_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailer_automation_sends       ENABLE ROW LEVEL SECURITY;

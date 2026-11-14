-- ── SIU Performance Hub — check-in FORMS ─────────────────────────────────────
-- Daniel, 2026-11-14, with Rowan's Smartabase Loom: "copy all of those [the
-- questions] to start off with as the base template, and then we can customise
-- from there … build this out with the whole flow end to end".
--
--  🔴 A form is DATA. shared/perf-forms.ts holds the engine and Rowan's form as
--     the seed; the live, editable copy is a row here.
--  🔴 Editing a form never rewrites a past answer: every response stores the
--     form VERSION it was answered on, and old versions are kept in
--     perf_form_versions.
--  🔴 One response per player per form per NZ day; a second submit UPDATES it.
--  🔴 "Try the player app" writes TEST responses: no player, flagged is_test,
--     never on the board, never in the load engine, hidden from the report
--     unless asked for.

create table if not exists perf_forms (
  id               serial primary key,
  organization_id  integer not null references organizations(id) on delete restrict,
  key              text    not null check (key ~ '^[a-z0-9-]+$'),
  title            text    not null,
  definition       jsonb   not null,
  version          integer not null default 1,
  -- The form players are asked every day. One per organisation.
  is_daily         boolean not null default false,
  template_key     text,
  updated_by       integer references users(id) on delete restrict,
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  archived_at      timestamptz,
  unique (organization_id, key)
);
create unique index if not exists perf_forms_one_daily on perf_forms (organization_id) where is_daily and archived_at is null;

create table if not exists perf_form_versions (
  form_id     integer not null references perf_forms(id) on delete cascade,
  version     integer not null,
  definition  jsonb   not null,
  saved_by    integer references users(id) on delete restrict,
  saved_at    timestamptz not null default now(),
  primary key (form_id, version)
);

create table if not exists perf_form_responses (
  id                  serial primary key,
  organization_id     integer not null references organizations(id) on delete restrict,
  form_id             integer not null references perf_forms(id) on delete restrict,
  form_version        integer not null,
  contact_id          integer references contacts(id) on delete restrict,
  entry_date          date    not null,
  answers             jsonb   not null,
  flag_level          text    check (flag_level in ('red','amber')),
  flag_reasons        text[]  not null default '{}',
  entered_by          integer references users(id) on delete restrict,
  entered_by_athlete  boolean not null default false,
  is_test             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Every row says who: the player themself, or a named staff member.
  check (entered_by is not null or entered_by_athlete),
  -- A real response belongs to a player; only a test may have none.
  check (contact_id is not null or is_test)
);
create unique index if not exists perf_form_responses_one_a_day
  on perf_form_responses (form_id, contact_id, entry_date) where not is_test;
create index if not exists perf_form_responses_day on perf_form_responses (organization_id, entry_date desc);

-- The load the check-in reported, so an edit or a cleared answer can take it back out.
alter table perf_rpe add column if not exists form_response_id integer references perf_form_responses(id) on delete cascade;

-- Rowan's "save this as a report to ourselves". Per person; the date is RELATIVE
-- ("today", "last 7 days") so tomorrow's click shows tomorrow's data.
create table if not exists perf_saved_reports (
  id               serial primary key,
  organization_id  integer not null references organizations(id) on delete restrict,
  user_id          integer not null references users(id) on delete cascade,
  name             text    not null check (length(name) between 1 and 80),
  config           jsonb   not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, name)
);

alter table perf_forms          enable row level security;
alter table perf_form_versions  enable row level security;
alter table perf_form_responses enable row level security;
alter table perf_saved_reports  enable row level security;

-- ── SIU Performance — first-team load, availability, wellness, testing ──────
-- Daniel, 2026-11-10: "integrate catapult into south island united … a new
-- section for performance … build it like clubos.tech has … sync with clubos in
-- as close to real time as possible."
--
-- Source-agnostic on purpose. Every session and every athlete carries `source`
-- ('catapult_one' today; a CSV upload, Terra or an official Catapult API later)
-- and a key from that source, so a second feed writes the SAME rows and no
-- screen changes. Plan: plans/2026-11-10-siu-performance-tab.md.
--
-- 🔴 BLANK IS NOT ZERO. Every metric is nullable with NO default. A player who
-- wore no pod has no row; a pod that recorded nothing for a metric stores NULL
-- and is left out of every average. A rest day (no session at all) is a
-- DERIVED zero in shared/performance.ts and is never written here.
--
-- 🔴 AN ATHLETE IS NOT A PERSON UNTIL A HUMAN SAYS SO. Catapult names players
-- by initials ("HH"); `contact_id` stays NULL until a staff member links it.
-- Guessing from initials would put one player's load on another's chart.

create extension if not exists btree_gist;

create table if not exists perf_athletes (
  id                  serial primary key,
  organization_id     integer not null references organizations(id) on delete restrict,
  source              text    not null,
  source_athlete_key  text    not null,
  source_name         text,
  source_squads       text[]  not null default '{}',
  contact_id          integer references contacts(id) on delete restrict,
  linked_by           integer references users(id) on delete restrict,
  linked_at           timestamptz,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  unique (organization_id, source, source_athlete_key)
);
-- One person, one athlete per source: a second link to the same contact is refused.
create unique index if not exists perf_athletes_contact_once
  on perf_athletes (organization_id, source, contact_id) where contact_id is not null;

create table if not exists perf_sessions (
  id               serial primary key,
  organization_id  integer not null references organizations(id) on delete restrict,
  source           text    not null,
  external_key     text    not null,
  session_date     date    not null,
  -- training | match | test | other. NULL = nobody has said; reads "Unclassified".
  kind             text check (kind is null or kind in ('training','match','test','other')),
  source_kind      text,
  name             text,
  tags             text[]  not null default '{}',
  player_count     integer,
  notes            text,
  first_synced_at  timestamptz not null default now(),
  last_synced_at   timestamptz not null default now(),
  unique (organization_id, source, external_key)
);
create index if not exists perf_sessions_org_date on perf_sessions (organization_id, session_date desc);

create table if not exists perf_session_stats (
  id                    serial primary key,
  session_id            integer not null references perf_sessions(id) on delete cascade,
  athlete_id            integer not null references perf_athletes(id) on delete restrict,
  distance_m            numeric,
  top_speed_kmh         numeric,
  sprint_distance_m     numeric,
  power_plays           numeric,
  energy_kcal           numeric,
  impacts               numeric,
  hr_load               numeric,
  time_in_red_zone_min  numeric,
  player_load           numeric,
  distance_per_min      numeric,
  power_score           numeric,
  work_ratio            numeric,
  hr_max                numeric,
  max_acceleration      numeric,
  max_deceleration      numeric,
  rpe                   smallint check (rpe is null or rpe between 1 and 10),
  raw                   jsonb,
  updated_at            timestamptz not null default now(),
  unique (session_id, athlete_id)
);
create index if not exists perf_session_stats_athlete on perf_session_stats (athlete_id);

create table if not exists perf_availability (
  id               serial primary key,
  organization_id  integer not null references organizations(id) on delete restrict,
  contact_id       integer not null references contacts(id) on delete restrict,
  status           text    not null check (status in ('injured','ill','modified','unavailable')),
  started_on       date    not null,
  ended_on         date,
  reason           text,
  body_area        text,
  notes            text,
  recorded_by      integer not null references users(id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ended_on is null or ended_on >= started_on),
  -- One spell out at a time per player. An open spell runs to infinity.
  exclude using gist (
    contact_id with =,
    daterange(started_on, coalesce(ended_on, 'infinity'::date), '[]') with &&
  )
);

create table if not exists perf_wellness (
  id               serial primary key,
  organization_id  integer not null references organizations(id) on delete restrict,
  contact_id       integer not null references contacts(id) on delete restrict,
  date             date    not null,
  sleep            smallint check (sleep    is null or sleep    between 1 and 5),
  fatigue          smallint check (fatigue  is null or fatigue  between 1 and 5),
  soreness         smallint check (soreness is null or soreness between 1 and 5),
  stress           smallint check (stress   is null or stress   between 1 and 5),
  mood             smallint check (mood     is null or mood     between 1 and 5),
  sore_areas       text[]  not null default '{}',
  note             text,
  entered_by       integer not null references users(id) on delete restrict,
  entered_at       timestamptz not null default now(),
  unique (contact_id, date)
);

create table if not exists perf_tests (
  id                serial primary key,
  organization_id   integer not null references organizations(id) on delete restrict,
  name              text    not null,
  unit              text,
  higher_is_better  boolean not null,
  -- Benchmark bands are Adria's knowledge: NULL = no band, no colour shown.
  band_red          numeric,
  band_green        numeric,
  created_by        integer not null references users(id) on delete restrict,
  created_at        timestamptz not null default now()
);
create unique index if not exists perf_tests_name on perf_tests (organization_id, lower(name));

create table if not exists perf_test_results (
  id          serial primary key,
  test_id     integer not null references perf_tests(id) on delete restrict,
  contact_id  integer not null references contacts(id) on delete restrict,
  tested_on   date    not null,
  value       numeric not null,
  notes       text,
  entered_by  integer not null references users(id) on delete restrict,
  entered_at  timestamptz not null default now(),
  unique (test_id, contact_id, tested_on)
);

-- Every sync attempt, success or failure, so the tab can say "last synced 4
-- min ago" or "sync failing since 2am: login refused" instead of going quiet.
create table if not exists perf_sync_runs (
  id                serial primary key,
  organization_id   integer not null references organizations(id) on delete restrict,
  source            text    not null,
  trigger           text    not null,           -- 'cron' | 'manual'
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  ok                boolean,
  sessions_seen     integer,
  sessions_written  integer,
  stats_written     integer,
  error             text
);
create index if not exists perf_sync_runs_recent on perf_sync_runs (organization_id, started_at desc);

alter table perf_athletes      enable row level security;
alter table perf_sessions      enable row level security;
alter table perf_session_stats enable row level security;
alter table perf_availability  enable row level security;
alter table perf_wellness      enable row level security;
alter table perf_tests         enable row level security;
alter table perf_test_results  enable row level security;
alter table perf_sync_runs     enable row level security;

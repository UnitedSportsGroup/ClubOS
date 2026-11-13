-- ── SIU Performance Hub — every data source into one store ──────────────────
-- Daniel, 2026-11-14: "build a player monitoring system like smartabase … a web
-- app and mobile app … linked into siu clubos workspace in the performance data
-- areas … all data sources plugged into one dashboard like the player monitoring
-- responses, objective gps data, formulas etc… whoop … wyscout, statsbomb, video
-- clips".
--
-- Builds on migrations/2026-11-10_performance.sql (applied 10 Nov, every table
-- still EMPTY when this was written). The change of shape:
--
--   🔴 ONE STORE. Every number from every source is ONE row in
--   `perf_metric_values`: a player, a date, a metric key from
--   shared/performance.ts, a value, and the source it came from. GPS, WHOOP,
--   Wyscout, StatsBomb, force plates and a hand-typed sprint time all land in
--   the same table, so a new source is an IMPORT, never a new screen. That is
--   the Smartabase shape, and it is why `perf_session_stats` (one wide column
--   per Catapult metric) is dropped — it was empty, and a wide table needs a
--   migration for every metric a new device invents.
--
--   🔴 BLANK IS NOT ZERO. A metric a source did not give is NO ROW. A value is
--   never NULL and never defaulted. A rest day is a DERIVED zero in
--   shared/performance.ts and is never written here.
--
--   🔴 A PERSON IS NOT A PERSON UNTIL A HUMAN SAYS SO. Catapult names players
--   "HH". `perf_athletes.contact_id` stays NULL until staff link it.
--
--   🔴 Players answer their own check-ins (wellness, RPE) on their phones, so
--   `entered_by` may be NULL — but only when the player themself submitted it
--   (`entered_by_athlete`). A CHECK keeps one of the two true: every row says who.

drop table if exists perf_session_stats;

-- ── the squad ───────────────────────────────────────────────────────────────
-- The roster IS club_squads / club_squad_members (org 2), the club's own team
-- spine. No second roster table. See script/seed-siu-performance-squad.ts.

-- ── one store ───────────────────────────────────────────────────────────────
create table if not exists perf_metric_values (
  id               bigserial primary key,
  organization_id  integer not null references organizations(id) on delete restrict,
  contact_id       integer references contacts(id) on delete restrict,
  athlete_id       integer references perf_athletes(id) on delete restrict,
  observed_on      date    not null,
  metric_key       text    not null,
  value            numeric not null,
  source           text    not null,
  -- The source's own key for this reading. A re-import of the same file, or a
  -- connector polling twice, is a RETRY that updates the row, never a second one.
  external_key     text    not null,
  session_id       integer references perf_sessions(id) on delete cascade,
  import_id        integer,
  entered_by       integer references users(id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- A reading belongs to a person, or to a source identity waiting to be linked.
  check (contact_id is not null or athlete_id is not null),
  check (metric_key ~ '^[a-z0-9_]+$'),
  unique (organization_id, source, external_key, metric_key)
);
create index if not exists perf_metric_values_person on perf_metric_values (contact_id, metric_key, observed_on);
create index if not exists perf_metric_values_org_date on perf_metric_values (organization_id, observed_on desc);
create index if not exists perf_metric_values_athlete on perf_metric_values (athlete_id) where contact_id is null;

-- Every uploaded file, kept. The same file twice is a no-op (sha256), and a
-- better parser later can re-read every file ever uploaded.
create table if not exists perf_imports (
  id               serial primary key,
  organization_id  integer not null references organizations(id) on delete restrict,
  source           text    not null,
  filename         text,
  sha256           text    not null,
  bytes            bytea   not null,
  rows_read        integer,
  values_written   integer,
  uploaded_by      integer not null references users(id) on delete restrict,
  uploaded_at      timestamptz not null default now(),
  check (octet_length(bytes) <= 5 * 1024 * 1024),
  unique (organization_id, sha256)
);
alter table perf_metric_values
  drop constraint if exists perf_metric_values_import_fk;
alter table perf_metric_values
  add constraint perf_metric_values_import_fk foreign key (import_id) references perf_imports(id) on delete set null;

-- ── session RPE (Foster) — answered by the player after training/a match ─────
create table if not exists perf_rpe (
  id                  serial primary key,
  organization_id     integer not null references organizations(id) on delete restrict,
  contact_id          integer not null references contacts(id) on delete restrict,
  date                date    not null,
  kind                text    not null check (kind in ('training','match','gym','other')),
  rpe                 smallint not null check (rpe between 0 and 10),
  minutes             smallint check (minutes is null or minutes between 1 and 300),
  note                text,
  entered_by          integer references users(id) on delete restrict,
  entered_by_athlete  boolean not null default false,
  entered_at          timestamptz not null default now(),
  check (entered_by is not null or entered_by_athlete),
  -- One answer per player per day per kind; a second submit UPDATES it.
  unique (contact_id, date, kind)
);

-- ── wellness: players submit it themselves now ──────────────────────────────
alter table perf_wellness alter column entered_by drop not null;
alter table perf_wellness add column if not exists entered_by_athlete boolean not null default false;
alter table perf_wellness add column if not exists sleep_hours numeric
  check (sleep_hours is null or (sleep_hours >= 0 and sleep_hours <= 16));
-- "Do you have any pain or injury you want the physio to know about?" — goes to
-- medical staff only, never onto the coaches' board.
alter table perf_wellness add column if not exists medical_flag boolean;
alter table perf_wellness drop constraint if exists perf_wellness_who_entered;
alter table perf_wellness add constraint perf_wellness_who_entered
  check (entered_by is not null or entered_by_athlete);

-- ── availability: coaches see status + expected return; notes are clinical ───
alter table perf_availability add column if not exists expected_return date;
comment on column perf_availability.notes is
  'CLINICAL. Returned only to a user holding the performance-medical grant.';

-- ── video ────────────────────────────────────────────────────────────────────
create table if not exists perf_media (
  id               serial primary key,
  organization_id  integer not null references organizations(id) on delete restrict,
  title            text    not null,
  url              text    not null check (url ~* '^https://'),
  source           text    not null,
  clip_date        date,
  session_id       integer references perf_sessions(id) on delete set null,
  contact_ids      integer[] not null default '{}',
  tags             text[]  not null default '{}',
  start_seconds    integer check (start_seconds is null or start_seconds >= 0),
  note             text,
  created_by       integer not null references users(id) on delete restrict,
  created_at       timestamptz not null default now(),
  archived_at      timestamptz
);
create index if not exists perf_media_org on perf_media (organization_id, clip_date desc);

-- ── the player's own account (phone check-in) ───────────────────────────────
-- A CUSTOMER-shaped credential, never a staff session: its own cookie, its own
-- tables, and it reaches only /api/public/athlete/*. Ported from Team Pay's
-- captain account. Created ONLY by staff inviting a player on the roster.
create table if not exists perf_athlete_accounts (
  id               serial primary key,
  organization_id  integer not null references organizations(id) on delete restrict,
  contact_id       integer not null references contacts(id) on delete restrict,
  email            text    not null,
  password_hash    text,
  invited_by       integer not null references users(id) on delete restrict,
  invited_at       timestamptz not null default now(),
  last_sign_in_at  timestamptz,
  disabled_at      timestamptz,
  updated_at       timestamptz not null default now(),
  unique (organization_id, contact_id)
);
create unique index if not exists perf_athlete_accounts_email on perf_athlete_accounts (lower(email));

create table if not exists perf_athlete_sessions (
  id           serial primary key,
  account_id   integer not null references perf_athlete_accounts(id) on delete cascade,
  token_hash   text    not null unique,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  ip           text,
  user_agent   text,
  created_at   timestamptz not null default now()
);

create table if not exists perf_athlete_tokens (
  id           serial primary key,
  account_id   integer not null references perf_athlete_accounts(id) on delete cascade,
  token_hash   text    not null unique,
  kind         text    not null check (kind in ('set','reset')),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists perf_athlete_auth_events (
  id          bigserial primary key,
  email       text,
  account_id  integer references perf_athlete_accounts(id) on delete set null,
  action      text    not null,
  ok          boolean not null,
  reason      text,
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists perf_athlete_auth_events_recent on perf_athlete_auth_events (created_at desc);

alter table perf_metric_values       enable row level security;
alter table perf_imports             enable row level security;
alter table perf_rpe                 enable row level security;
alter table perf_media               enable row level security;
alter table perf_athlete_accounts    enable row level security;
alter table perf_athlete_sessions    enable row level security;
alter table perf_athlete_tokens      enable row level security;
alter table perf_athlete_auth_events enable row level security;

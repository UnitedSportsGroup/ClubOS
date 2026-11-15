-- SIU Performance app — push reminders. Daniel, 14 Nov: "build the mobile app now".
--  🔴 A token belongs to a PLAYER ACCOUNT, never to a staff user, and only the
--     player's own signed-in app can register it.
--  🔴 One morning reminder per NZ day, claimed by ONE machine (perf_reminder_runs).
create table if not exists perf_athlete_push_tokens (
  id            serial primary key,
  account_id    integer not null references perf_athlete_accounts(id) on delete cascade,
  token         text    not null unique check (token ~ '^Expo(nent)?PushToken\[[^\]]+\]$'),
  platform      text    check (platform in ('ios','android')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  disabled_at   timestamptz
);
create index if not exists perf_athlete_push_tokens_account on perf_athlete_push_tokens (account_id) where disabled_at is null;

create table if not exists perf_reminder_runs (
  run_date    date primary key,
  claimed_at  timestamptz not null default now(),
  sent        integer,
  skipped     integer,
  finished_at timestamptz
);
alter table perf_athlete_push_tokens enable row level security;
alter table perf_reminder_runs       enable row level security;

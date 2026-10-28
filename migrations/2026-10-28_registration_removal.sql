-- ── Removing a registration entered by mistake, with a name on it ───────────
-- Daniel, 2026-10-28, after Travis entered one EFTPOS payment twice (#3021 and
-- #3023, receipt 034840, ten minutes apart): "make sure he can do this himself
-- going forward but also that the database records and marks who deleted it so
-- we can track down who's making these changes … if someone is trying to
-- manipulate the system."
--
-- Until today DELETE /api/admin/registrations/:id was a HARD delete, open to
-- every logged-in staff member, that wrote nothing anywhere. A paid office
-- registration could vanish — with the record of who took the money — and no
-- one could ever say it had existed.
--
-- 🔴 A REMOVED REGISTRATION IS KEPT. Its status becomes 'removed', which is not
-- in REAL_REGISTRATION_STATUSES, so it leaves every roll, count, list, family
-- card and Rambo answer through the one decider that already governs them all.
-- The row, its money fields and its served-by stay exactly as they were.
--
-- 🔴 WHO, WHEN, WHY AND FROM WHAT are stamped on the row, all or none (CHECK),
-- and the remover is ON DELETE RESTRICT: deleting a staff member must never
-- erase the record of what they removed.
--
-- 🔴 EVERY remove and restore is also an APPEND-ONLY event row. The stamps on
-- the registration describe its state now; the events are the history, and a
-- trigger refuses UPDATE and DELETE on them so nobody can tidy the trail.

-- New enum value. Not USED in this file: Postgres will not let a value added in
-- a transaction be referenced before that transaction commits.
alter type registration_status add value if not exists 'removed';

alter table registrations add column if not exists removed_at timestamptz;
alter table registrations add column if not exists removed_by_user_id integer
  references users(id) on delete restrict;
alter table registrations add column if not exists removed_reason text;
-- The status it held, so a restore puts it back exactly — never a guess.
alter table registrations add column if not exists removed_from_status registration_status;

alter table registrations drop constraint if exists registrations_removed_all_or_none;
alter table registrations add constraint registrations_removed_all_or_none check (
  (removed_at is null and removed_by_user_id is null and removed_reason is null and removed_from_status is null)
  or
  (removed_at is not null and removed_by_user_id is not null
   and removed_reason is not null and length(btrim(removed_reason)) >= 3
   and removed_from_status is not null)
);

create table if not exists registration_removal_events (
  id integer primary key generated always as identity,
  registration_id integer not null references registrations(id) on delete restrict,
  action text not null check (action in ('removed', 'restored')),
  user_id integer not null references users(id) on delete restrict,
  reason text,
  -- What the registration looked like at that moment (child, programme, money,
  -- payment method + reference, who served it) — readable without a join.
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists registration_removal_events_reg_idx on registration_removal_events (registration_id, created_at);
create index if not exists registration_removal_events_user_idx on registration_removal_events (user_id, created_at);

create or replace function registration_removal_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'registration_removal_events is append-only';
end $$;

drop trigger if exists registration_removal_events_no_change on registration_removal_events;
create trigger registration_removal_events_no_change
  before update or delete on registration_removal_events
  for each row execute function registration_removal_events_append_only();

alter table registration_removal_events enable row level security;

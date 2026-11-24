-- SIU Performance app, 25 Nov 2026 (meeting with Michael Peterson + Adria Casals).
--  * Staff sign in to the SAME app and get the squad board instead of the check-in.
--    A staff login is an explicit column set only from the performance-gated admin
--    route, never inferred from a squad role.
--  * Staff who ask for it are told when a player reports something (once per check-in).
-- Additive, nullable, no backfill. No BEGIN/COMMIT here: the apply script owns the transaction.
alter table perf_athlete_accounts add column if not exists staff_role text;
alter table perf_athlete_accounts drop constraint if exists perf_athlete_accounts_staff_role_check;
alter table perf_athlete_accounts add constraint perf_athlete_accounts_staff_role_check
  check (staff_role is null or staff_role in ('coach','physio','performance'));
alter table perf_athlete_accounts add column if not exists notify_reports boolean not null default false;
-- Only staff can be told about other people's check-ins.
alter table perf_athlete_accounts drop constraint if exists perf_athlete_accounts_notify_staff_only;
alter table perf_athlete_accounts add constraint perf_athlete_accounts_notify_staff_only
  check (not notify_reports or staff_role is not null);
alter table perf_form_responses add column if not exists alert_sent_at timestamptz;

-- SIU Performance → Video: ONE standing library link for the coaching staff.
-- Daniel, 2026-11-28: "make sure they can see the training clips as well so we
-- build this over time as a library". A film-level share link shows one film;
-- the library link shows every film that is in the library, newest first, and a
-- film added later appears on it with no new link to send.
--
-- in_library defaults TRUE: the library is the point, and a film is taken out
-- deliberately (a staff member switches it off), never left out by omission.
-- The library link itself is off until a staff member switches it on.

alter table perf_films add column if not exists in_library boolean not null default true;

create table if not exists perf_film_libraries (
  id              serial primary key,
  organization_id integer not null unique references organizations(id) on delete restrict,
  token           text not null unique,
  enabled         boolean not null default false,
  created_by      integer references users(id) on delete restrict,
  created_at      timestamptz not null default now(),
  constraint perf_film_libraries_token check (token ~ '^[A-Za-z0-9_-]{16,64}$')
);
alter table perf_film_libraries enable row level security;

-- SIU Performance → Video: session film the club hosts itself.
--
-- A FILM is one session or match (a date, a title). It holds FILES: for each
-- camera clip a small "watch" copy that plays in the browser and, optionally,
-- the camera's ORIGINAL to download. NOTES are staff comments pinned to a
-- moment in a clip. A film may carry ONE share link (a random token) that lets
-- someone without a ClubOS login watch and download it.
--
-- The bytes live in the private Vercel Blob store "siu-film"; these rows only
-- point at them. Nothing here is deleted: a film or file is archived.

create table if not exists perf_films (
  id                serial primary key,
  organization_id   integer not null references organizations(id) on delete restrict,
  title             text not null,
  film_date         date,                         -- the day it was filmed; NULL = not recorded
  kind              text not null default 'training',   -- training | match | other (checked in the app)
  note              text,
  share_token       text unique,                  -- NULL = never shared
  share_enabled     boolean not null default false,
  share_created_by  integer references users(id) on delete restrict,
  share_created_at  timestamptz,
  created_by        integer references users(id) on delete restrict,
  created_at        timestamptz not null default now(),
  archived_at       timestamptz,
  constraint perf_films_share_needs_token check (not share_enabled or share_token is not null),
  constraint perf_films_title_not_blank check (length(btrim(title)) > 0)
);
create index if not exists perf_films_org on perf_films (organization_id, film_date desc nulls last, id desc);

create table if not exists perf_film_files (
  id              serial primary key,
  film_id         integer not null references perf_films(id) on delete restrict,
  clip            integer not null default 1,     -- which camera clip of the session (1, 2, …)
  role            text not null,                  -- 'watch' (plays in the page) | 'original' (download only)
  label           text not null,                  -- what a person reads: "Clip 1", "Clip 1 · original 4K"
  blob_url        text not null,
  download_name   text not null,
  content_type    text not null default 'video/mp4',
  bytes           bigint not null,
  seconds         numeric(10,2),                  -- NULL = not measured
  width           integer,
  height          integer,
  poster_url      text,
  created_by      integer references users(id) on delete restrict,
  created_at      timestamptz not null default now(),
  archived_at     timestamptz,
  constraint perf_film_files_role check (role in ('watch','original')),
  constraint perf_film_files_bytes check (bytes > 0),
  constraint perf_film_files_store check (blob_url ~ '^https://[a-z0-9]+\.private\.blob\.vercel-storage\.com/'),
  constraint perf_film_files_poster_store check (poster_url is null or poster_url ~ '^https://[a-z0-9]+\.private\.blob\.vercel-storage\.com/')
);
create index if not exists perf_film_files_film on perf_film_files (film_id, clip, role);
-- One live watch copy and one live original per clip.
create unique index if not exists perf_film_files_one_per_role on perf_film_files (film_id, clip, role) where archived_at is null;

create table if not exists perf_film_notes (
  id          serial primary key,
  film_id     integer not null references perf_films(id) on delete restrict,
  clip        integer not null default 1,
  at_seconds  numeric(10,2) not null,
  body        text not null,
  created_by  integer references users(id) on delete restrict,
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  constraint perf_film_notes_time check (at_seconds >= 0),
  constraint perf_film_notes_body check (length(btrim(body)) > 0)
);
create index if not exists perf_film_notes_film on perf_film_notes (film_id, clip, at_seconds);

alter table perf_films      enable row level security;
alter table perf_film_files enable row level security;
alter table perf_film_notes enable row level security;

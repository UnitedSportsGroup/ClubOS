-- ── Room history, and what staff saw when they walked through ───────────────
-- Daniel, 2026-09-21: "same thing for accommodation we need a history... say
-- when travis or someone else from club staff does inspection say once or twice
-- a month they come through take photos/videos upload them and could even label
-- each photo for what room/house it's for and same thing seeing history of like
-- [a player] was in Room 2 main house from January 10th–May 31st and it sat
-- empty from 1st June to July 15th and then [another] moved in on July 16th –
-- present." (His examples were illustrative, not real tenancies.)
--
-- 🔴 THE OCCUPANCY HISTORY NEEDS NO MIGRATION AT ALL. `housing_tenancies`
-- already carries room_id, contact_id, start_date and end_date, and already has
-- the one-room-one-tenant exclusion constraint. The gaps — "it sat empty" — are
-- DERIVED by the same @shared/occupancy-timeline the vehicles use. Adding an
-- "empty period" table would be a second source of truth that goes stale the
-- moment a tenancy date is corrected.
--
-- So all that is missing is the walk-through.

-- 🔴 NO `housing_inspections` PARENT TABLE. An inspection is a set of photos
-- taken on one day, and grouping them by `taken_on` is derived — free, always
-- correct, and it cannot drift from the photos it claims to contain. A parent
-- row would need creating before a photo could be added and deleting when the
-- last one went.
create table if not exists housing_inspection_media (
  id integer primary key generated always as identity,
  organization_id integer not null references organizations(id) on delete cascade,

  -- 🔴 The house is required, the room is not. A photo of the kitchen, the
  -- roof or the driveway belongs to the property and to no room — forcing a
  -- room would make staff file it under an arbitrary one.
  house_id integer not null references housing_houses(id) on delete cascade,
  room_id integer references housing_rooms(id) on delete set null,

  -- The day the place looked like this, and separately when it reached us.
  -- Different facts: photos taken on a Saturday walk-through and uploaded on
  -- Monday still show the Saturday.
  taken_on date not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by integer references users(id) on delete set null,
  -- Kept as text as well as a link: the person who did the inspection may
  -- leave the club, and the photograph still has to say who took it.
  uploaded_by_name text,

  storage_key text not null,
  file_name text,
  content_type text,
  size_bytes integer,
  caption text,

  created_at timestamptz not null default now(),

  -- A photograph of a day that has not happened is a typo, not a record.
  constraint housing_inspection_media_not_future
    check (taken_on <= (now() at time zone 'Pacific/Auckland')::date + 1)
);

create index if not exists housing_inspection_media_house_idx
  on housing_inspection_media (house_id, taken_on desc);
create index if not exists housing_inspection_media_room_idx
  on housing_inspection_media (room_id, taken_on desc);
create index if not exists housing_inspection_media_org_idx
  on housing_inspection_media (organization_id);

alter table housing_inspection_media enable row level security;

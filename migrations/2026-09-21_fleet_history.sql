-- ── Vehicle history, the gaps in it, and the agreement behind it ────────────
-- Daniel, 2026-09-21: "let's add vehicle history to vehicles section of clubos
-- and be able to see like for example travis had car from 20th july 2026 to
-- 12th september 2026 and then we assign new person from start to end date and
-- any dates not clicked are shown as blank, no one had car at this time and it
-- was parked at United Sports Centre or whatever address we say." And:
-- "probably also needs tab where we can see their vehicle agreement with the
-- club and easily be able to access it here as well."
--
-- 🔴 THE GAPS ARE DERIVED, NEVER STORED. A period with no holder is the ABSENCE
-- of an assignment, computed on read by `vehicleTimeline()` in
-- shared/fleet-history.ts. Storing a "nobody had it" row would be a second
-- source of truth that goes stale the moment somebody edits a date either side
-- of it, and it would need deleting and recreating on every change.

-- Where the vehicle sits when nobody holds it. Free text because it is an
-- address a human writes, not a place we model.
-- 🔴 NULL means NOBODY HAS SAID, and the timeline reads "location not
-- recorded". It must never fall back to United Sports Centre — the club has
-- vehicles that live at other addresses, and a guessed location on a gap is
-- exactly the kind of thing an insurer or the IRD would later be told was a
-- record.
alter table fleet_vehicles add column if not exists parked_location text;

-- ── One vehicle, one holder, at any moment ──────────────────────────────────
-- 🔴 `fleet_assignments_one_open_unq` already stops two people holding it RIGHT
-- NOW, but nothing stopped two CLOSED assignments overlapping — and the whole
-- history view is a lie if they can. Travis 20 Jul–12 Sep alongside somebody
-- else 1 Aug–1 Sep renders as two holders at once and makes every derived gap
-- wrong.
--
-- Same shape as the residency's one-room-one-tenant rule. A NULL returned_on is
-- an unbounded upper bound, so an open assignment excludes everything after it.
-- Verified before adding: zero overlapping pairs exist in the live table.
create extension if not exists btree_gist;

alter table fleet_assignments drop constraint if exists fleet_assignments_no_overlap;
alter table fleet_assignments add constraint fleet_assignments_no_overlap
  exclude using gist (
    vehicle_id with =,
    daterange(assigned_on, returned_on, '[]') with &&
  );

-- ── The agreement between the club and the person driving it ────────────────
-- 🔴 Its own table, not a column on the vehicle. A vehicle has MORE THAN ONE
-- agreement over its life (one per driver), each signed on its own date, and
-- the old ones are exactly what you need when an insurer asks who was
-- authorised to drive it in March.
--
-- 🔴 The file goes through the Club Drive storage adapter and is served by a
-- short-lived signed URL — never a public link. Same rule as a fine's notice:
-- an agreement carries a person's name, signature and often a licence number.
create table if not exists fleet_agreements (
  id integer primary key generated always as identity,
  organization_id integer not null references organizations(id) on delete cascade,
  vehicle_id integer not null references fleet_vehicles(id) on delete cascade,

  -- Which stint this covers, when we know. Nullable: the club has agreements
  -- signed before any of this was recorded, and losing them to a missing link
  -- would be worse than filing them against the vehicle alone.
  assignment_id integer references fleet_assignments(id) on delete set null,

  -- Who signed it. Kept as TEXT as well as a user link, because most drivers
  -- are not ClubOS logins and a name is what the paper says.
  holder_name text not null,
  holder_user_id integer references users(id) on delete set null,

  signed_on date,
  expires_on date,
  -- 🔴 No `is_current` flag. Whether an agreement is in force is a question
  -- about today's date and the stint it covers — derived, like every other
  -- status in this tab.

  storage_key text,
  file_name text,
  content_type text,
  size_bytes integer,

  notes text,
  uploaded_by integer references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fleet_agreements_expires_after_signed
    check (expires_on is null or signed_on is null or expires_on >= signed_on),
  -- A row that is neither a file nor a note records nothing at all.
  constraint fleet_agreements_has_something
    check (storage_key is not null or notes is not null)
);

create index if not exists fleet_agreements_vehicle_idx on fleet_agreements (vehicle_id, signed_on desc);
create index if not exists fleet_agreements_org_idx on fleet_agreements (organization_id);

alter table fleet_agreements enable row level security;

-- ── What condition it was in, and on what day ───────────────────────────────
-- Daniel, 2026-09-21: "add a way to add photos/videos to show state of car on
-- that day and show who took/added the photos and the timestamp and date for it
-- so we have a clear history of who had the cars and what conditions they were
-- in and how that evolved over time to track any damage that's not being
-- reported."
--
-- 🔴 TAKEN and UPLOADED ARE DIFFERENT FACTS and both are kept. A photo taken on
-- the day a van was handed back but uploaded a week later still shows the van as
-- it was on the day of the handover. Collapsing them into one timestamp would
-- put the evidence on the wrong side of a handover, which is precisely the
-- question this table exists to answer.
--
-- 🔴 IT DOES NOT STORE WHICH STINT IT BELONGS TO. Which holder was driving when
-- a photo was taken is `taken_on` read against the timeline — derived, so that
-- correcting an assignment date moves the photo to the right person instead of
-- leaving it filed under the wrong one for ever.
--
-- 🔴 No `shows_damage` flag. Whether a scratch is new is a judgement a human
-- makes by comparing two photographs, and a boolean default of false would
-- quietly assert "no damage" on every row nobody looked at.
create table if not exists fleet_condition_media (
  id integer primary key generated always as identity,
  organization_id integer not null references organizations(id) on delete cascade,
  vehicle_id integer not null references fleet_vehicles(id) on delete cascade,

  -- The day the vehicle looked like this.
  taken_on date not null,
  -- When it reached us, and who put it there. Server-stamped, never from the
  -- browser: "who added this" is the half of the record a person cannot choose.
  uploaded_at timestamptz not null default now(),
  uploaded_by integer references users(id) on delete set null,
  -- The name is kept as well as the link, because an uploader can leave the
  -- club and the photograph still has to say who took it.
  uploaded_by_name text,

  storage_key text not null,
  file_name text,
  content_type text,
  size_bytes integer,
  caption text,

  created_at timestamptz not null default now(),

  -- A photograph of a day that has not happened is a typo, not a record.
  constraint fleet_condition_media_taken_not_future
    check (taken_on <= (now() at time zone 'Pacific/Auckland')::date + 1)
);

create index if not exists fleet_condition_media_vehicle_idx
  on fleet_condition_media (vehicle_id, taken_on desc);
create index if not exists fleet_condition_media_org_idx
  on fleet_condition_media (organization_id);

alter table fleet_condition_media enable row level security;

-- ── The people allowed to drive, and the licence that says so ───────────────
-- Daniel, 2026-09-21: "add a place for us to store drivers license number,
-- expiry date and front and back photos of drivers license as well attached to
-- each driver so we have all info we need like an SOP of a car rental company
-- would do professionally to cover ourselves legally and financially."
--
-- 🔴 A LICENCE IS A FACT ABOUT A PERSON, NOT ABOUT ONE STINT. Travis driving
-- three vehicles must not mean typing his licence three times, and an expiry
-- has to raise one warning rather than one per assignment. So drivers get their
-- own table and assignments point at it.
--
-- 🔴 `fleet_assignments.driver_id` is NULLABLE with no backfill. Every
-- assignment that exists was recorded before this table did, and inventing a
-- driver row for each holder_name would merge two people who share a name and
-- split one person who was entered twice with different spellings. Staff link
-- them deliberately; until then the holder's name on the assignment still
-- stands, which is what the paper says anyway.
--
-- 🔴 This is the most sensitive data in the fleet: a licence number and
-- photographs of a licence. The tab is already super-admin-only, the images are
-- served by short-lived signed URLs and never a public link, and nothing here
-- is exposed on any public route. Worth a retention decision from Daniel —
-- a rental company holds these for the term of the hire plus a claims window,
-- not for ever.
create table if not exists fleet_drivers (
  id integer primary key generated always as identity,
  organization_id integer not null references organizations(id) on delete cascade,

  full_name text not null,
  user_id integer references users(id) on delete set null,
  email text,
  phone text,

  licence_number text,
  licence_class text,
  licence_expires_on date,
  licence_country text,
  -- 🔴 Endorsements and conditions are free text, verbatim from the card. NZTA
  -- changes its vocabulary and we are not NZTA.
  licence_conditions text,

  -- Front and back are separate images on purpose: a card photographed once is
  -- half a record, and the back carries the conditions and endorsements.
  front_storage_key text,
  front_file_name text,
  back_storage_key text,
  back_file_name text,

  -- Who checked the card against the person, and when. An unchecked licence on
  -- file is a photocopy, not a verification.
  verified_on date,
  verified_by integer references users(id) on delete set null,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One driver per licence number within an org. Two rows for one licence is
  -- how an expiry warning gets missed on the copy nobody opens.
  constraint fleet_drivers_licence_unq unique (organization_id, licence_number)
);

create index if not exists fleet_drivers_org_idx on fleet_drivers (organization_id, full_name);
alter table fleet_drivers enable row level security;

alter table fleet_assignments add column if not exists driver_id integer
  references fleet_drivers(id) on delete set null;
create index if not exists fleet_assignments_driver_idx on fleet_assignments (driver_id);

-- ── A fine belongs to a STINT, not just to a vehicle ────────────────────────
-- Daniel, 2026-09-21: "let's also figure out the best way to fit fines into
-- vehicles as you didn't understand me the first time... allow us to assign to
-- vehicle, to driver, date, photo/pdf of scanned original document of fine etc."
--
-- Most of that already exists: `fines` carries vehicle_id, person_contact_id,
-- offence_on / issued_on / due_on, amount_cents and `fine_attachments` for the
-- scanned notice. What was missing is the join to the fleet history — which
-- stint the offence fell in, and therefore which driver.
--
-- 🔴 STILL RECORDED, NEVER DERIVED. The timeline can now say who held the
-- vehicle on the offence date, and the form OFFERS that — but in NZ the
-- registered owner is liable unless liability is formally transferred, so
-- naming a driver stays a human's assertion. This column is what a human
-- confirmed, not what the dates implied.
--
-- 🔴 Deliberately NOT a second person column. `person_contact_id` already names
-- who the club holds responsible; adding a driver id beside it would be two
-- answers to one question. The assignment reaches the driver on its own.
alter table fines add column if not exists fleet_assignment_id integer
  references fleet_assignments(id) on delete set null;
create index if not exists fines_fleet_assignment_idx on fines (fleet_assignment_id);

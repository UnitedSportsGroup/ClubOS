-- United Gymnastics — the class roll.
--
-- ADDITIVE ONLY. No BEGIN/COMMIT in this file on purpose: an inner COMMIT ends
-- the transaction a --dry-run wrapper opened, and the ROLLBACK then runs in
-- autocommit against a database that has already kept the changes.
--
-- Design notes that are load-bearing, not commentary:
--
--  * A ROW MEANS SOMEBODY MARKED IT. There is no 'not marked' status, because
--    a half-taken roll must never read as "nobody came". Absence of a row is
--    absence of knowledge; `absent` is a positive statement that a child who
--    was expected did not arrive.
--
--  * NO CHECK CONSTRAINT ON `status`. The set is going to grow — the club's own
--    coaching app already marks Present / Absent / Injured — and a stale CHECK
--    is how the MFL checkout started 500ing. The app validates it.
--
--  * `session_date` IS A DATE, and the term a session belongs to is worked out
--    from that date. Storing a term here would let a session and its roll
--    disagree the first time a term's dates were corrected.

CREATE TABLE IF NOT EXISTS cugc_attendance (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- RESTRICT, never CASCADE: deleting an enrolment must not quietly erase the
  -- record that a child was in the gym that afternoon. Same reasoning as
  -- registrations.served_by_user_id.
  registration_id   INTEGER NOT NULL REFERENCES cugc_registrations(id) ON DELETE RESTRICT,

  -- The timetable lives in shared/cugc-classes.ts, so this is a free-text key
  -- rather than an FK. Deliberate: the alternative is a classes table that must
  -- be kept in step with the config that prices the website, and two sources
  -- for one timetable is the bug this whole feature exists to avoid.
  class_id          TEXT NOT NULL,
  session_date      DATE NOT NULL,

  status            TEXT NOT NULL,
  note              TEXT,

  marked_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Who took the roll is a fact about a child's afternoon; a staff member
  -- leaving must not rewrite it.
  marked_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,

  -- One mark per child per class per day. A coach tapping twice is a correction,
  -- not a second attendance.
  CONSTRAINT cugc_attendance_once UNIQUE (registration_id, class_id, session_date)
);

-- The roll's own query: one class, one day.
CREATE INDEX IF NOT EXISTS idx_cugc_attendance_session
  ON cugc_attendance (organization_id, class_id, session_date);

-- "Has this child been turning up?" across a term.
CREATE INDEX IF NOT EXISTS idx_cugc_attendance_registration
  ON cugc_attendance (registration_id, session_date DESC);

-- RLS: new tables default to OFF, and a Supabase anon key is public by design.
-- Our own connections are service-role (rolbypassrls), so this changes nothing
-- for the app and is the second wall if a key ever leaks.
ALTER TABLE cugc_attendance ENABLE ROW LEVEL SECURITY;

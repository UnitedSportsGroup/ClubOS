-- Hand-loaded mailing lists for a workspace mailer — addresses that are not
-- customers (no registration, no payment), e.g. the primary-school offices the
-- MFL Mailer promotes Ballers Youth League to (Isaac, 23 Sep 2026; list from
-- Connor's Football in Schools database).
--
-- Kept OUT of the captains/players audience on purpose: a school office must
-- never receive a "your team's fixtures" email, and a captain must never be
-- counted as a school. A list is chosen explicitly by its list_key.
-- Unsubscribes still go through email_unsubscribes (same org), so one opt-out
-- covers every audience.
CREATE TABLE IF NOT EXISTS mailer_list_contacts (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  list_key        text    NOT NULL,
  email           text    NOT NULL CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%._%'),
  name            text,
  organisation    text,
  role            text,
  phone           text,
  source          text    NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mailer_list_contacts_org_list_email_unq UNIQUE (organization_id, list_key, email)
);
ALTER TABLE mailer_list_contacts ENABLE ROW LEVEL SECURITY;

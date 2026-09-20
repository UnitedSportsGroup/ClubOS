-- Football Fest — registrations of interest.
--
-- Daniel, 2026-09-19: "remove business expo stall prices just make it click the
-- button to fill out the form and essentially register interest and make that
-- fall into … clubos CIC workspace in ethnic cup tab in new page called
-- Football Fest and have section for registrations of interest".
--
-- The festival is the weekend of 14-15 November 2026 at United Sports Centre,
-- around All Whites v India. footballfest.co.nz carried "$200 a day" for an expo
-- stall; nobody had agreed that number with the businesses it was aimed at, so
-- the page now asks for interest and a human quotes. THIS TABLE IS WHERE THAT
-- INTEREST LANDS.
--
-- 🔴 ITS OWN TABLE, not a column on ethnic_cup_registrations. That table is a
-- COMMUNITY asking to enter a football team in a tournament, and it is wired to
-- Team Pay: `teampay_entry_id`, a "Create entry & send link" button that emails
-- a manager, and a $800 fee per row. A business asking about a stall shares none
-- of that. Folding the two together would put a coffee cart one mis-click away
-- from being emailed that its team is entered in the Christchurch Ethnic Cup.
--
-- 🔴 NO CHECK CONSTRAINT ON `status` OR `kind`. Both are enum-ish and validated
-- in app code (server/football-fest-routes.ts), the same call ethnic-cup-routes
-- made: a stale CHECK is how the MFL checkout once 500'd. What IS enforced here
-- is the shape nothing can work without — a contact and a business name.
--
-- Lives under the CIC organisation, like the Ethnic Cup, and is surfaced through
-- the CIC workspace's Ethnic view rather than a workspace of its own.

CREATE TABLE IF NOT EXISTS football_fest_registrations (
  id                integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id   integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- What they are asking about. 'expo' today; 'food_truck', 'sponsor' and
  -- 'other' exist so the same form can widen without a migration.
  kind              text NOT NULL DEFAULT 'expo',

  business_name     text NOT NULL,
  contact_name      text NOT NULL,
  email             text NOT NULL,
  phone             text,

  -- "Saturday" | "Sunday" | "Both" | "Not sure" — free text, judged by a human.
  days              text,
  -- What the business actually does / what they would bring.
  about             text,
  message           text,

  source_url        text,

  -- new | contacted | confirmed | declined | archived — app-validated.
  status            text NOT NULL DEFAULT 'new',
  -- Staff notes. Never shown to the person who filled the form in.
  notes             text,

  /* 🔴 Whether the form guard held this submission, recorded at the time it was
   * taken. The guard's verdict is a fact about THAT request — the IP, the
   * timing, the token — and cannot be recomputed later. A held row is still a
   * real row a human works through; this only tells them why it is worth a
   * second look. NULL means the column did not exist yet, never "clean". */
  held              boolean,
  held_reasons      text[],

  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);

-- The board reads newest-first within one organisation.
CREATE INDEX IF NOT EXISTS football_fest_registrations_org_created_idx
  ON football_fest_registrations (organization_id, created_at DESC);

-- Staff filter by status constantly; the partial index keeps the open work cheap.
CREATE INDEX IF NOT EXISTS football_fest_registrations_open_idx
  ON football_fest_registrations (organization_id, status)
  WHERE status IN ('new', 'contacted');

/* 🔴 A blank contact is not a registration — it is a row nobody can act on.
 * NOT NULL alone would accept an empty string, which is exactly what an
 * unvalidated form posts. */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'football_fest_registrations_contactable_chk') THEN
    ALTER TABLE football_fest_registrations
      ADD CONSTRAINT football_fest_registrations_contactable_chk
      CHECK (length(btrim(business_name)) > 0
         AND length(btrim(contact_name))  > 0
         AND position('@' in email)       > 1);
  END IF;
END $$;

/* RLS on, like every other table in this database. The app connects as the
 * service role (rolbypassrls), so this changes nothing for ClubOS — it is the
 * second wall that catches a leaked anon key. */
ALTER TABLE football_fest_registrations ENABLE ROW LEVEL SECURITY;

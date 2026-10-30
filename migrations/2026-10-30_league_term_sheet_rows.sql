-- The team spreadsheets Isaac kept each term ("Term 4 Teams - Mini Football"),
-- loaded so the MFL History breakdown can tie a Shopify payment (email, no team
-- name) to a SportNinja team (name, no email). Daniel + Isaac, 30 Oct 2026:
-- "why 85 teams term 4 2025 … 52 of 85 … find the discrepancies … based on our
-- old spreadsheets".
--
-- 🔴 Team tabs only. The same workbook's Referees tab holds bank account numbers
-- and home addresses; it is never imported.
-- 🔴 Personal data (captain email/phone) lives here, never in git (CONSTITUTION 12).

CREATE TABLE IF NOT EXISTS league_term_sheet_rows (
  id              serial PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES organizations(id),
  term            text NOT NULL,              -- '2025-T4', the key league-lifetime.ts uses
  league          text NOT NULL,              -- the sheet's tab: 'Monday 5s', 'Thursday 7s' …
  team_name       text NOT NULL,
  captain         text,
  email           text,
  phone           text,
  payment_type    text,                       -- 'Full' | 'Weekly' as written, blank = not recorded
  discount        text,                       -- as written ('0.1', 'Earlybird - 10%')
  discount_type   text,
  related_team    text,
  tier            text,                       -- 'Premiership' | 'Championship' from the split below the list
  source_file     text NOT NULL,
  source_row      integer NOT NULL,
  imported_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, term, source_file, league, source_row)
);
CREATE INDEX IF NOT EXISTS league_term_sheet_rows_term ON league_term_sheet_rows (organization_id, term);
ALTER TABLE league_term_sheet_rows ENABLE ROW LEVEL SECURITY;

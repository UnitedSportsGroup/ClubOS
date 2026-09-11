-- One child stored as two contact records — recorded, never deleted.
--
-- Daniel, 2026-09-11, after the Technification Term 3 list read 64 for 60
-- children: "work through these four."
--
-- 🔴 RETIRE, NEVER DELETE. A duplicate holds real history — payments, an
-- attendance mark, a squad place — and deleting the row would either fail on a
-- RESTRICT or silently orphan it. The row stays, pointing at the record that
-- absorbed it, so the merge is auditable and reversible.
--
-- 🔴 A merged record must name WHO merged it, same doctrine as
-- served_by_user_id and refundedBy: this moves a child's payment history onto a
-- different person and somebody has to own that.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS merged_into_contact_id integer REFERENCES contacts(id);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS merged_at timestamptz;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS merged_by_user_id integer REFERENCES users(id);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS merged_note text;

DO $$ BEGIN
  -- A record cannot absorb itself.
  ALTER TABLE contacts ADD CONSTRAINT contacts_merge_not_self
    CHECK (merged_into_contact_id IS NULL OR merged_into_contact_id <> id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- Merged and "when" are one fact; neither is valid alone.
  ALTER TABLE contacts ADD CONSTRAINT contacts_merge_pair
    CHECK ((merged_into_contact_id IS NULL) = (merged_at IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS contacts_merged_into_idx
  ON contacts (merged_into_contact_id) WHERE merged_into_contact_id IS NOT NULL;

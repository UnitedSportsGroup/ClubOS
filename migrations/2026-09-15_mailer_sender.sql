-- Who sent this email.
--
-- Daniel, relaying Olga: "really important to be able for anyone to see what is
-- sent and who sent it so we have transparency and can track it."
--
-- 🔴 Before this column, "who sent this" was UNANSWERABLE, not merely unshown —
-- `email_campaigns` recorded the from ADDRESS and nothing about the person who
-- pressed send. A shared address ("CUFC Camps <noreply@cufc.co.nz>") is not a
-- person, and it is the address almost every campaign goes out under.
--
-- 🔴 ON DELETE RESTRICT, the same doctrine as served_by_user_id and refundedBy:
-- deleting a staff member must never erase who emailed 3,800 families.
ALTER TABLE email_campaigns
  ADD COLUMN IF NOT EXISTS created_by_user_id integer REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS email_campaigns_created_by_idx
  ON email_campaigns (created_by_user_id) WHERE created_by_user_id IS NOT NULL;

-- Sorting and paging a history page reads newest-first every time.
CREATE INDEX IF NOT EXISTS email_campaigns_created_at_idx ON email_campaigns (created_at DESC);

-- How we know who sent a campaign — which is not the same as who sent it.
--
-- Daniel: "is there a way to update the past ones?" No trail exists (audit_logs
-- holds 105 rows, none about the mailer), so the 24 historical senders cannot be
-- recovered — only asserted by a human who remembers.
--
-- 🔴 A NAME SOMEBODY TYPED IS A WEAKER CLAIM THAN AN AUTHENTICATED SEND, and the
-- page must not present them identically. 'authenticated' = ClubOS stamped the
-- account that pressed send. 'recorded_by_hand' = a super admin asserted it
-- afterwards, and WHO asserted it is itself recorded, because an unsourced
-- claim about who emailed 3,800 families is worth very little.
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS sender_source text;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS sender_recorded_by_user_id integer REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS sender_recorded_at timestamptz;

DO $$ BEGIN
  -- Only two ways to know, and a hand-recorded one must say who recorded it.
  ALTER TABLE email_campaigns ADD CONSTRAINT email_campaigns_sender_source_ck CHECK (
    sender_source IS NULL
    OR (sender_source = 'authenticated' AND created_by_user_id IS NOT NULL)
    OR (sender_source = 'recorded_by_hand' AND created_by_user_id IS NOT NULL
        AND sender_recorded_by_user_id IS NOT NULL AND sender_recorded_at IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Everything already stamped came from the send path, so it is authenticated.
UPDATE email_campaigns SET sender_source = 'authenticated'
 WHERE created_by_user_id IS NOT NULL AND sender_source IS NULL;

-- 2026-10-01 — a real unsubscribe on United Prints sales emails.
--
-- Dima flagged the footer: "reply 'unsubscribe'" is not an unsubscribe link,
-- and NZ's Unsolicited Electronic Messages Act 2007 s11 wants a functional
-- unsubscribe facility on every commercial message. Every email now carries
-- one; this table is what it writes, and the send route refuses an address in it.
--
-- Keyed by ADDRESS within the workspace, not by prospect: the same inbox can sit
-- on two prospect rows (a school and its PTA), and opting out of one must stop both.
-- Rows are never deleted by the app — taking an opt-out back is the person's call.
CREATE TABLE IF NOT EXISTS sales_email_optouts (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  sales_email_id integer REFERENCES sales_emails(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'link',
  opted_out_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_email_optouts_org_email_uq ON sales_email_optouts (organization_id, lower(email));
ALTER TABLE sales_email_optouts ENABLE ROW LEVEL SECURITY;

-- Sales outreach emails and what happened to each one.
-- Additive only. No BEGIN/COMMIT here — the apply script owns the transaction.
--
-- sales_emails        one row per email that Resend ACCEPTED (a failed send
--                     is never written — it never happened)
-- sales_email_events  delivered / bounced / complained / delay (Resend
--                     webhook) and opened / clicked (our pixel + redirect)
--
-- Quote submitted, order confirmed and paid are NOT stored: they are read
-- live from print_quotes / print_orders, so they can never disagree with them.

CREATE TABLE IF NOT EXISTS sales_emails (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id     integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id         integer NOT NULL REFERENCES sales_prospects(id) ON DELETE CASCADE,
  activity_id         integer REFERENCES sales_activities(id) ON DELETE SET NULL,
  token               text NOT NULL UNIQUE CHECK (length(token) >= 24),
  to_email            text NOT NULL,
  subject             text NOT NULL,
  body                text NOT NULL,
  -- The ONLY places a tracked link may send someone: /t/se/:token/:i reads
  -- links[i], so the redirect can never be pointed somewhere else.
  links               jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(links) = 'array'),
  attachments         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments) = 'array'),
  provider_message_id text UNIQUE,
  sent_by             integer REFERENCES users(id) ON DELETE SET NULL,
  sent_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_emails_prospect_idx ON sales_emails (prospect_id, sent_at);
CREATE INDEX IF NOT EXISTS sales_emails_org_idx ON sales_emails (organization_id, sent_at);
CREATE INDEX IF NOT EXISTS sales_emails_to_idx ON sales_emails (lower(to_email));

CREATE TABLE IF NOT EXISTS sales_email_events (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sales_email_id     integer NOT NULL REFERENCES sales_emails(id) ON DELETE CASCADE,
  type               text NOT NULL CHECK (type IN ('delivered','bounced','complained','delivery_delayed','opened','clicked')),
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  link_index         integer,
  url                text,
  user_agent         text,
  -- Resend retries a webhook; its event id makes a retry a no-op.
  provider_event_id  text UNIQUE,
  CHECK ((type = 'clicked') = (link_index IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sales_email_events_email_idx ON sales_email_events (sales_email_id, occurred_at);

ALTER TABLE sales_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_email_events ENABLE ROW LEVEL SECURITY;

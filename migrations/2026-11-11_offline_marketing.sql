-- Marketing → Signage · Billboards · Traditional Media, and Branding.
--
-- offline_marketing_items  one row per sign we put up, billboard booking,
--                          media outlet, or piece of coverage / paid placement.
--                          `channel` says which (see shared/offline-marketing.ts);
--                          kind and status are validated there, not by a CHECK
--                          (a stale enum CHECK is how the MFL checkout 500'd).
-- brand_workboards         one row per brand: the working notes, links and
--                          to-do list beside its brand guidelines.
--
-- 🔴 A blank cost, audience or date is NULL and drawn "—", never zero.
-- 🔴 Removed rows are archived, never deleted.
CREATE TABLE IF NOT EXISTS offline_marketing_items (
  id            serial PRIMARY KEY,
  channel       text NOT NULL,
  brand         text,
  title         text NOT NULL,
  kind          text,
  -- Who makes or runs it: the printer, the billboard company, the outlet.
  supplier      text,
  location      text,
  size          text,
  quantity      integer,
  status        text,
  starts_on     date,
  ends_on       date,
  cost_cents    integer CHECK (cost_cents IS NULL OR cost_cents >= 0),
  -- The audience figure the supplier or outlet gave. Typed in, never worked out.
  audience      integer CHECK (audience IS NULL OR audience >= 0),
  link_url      text,
  contact_name  text,
  contact_email text,
  contact_phone text,
  notes         text,
  created_by    integer REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz
);
CREATE INDEX IF NOT EXISTS offline_marketing_items_channel_idx ON offline_marketing_items (channel, archived_at);

CREATE TABLE IF NOT EXISTS brand_workboards (
  brand      text PRIMARY KEY,
  notes      text NOT NULL DEFAULT '',
  -- [{ "label": "...", "url": "https://..." }]
  links      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ "id": "...", "text": "...", "done": false }]
  todos      jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE offline_marketing_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_workboards        ENABLE ROW LEVEL SECURITY;

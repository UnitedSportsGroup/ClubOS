-- Campaigns — plan a marketing campaign, set its goal, and watch the goal move
-- from ClubOS's own sales.
--
-- Daniel, 2026-11-10: "create a campaign … set the targets, both in revenue and
-- sign-up numbers … see that updating and tracking live … map out the tasks and
-- the timeline … add channels … track the conversions … can we track the sales
-- we get organically … an A/B split test into this flow."
--
-- United Sports Group → Marketing → Campaigns (/admin/campaigns).
--
-- 🔴 NOTHING here stores a result. Bookings, revenue, spend, opens and visitors
-- are read live from registrations, marketing_daily, email_campaign_recipients
-- and analytics_events every time the page opens (server/campaigns/). These
-- tables hold only the PLAN: the goal, the dates, what is linked, the tasks.
-- The two `manual_*` pairs exist for things ClubOS cannot see (a flyer drop, a
-- radio spot) and are shown as typed in.
--
-- Not `mkt_campaigns` (MarketingOS email/SMS sends) and not `email_campaigns`
-- (the Mailer): the prefix is `cmp_`.
--
-- Applied and proven by script/apply-campaigns.ts (dry run by default).
-- No BEGIN/COMMIT here: the applier owns the transaction.

CREATE TABLE IF NOT EXISTS cmp_campaigns (
  id                 serial PRIMARY KEY,
  name               text NOT NULL CHECK (btrim(name) <> ''),
  -- A key from SOCIAL_BRANDS (shared/social.ts). Validated there, not by a CHECK.
  brand              text,
  -- planning · live · paused · done. Whether it is LATE or ON PACE is derived.
  status             text NOT NULL DEFAULT 'planning',
  -- The selling window: sales between these days count toward the goal.
  starts_on          date,
  ends_on            date,
  -- The thing being sold (the camp's own days). The timeline works back from it.
  event_starts_on    date,
  event_ends_on      date,
  -- NULL = no goal set. Never defaulted: a goal of 0 is not "no goal".
  goal_revenue_cents bigint CHECK (goal_revenue_cents IS NULL OR goal_revenue_cents >= 0),
  goal_signups       integer CHECK (goal_signups IS NULL OR goal_signups >= 0),
  budget_cents       bigint CHECK (budget_cents IS NULL OR budget_cents >= 0),
  -- What ClubOS sells for this campaign. Sales of these programmes are the result.
  program_ids        integer[] NOT NULL DEFAULT '{}',
  -- Only for a campaign with nothing linked: results a person typed in.
  manual_signups       integer CHECK (manual_signups IS NULL OR manual_signups >= 0),
  manual_revenue_cents bigint CHECK (manual_revenue_cents IS NULL OR manual_revenue_cents >= 0),
  summary            text,
  owner_user_id      integer REFERENCES users(id) ON DELETE SET NULL,
  created_by         integer REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Archived, never deleted: a finished campaign is the record of what worked.
  archived_at        timestamptz,
  CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
  CHECK (event_starts_on IS NULL OR event_ends_on IS NULL OR event_ends_on >= event_starts_on)
);

-- A channel or activation inside a campaign: Meta ads, an email sequence, an
-- early-bird offer, a shoot. What it is LINKED to decides what can be measured.
CREATE TABLE IF NOT EXISTS cmp_channels (
  id                 serial PRIMARY KEY,
  campaign_id        integer NOT NULL REFERENCES cmp_campaigns(id) ON DELETE CASCADE,
  -- meta_ads · google_ads · tiktok_ads · email · sms · whatsapp · social ·
  -- offer · website · print · partner · creative · other (shared/campaigns.ts)
  kind               text NOT NULL,
  name               text NOT NULL CHECK (btrim(name) <> ''),
  -- planned · live · done · dropped
  status             text NOT NULL DEFAULT 'planned',
  starts_on          date,
  ends_on            date,
  budget_cents       bigint CHECK (budget_cents IS NULL OR budget_cents >= 0),
  -- Links. Each is optional; an unlinked channel shows its plan and no numbers.
  meta_campaign_ids  text[] NOT NULL DEFAULT '{}',
  email_campaign_ids integer[] NOT NULL DEFAULT '{}',
  utm_campaign       text,
  discount_code      text,
  -- Spend ClubOS cannot see (Google Ads until connected, a print run).
  manual_spend_cents bigint CHECK (manual_spend_cents IS NULL OR manual_spend_cents >= 0),
  notes              text,
  position           integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS cmp_channels_campaign_idx ON cmp_channels (campaign_id);

-- The work-back plan. Overdue is derived (not done and due before today).
CREATE TABLE IF NOT EXISTS cmp_tasks (
  id            serial PRIMARY KEY,
  campaign_id   integer NOT NULL REFERENCES cmp_campaigns(id) ON DELETE CASCADE,
  channel_id    integer REFERENCES cmp_channels(id) ON DELETE SET NULL,
  title         text NOT NULL CHECK (btrim(title) <> ''),
  -- task · milestone · shoot · edit · launch · review
  kind          text NOT NULL DEFAULT 'task',
  due_on        date,
  done_at       timestamptz,
  done_by       integer REFERENCES users(id) ON DELETE SET NULL,
  owner_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  notes         text,
  position      integer NOT NULL DEFAULT 0,
  created_by    integer REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- "Who" without "when" is refused. ("When" survives the person's account being removed.)
  CHECK ((done_at IS NULL) = (done_by IS NULL) OR done_by IS NULL)
);
CREATE INDEX IF NOT EXISTS cmp_tasks_campaign_idx ON cmp_tasks (campaign_id, due_on);

-- A split test: one thing changed, two or more versions.
CREATE TABLE IF NOT EXISTS cmp_tests (
  id          serial PRIMARY KEY,
  campaign_id integer NOT NULL REFERENCES cmp_campaigns(id) ON DELETE CASCADE,
  channel_id  integer REFERENCES cmp_channels(id) ON DELETE SET NULL,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  -- The ONE thing that differs between versions (headline, picture, offer…).
  variable    text,
  hypothesis  text,
  -- planned · running · done
  status      text NOT NULL DEFAULT 'planned',
  starts_on   date,
  ends_on     date,
  -- A person's call, recorded with their reason. Never set automatically.
  winner_variant_id integer,
  conclusion  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cmp_tests_campaign_idx ON cmp_tests (campaign_id);

CREATE TABLE IF NOT EXISTS cmp_test_variants (
  id           serial PRIMARY KEY,
  test_id      integer NOT NULL REFERENCES cmp_tests(id) ON DELETE CASCADE,
  label        text NOT NULL CHECK (btrim(label) <> ''),
  description  text,
  -- How ClubOS tells this version apart: the utm_content on its link, and/or
  -- the page path it lands on. Either may be blank; both blank = typed in.
  utm_content  text,
  landing_path text,
  manual_visitors    integer CHECK (manual_visitors IS NULL OR manual_visitors >= 0),
  manual_conversions integer CHECK (manual_conversions IS NULL OR manual_conversions >= 0),
  position     integer NOT NULL DEFAULT 0,
  UNIQUE (test_id, label)
);

ALTER TABLE cmp_campaigns     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cmp_channels      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cmp_tasks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cmp_tests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cmp_test_variants ENABLE ROW LEVEL SECURITY;

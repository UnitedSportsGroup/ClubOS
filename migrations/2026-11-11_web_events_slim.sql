-- Website analytics — a narrow, time-ordered copy of the tracker rows the
-- Website analytics page reads.
--
-- analytics_events is 400 MB with page views scattered among clicks and bot
-- rows: reading a month of visits touched ~500 MB of pages and took 6–50 s
-- whenever they were not already in memory. This table holds only the columns
-- the report uses, for non-bot rows of the six event kinds it reads, with the
-- website name already worked out. It is a COPY: analytics_events stays the
-- record, and this can be emptied and refilled at any time
-- (server/marketing-hub/web-slim.ts).
CREATE TABLE IF NOT EXISTS web_events_slim (
  id           bigint PRIMARY KEY,           -- analytics_events.id
  ts           timestamp NOT NULL,           -- UTC, as in analytics_events
  day          date NOT NULL,                -- the New Zealand day
  kind         text NOT NULL,                -- page_view · time_on_page · scroll_depth · bounce · session_start · cta_click
  host         text,                         -- page views only; NULL = the address named no website
  path         text,
  visitor_id   text,
  session_id   text,
  channel      text,
  device       text,
  ref_host     text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  -- Behaviour events, kept as the tracker wrote them (text): seconds on the
  -- page, furthest scroll %, first-ever visit, and a pressed button's words/link.
  s            text,
  m            text,
  n            text,
  txt          text,
  href         text
);
CREATE INDEX IF NOT EXISTS web_events_slim_ts_idx ON web_events_slim (ts);
CREATE INDEX IF NOT EXISTS web_events_slim_pv_ts_idx ON web_events_slim (ts) WHERE kind = 'page_view';
CREATE INDEX IF NOT EXISTS web_events_slim_visitor_idx ON web_events_slim (visitor_id);
ALTER TABLE web_events_slim ENABLE ROW LEVEL SECURITY;

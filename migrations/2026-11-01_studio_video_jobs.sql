-- Content Studio video editor (2026-11-01).
--
-- Daniel: "Let's also build the video editor … that level of output through
-- our content studio." A video piece holds the clips staff uploaded and, once
-- made, the EDIT (an edl in its doc) and the finished file. The work is done
-- by a worker (the editing kit's renderer); this table is the queue between
-- them. Additive and idempotent.
--
--   kind   plan   = transcribe, plan the edit with Claude, render, look, fix
--          render = render the stored edit as it is (a person changed words)
--   status queued → running → done | failed. ONE live job per piece: a
--          second press while one is queued or running is refused by Postgres.

CREATE TABLE IF NOT EXISTS studio_video_jobs (
  id                    integer      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  piece_id              integer      NOT NULL REFERENCES studio_pieces(id) ON DELETE CASCADE,
  kind                  text         NOT NULL CHECK (kind IN ('plan','render')),
  status                text         NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  stage                 text         CHECK (stage IS NULL OR length(stage) <= 200),
  requested_by_user_id  integer      REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  claimed_at            timestamptz,
  finished_at           timestamptz,
  error                 text         CHECK (error IS NULL OR length(error) <= 1000),
  cost_usd_cents        numeric(10,2) CHECK (cost_usd_cents IS NULL OR cost_usd_cents >= 0),
  -- A finished job says when; a running one says when it was claimed.
  CHECK ((status IN ('done','failed')) = (finished_at IS NOT NULL)),
  CHECK (status = 'queued' OR claimed_at IS NOT NULL),
  -- A failure says why.
  CHECK (status <> 'failed' OR error IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_video_jobs_one_live ON studio_video_jobs (piece_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS studio_video_jobs_queue ON studio_video_jobs (id) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS studio_video_jobs_piece ON studio_video_jobs (piece_id, id DESC);
ALTER TABLE studio_video_jobs ENABLE ROW LEVEL SECURITY;

-- 2026-10-01 (later) — artwork of ANY size, and asking for it after the fact.
--
-- Daniel: "the image files not coming through is a disaster… we need a way of
-- taking them even if it's a large file." Storage refuses one object over 50MB
-- (a project setting we can't change from here), so a big file is split in the
-- customer's browser into ≤45MB parts that go STRAIGHT to storage — never
-- through our server — and are streamed back as one file on download.
--
--   parts   — 1 for a normal file; N for a split one (keys `${storage_key}/${i}`)
--   status  — 'uploading' until every part is confirmed, then 'ready'. Only
--             'ready' files are shown, so a half-sent file never looks complete.
--   chunked — storage_key is a folder of parts rather than one object.
ALTER TABLE print_quote_files ADD COLUMN IF NOT EXISTS parts integer NOT NULL DEFAULT 1 CHECK (parts >= 1);
ALTER TABLE print_quote_files ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready' CHECK (status IN ('uploading','ready'));
ALTER TABLE print_quote_files ADD COLUMN IF NOT EXISTS chunked boolean NOT NULL DEFAULT false;
-- When Dima last asked this customer for their artwork (the "Ask for artwork" button).
ALTER TABLE print_quotes ADD COLUMN IF NOT EXISTS artwork_requested_at timestamptz;

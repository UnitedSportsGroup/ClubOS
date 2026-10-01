-- 2026-10-01 — the customer's artwork actually reaches ClubOS.
--
-- Dima (voice note, 28 Sep): "people upload a file on the site when they ask
-- for a quote, but in ClubOS we can't see it — it says ask them for it. Either
-- remove the feature or the file has to be inside ClubOS." Until today the
-- Instant Quote form sent only the file NAME.
--
-- One row per uploaded file. The bytes live in Club Drive's storage adapter
-- (private bucket, short-lived signed URLs) — never a public link, never base64
-- in a row. A quote can carry several files per line (front + back artwork).
--
-- 🔴 item_id is SET NULL, quote_id CASCADE: a file belongs to the quote; a line
-- being edited away must not orphan or destroy the customer's artwork.
CREATE TABLE IF NOT EXISTS print_quote_files (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  quote_id integer NOT NULL REFERENCES print_quotes(id) ON DELETE CASCADE,
  item_id integer REFERENCES print_quote_items(id) ON DELETE SET NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  storage_key text NOT NULL,
  storage_backend text NOT NULL,
  checksum text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS print_quote_files_quote_idx ON print_quote_files (quote_id);
CREATE INDEX IF NOT EXISTS print_quote_files_item_idx ON print_quote_files (item_id);
ALTER TABLE print_quote_files ENABLE ROW LEVEL SECURITY;

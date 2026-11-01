-- Content Studio: carousels and any size (2026-11-01).
--
-- Daniel: "create carousels, so it's a cohesive slide, all in the same kind of
-- theme and idea" and "copy-and-resize … automatically resize it for a story,
-- a 4:5 post … go-to-media billboard campaigns … all the different billboard
-- ratios". Additive; nothing existing changes meaning.
--
--   kind 'carousel'  — several slides of one design, one size.
--   size             — the four named sizes, or any 'WIDTHxHEIGHT' in pixels
--                      (a billboard placement's own spec, typed in).
--   studio_renders.slide — which slide a render is (0 for a single graphic).

ALTER TABLE studio_pieces DROP CONSTRAINT IF EXISTS studio_pieces_kind_check;
ALTER TABLE studio_pieces ADD CONSTRAINT studio_pieces_kind_check CHECK (kind IN ('graphic','page','video','carousel'));
ALTER TABLE studio_pieces DROP CONSTRAINT IF EXISTS studio_pieces_size_check;
ALTER TABLE studio_pieces ADD CONSTRAINT studio_pieces_size_check CHECK (size IS NULL OR size IN ('square','portrait','story','landscape') OR size ~ '^[1-9][0-9]{2,3}x[1-9][0-9]{2,3}$');
ALTER TABLE studio_pieces DROP CONSTRAINT IF EXISTS studio_pieces_check3;
ALTER TABLE studio_pieces ADD CONSTRAINT studio_pieces_check3 CHECK ((kind IN ('graphic','carousel')) = (size IS NOT NULL));
ALTER TABLE studio_generations DROP CONSTRAINT IF EXISTS studio_generations_kind_check;
ALTER TABLE studio_generations ADD CONSTRAINT studio_generations_kind_check CHECK (kind IN ('graphic','page','video','carousel'));
ALTER TABLE studio_renders ADD COLUMN IF NOT EXISTS slide smallint NOT NULL DEFAULT 0;
ALTER TABLE studio_renders DROP CONSTRAINT IF EXISTS studio_renders_slide_check;
ALTER TABLE studio_renders ADD CONSTRAINT studio_renders_slide_check CHECK (slide BETWEEN 0 AND 19);

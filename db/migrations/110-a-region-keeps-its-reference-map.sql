-- 110-a-region-keeps-its-reference-map.sql
--
-- The reference map an admin calibrates under a region in the Create
-- Subregions dialog is kept in the database (#595, ADR-0113), where it lived
-- in the admin's browser before: cleared site data, another machine or a
-- second admin lost it. One per region, raster only, at most 10 MB.
--
-- 01-schema.sql declares the same table for a fresh database.
-- Re-runnable: the table is created where it is missing.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS region_image_overlays (
    region_id INTEGER PRIMARY KEY REFERENCES regions(id) ON DELETE CASCADE,
    image BYTEA NOT NULL CHECK (octet_length(image) BETWEEN 1 AND 10485760),
    image_type TEXT NOT NULL CHECK (image_type IN ('image/png', 'image/jpeg', 'image/webp')),
    image_name TEXT NOT NULL CHECK (length(image_name) BETWEEN 1 AND 255),
    image_width INTEGER NOT NULL CHECK (image_width > 0),
    image_height INTEGER NOT NULL CHECK (image_height > 0),
    corners JSONB NOT NULL CHECK (jsonb_typeof(corners) = 'array' AND jsonb_array_length(corners) = 4),
    opacity REAL NOT NULL CHECK (opacity >= 0 AND opacity <= 1),
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE region_image_overlays IS 'The reference map an admin calibrates under a region in the Create Subregions dialog (#595, ADR-0113): one per region, admin-only working material, never shown to a visitor.';
COMMENT ON COLUMN region_image_overlays.image IS 'The image''s bytes: PNG, JPEG or WebP (image_type), checked by their signature on write, at most 10 MB.';
COMMENT ON COLUMN region_image_overlays.corners IS 'Where the image''s corners lie on the map, as four [lng, lat] pairs in MapLibre''s image-source order: top left, top right, bottom right, bottom left.';
COMMENT ON COLUMN region_image_overlays.opacity IS 'How opaque the image is drawn over the map, 0 to 1.';

COMMIT;

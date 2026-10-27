-- 183-a-region-map-image-carries-its-credit.sql
--
-- A region's map image is a Commons file, most often CC BY-SA and drawn by a
-- Wikivoyage mapmaker, and the admin's import and editor dialogs draw it. Every
-- picture shown carries its credit (ADR-0043), so each candidate keeps the
-- credit Commons' extmetadata gives its file, in the shape an experience's
-- `metadata.imageCredit` has (#2087).
--
-- Null means the credit has not been read yet: the dialog that first draws the
-- file asks Commons and keeps the answer. Existing rows start that way, since a
-- migration does not call Commons.
--
-- A region's reference map in the Create Subregions dialog is kept as bytes,
-- and is most often that same map loaded with one click, so it keeps the
-- address it was loaded from: its credit is that file's. Null for an image an
-- admin uploaded, and for every overlay saved before this column existed.
--
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE workbench.region_map_images
    ADD COLUMN IF NOT EXISTS image_credit JSONB;

COMMENT ON COLUMN workbench.region_map_images.image_credit IS
    'Who the file is credited to, from Commons extmetadata (author, license, licenseUrl, detailsUrl); null until a dialog that draws it has asked';

ALTER TABLE region_image_overlays
    ADD COLUMN IF NOT EXISTS source_url TEXT CHECK (source_url IS NULL OR source_url ~ '^https?://');

COMMENT ON COLUMN region_image_overlays.source_url IS
    'The region map address the image was loaded from, whose credit it carries; null for an uploaded file';

COMMIT;

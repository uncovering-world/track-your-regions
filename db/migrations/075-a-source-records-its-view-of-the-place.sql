-- 075-a-source-records-its-view-of-the-place.sql
--
-- Each source's view of a place is recorded on its membership (#1246,
-- ADR-0084): the name, description, picture and coordinate the source last
-- reported. Where two sources' views of a field differ, a run leaves the
-- place's value alone, so neither source overwrites the other.
--
-- The views are filled from the place for the membership of the source that
-- brought it, which until a merge (#755) is the place's one membership and
-- the source whose run last wrote those columns. Any other membership -- a
-- curator's manual one, which no run brings -- reports nothing, and a view
-- left NULL never contradicts another. Each source's next run rewrites its own.
--
-- Order-independent with 01-schema.sql, which declares the same columns.
-- Re-runnable: the columns are added if absent, and the backfill fills only a
-- view no run has written yet.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS reported_name TEXT;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS reported_description TEXT;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS reported_image_url TEXT;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS reported_location geometry(Point, 4326);

UPDATE experience_kind_memberships m
   SET reported_name = e.name,
       reported_description = e.description,
       reported_image_url = e.image_url,
       reported_location = e.location
  FROM experiences e
 WHERE e.id = m.experience_id
   AND m.source_id = e.source_id
   AND m.reported_name IS NULL
   AND m.reported_location IS NULL;

COMMENT ON COLUMN experience_kind_memberships.reported_name IS 'The name this membership''s source last reported for the place, tidied as the place stores a name. With the three columns beside it, the source''s view of the place (ADR-0084): written by every run of the source whatever the place keeps, and read to tell whether the sources of one place disagree (#1246). NULL where the source reports nothing, which contradicts no other view.';
COMMENT ON COLUMN experience_kind_memberships.reported_description IS 'The description this membership''s source last reported for the place (its view, #1246).';
COMMENT ON COLUMN experience_kind_memberships.reported_image_url IS 'The picture this membership''s source last reported for the place, after the run''s picture rule (its view, #1246). Its credit is fetched when a curator chooses it, as for any picture a curator names.';
COMMENT ON COLUMN experience_kind_memberships.reported_location IS 'The coordinate this membership''s source last reported for the place (its view, #1246). Two views within ten metres agree (ADR-0027).';

COMMIT;

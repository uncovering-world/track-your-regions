-- 176-a-twin-is-named-apart-across-the-catalogue.sql
--
-- A place whose label another place of the catalogue carries is named apart
-- by the hint its description gives, "Soviet War Memorial (Berlin's Treptower
-- Park)", and whether it is decided over the whole catalogue rather than over
-- one run's batch (#1967). Over the batch, two kinds of one item reached two
-- answers: Monuments & memorials admits both Soviet War Memorials of Berlin
-- and named them apart, Public art refuses the Tiergarten one and did not, and
-- each run renamed the Treptower Park place back.
--
-- Deciding over the catalogue compares the labels the sources sent, before
-- any suffix, so each membership records its own (reported_label). It is
-- filled from what the source last reported: the suffix only Public art,
-- Monuments & memorials, Towers, Bridges & engineering marvels and Squares &
-- streets (sources 3, 6, 7, 8, 9) wrote is taken off where the name ends in
-- exactly the hint its subtitle gives; every other name is its label already.
-- A run of the source writes the column again, whatever this file derived.
--
-- Re-runnable: the column and its index are added if missing, and only an
-- empty column filled.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS reported_label TEXT;
COMMENT ON COLUMN experience_kind_memberships.reported_label IS 'The label this membership''s source last sent for the place, before a twin''s suffix (#1967): a label another standing place of the catalogue carries is named apart, so every source of one item names it alike.';
CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_label ON experience_kind_memberships(reported_label);

WITH hinted AS (
  SELECT m.id, m.source_id, m.reported_name,
         btrim(substring(m.reported_subtitle FROM '(?i)\min\s+([^,.\n]+)')) AS hint
    FROM experience_kind_memberships m
   WHERE m.reported_label IS NULL AND m.reported_name IS NOT NULL
)
UPDATE experience_kind_memberships m
   SET reported_label = CASE
         WHEN h.source_id IN (3, 6, 7, 8, 9) AND h.hint <> ''
              AND right(h.reported_name, length(h.hint) + 3) = ' (' || h.hint || ')'
         THEN left(h.reported_name, length(h.reported_name) - length(h.hint) - 3)
         ELSE h.reported_name END
  FROM hinted h
 WHERE m.id = h.id;

COMMIT;

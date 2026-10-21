-- 143-a-place-holds-the-subtitle-its-sources-agree-on.sql
--
-- A subtitle arriving where the place holds none passes the gate (#1795,
-- ADR-0133). The UNESCO run writes UNESCO's paragraph as the description and
-- no subtitle, so a World Heritage site it made held none, and every run of a
-- gated Wikidata kind that also admits it held Wikidata's line: Ajanta Caves,
-- under Places of worship and Archaeology, got the same card on every run.
-- This file writes the line onto the places the runs before it held it from,
-- and closes the cards that held nothing else.
--
-- The line is one an admitted membership reports (reported_subtitle), as the
-- run of an admitted kind writes it. It is contested as the run contests it,
-- by every view that stands, admitted or not (viewStandsSql, sourceViews.ts):
-- a place whose standing views report two different lines is left alone, and
-- which of them it shows is a curator's choice between two sources' views. A
-- withdrawn membership says nothing about the place any more. A subtitle a
-- curator claimed is never written.
--
-- A membership's held pointer is cleared where the run it names held nothing
-- but the subtitle, and proposed the line the place now holds: the source's
-- next run would clear it the same way, finding nothing to propose. A card
-- that also holds something else keeps its pointer and loses its subtitle row
-- with that next run.
--
-- Re-runnable: a place that holds a subtitle is not written again, and a
-- cleared pointer is not matched twice.

\set ON_ERROR_STOP on

BEGIN;

WITH reported AS (
  SELECT m.experience_id, min(m.reported_subtitle) AS line
    FROM experience_kind_memberships m
   WHERE COALESCE(m.reported_subtitle, '') <> ''
     AND m.source_membership = 'present'
     AND m.missing_since IS NULL
   GROUP BY m.experience_id
  HAVING count(DISTINCT m.reported_subtitle) = 1
     AND bool_or(m.admission = 'admitted')
)
UPDATE experiences e
   SET subtitle = r.line,
       updated_at = NOW()
  FROM reported r
 WHERE e.id = r.experience_id
   AND e.merged_into_id IS NULL
   AND COALESCE(e.subtitle, '') = ''
   AND NOT COALESCE(e.curated_fields ? 'subtitle', FALSE)
RETURNING e.id AS written_place, e.name, e.subtitle;

UPDATE experience_kind_memberships m
   SET pending_change_sync_log_id = NULL,
       updated_at = NOW()
  FROM experience_sync_changes c, experiences e
 WHERE c.sync_log_id = m.pending_change_sync_log_id
   AND c.experience_id = m.experience_id
   AND e.id = m.experience_id
   AND jsonb_typeof(c.changed_fields) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(c.changed_fields) f
                WHERE f->>'field' = 'subtitle' AND (f->>'held')::boolean
                  AND f->>'new' = e.subtitle)
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.changed_fields) f
                    WHERE f->>'field' <> 'subtitle' AND COALESCE((f->>'held')::boolean, FALSE))
   AND NOT COALESCE(jsonb_path_exists(c.contents, 'strict $.**.held ? (@ == true)'), FALSE)
RETURNING m.experience_id AS closed_card, m.source_id, c.sync_log_id;

COMMIT;

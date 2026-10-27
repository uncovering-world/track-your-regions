-- 190: what the World Heritage list says of a part is its record's (ADR-0156 decision 2, #1426)
--
-- UNESCO's view of a serial site's component, the name and coordinate its
-- list gives it, was read off the component's point: the part's own, or after
-- a merge the point the merge folded into the place it kept (the Temple of
-- Karnak's, folded into the Karnak Temple Complex). It is how a source knows
-- the part, so it moves onto the part's record in World Heritage components
-- (`reported_name`, `reported_location` of its kind 10 membership), which the
-- site's run writes from its list from now on and a merge carries with the
-- relation. A record whose component's point stands no longer, the list
-- having dropped it, holds no view, as the read held none.
--
-- The sources card names a view by the row it is on, so a curator's choice
-- and a suggestion about a part that named the component's view by the site's
-- membership name it by the part's record now. Only the part's own rows are
-- re-keyed: the site's membership names no other view on a part.
--
-- A record that changes owner, its relation gone and a part of two sites keyed
-- to the one that remains (refresh_component_record), drops the view the
-- previous site's list wrote: it is the new site's to write, and its next run
-- does, reading the cleared record as drift.
--
-- Re-runnable: a record that holds its view already is left, and a choice or
-- a suggestion already re-keyed names no site membership.

\set ON_ERROR_STOP on

BEGIN;

WITH RECURSIVE folded (id, kept_id, external_ref) AS (
  SELECT f.id, kept.id, f.external_ref
    FROM experience_locations kept
    JOIN experience_locations f ON f.merged_into_id = kept.id
   WHERE kept.merged_into_id IS NULL
     AND kept.experience_id IN (SELECT part_id FROM experience_parts WHERE reason = 'component')
  UNION
  SELECT f.id, folded.kept_id, f.external_ref FROM folded
    JOIN experience_locations f ON f.merged_into_id = folded.id
),
view AS (
  SELECT DISTINCT ON (rec.id) rec.id, c.name, c.location
    FROM experience_kind_memberships rec
    JOIN experience_parts p ON p.part_id = rec.experience_id AND rec.external_id = 'component:' || p.id
    JOIN experience_locations c ON c.external_ref = p.external_ref
     AND c.missing_since IS NULL AND c.source_membership = 'present'
     AND ((c.experience_id = p.part_id AND c.merged_into_id IS NULL)
          OR c.id IN (SELECT folded.id FROM folded
                        JOIN experience_locations kept ON kept.id = folded.kept_id
                       WHERE kept.experience_id = p.part_id
                         AND folded.external_ref IS DISTINCT FROM kept.external_ref))
   WHERE rec.kind_id = 10
   ORDER BY rec.id, c.merged_into_id IS NOT NULL, c.id
)
UPDATE experience_kind_memberships rec
   SET reported_name = view.name, reported_location = view.location, updated_at = NOW()
  FROM view
 WHERE rec.id = view.id
   AND rec.reported_name IS NULL AND rec.reported_location IS NULL;

-- The site's membership, and the part's record, of each part.
CREATE TEMP TABLE part_view_keys ON COMMIT DROP AS
SELECT rec.experience_id AS part_id, p.membership_id AS site_key, rec.id AS record_key
  FROM experience_kind_memberships rec
  JOIN experience_parts p ON p.part_id = rec.experience_id AND rec.external_id = 'component:' || p.id
 WHERE rec.kind_id = 10 AND p.membership_id IS NOT NULL;

UPDATE experience_view_choices c
   SET chosen_membership_id = CASE WHEN c.chosen_membership_id = k.site_key THEN k.record_key
                                   ELSE c.chosen_membership_id END,
       views = (c.views - k.site_key::text) || jsonb_build_object(k.record_key::text, c.views -> k.site_key::text)
  FROM part_view_keys k
 WHERE c.experience_id = k.part_id AND c.views ? k.site_key::text;

UPDATE experience_view_suggestions s
   SET suggested_membership_id = CASE WHEN s.suggested_membership_id = k.site_key THEN k.record_key
                                      ELSE s.suggested_membership_id END,
       views = (s.views - k.site_key::text) || jsonb_build_object(k.record_key::text, s.views -> k.site_key::text),
       probabilities = CASE WHEN s.probabilities ? ('view' || k.site_key)
                            THEN (s.probabilities - ('view' || k.site_key))
                                 || jsonb_build_object('view' || k.record_key, s.probabilities -> ('view' || k.site_key))
                            ELSE s.probabilities END
  FROM part_view_keys k
 WHERE s.experience_id = k.part_id AND s.views ? k.site_key::text;

CREATE OR REPLACE FUNCTION refresh_component_record(place INTEGER) RETURNS void AS $$
DECLARE
  owner INTEGER;
BEGIN
  SELECT min(p.id) INTO owner FROM experience_parts p WHERE p.part_id = place AND p.reason = 'component';
  IF owner IS NULL THEN
    DELETE FROM experience_kind_memberships WHERE experience_id = place AND kind_id = 10;
  ELSE
    UPDATE experience_kind_memberships
       SET external_id = 'component:' || owner, reported_name = NULL, reported_location = NULL, updated_at = NOW()
     WHERE experience_id = place AND kind_id = 10 AND external_id <> 'component:' || owner;
    INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id)
    VALUES (place, 10, 10, 'component:' || owner)
    ON CONFLICT (experience_id, kind_id) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMIT;

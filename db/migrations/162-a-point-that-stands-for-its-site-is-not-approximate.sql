-- 162-a-point-that-stands-for-its-site-is-not-approximate.sql
--
-- A World Heritage point that stands for its whole site is not approximate
-- (#1903). The mark (#1853) asks a curator where a roughly placed component
-- really stands, and the minute a point is given to says nothing about where a
-- site the size of Virunga or the Okavango Delta stands: its *Where is it?*
-- card offered Virunga's own protected area, read as a point 145 km off. On
-- the development catalogue on 2026-10-23, 63 open approximate points stood
-- for their whole site, 41 of them for one ten times their minute or more.
--
-- A point stands for its whole site as stands_for_whole_site() reads it
-- (migration 161): the only standing point of its site, one carrying the
-- site's own reference, or one named like the site. Only a site of an area
-- that outsizes the point's minute ten times or more is left unasked
-- (outsizes_its_minute(), declared here): the Longmen Grottoes (331 ha), whose
-- point stands 10 km from the caves, Sigiriya and Grimeton stay asked. The
-- World Heritage run no longer marks such a point (writeExperienceLocations);
-- this file clears the mark it left, and the hints the Find component items
-- pass kept for it. A point a curator placed keeps its claim, and the mark
-- beneath it, which no reader is asked about, is cleared too. It also drops the hints of
-- settlements and boundaries the pass kept (138 and 17 of 316 namesakes).
--
-- Re-runnable: a cleared point matches nothing.

\set ON_ERROR_STOP on

BEGIN;

-- Whether a site of `area_hectares` outsizes the cell of a point given to the
-- whole minute at `latitude` so far that the point stands for it well enough
-- wherever in the cell it falls (#1903): ten cells or more. A minute of
-- latitude is 1.852 km and a minute of longitude 1.852 km times the cosine, so
-- the cell is about 340 ha at the equator. The Okavango Delta (2 023 590 ha)
-- and Virunga (800 000 ha) outsize theirs thousands of times; the Longmen
-- Grottoes (331 ha), whose list point stands 10 km from the caves, do not. An
-- area the list does not state outsizes nothing.
CREATE OR REPLACE FUNCTION outsizes_its_minute(area_hectares NUMERIC, latitude DOUBLE PRECISION) RETURNS BOOLEAN AS $$
  SELECT COALESCE(area_hectares, 0) >= 10 * 1.852 * 1.852 * cos(radians(latitude)) * 100
$$ LANGUAGE sql IMMUTABLE;

CREATE TEMP TABLE whole_site_point ON COMMIT DROP AS
SELECT el.id
  FROM experience_locations el
  JOIN LATERAL (
    SELECT COALESCE((SELECT p.whole_id FROM experience_parts p
                      WHERE p.part_id = el.experience_id AND p.reason = 'component'), el.experience_id) AS site_id
  ) s ON TRUE
  JOIN experiences site ON site.id = s.site_id
  JOIN experience_kind_memberships m ON m.experience_id = site.id
  JOIN experience_sources src ON src.id = m.source_id AND src.name = 'UNESCO World Heritage Sites'
 WHERE el.approximate IS NOT NULL
   AND stands_for_whole_site(el.name, el.external_ref, site.name, m.external_id,
         (SELECT count(*)::int FROM experience_locations sp
           WHERE sp.missing_since IS NULL AND sp.merged_into_id IS NULL
             AND (sp.experience_id = site.id
                  OR sp.experience_id IN (SELECT p.part_id FROM experience_parts p
                                           WHERE p.whole_id = site.id AND p.reason = 'component'))))
   AND outsizes_its_minute((site.metadata->>'areaHectares')::numeric, ST_Y(el.location));

SELECT count(*) AS points_cleared FROM whole_site_point;

DELETE FROM experience_point_hints h USING whole_site_point w WHERE h.location_id = w.id;
UPDATE experience_locations el SET approximate = NULL FROM whole_site_point w WHERE el.id = w.id;

-- A settlement or a boundary named like a component is the place it is named
-- after, not where it stands, and the pass no longer offers one (pointHints.ts):
-- the hints it kept before go now rather than at its next run.
WITH settlement_hint AS (
  DELETE FROM experience_point_hints h
   USING osm_objects o
   WHERE h.source = 'osm-name' AND o.osm_type = left(h.ref, 1) AND o.osm_id = substr(h.ref, 2)::bigint
     AND (o.tags ? 'place' OR o.tags ? 'boundary')
  RETURNING h.location_id)
SELECT count(*) AS settlement_hints_dropped FROM settlement_hint;

COMMIT;

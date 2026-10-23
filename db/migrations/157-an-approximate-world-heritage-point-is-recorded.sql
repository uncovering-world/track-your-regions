-- 157-an-approximate-world-heritage-point-is-recorded.sql
--
-- A World Heritage component placed only roughly is recorded as such (#1853):
-- to the whole minute (both coordinates within 1e-6 degrees of a whole minute,
-- WHOLE_MINUTE_TOLERANCE_DEG), or on a point another component of the property,
-- under another reference, shares. The run records it on every point it writes
-- (approximateReasons, @tyr/shared/precision), but a site whose points did not
-- change takes the writer's fast path and writes none, so this file records it
-- on the points the World Heritage source places now, by the same rule.
--
-- A point a curator placed (a claim on its location) is not approximate.
--
-- On the development catalogue on 2026-10-23: 640 of 6 410 placed points on a
-- whole minute.
--
-- Re-runnable: every placed point is set again from its coordinate.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS approximate VARCHAR(12)
    CHECK (approximate IN ('whole-minute', 'shared'));
COMMENT ON COLUMN experience_locations.approximate IS 'Why the World Heritage list''s point for this component only says roughly where it is (#1853): whole-minute, a coordinate to the whole minute (the Longmen Grottoes, 10 km off), or shared, a point another component of the property under another reference also stands on (Echmiatsin''s cathedral, church and cemetery). Null for a point given to the second and for one a curator placed (curated_fields location). Written by the World Heritage run.';

WITH placed AS (
  SELECT el.id, m.id AS membership_id, el.external_ref, el.curated_fields,
         round(ST_X(el.location)::numeric, 6) AS lon6, round(ST_Y(el.location)::numeric, 6) AS lat6,
         abs(ST_X(el.location) * 60 - round(ST_X(el.location) * 60)) < 6e-5
           AND abs(ST_Y(el.location) * 60 - round(ST_Y(el.location) * 60)) < 6e-5 AS whole_minute
    FROM experience_locations el
    JOIN experience_location_placements pl ON pl.location_id = el.id
    JOIN experience_kind_memberships m ON m.id = pl.membership_id
   WHERE m.source_id = (SELECT id FROM experience_sources WHERE name = 'UNESCO World Heritage Sites')
     AND el.missing_since IS NULL AND el.merged_into_id IS NULL
), judged AS (
  SELECT p.id,
         CASE WHEN p.curated_fields ? 'location' THEN NULL
              WHEN p.external_ref IS NOT NULL AND EXISTS (
                     SELECT 1 FROM placed q
                      WHERE q.membership_id = p.membership_id AND q.id <> p.id
                        AND q.external_ref IS NOT NULL AND q.external_ref <> p.external_ref
                        AND q.lon6 = p.lon6 AND q.lat6 = p.lat6) THEN 'shared'
              WHEN p.whole_minute THEN 'whole-minute'
         END AS reason
    FROM placed p
)
UPDATE experience_locations el
   SET approximate = j.reason
  FROM judged j
 WHERE el.id = j.id AND el.approximate IS DISTINCT FROM j.reason;

SELECT approximate, count(*) FROM experience_locations WHERE approximate IS NOT NULL GROUP BY approximate ORDER BY 1;

COMMIT;

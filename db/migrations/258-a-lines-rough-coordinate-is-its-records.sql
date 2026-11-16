-- 258-a-lines-rough-coordinate-is-its-records.sql
--
-- How roughly the World Heritage list placed a component is the source's view
-- of the line, held on the line's record beside the coordinate it gave
-- (ADR-0213 decision 5, #2123), never on the place: whether the place stands
-- only roughly is read from it (pointRoughSql, placePoints.ts), with the
-- curator's claim on the coordinate.
--
-- * source_records gains reported_location_rough: whole-minute, shared or
--   NULL, as approximateReasons (@tyr/shared/precision) reads the list, and
--   NULL for a line that stands for a site whose area outsizes its minute
--   (listingRoughSql, partFieldsWriter.ts), which the run resolves where it
--   knows the area.
-- * Every record of World Heritage components whose line the list gives is
--   given it, read off the coordinate its site's run wrote (reported_location):
--   shared where another line of the same site under another reference stands
--   on the same coordinate to the sixth decimal, whole-minute where both of its
--   coordinates lie within 1e-5 of a degree of a whole minute
--   (WHOLE_MINUTE_TOLERANCE_DEG). A line that stands for its whole site
--   (stands_for_whole_site, the site's listed lines counted) of an area ten
--   cells of its minute or more (outsizes_its_minute) holds none, as the run
--   leaves it. A record with no coordinate holds none. The
--   site's next run writes the same from the list it reads, and its fast path
--   gives way to the write wherever the two differ (partListingChangesSql).
-- * idx_source_records_rough indexes the places holding a rough record, the
--   set every reader of a point asks before it looks for the point's record.
-- * experience_locations.approximate stays, written as before, until the
--   points go (#2124): a point a move held for a curator leaves at the list's
--   old coordinate keeps the reason it was stored with, since the record holds
--   the new one, and the catalogue check point-rough-out-of-step compares it
--   with the record on every other point.
--
-- Re-runnable: the column is declared if missing, and the backfill writes only
-- records whose mark differs.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';

ALTER TABLE source_records ADD COLUMN IF NOT EXISTS reported_location_rough VARCHAR(12)
    CHECK (reported_location_rough IN ('whole-minute', 'shared'));
-- The places holding a rough record, the set every reader of a point asks
-- first (pointRoughSql): a thousand rows, read once per statement.
CREATE INDEX IF NOT EXISTS idx_source_records_rough ON source_records(experience_id)
    WHERE reported_location_rough IS NOT NULL;
COMMENT ON COLUMN source_records.reported_location_rough IS 'How roughly the list placed the line this record stands for, on a record of World Heritage components (#1853, ADR-0213): whole-minute, a coordinate to the whole minute (the Longmen Grottoes, 10 km off), or shared, one another line of the site under another reference also stands on (Echmiatsin''s cathedral, church and cemetery). Written with reported_location by the site''s run (approximateReasons, @tyr/shared/precision) whatever a curator made of the place; NULL where the list gives the line to the second, where it no longer gives the line, and where the line stands for its whole site of an area ten cells of its minute or more (listingRoughSql, partFieldsWriter.ts, #1903), resolved by the run that knows the area. Whether the place stands only roughly is read from it by pointRoughSql (placePoints.ts), never stored.';
COMMENT ON TABLE experience_point_hints IS 'Where a component the World Heritage list placed only roughly (its line''s record, source_records.reported_location_rough, read by pointRoughSql) may really stand (#1853): the coordinate of its own Wikidata item (item, ref the item), an OpenStreetMap object carrying its World Heritage reference ref:whc (osm-ref, ref like W194252618), or one within 2 km named like it (osm-name), with its distance from the point in metres. Worked out by the Find component items pass from the subset, the OpenStreetMap layer and the full OpenStreetMap''s answers a curator asked for from the card (experience_point_name_asks, #2243), and replaced per point on each pass, so the curator''s card reads no workbench table (ADR-0124).';
COMMENT ON COLUMN experience_locations.approximate IS 'Why the World Heritage list''s point for this component only says roughly where it is (#1853), as the run read it before the line''s record held it (source_records.reported_location_rough, #2123). Read for one case only: a point a move held for a curator leaves at the list''s old coordinate, which an unread arrival names (pointRoughSql). The catalogue check point-rough-out-of-step compares it with what the record says, and both go with the points (#2124). Written by the World Heritage run.';

UPDATE source_records rec
   SET reported_location_rough = resolved.reason
  FROM (
    SELECT mark.id,
           CASE WHEN mark.reason IS NOT NULL
                 AND outsizes_its_minute((SELECT (wh.facts->>'areaHectares')::numeric FROM source_records wh
                                           WHERE wh.experience_id = mark.whole_id AND wh.kind_id = 1),
                                         ST_Y(mark.reported_location))
                 AND stands_for_whole_site(mark.reported_name, mark.external_id, site.name,
                                           (SELECT wh.external_id FROM source_records wh
                                             WHERE wh.experience_id = mark.whole_id AND wh.source_id = 1
                                               AND wh.kind_id IS NOT NULL ORDER BY wh.id LIMIT 1),
                                           (SELECT count(*)::int FROM source_records listed
                                             WHERE listed.source_id = 10 AND listed.whole_id = mark.whole_id
                                               AND listed.reported_location IS NOT NULL))
                THEN NULL ELSE mark.reason END AS reason
      FROM (
    SELECT line.id, line.whole_id, line.reported_name, line.external_id, line.reported_location,
           CASE WHEN EXISTS (
                  SELECT 1 FROM source_records other
                   WHERE other.source_id = 10 AND other.whole_id = line.whole_id AND other.id <> line.id
                     AND other.reported_location IS NOT NULL AND other.external_id <> line.external_id
                     AND round(ST_X(other.reported_location)::numeric, 6) = round(ST_X(line.reported_location)::numeric, 6)
                     AND round(ST_Y(other.reported_location)::numeric, 6) = round(ST_Y(line.reported_location)::numeric, 6))
                THEN 'shared'
                WHEN abs(ST_X(line.reported_location) * 60 - round(ST_X(line.reported_location) * 60)) < 1e-5 * 60
                 AND abs(ST_Y(line.reported_location) * 60 - round(ST_Y(line.reported_location) * 60)) < 1e-5 * 60
                THEN 'whole-minute'
           END AS reason
      FROM source_records line
     WHERE line.source_id = 10 AND line.whole_id IS NOT NULL
      ) mark
      JOIN experiences site ON site.id = mark.whole_id
  ) resolved
 WHERE rec.id = resolved.id AND rec.reported_location_rough IS DISTINCT FROM resolved.reason;

COMMIT;

-- 242-a-line-read-twice-leaves-no-part-behind.sql
--
-- The World Heritage runs of 2026-10-01 and 2026-10-08 read some lines of the
-- list twice: each copy arrived as a second, pending point beside the point
-- already standing, and the run of 2026-10-10 withdrew it. When components
-- became places (ADR-0100, 2026-10-13) every such copy became a part of its
-- own. No reader or curator was ever shown one, yet each hides its twin's
-- reference from the run's lookup: the registry holds a reference two places
-- claim as identifying neither. Bad Gögging (1608ter-001) is parts 38297 and
-- 38374, 0 m apart. This file removes them (#2119).
--
-- A place is removed when all of this holds, checked under its lock and again
-- in each statement that removes it:
--
--   - it is live (not folded into another place);
--   - its one source record is World Heritage components' record of it as a
--     part of a whole: no record in a kind, no other record;
--   - it has points, and every one is pending (never published), withdrawn
--     (missing_since set) and not folded;
--   - a twin stands: another live part of the same whole, under the same
--     reference from the same source, with a point that is published,
--     standing, not lost and not turned down;
--   - nothing a person made or sees hangs on it: no visit, work link, merge
--     on either side, separation, curation-log row, held or conflict
--     decision, view choice or suggestion, region refusal, manual or offered
--     region row, manual region row on any of its points, identifier verdict,
--     merge proposal or suggestion, kind suggestion or answer, visit
--     suggestion, find-site link, changeset row, place folded into it, or
--     point another point names;
--   - no other place is a part of it: no record or part relation names it as
--     a whole, since deleting it would delete those by cascade.
--
-- A place shaped like a copy that something holds is left, and the file says
-- how many and which.
--
-- On the development catalogue on 2026-11-13 that is 92 places in 5 wholes
-- (the Danube Limes 75, the Dorset and East Devon Coast 8, Pompei 7, Graz 1,
-- W-Arly-Pendjari 1), each with its one record, its one point, the point's one
-- placement, its one part relation and its one registry row, and 21 open
-- component-item questions on those points, which no card shows (the card
-- asks only about a published point that stands). Nothing else hangs on them:
-- no point of theirs has a manual region row and no place is a part of one.
-- A fresh database holds none, and neither does this one once the file ran, so
-- the count is asserted to be at most 100 and the file is re-runnable.
--
-- Order, so no trigger fires per row where one statement does:
--   1. The places and their wholes are locked in id order (objects first),
--      then the places' points, then their region keys (lock_place_regions),
--      as a merge takes them. A place and its points are locked FOR UPDATE:
--      a writer that adds a row naming one by a foreign key takes only a key
--      share on it, which FOR NO KEY UPDATE lets through (db/locks.ts), and
--      the delete would take that row by cascade or set its key to null. Under
--      FOR UPDATE such a writer waits and then fails on the missing key. The
--      wholes keep FOR NO KEY UPDATE: nothing of theirs is deleted, so a row
--      a writer adds on one meanwhile is kept.
--   2. The part relations go in one statement: one region refresh over the
--      wholes and the parts (trg_place_regions_part_delete), and the pairing
--      marks, before the records whose triggers would delete them one by one.
--   3. The records go in one statement: the registry trigger refreshes each
--      record's reference, so the twin's reference identifies its part again;
--      parts_follow_records() finds no relation left to change.
--   4. The places go in one statement, their points, placements and the open
--      questions on them by cascade, with one region refresh over the points.

\set ON_ERROR_STOP on

BEGIN;

-- Whether anything a person made or sees hangs on the place or its points,
-- or another place hangs on it as a part.
CREATE OR REPLACE FUNCTION pg_temp.holds_nothing(place INTEGER) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (SELECT 1 FROM user_visited_experiences WHERE experience_id = place)
     AND NOT EXISTS (SELECT 1 FROM experience_treasures WHERE experience_id = place)
     AND NOT EXISTS (SELECT 1 FROM experience_merges WHERE place IN (survivor_id, folded_id))
     AND NOT EXISTS (SELECT 1 FROM experience_separations WHERE place IN (original_id, separated_id))
     AND NOT EXISTS (SELECT 1 FROM experience_curation_log WHERE experience_id = place)
     AND NOT EXISTS (SELECT 1 FROM experience_held_decisions WHERE experience_id = place)
     AND NOT EXISTS (SELECT 1 FROM experience_conflict_decisions WHERE experience_id = place)
     AND NOT EXISTS (SELECT 1 FROM experience_view_choices WHERE experience_id = place)
     AND NOT EXISTS (SELECT 1 FROM experience_view_suggestions WHERE experience_id = place)
     AND NOT EXISTS (SELECT 1 FROM experience_rejections WHERE experience_id = place)
     AND NOT EXISTS (SELECT 1 FROM experience_regions
                      WHERE experience_id = place AND (assignment_type = 'manual' OR listing = 'offered'))
     AND NOT EXISTS (SELECT 1 FROM experience_location_regions elr
                       JOIN experience_locations el ON el.id = elr.location_id
                      WHERE el.experience_id = place AND elr.assignment_type = 'manual')
     AND NOT EXISTS (SELECT 1 FROM place_identifier_verdicts WHERE experience_id = place)
     AND NOT EXISTS (SELECT 1 FROM experience_merge_proposals WHERE place IN (place_a, place_b, part_id))
     AND NOT EXISTS (SELECT 1 FROM experience_merge_suggestions WHERE place IN (place_a, place_b))
     AND NOT EXISTS (SELECT 1 FROM experience_kind_suggestions WHERE experience_id = place)
     AND NOT EXISTS (SELECT 1 FROM experience_planned_kind_answers WHERE experience_id = place)
     AND NOT EXISTS (SELECT 1 FROM experience_visit_suggestions WHERE experience_id = place)
     AND NOT EXISTS (SELECT 1 FROM find_site_links WHERE site_id = place)
     AND NOT EXISTS (SELECT 1 FROM experience_sync_changes WHERE experience_id = place)
     AND NOT EXISTS (SELECT 1 FROM experiences folded WHERE folded.merged_into_id = place)
     AND NOT EXISTS (SELECT 1 FROM experience_locations other
                       JOIN experience_locations own ON own.experience_id = place
                      WHERE other.experience_id <> place
                        AND own.id IN (other.withdrawal_deferred_for_location_id, other.moved_to_location_id,
                                       other.merged_into_id))
     AND NOT EXISTS (SELECT 1 FROM source_records part_rec WHERE part_rec.whole_id = place AND part_rec.experience_id <> place)
     AND NOT EXISTS (SELECT 1 FROM experience_parts prt WHERE prt.whole_id = place)
$$;

-- Whether a place has the shape of a copy of a line, whatever hangs on it.
CREATE OR REPLACE FUNCTION pg_temp.looks_like_leftover_part(place INTEGER) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM experiences e
      JOIN source_records rec ON rec.experience_id = e.id
     WHERE e.id = place AND e.merged_into_id IS NULL
       AND rec.source_id = 10 AND rec.whole_id IS NOT NULL AND rec.whole_id <> e.id
       AND NOT EXISTS (SELECT 1 FROM source_records other WHERE other.experience_id = e.id AND other.id <> rec.id)
       AND EXISTS (SELECT 1 FROM experience_locations el WHERE el.experience_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM experience_locations el
                        WHERE el.experience_id = e.id
                          AND NOT (el.curation_state = 'pending' AND el.missing_since IS NOT NULL
                                   AND el.merged_into_id IS NULL))
       AND EXISTS (SELECT 1 FROM source_records twin
                     JOIN experiences te ON te.id = twin.experience_id AND te.merged_into_id IS NULL
                    WHERE twin.source_id = rec.source_id AND twin.whole_id = rec.whole_id
                      AND twin.external_id = rec.external_id AND twin.experience_id <> e.id
                      AND EXISTS (SELECT 1 FROM experience_locations tl
                                   WHERE tl.experience_id = twin.experience_id
                                     AND tl.merged_into_id IS NULL AND tl.missing_since IS NULL
                                     AND tl.curation_state <> 'pending' AND tl.existence <> 'lost'
                                     AND tl.refused_at IS NULL)))
$$;

-- Whether a place is a copy of a line this file removes, its record included.
CREATE OR REPLACE FUNCTION pg_temp.is_leftover_part(place INTEGER) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT pg_temp.looks_like_leftover_part(place) AND pg_temp.holds_nothing(place)
$$;

DO $$
DECLARE
  shaped INTEGER[];
  candidates INTEGER[];
  doomed INTEGER[];
  held INTEGER[];
  wholes INTEGER[];
  next_id INTEGER;
  removed INTEGER;
BEGIN
  -- 1. The places that look like copies and their wholes, locked in id order,
  --    the places FOR UPDATE and the wholes FOR NO KEY UPDATE, then the
  --    places' points, then read again under the locks, then their region keys.
  shaped := ARRAY(SELECT e.id FROM experiences e WHERE pg_temp.looks_like_leftover_part(e.id) ORDER BY e.id);
  candidates := ARRAY(SELECT id FROM unnest(shaped) AS id WHERE pg_temp.holds_nothing(id) ORDER BY id);
  wholes := ARRAY(SELECT DISTINCT rec.whole_id FROM source_records rec
                   WHERE rec.experience_id = ANY(candidates) AND rec.source_id = 10);
  FOR next_id IN SELECT DISTINCT id FROM unnest(candidates || wholes) AS id ORDER BY id LOOP
    IF next_id = ANY(candidates) THEN
      PERFORM 1 FROM experiences WHERE id = next_id FOR UPDATE;
    ELSE
      PERFORM 1 FROM experiences WHERE id = next_id FOR NO KEY UPDATE;
    END IF;
  END LOOP;
  PERFORM 1 FROM experience_locations
    WHERE experience_id = ANY(candidates) ORDER BY id FOR UPDATE;
  doomed := ARRAY(SELECT id FROM unnest(candidates) AS id WHERE pg_temp.is_leftover_part(id) ORDER BY id);
  held := ARRAY(SELECT id FROM unnest(shaped) AS id WHERE NOT id = ANY(doomed) ORDER BY id);
  IF cardinality(doomed) > 100 THEN
    RAISE EXCEPTION '% places look like copies of a list line, more than the 100 this file expects (92 on the development catalogue)',
      cardinality(doomed);
  END IF;
  RAISE NOTICE 'Leaving % places shaped like copies of a list line, each held by something or changed since: %',
    cardinality(held), held;
  RAISE NOTICE 'Removing % copies of a list line in % wholes', cardinality(doomed), cardinality(wholes);
  IF cardinality(doomed) = 0 THEN
    RETURN;
  END IF;
  PERFORM lock_place_regions(doomed || wholes);

  -- 2. Their part relations, in one statement.
  DELETE FROM experience_parts prt
   USING source_records rec
   WHERE prt.part_id = ANY(doomed) AND rec.experience_id = prt.part_id AND rec.whole_id = prt.whole_id
     AND rec.source_id = 10 AND pg_temp.is_leftover_part(prt.part_id);
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed <> cardinality(doomed) THEN
    RAISE EXCEPTION 'Removed % part relations for % copies; each copy holds one', removed, cardinality(doomed);
  END IF;

  -- 3. Their records, in one statement, each read again as it goes.
  DELETE FROM source_records rec
   WHERE rec.experience_id = ANY(doomed) AND rec.source_id = 10 AND rec.whole_id IS NOT NULL
     AND pg_temp.is_leftover_part(rec.experience_id);
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed <> cardinality(doomed) THEN
    RAISE EXCEPTION 'Removed % records for % copies; each copy holds one', removed, cardinality(doomed);
  END IF;

  -- 4. The places, in one statement: nothing a person made or sees may hang on one.
  DELETE FROM experiences e
   WHERE e.id = ANY(doomed) AND e.merged_into_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM source_records left_over WHERE left_over.experience_id = e.id)
     AND NOT EXISTS (SELECT 1 FROM experience_locations el
                      WHERE el.experience_id = e.id AND NOT (el.curation_state = 'pending' AND el.missing_since IS NOT NULL))
     AND pg_temp.holds_nothing(e.id);
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed <> cardinality(doomed) THEN
    RAISE EXCEPTION 'Removed % places of % copies; one changed while this file ran', removed, cardinality(doomed);
  END IF;
END;
$$;

COMMIT;

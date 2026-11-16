-- 259-a-whole-is-shaped-once-per-statement.sql
--
-- A whole takes its shape once for the statement that gives it parts
-- (ADR-0210, whole_shape_follows_parts). whole_shape_of measures every two of
-- the parts' points against each other, about 0.6 s for 758 parts standing
-- within a kilometre, and the trigger asked it in a subquery that a nested
-- loop runs again for every row of experiences. The planner picks that loop
-- when its statistics say experiences is nearly empty, as a test database's
-- do after autovacuum: the 758-shelter case of wholeLeaves.db.test.ts ran for
-- minutes there instead of under a second, and timed out in CI's database
-- lane. A MATERIALIZED CTE is run once whatever the plan, and it asks only
-- the wholes that have no shape yet, which are the only ones written.
--
-- No row changes. Order-independent with 01-schema.sql, which declares the
-- same; re-runnable.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION whole_shape_follows_parts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- whole_shape_of measures every two parts' points against each other, so
    -- it is asked once for each whole with no shape yet, in a MATERIALIZED
    -- CTE: a subquery on the inner side of a nested loop is run again for
    -- every outer row, and the planner picks that loop, experiences outside,
    -- whenever its statistics say the table is nearly empty.
    WITH shaped AS MATERIALIZED (
      SELECT e.id, whole_shape_of(e.id) AS shape
        FROM experiences e
       WHERE e.whole_shape IS NULL AND e.id IN (SELECT n.whole_id FROM new_parts n)
    )
    UPDATE experiences e
       SET whole_shape = shaped.shape,
           location = CASE WHEN shaped.shape = 'dispersed' THEN NULL ELSE e.location END,
           curated_fields = CASE WHEN shaped.shape = 'dispersed' THEN e.curated_fields - 'location' ELSE e.curated_fields END,
           updated_at = NOW()
      FROM shaped
     -- Asked again here, not only in the CTE: a row another statement shaped
     -- while this one waited on its lock is rechecked by this clause alone.
     WHERE e.id = shaped.id AND e.whole_shape IS NULL;
  ELSE
    UPDATE experiences e
       SET whole_shape = NULL, location = back.location, updated_at = NOW()
      FROM (SELECT w.whole_id, COALESCE(held.location,
              (SELECT r.reported_location FROM source_records r
                WHERE r.experience_id = w.whole_id AND r.kind_id IS NOT NULL AND r.reported_location IS NOT NULL
                ORDER BY r.source_id = 1 DESC, r.id LIMIT 1),
              (SELECT el.location FROM experience_locations el
                WHERE el.experience_id = w.whole_id AND el.missing_since IS NULL AND el.existence <> 'lost'
                  AND el.merged_into_id IS NULL AND el.refused_at IS NULL
                ORDER BY el.id LIMIT 1)) AS location
              FROM (SELECT DISTINCT o.whole_id FROM old_parts o) w
              JOIN experiences held ON held.id = w.whole_id) back
     WHERE e.id = back.whole_id AND e.whole_shape IS NOT NULL
       -- A place nothing gives a point keeps its shape, which the check
       -- whole-shape-drift names, rather than refuse the delete.
       AND back.location IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM experience_parts p WHERE p.whole_id = back.whole_id);
  END IF;
  RETURN NULL;
END;
$$;

COMMIT;

-- 268-a-places-state-is-its-periods.sql
--
-- The clean catalogue model, slice B2 (#2584, #2585, ADR-0217 decision 5,
-- ADR-0225): a place's state is its periods. experiences.existence and the
-- state verdict it carried (state_decided_by, state_decided_at, state_note)
-- go.
--
-- * A curator's lost becomes the end of the place's standing, as the
--   curator's own periods (source 11, Curators) with who decided and when
--   (ADR-0217 decision 5): the open stood period that names no kind is closed
--   with no end date, and the place's other stood periods that name no kind
--   become the curator's with it, so a run keeps them (lifetimeWrites.ts). A
--   place with none gets one period that ended, its start and its end not
--   known. An open period that begins on a day still ahead is dropped first:
--   no period both begins ahead and has ended. The Kakhovka Dam, judged lost
--   on its card, keeps its run's start and ends with the curator's word.
-- * The note a curator gave has no column among the periods. The curation
--   log holds it with the act (marked_lost, an admission answer), and the file
--   counts, before it drops them, the notes no log entry of the place holds.
-- * Who decided, when and the note on a place that is not lost (an admission
--   answer, a refusal, a verdict taken back) are the curation log's alone:
--   dropped and counted.
-- * The functions and the trigger that read existence are restated first:
--   crowding_above(), recount_crowding() and refresh_crowding() read
--   stands_today alone, and crowding_follows_place_change follows location
--   alone, a place's standing reaching the recount through its memberships'
--   stands_today.
-- * The curation log's reason_code CHECK takes the two reasons a lost taken
--   back gives, never-gone and rebuilt (CURATION_REASON_CODES in
--   @tyr/shared/curationLog, which the CHECK lists in its order).
-- * The verdicts are read into a table of this transaction, the shape changes
--   (experiences_existence_check, the state_decided_by key, the four columns
--   and idx_experiences_existence with its column), and the periods are
--   written last (db/migrations/README.md: shape before rows).
--
-- Re-runnable: once existence is gone the file reads no verdict and writes
-- nothing. Runs before the next re-application of 01-schema.sql, which
-- refuses to run while experiences.existence exists.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';

-- No curator's verdict may land between the read below and the drop of its
-- column: writes to experiences wait until this file commits.
LOCK TABLE experiences IN SHARE ROW EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- The verdicts, read before their columns go
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE b2_lost (
    experience_id INTEGER PRIMARY KEY,
    decided_by INTEGER,
    decided_at TIMESTAMPTZ NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
    lost_count INTEGER;
    notes_unlogged INTEGER;
    other_dropped INTEGER;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'experiences' AND column_name = 'existence') THEN
        RAISE NOTICE '268: experiences.existence is gone already; nothing to move';
        RETURN;
    END IF;

    EXECUTE $q$
        INSERT INTO b2_lost (experience_id, decided_by, decided_at)
        SELECT e.id, u.id, COALESCE(e.state_decided_at, NOW())
          FROM experiences e
          LEFT JOIN users u ON u.id = e.state_decided_by
         WHERE e.existence = 'lost'
    $q$;
    GET DIAGNOSTICS lost_count = ROW_COUNT;

    EXECUTE $q$
        SELECT count(*) FROM experiences e
         WHERE e.state_note IS NOT NULL AND btrim(e.state_note) <> ''
           AND NOT EXISTS (SELECT 1 FROM experience_curation_log cl
                            WHERE cl.experience_id = e.id AND cl.details->>'note' = e.state_note)
    $q$ INTO notes_unlogged;

    EXECUTE $q$
        SELECT count(*) FROM experiences e
         WHERE e.existence <> 'lost' AND (e.state_decided_by IS NOT NULL OR e.state_decided_at IS NOT NULL OR e.state_note IS NOT NULL)
    $q$ INTO other_dropped;

    RAISE NOTICE '268: % lost verdicts move to place_periods; % notes no curation log entry holds are dropped; % verdicts on places not lost are left to the curation log',
        lost_count, notes_unlogged, other_dropped;
END $$;

-- ---------------------------------------------------------------------------
-- What reads existence, restated without it
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crowding_above(
  of_kind integer, of_type text, of_member integer, at_point geometry, within_km double precision, above_score real
) RETURNS TABLE (membership_id integer)
LANGUAGE sql STABLE PARALLEL SAFE AS $fn$
  SELECT d.id
    FROM source_records d
    JOIN experiences de ON de.id = d.experience_id
    LEFT JOIN membership_fame df ON df.membership_id = d.id
   WHERE d.kind_id = of_kind AND d.type IS NOT DISTINCT FROM of_type AND d.id <> of_member
     AND de.location && crowding_box(at_point, within_km)
     AND ST_DWithin(de.location::geography, at_point::geography, within_km * 1000)
     AND d.admission <> 'refused' AND de.stands_today AND d.stands_today
     AND d.crowding_pin IS DISTINCT FROM 'shadow'
     AND (d.crowding_pin = 'list' OR df.score > above_score)
     AND NOT place_shows_works(de.id)
$fn$;

CREATE OR REPLACE FUNCTION recount_crowding(near geometry DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(2201, 0);

  DELETE FROM membership_crowding mc
   USING source_records m, experiences e, experience_kinds k
   WHERE mc.membership_id = m.id AND e.id = m.experience_id AND k.id = m.kind_id
     AND (near IS NULL OR k.crowding_radius_km IS NULL
          OR (e.location && crowding_box(near, k.crowding_radius_km)
              AND ST_DWithin(e.location::geography, near::geography, k.crowding_radius_km * 1000)));

  INSERT INTO membership_crowding (membership_id, outranked_by)
  SELECT c.id, n.better
    FROM source_records c
    JOIN experience_kinds k ON k.id = c.kind_id AND k.crowding_limit IS NOT NULL
    JOIN experiences ce ON ce.id = c.experience_id
    LEFT JOIN membership_fame cf ON cf.membership_id = c.id
    CROSS JOIN LATERAL crowding_better(c.kind_id, c.type, c.id, ce.location, k.crowding_radius_km, cf.score) n
   WHERE c.admission <> 'refused' AND ce.stands_today AND c.stands_today
     AND ce.location IS NOT NULL
     AND (c.type IS NULL OR c.type <> ALL(k.crowding_exempt_types))
     AND (near IS NULL
          OR (ce.location && crowding_box(near, k.crowding_radius_km)
              AND ST_DWithin(ce.location::geography, near::geography, k.crowding_radius_km * 1000)))
     AND NOT place_shows_works(ce.id)
     AND c.crowding_pin IS DISTINCT FROM 'list'
     AND (c.crowding_pin = 'shadow' OR cf.score IS NOT NULL)
     AND (c.crowding_pin = 'shadow' OR n.better >= k.crowding_limit)
  ON CONFLICT (membership_id) DO UPDATE SET outranked_by = EXCLUDED.outranked_by, computed_at = NOW();
END $fn$;

CREATE OR REPLACE FUNCTION refresh_crowding() RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE crowded integer;
BEGIN
  WITH candidates AS (
    SELECT f.membership_id, m.kind_id, m.type, f.readers, f.guide_editions, f.wikipedia_editions
      FROM membership_fame f
      JOIN source_records m ON m.id = f.membership_id
      JOIN experience_kinds k ON k.id = m.kind_id AND k.crowding_limit IS NOT NULL
      JOIN experiences e ON e.id = m.experience_id
     WHERE m.admission <> 'refused' AND e.stands_today AND m.stands_today
       AND e.location IS NOT NULL
       AND (m.type IS NULL OR m.type <> ALL(k.crowding_exempt_types))
  ), scored AS (
    SELECT membership_id,
           ((percent_rank() OVER (PARTITION BY kind_id, type ORDER BY readers)
           + percent_rank() OVER (PARTITION BY kind_id, type ORDER BY guide_editions > 0)
           + percent_rank() OVER (PARTITION BY kind_id, type ORDER BY wikipedia_editions)) / 3)::real AS score
      FROM candidates
  )
  UPDATE membership_fame f SET score = s.score
    FROM membership_fame f2 LEFT JOIN scored s ON s.membership_id = f2.membership_id
   WHERE f.membership_id = f2.membership_id AND f.score IS DISTINCT FROM s.score;

  PERFORM recount_crowding(NULL);
  SELECT count(*) INTO crowded FROM membership_crowding;
  RETURN crowded;
END $fn$;

DROP TRIGGER IF EXISTS crowding_follows_place_change ON experiences;
CREATE CONSTRAINT TRIGGER crowding_follows_place_change
  AFTER UPDATE OF location ON experiences
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.location IS DISTINCT FROM NEW.location)
  EXECUTE FUNCTION crowding_follows_place();

-- ---------------------------------------------------------------------------
-- The columns go
-- ---------------------------------------------------------------------------

ALTER TABLE experiences DROP CONSTRAINT IF EXISTS experiences_existence_check;
ALTER TABLE experiences DROP CONSTRAINT IF EXISTS experiences_state_decided_by_fkey;
DROP INDEX IF EXISTS idx_experiences_existence;

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_reason_code_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_reason_code_check
    CHECK ((reason_code IN ('not-this-kind', 'not-worth-a-visit', 'not-one-place', 'wrong-place', 'duplicate', 'gone', 'source-text', 'missing-from-rule', 'never-gone', 'rebuilt', 'other')));
ALTER TABLE experiences
    DROP COLUMN IF EXISTS existence,
    DROP COLUMN IF EXISTS state_decided_by,
    DROP COLUMN IF EXISTS state_decided_at,
    DROP COLUMN IF EXISTS state_note;

-- ---------------------------------------------------------------------------
-- A curator's lost, as the end of the place's standing
-- ---------------------------------------------------------------------------

-- An open period that begins on a day still ahead cannot be closed: it goes.
DELETE FROM place_periods p
 USING b2_lost l
 WHERE p.experience_id = l.experience_id AND p.kind_id IS NULL AND p.says = 'stood'
   AND NOT p.ended AND p.from_first > current_day_index();

-- The open one is closed, with no end date, and every stood period of the
-- place that names no kind becomes the curator's.
UPDATE place_periods p
   SET ended = true,
       source_id = 11, decided_by = l.decided_by, decided_at = l.decided_at,
       updated_at = clock_timestamp()
  FROM b2_lost l
 WHERE p.experience_id = l.experience_id AND p.kind_id IS NULL AND p.says = 'stood';

-- A place with none: one period that ended, its start and its end not known.
INSERT INTO place_periods (experience_id, kind_id, says, ordinal, ended, source_id, decided_by, decided_at)
SELECT l.experience_id, NULL, 'stood', 1, true, 11, l.decided_by, l.decided_at
  FROM b2_lost l
 WHERE NOT EXISTS (SELECT 1 FROM place_periods p
                    WHERE p.experience_id = l.experience_id AND p.kind_id IS NULL AND p.says = 'stood');

DO $$
DECLARE
    still_standing INTEGER;
BEGIN
    SELECT count(*) INTO still_standing
      FROM b2_lost l JOIN experiences e ON e.id = l.experience_id
     WHERE e.stands_today;
    IF still_standing > 0 THEN
        RAISE EXCEPTION '268: % places judged lost still stand after the move', still_standing;
    END IF;
END $$;

COMMIT;

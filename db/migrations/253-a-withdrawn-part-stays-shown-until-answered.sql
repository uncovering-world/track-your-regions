-- 253-a-withdrawn-part-stays-shown-until-answered.sql
--
-- A serial site's part whose line the World Heritage list stops giving stays
-- shown, on the map and in its site's "k of N", until a curator answers
-- former (on the part's record) or lost (on the part): the rule a membership
-- its source stopped listing follows (#1251, the maintainer's decision of
-- 2026-11-15 on #2123, ADR-0216). The withdrawal is the record's own: the
-- site's run writes it (writePartListings) and keeps the line's point standing
-- (lineWithdrawnOnItsRecordSql), and a curator's verdict writes it back.
--
-- * refresh_part_record_gates() no longer derives the record's listing from
--   its points; it still derives the read state and the refusal.
-- * The line points of every part whose record says the list withdrew it and
--   nobody has judged it stand again: on the development catalogue on
--   2026-11-16, the two Western Tien-Shan areas the list dropped on
--   2026-10-25, the Maidantal and the Bashkizilsay areas of the Chatkal
--   reserve. Their site counts 13 of its 23 places again, where it counted
--   11. Their records keep the withdrawal, which the site's card asks about.
--   A record judged former keeps its point hidden.
--
-- A withdrawn point lost its regions, which only the backend computes: after
-- this, the admin panel's Region Assignment for the World Heritage source
-- lists the two areas in their regions again (3 each on the development
-- catalogue, as each of the site's other areas).
--
-- Two transactions: the function, then the points. Re-runnable: the function
-- is replaced, and a second run finds no such point.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';

-- Write the read state and the refusal of the parts' records of the places
-- `places` from their line points, as the old gate reads them: read once one
-- of them is published (verified before auto), turned down while none is and
-- every one still asked about is refused. Whether the list still gives the
-- line is the record's own, written by the site's run (writePartListings) and
-- a curator's verdict, never derived from the points (ADR-0216). A folded
-- point is no line. A move the guard refuses is not made (a new record a run
-- wrote auto before its pending point reached it): the record keeps its
-- state, and the catalogue check part-gate-out-of-step names it. A record
-- with no line point keeps what it holds. Writes only what differs, so a
-- statement that changes no gate writes no record.
CREATE OR REPLACE FUNCTION refresh_part_record_gates(places INTEGER[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF places IS NULL OR cardinality(places) = 0 THEN
    RETURN;
  END IF;
  WITH line AS (
    SELECT rec.id AS record_id, el.curation_state, el.refused_at, el.missing_since
      FROM source_records rec
      JOIN experience_locations el ON el.experience_id = rec.experience_id AND el.merged_into_id IS NULL
     WHERE rec.experience_id = ANY(places)
       AND rec.source_id = 10 AND rec.whole_id IS NOT NULL AND rec.whole_id <> rec.experience_id
       AND is_part_line_point(el.id, rec.whole_id)
  ),
  gate AS (
    SELECT record_id,
           CASE WHEN bool_or(curation_state = 'verified') THEN 'verified'
                WHEN bool_or(curation_state = 'auto') THEN 'auto'
                ELSE 'pending' END AS curation_state,
           bool_and(curation_state = 'pending')
             AND NOT bool_or(refused_at IS NULL AND missing_since IS NULL)
             AND bool_or(refused_at IS NOT NULL) AS refused,
           max(refused_at) AS refused_at
      FROM line GROUP BY record_id
  ),
  wanted AS (
    SELECT rec.id,
           CASE WHEN (rec.curation_state, gate.curation_state)
                     IN (('pending', 'verified'), ('auto', 'verified'), ('verified', 'auto'))
                THEN gate.curation_state ELSE rec.curation_state END AS curation_state,
           CASE WHEN gate.refused THEN 'refused' ELSE 'admitted' END AS admission,
           CASE WHEN gate.refused THEN 'kept out by a curator' END AS admission_reason,
           CASE WHEN gate.refused THEN gate.refused_at END AS admission_answered_at
      FROM gate JOIN source_records rec ON rec.id = gate.record_id
  )
  UPDATE source_records rec
     SET curation_state = wanted.curation_state,
         admission = wanted.admission,
         admission_reason = wanted.admission_reason,
         admission_answered_at = wanted.admission_answered_at,
         updated_at = NOW()
    FROM wanted
   WHERE rec.id = wanted.id
     AND (rec.curation_state, rec.admission, rec.admission_reason, rec.admission_answered_at)
         IS DISTINCT FROM
         (wanted.curation_state, wanted.admission, wanted.admission_reason, wanted.admission_answered_at);
END;
$$;

COMMIT;

BEGIN;

UPDATE experience_locations el SET missing_since = NULL
  FROM source_records rec
 WHERE rec.source_id = 10 AND rec.whole_id IS NOT NULL AND rec.whole_id <> rec.experience_id
   AND rec.missing_since IS NOT NULL AND rec.source_membership = 'present' AND rec.curation_state <> 'pending'
   AND el.experience_id = rec.experience_id AND is_part_line_point(el.id, rec.whole_id)
   AND el.missing_since IS NOT NULL AND el.source_membership = 'present' AND el.existence = 'extant'
   AND el.merged_into_id IS NULL AND el.moved_to_location_id IS NULL
   AND el.withdrawal_deferred_for_location_id IS NULL;

COMMIT;

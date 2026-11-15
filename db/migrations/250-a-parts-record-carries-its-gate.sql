-- 250-a-parts-record-carries-its-gate.sql
--
-- A part's gate is its record in its whole (#2123, ADR-0213): World Heritage
-- components' record of a serial site's part says whether a curator has read
-- the part, turned it down, and whether the list still gives its line. Until
-- the review queue and the run write the record, it follows the points that
-- are its list line (refresh_part_record_gates, by triggers on
-- experience_locations and on a record that moves to another place), so the
-- record is right from the start while every writer still writes the point.
-- Nothing a reader or a curator sees changes.
--
-- What it changes on a database that holds the catalogue (the development
-- catalogue, 2026-11-15, dry run over its 5,645 parts' records, 31 ms):
--
-- * A part none of whose line points a curator has read takes a pending
--   record: 75, Wudang's 45 among them, Western Tien-Shan's 10 renumbered
--   areas and Baalbek's 3. Every record was auto until now.
-- * A part whose line points the list withdrew takes the latest of their
--   marks: 13, 11 of them judged former; Western Tien-Shan's Maidantal and
--   Bashkizilsay areas are the two still asked about.
-- * A part whose line points a curator turned down takes the shape of a
--   curator's no to an arrival (admission refused, "kept out by a curator"):
--   none on the development catalogue.
-- * A new part's record is written pending where its point is
--   (part_site_components).
--
-- Three transactions: the functions and triggers; the records a run wrote
-- auto before their part's point was read, moved to pending with the move
-- guard off for that statement alone, since auto was the column's default and
-- never anyone's answer; then every other column of the gate. Order-independent
-- with 01-schema.sql, which declares the same. Re-runnable: the functions and
-- triggers are replaced, and a second run writes nothing.

\set ON_ERROR_STOP on

BEGIN;

-- Creating the triggers takes a lock on experience_locations and
-- source_records that holds their writers until this transaction commits.
SET LOCAL lock_timeout = '10s';

COMMENT ON TABLE source_records IS 'One source''s record of a place (ADR-0198): in a kind, a membership (ADR-0045 decision 4), one row per (place, kind), carrying what the kind says about the place -- the source that brought it, the admission verdict, the badge, and whether a curator has passed the arrival; or in a whole, a part record, one row per (source, place, whole), carrying how the source knows the part -- its reference, its item and its view -- and the part''s gate (ADR-0213). The place itself is the experiences row.';
COMMENT ON COLUMN source_records.curation_state IS 'pending = arrived from a gated source and nobody has passed it; auto = published unread; verified = a curator passed what is live now. No reader-facing read may offer a place none of whose memberships has passed (ADR-0025; per member since ADR-0045 decision 7). On a part''s record in its whole, whether a curator has read the part (ADR-0213).';

-- A serial site's components are places, part of the site: 01-schema.sql's
-- part_site_components(), which now writes a new part's record in its point's
-- state (the INSERT near its end).
CREATE OR REPLACE FUNCTION part_site_components(site INTEGER, site_membership INTEGER)
RETURNS INTEGER AS $$
DECLARE
  parted INTEGER := 0;
  component RECORD;
  part INTEGER;
BEGIN
  -- Serial by its standing components: a point the source withdrew, a lost
  -- one, a refused one, or an arrival that replaces a moved one is no second
  -- component (the Pilgrimage Church of Wies, moved once, is one place).
  IF NOT EXISTS (SELECT 1 FROM experience_parts WHERE whole_id = site AND reason = 'component')
     AND (SELECT count(*) FROM experience_locations el
           WHERE el.experience_id = site AND el.merged_into_id IS NULL
             AND el.missing_since IS NULL AND el.existence <> 'lost' AND el.refused_at IS NULL
             AND el.withdrawal_deferred_for_location_id IS NULL
             AND (EXISTS (SELECT 1 FROM experience_location_placements pl
                           WHERE pl.location_id = el.id AND pl.membership_id = site_membership)
                  OR NOT EXISTS (SELECT 1 FROM experience_location_placements pl
                                  WHERE pl.location_id = el.id))) < 2
  THEN
    RETURN 0;
  END IF;

  FOR component IN
    SELECT el.id, el.name, el.external_ref, el.location, el.missing_since, el.withdrawal_deferred_for_location_id,
           el.curation_state
      FROM experience_locations el
     WHERE el.experience_id = site AND el.merged_into_id IS NULL
       AND (EXISTS (SELECT 1 FROM experience_location_placements pl
                     WHERE pl.location_id = el.id AND pl.membership_id = site_membership)
            OR NOT EXISTS (SELECT 1 FROM experience_location_placements pl
                            WHERE pl.location_id = el.id))
       AND el.external_ref IS DISTINCT FROM (SELECT m.external_id FROM source_records m WHERE m.id = site_membership)
       -- An arrival the list withdrew before anyone read it was never a
       -- component a reader knew, and makes no part.
       AND NOT (el.missing_since IS NOT NULL AND el.curation_state = 'pending')
     ORDER BY el.id
  LOOP
    -- A component that moved is the part it moved from (#2182): its point
    -- arrives as a new point, the withdrawal of the one it replaces held for
    -- it under a gate or applied at once without one, and the arrival goes on
    -- that part rather than making a second place of the same reserve or
    -- hillside. Found by its name, which carries the component across a new
    -- number as well as a new spot (Western Tien-Shan's Boraldaitau area,
    -- 1490-005 to 1490-003 and 85 km): the part's point this one replaces,
    -- else one the list dropped, of the same name, on a part with no other
    -- point standing. A name that names nothing finds none.
    part := NULL;
    IF component.missing_since IS NULL AND NOT names_nothing(component.name) THEN
      SELECT p.part_id INTO part
        FROM experience_parts p
        JOIN experience_locations old ON old.experience_id = p.part_id AND old.merged_into_id IS NULL
       WHERE p.whole_id = site AND p.reason = 'component'
         AND name_match_key(old.name) = name_match_key(component.name)
         AND (old.id = component.withdrawal_deferred_for_location_id OR old.missing_since IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM experience_locations standing
                          WHERE standing.experience_id = p.part_id AND standing.merged_into_id IS NULL
                            AND standing.missing_since IS NULL AND standing.id <> old.id)
       ORDER BY old.id = component.withdrawal_deferred_for_location_id DESC,
                whc_ref_bare(old.external_ref) IS NOT DISTINCT FROM whc_ref_bare(component.external_ref) DESC,
                old.missing_since DESC NULLS FIRST, p.id
       LIMIT 1;
    END IF;
    IF part IS NOT NULL THEN
      UPDATE experience_locations SET experience_id = part WHERE id = component.id;
      CONTINUE;
    END IF;
    -- A part is a line the list names, under its reference (ADR-0198): a point
    -- the list gives no reference (a site's one main point, before a list of
    -- components) is no component and stays the site's own.
    IF component.external_ref IS NULL THEN
      CONTINUE;
    END IF;

    -- A part folded back into this site once its point stood for the whole
    -- site (migration 161) is revived rather than made again: it keeps the
    -- point's key, and a link to it opens it again.
    SELECT folded.id INTO part
      FROM experiences folded JOIN experiences whole ON whole.id = site
     WHERE folded.source_id = whole.source_id AND folded.external_id = 'part:' || component.id
       AND folded.merged_into_id = site;
    IF part IS NOT NULL THEN
      UPDATE experiences
         SET merged_into_id = NULL, location = component.location, updated_at = NOW(),
             -- The revived part keeps its own article (ADR-0156 decision 3), and
             -- a name a curator gave it (followTheirPoints leaves it too).
             name = CASE WHEN COALESCE(curated_fields, '[]'::jsonb) ? 'name' THEN name
                         ELSE component_part_name(component.name, metadata->>'wikipediaUrl', component.external_ref,
                                                  (SELECT whole.name FROM experiences whole WHERE whole.id = site)) END
       WHERE id = part;
    ELSE
      INSERT INTO experiences (source_id, external_id, name, location)
      SELECT whole.source_id, 'part:' || component.id,
             component_part_name(component.name, NULL, component.external_ref, whole.name),
             component.location
        FROM experiences whole WHERE whole.id = site
      RETURNING id INTO part;
    END IF;

    -- The part's record of World Heritage components in its site, under the
    -- component's reference; the relation follows it (parts_follow_records).
    -- A line the site's record of itself stood for (ADR-0200) moves with its
    -- point, its item, a curator's claim on it and its view with it.
    UPDATE source_records SET experience_id = part, updated_at = NOW()
     WHERE source_id = 10 AND whole_id = site AND experience_id = site
       AND lower(external_id) = lower(component.external_ref);
    -- A new record arrives as its line did (ADR-0213): pending where the
    -- site's source holds its new points for a curator, so the part waits
    -- for one too. A record moves out of pending only (guard_curation_state_move).
    IF NOT FOUND THEN
      INSERT INTO source_records (experience_id, whole_id, source_id, external_id, curation_state)
      VALUES (part, site, 10, component.external_ref,
              CASE WHEN component.curation_state = 'pending' THEN 'pending' ELSE 'auto' END);
    END IF;

    UPDATE experience_locations SET experience_id = part WHERE id = component.id;

    parted := parted + 1;
  END LOOP;
  RETURN parted;
END;
$$ LANGUAGE plpgsql;

-- A part's gate is its record in its whole (ADR-0213, #2123): World Heritage
-- components' record of the part says whether a curator has read the part
-- (curation_state), turned it down (admission, the shape of a curator's no to
-- an arrival), and whether the list still gives its line (missing_since,
-- source_membership). Until the writers write the record, it follows the
-- points that are its list line, which the run, the review queue and the
-- curator's verdicts still write.
--
-- A point is the line of the part's record in the whole `whole` when the
-- whole's own record in a kind placed it, or nothing did (a point from before
-- placements): another kind's point on a part merged with that kind's place
-- (Ephesus's Archaeology point) is that kind's, never the line's. The rule
-- recordOfPointSql (partFieldsWriter.ts) reads for the record's reference.
CREATE OR REPLACE FUNCTION is_part_line_point(point INTEGER, whole INTEGER) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (SELECT 1 FROM experience_location_placements pl WHERE pl.location_id = point)
      OR EXISTS (SELECT 1 FROM experience_location_placements pl
                   JOIN source_records site ON site.id = pl.membership_id
                  WHERE pl.location_id = point AND site.experience_id = whole AND site.kind_id IS NOT NULL);
$$;

-- Write the gate of the parts' records of the places `places` from their line
-- points, as the old gate reads them: read once one of them is published
-- (verified before auto), turned down while none is and every one still
-- asked about is refused, missing once all of them are (at the latest of
-- their marks), former once all of them are. A folded point is no line. A
-- move the guard refuses is not made (a new record a run wrote auto before its
-- pending point reached it): the record keeps its state, and the catalogue
-- check part-gate-out-of-step names it. A record with no line point keeps
-- what it holds. Writes only what differs, so a statement that changes no
-- gate writes no record.
CREATE OR REPLACE FUNCTION refresh_part_record_gates(places INTEGER[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF places IS NULL OR cardinality(places) = 0 THEN
    RETURN;
  END IF;
  WITH line AS (
    SELECT rec.id AS record_id, el.curation_state, el.refused_at, el.missing_since, el.source_membership
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
           max(refused_at) AS refused_at,
           CASE WHEN bool_and(missing_since IS NOT NULL) THEN max(missing_since) END AS missing_since,
           CASE WHEN bool_and(source_membership = 'former') THEN 'former' ELSE 'present' END AS source_membership
      FROM line GROUP BY record_id
  ),
  wanted AS (
    SELECT rec.id,
           CASE WHEN (rec.curation_state, gate.curation_state)
                     IN (('pending', 'verified'), ('auto', 'verified'), ('verified', 'auto'))
                THEN gate.curation_state ELSE rec.curation_state END AS curation_state,
           CASE WHEN gate.refused THEN 'refused' ELSE 'admitted' END AS admission,
           CASE WHEN gate.refused THEN 'kept out by a curator' END AS admission_reason,
           CASE WHEN gate.refused THEN gate.refused_at END AS admission_answered_at,
           gate.missing_since, gate.source_membership
      FROM gate JOIN source_records rec ON rec.id = gate.record_id
  )
  UPDATE source_records rec
     SET curation_state = wanted.curation_state,
         admission = wanted.admission,
         admission_reason = wanted.admission_reason,
         admission_answered_at = wanted.admission_answered_at,
         missing_since = wanted.missing_since,
         source_membership = wanted.source_membership,
         updated_at = NOW()
    FROM wanted
   WHERE rec.id = wanted.id
     AND (rec.curation_state, rec.admission, rec.admission_reason, rec.admission_answered_at,
          rec.missing_since, rec.source_membership)
         IS DISTINCT FROM
         (wanted.curation_state, wanted.admission, wanted.admission_reason, wanted.admission_answered_at,
          wanted.missing_since, wanted.source_membership);
END;
$$;

-- The points' side: a point added, deleted, moved to another place or folded,
-- read or refused, withdrawn or judged former refreshes the records of the
-- places it was and is on. One refresh per statement, never per row. A
-- placement written later is not followed: the run writes a point's placement
-- before it parts it, and parting moves the point, which is followed.
CREATE OR REPLACE FUNCTION part_record_gates_follow_points() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_part_record_gates(ARRAY(SELECT DISTINCT n.experience_id FROM new_points n));
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM refresh_part_record_gates(ARRAY(
      SELECT o.experience_id FROM old_points o JOIN new_points n ON n.id = o.id
       WHERE (o.experience_id, o.merged_into_id, o.curation_state, o.refused_at, o.missing_since, o.source_membership)
             IS DISTINCT FROM
             (n.experience_id, n.merged_into_id, n.curation_state, n.refused_at, n.missing_since, n.source_membership)
      UNION
      SELECT n.experience_id FROM old_points o JOIN new_points n ON n.id = o.id
       WHERE n.experience_id IS DISTINCT FROM o.experience_id));
  ELSE
    PERFORM refresh_part_record_gates(ARRAY(SELECT DISTINCT o.experience_id FROM old_points o));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_part_record_gates_point_insert ON experience_locations;
CREATE TRIGGER trg_part_record_gates_point_insert
  AFTER INSERT ON experience_locations
  REFERENCING NEW TABLE AS new_points
  FOR EACH STATEMENT EXECUTE FUNCTION part_record_gates_follow_points();
DROP TRIGGER IF EXISTS trg_part_record_gates_point_update ON experience_locations;
CREATE TRIGGER trg_part_record_gates_point_update
  AFTER UPDATE ON experience_locations
  REFERENCING OLD TABLE AS old_points NEW TABLE AS new_points
  FOR EACH STATEMENT EXECUTE FUNCTION part_record_gates_follow_points();
DROP TRIGGER IF EXISTS trg_part_record_gates_point_delete ON experience_locations;
CREATE TRIGGER trg_part_record_gates_point_delete
  AFTER DELETE ON experience_locations
  REFERENCING OLD TABLE AS old_points
  FOR EACH STATEMENT EXECUTE FUNCTION part_record_gates_follow_points();

-- The record's side: a part's record that moves to another place or whole (a
-- merge folding the part, the site's own line record taken by a new part)
-- takes the gate of its new place's line points.
CREATE OR REPLACE FUNCTION part_record_gate_follows_its_place() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_part_record_gates(ARRAY[NEW.experience_id]);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_part_record_gate_follows_its_place ON source_records;
CREATE TRIGGER trg_part_record_gate_follows_its_place
  AFTER UPDATE OF experience_id, whole_id ON source_records
  FOR EACH ROW WHEN (NEW.source_id = 10 AND NEW.whole_id IS NOT NULL
                     AND (OLD.experience_id, OLD.whole_id) IS DISTINCT FROM (NEW.experience_id, NEW.whole_id))
  EXECUTE FUNCTION part_record_gate_follows_its_place();

COMMIT;

-- The records a run wrote auto while their part's line points all waited for a
-- curator: pending, as part_site_components now writes them. The guard
-- refuses auto -> pending as a move; this is no move, since nobody answered
-- auto, so it is off for this statement alone.
BEGIN;

SET LOCAL lock_timeout = '10s';

ALTER TABLE source_records DISABLE TRIGGER guard_curation_state_move;

UPDATE source_records rec
   SET curation_state = 'pending', updated_at = NOW()
 WHERE rec.source_id = 10 AND rec.whole_id IS NOT NULL AND rec.whole_id <> rec.experience_id
   AND rec.curation_state = 'auto'
   AND EXISTS (SELECT 1 FROM experience_locations el
                WHERE el.experience_id = rec.experience_id AND el.merged_into_id IS NULL
                  AND is_part_line_point(el.id, rec.whole_id))
   AND NOT EXISTS (SELECT 1 FROM experience_locations el
                    WHERE el.experience_id = rec.experience_id AND el.merged_into_id IS NULL
                      AND is_part_line_point(el.id, rec.whole_id)
                      AND el.curation_state <> 'pending');

ALTER TABLE source_records ENABLE TRIGGER guard_curation_state_move;

COMMIT;

-- Every other column of the gate, from the line points.
BEGIN;

SELECT refresh_part_record_gates(ARRAY(
  SELECT DISTINCT rec.experience_id FROM source_records rec
   WHERE rec.source_id = 10 AND rec.whole_id IS NOT NULL AND rec.whole_id <> rec.experience_id));

COMMIT;

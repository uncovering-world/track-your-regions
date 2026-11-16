-- 252-a-new-parts-record-arrives-by-its-wholes-gate.sql
--
-- A serial site's new part's record arrives by the gate of its whole's source
-- (#2123, ADR-0213, part_site_components): pending where the site's source
-- holds its new points for a curator, or the site itself waits for one, and
-- the part's line is unread. A part revived with a line a reader already sees
-- is no arrival. Until now the record took its line point's state alone.
--
-- A curator's answer about a part is written on its record by the backend
-- (partRecordAnswerSql in membershipWriter.ts), with the record's line points
-- in the same statement as the points the answer reaches (answerPoints in
-- experienceLocationWriter.ts); that needs nothing of the schema.
--
-- No row changes: every record on a copy of the development catalogue
-- (2026-11-16) keeps its state, and part-gate-out-of-step lists nothing.
-- Order-independent with 01-schema.sql, which declares the same; re-runnable.

\set ON_ERROR_STOP on

BEGIN;

-- A serial site's components are places, part of the site: 01-schema.sql's
-- part_site_components(), whose new part's record now arrives by the gate of
-- its whole's source.
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
    -- A new record arrives by the gate of its whole's source (ADR-0213):
    -- pending where the site's source holds its new points for a curator, or
    -- the site itself waits for one, and its line is unread; a line a reader
    -- already sees (a part revived) is no arrival. A record moves out of
    -- pending only (guard_curation_state_move).
    IF NOT FOUND THEN
      INSERT INTO source_records (experience_id, whole_id, source_id, external_id, curation_state)
      VALUES (part, site, 10, component.external_ref,
              CASE WHEN component.curation_state = 'pending'
                        -- A site with no membership is gated by its points alone.
                        AND COALESCE((SELECT s.requires_curation OR m.curation_state = 'pending'
                                        FROM source_records m JOIN experience_sources s ON s.id = m.source_id
                                       WHERE m.id = site_membership), TRUE)
                   THEN 'pending' ELSE 'auto' END);
    END IF;

    UPDATE experience_locations SET experience_id = part WHERE id = component.id;

    parted := parted + 1;
  END LOOP;
  RETURN parted;
END;
$$ LANGUAGE plpgsql;

COMMIT;

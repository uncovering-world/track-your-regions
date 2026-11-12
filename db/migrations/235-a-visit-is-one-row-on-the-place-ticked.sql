-- 235-a-visit-is-one-row-on-the-place-ticked.sql
--
-- A traveller's visit is one row on the place they ticked (#2120). A tick on
-- a point was a row of user_visited_locations; it becomes a visit on the
-- point's own place, and the table goes. A whole a part belongs to is read as
-- visited through the part, never written.
--
-- A point's visit lands on its place as it stands now: the place a merge
-- folded it into, followed down the chain of merges. Where the traveller
-- already holds a visit there, the earlier date stands and both notes are
-- kept, as a merge reconciles two visits (ADR-0046 decision 5). On the
-- development catalogue (2026-11-12) the table holds 4 rows; 1 lands as a new
-- visit (the Wallace Collection, 6222), 3 on a visit already held. A chain of
-- merges deeper than 16 stops the migration rather than lose the visit.
--
-- A tick on a part used to write a visit on every whole it is a part of as
-- well. A row on a whole now means the traveller ticked the whole itself, so
-- a row on a whole beside the same traveller's visit on one of its direct
-- parts (a place visit, or a point visit that lands on the part) is taken as
-- that cascade's and removed, before the fold, where the whole reads that
-- part's visit: a standing part with a point a reader is shown, so the whole
-- reads partly visited as it did. Kept where it cannot be told from the
-- traveller's own: a row with a note or a rating, which a person wrote, and a
-- row a point visit of theirs lands on or passes through, a tick on one of
-- the whole's own points. A direct tick made beside a part's visit cannot be
-- told from the cascade's row and goes with it (ADR-0199).
-- On the development catalogue (2026-11-12) that removes 1 row, on the
-- Monasteries of Haghpat and Sanahin (405), which holds no point of its own.
--
-- part_site_components, as migration 234 declares it, loses the arm that
-- moved a point's visits onto the part it made, and is otherwise unchanged.
-- Order-independent with 01-schema.sql, which declares the same.
-- Re-runnable: the fold and the drop run only while the table stands.

\set ON_ERROR_STOP on

BEGIN;

-- The visits table takes row locks only; the point table's exclusive lock
-- for the drop must not wait behind a long transaction.
SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public.user_visited_locations') IS NOT NULL THEN
    -- No point visit is written between the snapshot below and the drop: a
    -- backend still writing them waits, then fails on the dropped table.
    LOCK TABLE user_visited_locations IN ACCESS EXCLUSIVE MODE;

    CREATE TEMP TABLE followed_visits ON COMMIT DROP AS
    WITH RECURSIVE followed (user_id, place_id, visited_at, notes, depth) AS (
      SELECT uvl.user_id, el.experience_id, uvl.visited_at, uvl.notes, 0
        FROM user_visited_locations uvl
        JOIN experience_locations el ON el.id = uvl.location_id
      UNION ALL
      SELECT followed.user_id, e.merged_into_id, followed.visited_at, followed.notes, followed.depth + 1
        FROM followed JOIN experiences e ON e.id = followed.place_id
       WHERE e.merged_into_id IS NOT NULL AND followed.depth < 16)
    SELECT * FROM followed;

    IF EXISTS (SELECT 1 FROM followed_visits f JOIN experiences e ON e.id = f.place_id
                WHERE e.merged_into_id IS NOT NULL AND f.depth = 16) THEN
      RAISE EXCEPTION 'A point visit sits 16 or more merges from a standing place: follow its chain by hand before user_visited_locations is dropped';
    END IF;

    -- The cascade's rows on a whole, as the old code left them: beside the
    -- traveller's visit on one of its direct parts that the whole reads (a
    -- standing part with a point a reader is shown, so the whole keeps the
    -- state it showed), with nothing a person wrote on them and no point
    -- visit of theirs landing on the whole.
    DELETE FROM user_visited_experiences w
     WHERE w.notes IS NULL AND w.rating IS NULL
       AND EXISTS (SELECT 1 FROM experience_parts prt
                     JOIN experiences part ON part.id = prt.part_id AND part.merged_into_id IS NULL
                    WHERE prt.whole_id = w.experience_id
                      AND EXISTS (SELECT 1 FROM experience_locations shown
                                   WHERE shown.experience_id = part.id AND shown.merged_into_id IS NULL
                                     AND shown.missing_since IS NULL AND shown.existence <> 'lost'
                                     AND shown.curation_state <> 'pending')
                      AND (EXISTS (SELECT 1 FROM user_visited_experiences pv
                                    WHERE pv.experience_id = prt.part_id AND pv.user_id = w.user_id)
                           OR EXISTS (SELECT 1 FROM followed_visits pf
                                       WHERE pf.place_id = prt.part_id AND pf.user_id = w.user_id)))
       AND NOT EXISTS (SELECT 1 FROM followed_visits f
                        WHERE f.place_id = w.experience_id AND f.user_id = w.user_id);

    INSERT INTO user_visited_experiences AS v (user_id, experience_id, visited_at, notes)
    SELECT f.user_id, f.place_id, min(f.visited_at), NULLIF(string_agg(DISTINCT f.notes, E'\n\n'), '')
      FROM followed_visits f JOIN experiences e ON e.id = f.place_id
     WHERE e.merged_into_id IS NULL
     GROUP BY f.user_id, f.place_id
    ON CONFLICT (user_id, experience_id) DO UPDATE
       SET visited_at = LEAST(v.visited_at, EXCLUDED.visited_at),
           notes = CASE WHEN COALESCE(EXCLUDED.notes, '') = '' OR EXCLUDED.notes = v.notes THEN v.notes
                        WHEN COALESCE(v.notes, '') = '' THEN EXCLUDED.notes
                        ELSE v.notes || E'\n\n' || EXCLUDED.notes END;

    DROP TABLE user_visited_locations;
  END IF;
END $$;

COMMENT ON TABLE user_visited_experiences IS 'A traveller''s visits, one row on each place they ticked: a part, a place, or a whole ticked as a whole. A whole is read as visited through its direct parts'' rows, never written; a row on a place a merge folded is kept for the undo and never read (#2120).';

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
    SELECT el.id, el.name, el.external_ref, el.location, el.missing_since, el.withdrawal_deferred_for_location_id
      FROM experience_locations el
     WHERE el.experience_id = site AND el.merged_into_id IS NULL
       AND (EXISTS (SELECT 1 FROM experience_location_placements pl
                     WHERE pl.location_id = el.id AND pl.membership_id = site_membership)
            OR NOT EXISTS (SELECT 1 FROM experience_location_placements pl
                            WHERE pl.location_id = el.id))
       AND NOT stands_for_whole_site(el.name, el.external_ref,
             (SELECT whole.name FROM experiences whole WHERE whole.id = site),
             (SELECT m.external_id FROM source_records m WHERE m.id = site_membership), 2)
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
             -- The revived part keeps its own article (ADR-0156 decision 3).
             name = component_part_name(component.name, metadata->>'wikipediaUrl', component.external_ref,
                                        (SELECT whole.name FROM experiences whole WHERE whole.id = site))
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
    IF NOT FOUND THEN
      INSERT INTO source_records (experience_id, whole_id, source_id, external_id)
      VALUES (part, site, 10, component.external_ref);
    END IF;

    UPDATE experience_locations SET experience_id = part WHERE id = component.id;

    parted := parted + 1;
  END LOOP;
  RETURN parted;
END;
$$ LANGUAGE plpgsql;

COMMIT;

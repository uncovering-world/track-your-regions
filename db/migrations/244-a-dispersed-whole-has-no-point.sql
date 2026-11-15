-- 244-a-dispersed-whole-has-no-point.sql
--
-- A dispersed whole has no point of its own (#2122, ADR-0210): a serial World
-- Heritage site is its parts, and experiences.location is NULL exactly on it.
-- Before this, every one of the 482 wholes of the development catalogue held
-- ADR-0095's anchor, the component nearest its components' centroid.
-- Measured on a copy of it (2026-11-15): 25 parts revived, 486 wholes with no
-- point, the 25 parts named apart from their site, no row a reader is
-- offered in a region removed, about 1 s of statements and 3.7 s of commit
-- (the crowding recounts the points leave).
-- The parts are revived rather than made: migration 161 had folded each.
--
-- What it changes on a database that holds the catalogue:
--
-- * Every line of a serial site is a part. 16 sites kept the line named like
--   them as a point of their own (#1899): Prague's 616bis-001, Kakadu's
--   147quater-001, Graz's 931ter-002 (Schloss Eggenberg, which the list names
--   like the site), W-Arly-Pendjari's 749quater-001 twice. Each becomes a part,
--   so each site counts one leaf more (Graz 1 of 1 becomes 2). 4 sites whose
--   lines all carry the site's name, one per country, were one place of two
--   points and become wholes of two parts: Ohrid, Białowieża Forest,
--   Koutammakou and Waterton Glacier International Peace Park.
-- * A point under the site's own reference is the export's site coordinate,
--   no line, and is deleted with its record: Wudang's 705, which stood beside
--   45 parts still waiting for a curator. Its record's point keeps Wudang in
--   Hubei (ADR-0207 decision 2). A visit is on the place (ADR-0199), so none
--   is lost. Baalbek's 294 stays while Archaeology's Baalbek is folded into it
--   (#2119).
-- * Every whole takes its shape (whole_shape_of): all 486 are dispersed, since
--   all hold the World Heritage record, and give up their point, with a
--   curator's claim on it, which no answer to a question about it could write.
-- * A part named like its site never reads with the site's name
--   (component_part_name_apart): the transboundary sites' lines are named by
--   their countries, "Białowieża Forest (Poland)" and "Białowieża Forest
--   (Belarus)", the other parts named like their site by region, "Historic
--   Centre of Prague (Praha 1)": the 25 revived parts on the copy, their
--   names printed below. Every other part keeps its name.
-- * The places it touched are placed again, by their geometry first.
--
-- Two transactions: the schema, then the rows (a table's shape changes before
-- its rows are written, db/migrations/README.md). Order-independent with
-- 01-schema.sql, which declares the same. Re-runnable: the column and the
-- constraint are created where missing, the functions and triggers replaced,
-- and a second backfill finds nothing to do.

\set ON_ERROR_STOP on

BEGIN;

-- The ALTERs take experiences, experience_parts and experience_locations
-- exclusively for milliseconds: a long transaction on them must not stall
-- their writers behind this one.
SET LOCAL lock_timeout = '10s';

ALTER TABLE experiences ALTER COLUMN location DROP NOT NULL;
COMMENT ON COLUMN experiences.location IS 'The place''s point. NULL exactly on a dispersed whole, which is its parts and has no point of its own (whole_shape, ADR-0210).';

-- A whole's shape (ADR-0210): dispersed, a place a traveller visits one part
-- of at a time, which is its parts and holds no point of its own (Seville's
-- World Heritage site is its cathedral, its Alcázar and its Archivo de
-- Indias); or container, one a traveller stands inside, which keeps its own
-- point. NULL on a place that is not a whole. A serial World Heritage site is
-- always dispersed, whatever the walk between its parts (Würzburg's two, 159 m
-- apart).
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS whole_shape VARCHAR(10)
    CHECK (whole_shape IN ('dispersed', 'container'));
COMMENT ON COLUMN experiences.whole_shape IS 'A whole''s shape (ADR-0210): dispersed (its parts, no point of its own: a serial World Heritage site) or container (one place a traveller stands inside, keeping its point); NULL on a place that is not a whole. Written by whole_shape_follows_parts() when the place gains its first part or loses its last.';
ALTER TABLE experiences DROP CONSTRAINT IF EXISTS experiences_location_iff_not_dispersed;
ALTER TABLE experiences ADD CONSTRAINT experiences_location_iff_not_dispersed
    CHECK ((location IS NULL) = (whole_shape IS NOT DISTINCT FROM 'dispersed'));

-- The shape a place takes as it becomes a whole (ADR-0210): dispersed when it
-- holds a World Heritage record, or its parts' standing points lie more than
-- 1 km apart; container otherwise. Asked once, when the first parts arrive:
-- a container's later parts do not move its shape (an outlier 44 km off would
-- otherwise take a valley's point away), and the check whole-shape-drift
-- names one they would.
CREATE OR REPLACE FUNCTION whole_shape_of(place INTEGER) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM source_records r WHERE r.experience_id = place AND r.source_id = 1) THEN 'dispersed'
    WHEN EXISTS (
      SELECT 1
        FROM experience_parts pa JOIN experience_locations a ON a.experience_id = pa.part_id
        JOIN experience_parts pb ON pb.whole_id = pa.whole_id JOIN experience_locations b ON b.experience_id = pb.part_id
       WHERE pa.whole_id = place
         AND a.missing_since IS NULL AND a.existence <> 'lost' AND a.merged_into_id IS NULL AND a.refused_at IS NULL
         AND b.missing_since IS NULL AND b.existence <> 'lost' AND b.merged_into_id IS NULL AND b.refused_at IS NULL
         AND NOT ST_DWithin(a.location::geography, b.location::geography, 1000)) THEN 'dispersed'
    ELSE 'container' END
$$;
COMMENT ON FUNCTION whole_shape_of(INTEGER) IS 'The shape a place takes as it becomes a whole (ADR-0210): dispersed with a World Heritage record or parts more than 1 km apart, else container.';

-- Keeps every whole's shape and point in step with its parts (ADR-0210): a
-- place that gains its first part takes its shape (whole_shape_of), and gives
-- up its point when dispersed, with a curator's claim on it, which no answer
-- could then write; a whole that loses its last part is a place of
-- its own again, at the point its kind record reports (the World Heritage
-- record's first), else at a standing point of its own; with neither it keeps
-- its shape.
CREATE OR REPLACE FUNCTION whole_shape_follows_parts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE experiences e
       SET whole_shape = shaped.shape,
           location = CASE WHEN shaped.shape = 'dispersed' THEN NULL ELSE e.location END,
           curated_fields = CASE WHEN shaped.shape = 'dispersed' THEN e.curated_fields - 'location' ELSE e.curated_fields END,
           updated_at = NOW()
      -- OFFSET 0 keeps the subquery whole, so whole_shape_of runs once per
      -- whole rather than once for every column that reads its answer.
      FROM (SELECT w.whole_id, whole_shape_of(w.whole_id) AS shape
              FROM (SELECT DISTINCT n.whole_id FROM new_parts n) w OFFSET 0) shaped
     WHERE e.id = shaped.whole_id AND e.whole_shape IS NULL;
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

DROP TRIGGER IF EXISTS trg_whole_shape_part_insert ON experience_parts;
CREATE TRIGGER trg_whole_shape_part_insert
  AFTER INSERT ON experience_parts
  REFERENCING NEW TABLE AS new_parts
  FOR EACH STATEMENT EXECUTE FUNCTION whole_shape_follows_parts();
DROP TRIGGER IF EXISTS trg_whole_shape_part_delete ON experience_parts;
CREATE TRIGGER trg_whole_shape_part_delete
  AFTER DELETE ON experience_parts
  REFERENCING OLD TABLE AS old_parts
  FOR EACH STATEMENT EXECUTE FUNCTION whole_shape_follows_parts();

-- The GADM divisions that hold the point `at`, from its leaf (depth 0) up to
-- the root: the leaf the point lies in, picked in id order so a point on the
-- shared edge of two leaves reads one chain every time, then each division
-- above it, named without GADM's qualifier ("Ilha De Mocambique (Cidade)" is
-- Ilha De Mocambique). Nothing for a point no division holds (one offshore).
CREATE OR REPLACE FUNCTION divisions_holding(at GEOMETRY)
RETURNS TABLE (division_id INTEGER, division_name TEXT, depth INTEGER)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up AS (
    SELECT leaf.id, leaf.parent_id, leaf.name, 0 AS level
      FROM (SELECT d.id, d.parent_id, d.name FROM administrative_divisions d
             WHERE NOT d.has_children AND ST_Intersects(d.geom, at)
             ORDER BY d.id LIMIT 1) leaf
    UNION ALL
    SELECT a.id, a.parent_id, a.name, up.level + 1
      FROM administrative_divisions a JOIN up ON a.id = up.parent_id
     WHERE up.level < 12
  )
  SELECT up.id, btrim(regexp_replace(up.name, '\s*\([^)]*\)\s*$', '')), up.level FROM up
$$;

-- What the component part shown by the point `point` reads as in its site
-- `site`, from `base`, what its point names it (component_part_name). A part
-- named like its site (name_match_key folds them equal: every line of a
-- serial site is a part, the one named like the site too, ADR-0210) never
-- reads with the site's name (#2122), since "1 of 2" over two places of one
-- name tells a traveller nothing. It takes the site's spelling, so
-- Białowieża's lines, which the list spells "Bialowieza Forest", keep the
-- Polish letters, and where it stands in parentheses: the most general GADM
-- division its point lies in (divisions_holding) that holds no other line
-- named like the site and not the site's every other part, so a site across
-- several countries reads by country, "Białowieża Forest (Poland)" beside
-- "Białowieża Forest (Belarus)", and one in a single country by region,
-- "Historic Centre of Prague (Praha 1)" beside Průhonice Park. Where every
-- such division holds the site's other parts too and no other line is named
-- like the site, the most local one: "Kakadu National Park (West Arnhem)"
-- beside its two islands. Where no division tells it apart, it keeps the
-- site's name: no reference or other id is ever a name. Every other part
-- reads as its point names it, a sibling's namesake included. A line of the
-- site counts here while its point stands and is no arrival waiting for a
-- curator: a part readers see is not renamed for one nobody has read.
CREATE OR REPLACE FUNCTION component_part_name_apart(base TEXT, point INTEGER, site INTEGER)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
  site_name TEXT;
  site_key TEXT;
  at GEOMETRY;
  own_part INTEGER;
  namesakes GEOMETRY[];
  others GEOMETRY[];
  hint TEXT;
BEGIN
  IF base IS NULL OR site IS NULL THEN
    RETURN base;
  END IF;
  SELECT e.name INTO site_name FROM experiences e WHERE e.id = site;
  site_key := name_match_key(site_name);
  IF name_match_key(base) IS DISTINCT FROM site_key THEN
    RETURN base;
  END IF;
  SELECT el.location, el.experience_id INTO at, own_part FROM experience_locations el WHERE el.id = point;

  -- The site's other standing lines, and among them those named like it.
  SELECT array_agg(sp.location) FILTER (WHERE name_match_key(sp.name) = site_key), array_agg(sp.location)
    INTO namesakes, others
    FROM experience_parts wp
    JOIN experience_locations sp ON sp.experience_id = wp.part_id
   WHERE wp.whole_id = site AND wp.reason = 'component' AND wp.part_id <> own_part
     AND sp.merged_into_id IS NULL AND sp.missing_since IS NULL AND sp.existence <> 'lost' AND sp.refused_at IS NULL
     AND sp.curation_state <> 'pending';

  WITH own AS (
    SELECT c.division_id, c.division_name, c.depth FROM divisions_holding(at) c
     WHERE position(' ' || name_match_key(c.division_name) || ' ' IN ' ' || site_key || ' ') = 0
  ), namesake_divisions AS (
    SELECT n.ord, d.division_id FROM unnest(namesakes) WITH ORDINALITY AS n(location, ord)
      LEFT JOIN LATERAL divisions_holding(n.location) d ON true
  ), other_divisions AS (
    SELECT o.ord, d.division_id FROM unnest(others) WITH ORDINALITY AS o(location, ord)
      JOIN LATERAL divisions_holding(o.location) d ON true
  )
  SELECT COALESCE(
    -- The most general division that tells it apart: no other line named like
    -- the site in it (each such line in some division, or none can be told
    -- apart), and some other part of the site outside it.
    (SELECT own.division_name FROM own
      WHERE NOT EXISTS (SELECT 1 FROM namesake_divisions nd WHERE nd.division_id IS NULL OR nd.division_id = own.division_id)
        AND EXISTS (SELECT 1 FROM other_divisions od GROUP BY od.ord HAVING NOT bool_or(od.division_id = own.division_id))
      ORDER BY own.depth DESC LIMIT 1),
    -- The only line named like the site, whose divisions all hold its other
    -- parts too: where it is, as locally as the divisions say.
    (SELECT own.division_name FROM own WHERE namesakes IS NULL ORDER BY own.depth LIMIT 1))
    INTO hint;
  RETURN CASE WHEN hint IS NULL THEN site_name ELSE site_name || ' (' || hint || ')' END;
END;
$$;

-- A serial site's components are places, part of the site (ADR-0100): the one
-- statement of which of a site's points are its components and how each
-- becomes a part. Called by migration 094 over every World Heritage site and
-- by the World Heritage run after it writes a site's points
-- (writeExperienceLocations, under the site's lock). `site_membership` is the site's
-- World Heritage membership. A component is a point of the site's own that
-- this membership places, or that no membership places (a row from before
-- placements); another source's point on the place (an Archaeology dig the
-- same row holds) is not one. A site whose components are parts already gets
-- every new one parted; one of a single component stays one place (ADR-0088).
-- Each part is a place of one point: the point keeps its id, so its
-- placements, regions, claims and candidates follow it. A traveller's visit
-- to the component becomes a visit to the part (ADR-0100 decision 5), the
-- record a merge reconciles with another kind's visits to the same place.
-- It is named for its point (component_part_name) and stands where its point
-- does, both written by the writers of the point (followTheirPoints); its
-- picture, subtitle and article are the part row's (ADR-0156). A part with no kind of
-- its own is listed nowhere: lists find it through its site. Every line of a
-- serial site is a part, the one named like the site too (ADR-0210): Prague's
-- 616bis-001 is the part "Historic Centre of Prague" beside Průhonice Park,
-- since a dispersed whole holds no point of its own. A part migration 161
-- folded back into its site is revived. Only a point under the site's own
-- reference (Baalbek's 294, the export's site coordinate before its list had
-- lines) is no line and stays the site's. Answers how many points it parted.
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

-- The rows, in one transaction. It holds the region keys of the places it
-- places again until it commits.
BEGIN;

CREATE TEMP TABLE touched (place_id INTEGER PRIMARY KEY) ON COMMIT DROP;

-- Every World Heritage site parted as its run would part it on its next pass:
-- the 16 sites holding a line named like them, and the 4 transboundary sites
-- whose lines all carry the site's name (Białowieża Forest, one line in
-- Poland and one in Belarus), which become wholes of their lines.
CREATE TEMP TABLE parted ON COMMIT DROP AS
SELECT e.id, e.name, part_site_components(e.id, m.id) AS parted
  FROM experiences e
  JOIN source_records m ON m.experience_id = e.id AND m.source_id = 1
 WHERE e.merged_into_id IS NULL
 ORDER BY e.id;
SELECT id, name, parted FROM parted WHERE parted > 0 ORDER BY id;
INSERT INTO touched SELECT id FROM parted WHERE parted > 0;

INSERT INTO touched SELECT p.part_id FROM experience_parts p JOIN touched t ON t.place_id = p.whole_id
ON CONFLICT DO NOTHING;

-- A whole's point under the site's own reference, with the record of it. A
-- point a merge folded another into stays (Baalbek's 294 holds Archaeology's
-- Baalbek, merge 67), for the merge's undo to find (#2119); the check
-- whole-own-point names it meanwhile.
WITH bare AS (
  SELECT el.id AS point_id, e.id AS place_id, m.external_id
    FROM experiences e
    JOIN source_records m ON m.experience_id = e.id AND m.source_id = 1
    JOIN experience_locations el ON el.experience_id = e.id AND el.external_ref = m.external_id
   WHERE EXISTS (SELECT 1 FROM experience_parts p WHERE p.whole_id = e.id)
     AND NOT EXISTS (SELECT 1 FROM experience_locations folded WHERE folded.merged_into_id = el.id)
), gone_records AS (
  DELETE FROM source_records r USING bare
   WHERE r.source_id = 10 AND r.experience_id = bare.place_id AND r.whole_id = bare.place_id
     AND r.external_id = bare.external_id
  RETURNING r.experience_id
), gone_points AS (
  DELETE FROM experience_locations el USING bare WHERE el.id = bare.point_id
  RETURNING el.experience_id
)
INSERT INTO touched SELECT experience_id FROM gone_points UNION SELECT experience_id FROM gone_records
ON CONFLICT DO NOTHING;

-- Every whole takes its shape, and a dispersed one gives up its point.
UPDATE experiences e
   SET whole_shape = shaped.shape,
       location = CASE WHEN shaped.shape = 'dispersed' THEN NULL ELSE e.location END,
       updated_at = NOW()
  FROM (SELECT w.whole_id, whole_shape_of(w.whole_id) AS shape
          FROM (SELECT DISTINCT whole_id FROM experience_parts) w OFFSET 0) shaped
 WHERE e.id = shaped.whole_id AND e.whole_shape IS NULL;

-- And a curator's claim on that point with it: a conflict or a held move the
-- last run filed about the anchor (anchorToItsPoint claimed it) has nothing
-- left to write, and its answer releases the field (releasedOnTheWhole).
UPDATE experiences SET curated_fields = curated_fields - 'location', updated_at = NOW()
 WHERE whole_shape = 'dispersed' AND curated_fields ? 'location';

-- Every component part named as the run names it (component_part_name_apart,
-- followTheirPoints, partFollowsSql): a part named like its site is named
-- apart from it, Białowieża's two lines "Białowieża Forest (Poland)" and
-- "Białowieża Forest (Belarus)"; a part a curator named,
-- or one holding a kind of its own, keeps its name. Its point is the one a
-- reader sees first: standing, then published, then the older.
WITH named AS (
  SELECT p.id AS part_id, p.name AS before,
         component_part_name_apart(component_part_name(pt.name, p.metadata->>'wikipediaUrl', pt.external_ref, w.name),
                                   pt.id, w.id) AS after
    FROM (SELECT DISTINCT ON (el.experience_id) el.id, el.experience_id, el.name, el.external_ref
            FROM experience_locations el
           WHERE el.merged_into_id IS NULL
             AND EXISTS (SELECT 1 FROM experience_parts poc WHERE poc.part_id = el.experience_id AND poc.reason = 'component')
           ORDER BY el.experience_id, el.missing_since IS NULL DESC, el.curation_state <> 'pending' DESC, el.id) pt
    JOIN experiences p ON p.id = pt.experience_id
    CROSS JOIN LATERAL (SELECT w.id, w.name FROM experience_parts wp JOIN experiences w ON w.id = wp.whole_id
                         WHERE wp.part_id = p.id AND wp.reason = 'component' ORDER BY wp.whole_id LIMIT 1) w
   WHERE NOT COALESCE(p.curated_fields, '[]'::jsonb) ? 'name'
     AND NOT EXISTS (SELECT 1 FROM source_records held_kind WHERE held_kind.experience_id = p.id AND held_kind.kind_id IS NOT NULL)
), renamed AS (
  UPDATE experiences part SET name = named.after, updated_at = NOW()
    FROM named
   WHERE part.id = named.part_id AND named.after IS NOT NULL AND part.name IS DISTINCT FROM named.after
  RETURNING part.id, named.before, part.name AS after
)
SELECT id AS part, before, after FROM renamed ORDER BY id;

-- Placed again where it changed: every whole, whose outline no longer has a
-- point to reach (outline_reaches_place), and the places touched above, by
-- their geometry in every world view that has some, then their region rows
-- (ADR-0207).
INSERT INTO touched SELECT DISTINCT whole_id FROM experience_parts ON CONFLICT DO NOTHING;
SELECT w.world_view_id, refresh_place_shape_regions(ARRAY(SELECT place_id FROM touched), w.world_view_id) AS shape_rows_written
  FROM (SELECT DISTINCT world_view_id FROM regions WHERE geom IS NOT NULL ORDER BY world_view_id) w;
SELECT refresh_place_regions(ARRAY(SELECT place_id FROM touched)) AS rows_written;

COMMIT;

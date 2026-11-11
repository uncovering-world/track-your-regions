-- 232-a-part-record-is-a-record-in-a-whole.sql
--
-- A serial site's part's record is a record in its whole, and the virtual kind
-- World Heritage components goes (#2118, ADR-0198, narrowing ADR-0156
-- decisions 1 and 2).
--
-- Until now each part held a membership of the virtual kind 10, keyed by its
-- earliest relation (`component:<experience_parts.id>`), and every reader that
-- offers a place left kind 10 out. From here a source record places its place
-- in a kind (`kind_id`) or in a whole (`whole_id`), never both, and a part's
-- record of World Heritage components (source 10) is one per relation: in the
-- relation's whole, under the component's reference. What the file does:
--
--   1. experience_sources.id_scheme, the shape of each source's ids
--      (whc-site for source 1, whc-component for 10, wikidata for 2-9), and
--      experience_sources.kind_id nullable: source 10 fills no kind.
--   2. source_records.whole_id, kind_id nullable, and the record's keys: one
--      record per (source, whole, place), the (source, external id) key kept
--      for a record in a kind only, since a reference is not unique in a list
--      (Maloti-Drakensberg's 985ter-001 names Sehlabathebe and uKhahlamba).
--   3. The functions that read kind 10 read a record in a whole instead, and
--      the relation's trigger writes one record per relation.
--   4. Every kind-10 membership becomes its relation's record: whole_id the
--      relation's whole, external_id the relation's reference, kind_id NULL.
--      Its id, item, view and a curator's claims stay, and the keys and the
--      id scheme, in place before it, hold each record as it is written.
--      Asserted one record per relation and none left in kind 10.
--   5. Kind 10 and experience_kinds.is_virtual go.
--
-- Every change of source_records' shape comes before its first row write: the
-- table's deferred crowding triggers leave events pending from that write to
-- the commit, and Postgres refuses ALTER TABLE on a table with pending events.
-- The backfill's triggers write nothing a reader sees: the crowding triggers
-- run at the commit and find no kind with a crowding rule on either side (kind
-- 10 had none, and none is no kind); the pairing mark leaves a record in a
-- whole out (mark_pairing_due, replaced in step 3); the listing is not fired (no
-- missing_since, source_membership or experience_id changes); and the
-- identifier registry refreshes each part's values to the rows it held.
--
-- No reader-facing row changes: kind 10 was the only virtual kind, so every
-- reader that left it out leaves out the same records by kind_id IS NULL.
-- Compatible with migration 231 in either order: it neither drops nor
-- recreates experience_parts, and adds no trigger of its own there but the
-- record's.
--
-- Re-runnable: each step is guarded on what it changes still being there.
-- Order: BEFORE the next re-application of 01-schema.sql, which declares the
-- sources' id_scheme NOT NULL and no longer seeds kind 10.

\set ON_ERROR_STOP on

BEGIN;

-- 1. The sources' id schemes.
ALTER TABLE experience_sources ADD COLUMN IF NOT EXISTS id_scheme VARCHAR(20)
    CHECK (id_scheme IN ('whc-site', 'whc-component', 'wikidata', 'wikidata-statement', 'curator'));
UPDATE experience_sources
   SET id_scheme = CASE name
                     WHEN 'UNESCO World Heritage Sites' THEN 'whc-site'
                     WHEN 'World Heritage components' THEN 'whc-component'
                     ELSE 'wikidata'
                   END
 WHERE id_scheme IS NULL;
ALTER TABLE experience_sources ALTER COLUMN id_scheme SET NOT NULL;
ALTER TABLE experience_sources ALTER COLUMN kind_id DROP NOT NULL;

-- 2. A record in a kind or in a whole.
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS whole_id INTEGER REFERENCES experiences(id) ON DELETE CASCADE;
ALTER TABLE source_records ALTER COLUMN kind_id DROP NOT NULL;
COMMENT ON COLUMN source_records.whole_id IS 'The whole the record places the place in as a part -- the serial World Heritage site whose component the place is -- NULL on a record in a kind (ADR-0198). Written with the part-of relation it records (component_record_follows_relation).';
-- The (source, external id) key holds for a record in a kind only; dropped
-- before the backfill, which gives two parts of Maloti-Drakensberg one
-- reference.
ALTER TABLE source_records DROP CONSTRAINT IF EXISTS source_records_source_external_key;
CREATE UNIQUE INDEX IF NOT EXISTS source_records_kind_source_external
    ON source_records (source_id, external_id) WHERE kind_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_source_records_whole ON source_records (whole_id) WHERE whole_id IS NOT NULL;
-- Both hold before the backfill as after it: a kind-10 membership is in a kind
-- and becomes a record in a whole in one write, and the relations it becomes
-- the records of are unique per (whole, part).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_kind_or_whole') THEN
        ALTER TABLE source_records ADD CONSTRAINT source_records_kind_or_whole CHECK (num_nonnulls(kind_id, whole_id) = 1);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_records_one_per_whole') THEN
        ALTER TABLE source_records ADD CONSTRAINT source_records_one_per_whole UNIQUE (source_id, whole_id, experience_id);
    END IF;
END $$;

-- 3. The functions, as 01-schema.sql states them.
CREATE OR REPLACE FUNCTION recompute_place_listing(place_id INTEGER) RETURNS void AS $$
BEGIN
    UPDATE experiences e
       SET missing_since = d.missing_since,
           source_membership = d.source_membership
      FROM (SELECT CASE WHEN bool_and(m.missing_since IS NOT NULL) THEN max(m.missing_since) END AS missing_since,
                   CASE WHEN bool_and(m.source_membership = 'former') THEN 'former' ELSE 'present' END AS source_membership
              FROM source_records m
             WHERE m.experience_id = place_id
               AND m.kind_id IS NOT NULL) d
     WHERE e.id = place_id
       AND (e.missing_since IS DISTINCT FROM d.missing_since
            OR e.source_membership IS DISTINCT FROM d.source_membership);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION source_id_fits_scheme(p_scheme TEXT, p_id TEXT) RETURNS BOOLEAN AS $$
  SELECT CASE p_scheme
           WHEN 'whc-site' THEN p_id ~ '^[0-9]+$'
           WHEN 'whc-component' THEN p_id ~ '^[0-9]+[a-z]*(-[0-9]+[A-Za-z]*( [0-9]+)?)?$'
           WHEN 'wikidata' THEN p_id ~ '^Q[1-9][0-9]*$'
           WHEN 'wikidata-statement' THEN p_id ~ '^Q[1-9][0-9]*[$][0-9A-Fa-f-]+$'
           WHEN 'curator' THEN p_id ~ '^curator-[0-9]+-[0-9]+$'
           ELSE false
         END
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION source_record_fits_scheme() RETURNS trigger AS $$
DECLARE
  scheme TEXT;
BEGIN
  IF NEW.whole_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT s.id_scheme INTO scheme FROM experience_sources s WHERE s.id = NEW.source_id;
  IF NOT (source_id_fits_scheme(scheme, NEW.external_id) OR source_id_fits_scheme('curator', NEW.external_id)) THEN
    RAISE EXCEPTION 'source record id % does not fit the % scheme of source %', NEW.external_id, scheme, NEW.source_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION place_identifier_claims(p_scheme TEXT, p_values TEXT[])
RETURNS TABLE (experience_id INTEGER, value TEXT, basis TEXT, claims BOOLEAN)
LANGUAGE sql STABLE AS $$
  SELECT m.experience_id, m.external_id::text, 'membership', true
    FROM source_records m
    JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'wikidata' AND m.external_id = ANY(p_values) AND m.external_id ~ '^Q[0-9]+$'
  UNION ALL
  SELECT m.experience_id, item, 'site-items',
         cardinality(m.wikidata_items) = 1
           AND (SELECT count(*) FROM experience_locations one_point
                 WHERE one_point.experience_id = m.experience_id
                   AND one_point.merged_into_id IS NULL AND one_point.missing_since IS NULL) = 1
    FROM source_records m
    JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
    CROSS JOIN LATERAL unnest(m.wikidata_items) AS item
   WHERE p_scheme = 'wikidata' AND m.wikidata_items && p_values::text[] AND item = ANY(p_values)
     AND m.kind_id IS NOT NULL
  UNION ALL
  SELECT rec.experience_id, item, 'component-item',
         NOT EXISTS (SELECT 1 FROM source_records other
                       JOIN experiences other_place ON other_place.id = other.experience_id
                        AND other_place.merged_into_id IS NULL
                      WHERE other.source_id = 10 AND other.whole_id IS NOT NULL AND other.wikidata_items @> ARRAY[item]
                        AND other.experience_id <> rec.experience_id
                        AND EXISTS (SELECT 1 FROM experience_locations other_point
                                     WHERE other_point.experience_id = other.experience_id
                                       AND other_point.merged_into_id IS NULL AND other_point.missing_since IS NULL))
           AND NOT EXISTS (SELECT 1 FROM experience_locations other
                             JOIN experiences other_place ON other_place.id = other.experience_id
                              AND other_place.merged_into_id IS NULL
                            WHERE other.wikidata_item = item AND other.experience_id <> rec.experience_id
                              AND other.merged_into_id IS NULL AND other.missing_since IS NULL)
    FROM source_records rec
    JOIN experiences e ON e.id = rec.experience_id AND e.merged_into_id IS NULL
    CROSS JOIN LATERAL unnest(rec.wikidata_items) AS item
   WHERE p_scheme = 'wikidata' AND rec.source_id = 10 AND rec.whole_id IS NOT NULL
     AND rec.wikidata_items && p_values::text[] AND item = ANY(p_values)
     -- A part whose point stands, as a point's item counted only a standing point.
     AND EXISTS (SELECT 1 FROM experience_locations standing
                  WHERE standing.experience_id = rec.experience_id
                    AND standing.merged_into_id IS NULL AND standing.missing_since IS NULL)
  UNION ALL
  SELECT point.experience_id, point.wikidata_item::text, 'point',
         NOT EXISTS (SELECT 1 FROM experience_locations other
                       JOIN experiences other_place ON other_place.id = other.experience_id
                        AND other_place.merged_into_id IS NULL
                      WHERE other.wikidata_item = point.wikidata_item
                        AND other.experience_id <> point.experience_id
                        AND other.merged_into_id IS NULL AND other.missing_since IS NULL)
           AND NOT EXISTS (SELECT 1 FROM source_records other_rec
                             JOIN experiences other_place ON other_place.id = other_rec.experience_id
                              AND other_place.merged_into_id IS NULL
                            WHERE other_rec.source_id = 10 AND other_rec.whole_id IS NOT NULL
                              AND other_rec.wikidata_items @> ARRAY[point.wikidata_item::text]
                              AND other_rec.experience_id <> point.experience_id
                              AND EXISTS (SELECT 1 FROM experience_locations other_point
                                           WHERE other_point.experience_id = other_rec.experience_id
                                             AND other_point.merged_into_id IS NULL AND other_point.missing_since IS NULL))
    FROM experience_locations point
    JOIN experiences e ON e.id = point.experience_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'wikidata' AND point.wikidata_item = ANY(p_values)
     AND point.merged_into_id IS NULL AND point.missing_since IS NULL
  UNION ALL
  SELECT m.experience_id, m.external_id::text, 'membership', true
    FROM source_records m
    JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'whc' AND m.source_id = 1 AND m.external_id = ANY(p_values)
  UNION ALL
  SELECT prt.part_id, prt.external_ref, 'component',
         NOT EXISTS (SELECT 1 FROM experience_parts other
                       JOIN experiences other_part ON other_part.id = other.part_id
                        AND other_part.merged_into_id IS NULL
                      WHERE other.reason = 'component' AND other.external_ref = prt.external_ref
                        AND other.part_id <> prt.part_id)
    FROM experience_parts prt
    JOIN experiences e ON e.id = prt.part_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'whc' AND prt.reason = 'component' AND prt.external_ref = ANY(p_values)
  UNION ALL
  -- A curator's word (ADR-0143 decision 5): identifies claims whether or not a
  -- column carries the value; refers carries it without claiming; removed is
  -- applied by place_identifiers_expected(), which drops the row.
  SELECT v.experience_id, v.value::text, 'curator', v.verdict = 'identifies'
    FROM place_identifier_verdicts v
    JOIN experiences e ON e.id = v.experience_id AND e.merged_into_id IS NULL
   WHERE v.scheme = p_scheme AND v.value = ANY(p_values) AND v.verdict IN ('identifies', 'refers')
$$;

CREATE OR REPLACE FUNCTION mark_pairing_due() RETURNS TRIGGER AS $$
DECLARE
  ids INTEGER[];
  row_kind INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'experiences' THEN
    ids := ARRAY[CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.id END,
                 CASE WHEN TG_OP = 'UPDATE' THEN NEW.merged_into_id END];
  ELSIF TG_TABLE_NAME = 'experience_parts' THEN
    ids := CASE WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.whole_id, OLD.part_id] ELSE ARRAY[NEW.whole_id, NEW.part_id] END;
  ELSIF TG_TABLE_NAME = 'experience_separations' THEN
    ids := ARRAY[NEW.original_id, NEW.separated_id];
  ELSE
    -- A record in a whole changes nothing the pairing reads (ADR-0198): the
    -- part it records was marked when it was parted. Its own IF, since an AND
    -- would not keep the other tables' rows from being asked for a kind_id
    -- they do not have.
    IF TG_TABLE_NAME = 'source_records' THEN
      IF TG_OP = 'DELETE' THEN
        row_kind := OLD.kind_id;
      ELSE
        row_kind := NEW.kind_id;
      END IF;
      IF row_kind IS NULL THEN
        RETURN NULL;
      END IF;
    END IF;
    -- source_records and experience_locations: the row's place, and
    -- the place it left where it moved.
    ids := ARRAY[CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.experience_id END,
                 CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.experience_id END];
  END IF;
  -- DO UPDATE, not DO NOTHING: it locks a mark that is already there, so a
  -- drain deleting it waits for this transaction to commit and then pairs the
  -- place as this transaction left it.
  INSERT INTO experience_pairing_due (experience_id)
  SELECT DISTINCT i FROM unnest(ids) AS i
   WHERE i IS NOT NULL AND EXISTS (SELECT 1 FROM experiences e WHERE e.id = i)
  ON CONFLICT (experience_id) DO UPDATE SET marked_at = NOW();
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS refresh_component_record(INTEGER);
CREATE OR REPLACE FUNCTION refresh_component_record(p_whole INTEGER, p_part INTEGER) RETURNS void AS $$
DECLARE
  ref TEXT;
BEGIN
  SELECT p.external_ref INTO ref FROM experience_parts p
   WHERE p.whole_id = p_whole AND p.part_id = p_part AND p.reason = 'component';
  IF NOT FOUND THEN
    DELETE FROM source_records rec
     WHERE rec.source_id = 10 AND rec.whole_id = p_whole AND rec.experience_id = p_part;
  ELSIF ref IS NULL THEN
    -- A record is the list's view under the list's own id: a component the
    -- list never gave a reference (a site's one main point, parted once a later
    -- list names components) has none until it has a reference, and a record
    -- whose relation loses its reference keeps what it holds -- the reference
    -- it was last listed under, its item and a curator's claim on it -- since
    -- no run may take a curator's claim away.
    NULL;
  ELSE
    INSERT INTO source_records (experience_id, whole_id, source_id, external_id)
    VALUES (p_part, p_whole, 10, ref)
    ON CONFLICT (source_id, whole_id, experience_id) DO UPDATE
       SET external_id = EXCLUDED.external_id, updated_at = NOW()
     WHERE source_records.external_id IS DISTINCT FROM EXCLUDED.external_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION component_record_follows_relation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.whole_id, OLD.part_id) IS DISTINCT FROM (NEW.whole_id, NEW.part_id) THEN
    -- The record itself moves with the relation, keeping its item, its view
    -- and a curator's claims, so a merge's undo, which moves both back, finds
    -- the row it moved. A merge moves the part's own records first
    -- (moveMemberships), and then there is nothing left here to move.
    UPDATE source_records rec
       SET experience_id = NEW.part_id, whole_id = NEW.whole_id, updated_at = NOW()
     WHERE rec.source_id = 10 AND rec.whole_id = OLD.whole_id AND rec.experience_id = OLD.part_id
       AND NOT EXISTS (SELECT 1 FROM source_records held
                        WHERE held.source_id = 10 AND held.whole_id = NEW.whole_id
                          AND held.experience_id = NEW.part_id);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    PERFORM refresh_component_record(OLD.whole_id, OLD.part_id);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM refresh_component_record(NEW.whole_id, NEW.part_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_component_record_follows_relation ON experience_parts;
CREATE TRIGGER trg_component_record_follows_relation
  AFTER INSERT OR DELETE ON experience_parts
  FOR EACH ROW EXECUTE FUNCTION component_record_follows_relation();
DROP TRIGGER IF EXISTS trg_component_record_follows_relation_move ON experience_parts;
CREATE TRIGGER trg_component_record_follows_relation_move
  AFTER UPDATE OF whole_id, part_id, reason, external_ref ON experience_parts
  FOR EACH ROW WHEN ((OLD.whole_id, OLD.part_id, OLD.reason, OLD.external_ref)
                     IS DISTINCT FROM (NEW.whole_id, NEW.part_id, NEW.reason, NEW.external_ref))
  EXECUTE FUNCTION component_record_follows_relation();

-- Holds the backfill's records to the component scheme as they are written.
DROP TRIGGER IF EXISTS trg_source_record_fits_scheme ON source_records;
CREATE TRIGGER trg_source_record_fits_scheme
    BEFORE INSERT OR UPDATE OF source_id, external_id, whole_id ON source_records
    FOR EACH ROW EXECUTE FUNCTION source_record_fits_scheme();

-- 4. Each kind-10 membership becomes the record of the relation that owns it.
-- Every ALTER TABLE of source_records is above this line: the table carries
-- deferred constraint triggers (crowding_follows_membership_change and
-- _delete), so its first row write leaves events pending until the commit,
-- and Postgres refuses an ALTER TABLE or a CREATE INDEX on it from then on.
-- Every part of the development catalogue has exactly one relation, each with
-- a reference, so each record has one; a record whose relation is gone, or
-- names no reference the list knows the part by, has no record to become.
DELETE FROM source_records rec
 WHERE rec.kind_id = 10
   AND NOT EXISTS (SELECT 1 FROM experience_parts p
                    WHERE rec.external_id = 'component:' || p.id AND p.external_ref IS NOT NULL);
UPDATE source_records rec
   SET whole_id = p.whole_id, external_id = p.external_ref, kind_id = NULL, updated_at = NOW()
  FROM experience_parts p
 WHERE rec.kind_id = 10 AND rec.external_id = 'component:' || p.id;
-- A relation of a place that is a component of two sites had no record of its
-- own (the place's one was keyed by its earliest relation); it gets one now.
INSERT INTO source_records (experience_id, whole_id, source_id, external_id)
SELECT p.part_id, p.whole_id, 10, p.external_ref
  FROM experience_parts p
 WHERE p.reason = 'component' AND p.external_ref IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM source_records rec
                    WHERE rec.source_id = 10 AND rec.whole_id = p.whole_id AND rec.experience_id = p.part_id);

-- 5. The virtual kind goes.
UPDATE experience_sources SET kind_id = NULL WHERE id_scheme = 'whc-component' AND kind_id IS NOT NULL;
DELETE FROM experience_kinds
 WHERE name = 'World Heritage components'
   AND EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'experience_kinds' AND column_name = 'is_virtual');
ALTER TABLE experience_kinds DROP COLUMN IF EXISTS is_virtual;
ALTER TABLE experience_sources DROP CONSTRAINT IF EXISTS experience_sources_fills_kind_or_wholes;
ALTER TABLE experience_sources ADD CONSTRAINT experience_sources_fills_kind_or_wholes
    CHECK ((kind_id IS NULL) = (id_scheme IN ('whc-component', 'wikidata-statement', 'curator')));


-- Every component relation with a reference has its record, every record in
-- a whole a relation, and the reference of each is the relation's.
DO $$
DECLARE
    unrecorded INTEGER;
    unrelated INTEGER;
    left_in_kind INTEGER;
BEGIN
    SELECT count(*) INTO unrecorded FROM experience_parts p
     WHERE p.reason = 'component' AND p.external_ref IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM source_records rec
                        WHERE rec.source_id = 10 AND rec.whole_id = p.whole_id AND rec.experience_id = p.part_id
                          AND rec.external_id = p.external_ref);
    SELECT count(*) INTO unrelated FROM source_records rec
     WHERE rec.whole_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM experience_parts p
                        WHERE p.whole_id = rec.whole_id AND p.part_id = rec.experience_id AND p.reason = 'component');
    SELECT count(*) INTO left_in_kind FROM source_records rec
     WHERE rec.kind_id IS NULL AND rec.whole_id IS NULL;
    IF unrecorded > 0 OR unrelated > 0 OR left_in_kind > 0 THEN
        RAISE EXCEPTION 'migration 232: % relations without their record, % records in a whole without a relation, % records in neither',
            unrecorded, unrelated, left_in_kind;
    END IF;
END $$;

COMMIT;

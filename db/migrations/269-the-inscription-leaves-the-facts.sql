-- 269-the-inscription-leaves-the-facts.sql
--
-- A World Heritage Site's inscription leaves source_records.facts for the
-- typed tables 265 made and 266 filled (#2127, ADR-0225 § From today's
-- database to the model, B3): the criteria, the area, transboundary and
-- UNESCO's region in record_heritage_inscriptions, the year of inscription as
-- the start of the membership's listing in record_listings, and the current
-- stay on the List of World Heritage in Danger in record_danger_periods. The
-- backend reads and writes them there from this file on
-- (backend/src/db/inscription.ts, inscriptionWriter.ts), so:
--
-- * the place is marked due for pairing when its inscribed area changes, from
--   record_heritage_inscriptions (trg_inscription_area_pairing and
--   trg_inscription_area_pairing_write), no longer from the facts;
-- * 266's carry of the inscription runs once more, verbatim, for the facts
--   the runs wrote since it ran;
-- * the seven keys leave the facts, and a CHECK keeps them out.
--
-- The stays that ended (Cologne Cathedral 2004 to 2006) and the date of a
-- delisting (Liverpool, 21 July 2021) are in no column of today: the UNESCO
-- run reads them from Wikidata's statements (services/sync/heritageHistory.ts).
--
-- The shape first and the rows after (db/migrations/README.md): the CHECK is
-- added NOT VALID before the rows are written, and validated once the
-- deferred trigger events the writes queued have fired (SET CONSTRAINTS ALL
-- IMMEDIATE). Re-runnable: every statement writes only a row that differs.
--
-- Run it before the next re-application of db/init/01-schema.sql, which adds
-- the same CHECK validated and so fails on a database whose facts still hold
-- the seven keys.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';

-- The shape ----------------------------------------------------------------

-- One function for every table: the row's place, and for a move between
-- places both of them.
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
  ELSIF TG_TABLE_NAME = 'record_heritage_inscriptions' THEN
    -- The inscribed area gives a World Heritage membership its reach: the
    -- record's place.
    SELECT array_agg(s.experience_id) INTO ids
      FROM source_records s
     WHERE s.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.record_id ELSE NEW.record_id END;
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

-- A membership's inputs to the pairing, the inscribed area no longer among them.
DROP TRIGGER IF EXISTS pairing_due_membership_update ON source_records;
CREATE TRIGGER pairing_due_membership_update AFTER UPDATE ON source_records
  FOR EACH ROW WHEN (OLD.experience_id IS DISTINCT FROM NEW.experience_id
                     OR OLD.reported_name IS DISTINCT FROM NEW.reported_name
                     OR OLD.kind_id IS DISTINCT FROM NEW.kind_id
                     OR OLD.admission IS DISTINCT FROM NEW.admission
                     OR OLD.curation_state IS DISTINCT FROM NEW.curation_state)
  EXECUTE FUNCTION mark_pairing_due();

DROP TRIGGER IF EXISTS trg_inscription_area_pairing ON record_heritage_inscriptions;
CREATE TRIGGER trg_inscription_area_pairing
    AFTER UPDATE OF area_ha ON record_heritage_inscriptions
    FOR EACH ROW WHEN (OLD.area_ha IS DISTINCT FROM NEW.area_ha)
    EXECUTE FUNCTION mark_pairing_due();
DROP TRIGGER IF EXISTS trg_inscription_area_pairing_write ON record_heritage_inscriptions;
CREATE TRIGGER trg_inscription_area_pairing_write
    AFTER INSERT OR DELETE ON record_heritage_inscriptions
    FOR EACH ROW EXECUTE FUNCTION mark_pairing_due();

ALTER TABLE source_records DROP CONSTRAINT IF EXISTS source_records_facts_hold_no_inscription_check;
ALTER TABLE source_records ADD CONSTRAINT source_records_facts_hold_no_inscription_check
    CHECK (NOT (facts ?| ARRAY['dateInscribed', 'inDanger', 'dangerList', 'criteria', 'region', 'transboundary', 'areaHectares']))
    NOT VALID;

COMMENT ON COLUMN source_records.facts IS 'The kind''s own facts about the place (year, creators, wikidataClasses, artworkCount, admissionNote, the tier that admitted the row where it is the surroundings one, ...), written by the source''s run every pass; one a reader is shown waits behind the gate on a held place. No other kind''s run writes them, and a refused membership keeps its own (ADR-0153, ADR-0154, ADR-0171, ADR-0178, #1775, #2068, #2178). A World Heritage Site''s inscription is held in record_heritage_inscriptions, record_listings and record_danger_periods instead, never here (#2127).';

-- 266's carry of a World Heritage membership's facts, once more ------------

INSERT INTO record_heritage_inscriptions (record_id, criteria, area_ha, transboundary, unesco_region)
SELECT r.id,
       NULLIF(ARRAY(SELECT m[1] FROM regexp_matches(COALESCE(r.facts->>'criteria', ''),
                                                    '(\((?:viii|vii|vi|iv|v|ix|x|iii|ii|i)\))', 'g') AS m), '{}')::varchar(6)[],
       CASE WHEN r.facts->>'areaHectares' ~ '^[0-9]+(\.[0-9]+)?$'
             AND round((r.facts->>'areaHectares')::numeric, 2) > 0
             AND round((r.facts->>'areaHectares')::numeric, 2) < 1e12
            THEN round((r.facts->>'areaHectares')::numeric, 2) END,
       COALESCE(CASE WHEN jsonb_typeof(r.facts->'transboundary') = 'boolean' THEN (r.facts->>'transboundary')::boolean END, false),
       CASE WHEN r.facts->>'region' IN ('Africa', 'Arab States', 'Asia and the Pacific', 'Europe and North America',
                                        'Latin America and the Caribbean') THEN r.facts->>'region' END
  FROM source_records r
  JOIN experience_kinds k ON k.id = r.kind_id AND k.list_kept_outside
 WHERE r.source_id = 1
   AND r.facts ?| ARRAY['criteria', 'areaHectares', 'transboundary', 'region']
ON CONFLICT (record_id) DO UPDATE
   SET criteria = EXCLUDED.criteria, area_ha = EXCLUDED.area_ha, transboundary = EXCLUDED.transboundary,
       unesco_region = EXCLUDED.unesco_region
 WHERE (record_heritage_inscriptions.criteria, record_heritage_inscriptions.area_ha,
        record_heritage_inscriptions.transboundary, record_heritage_inscriptions.unesco_region)
       IS DISTINCT FROM (EXCLUDED.criteria, EXCLUDED.area_ha, EXCLUDED.transboundary, EXCLUDED.unesco_region);

-- A current stay on the Danger List: the importer's inDanger flag says
-- whether there is one wherever it is set, since the run sets it from the flag
-- and the listing together and a curator who took the flag off left the
-- listing as it was; a record with no flag reads the listing. "Y 2013" is
-- open since 2013; "Y" with no year, or the flag with no listing, is open
-- since a date not known. "N" or nothing writes no stay. Until its slice of #2458 the
-- dataset is the only word on a UNESCO stay no curator decided, so a re-run
-- follows it, in four steps that never delete a stay: a stay the facts no
-- longer read is closed (ended, its end not known); the last stay, closed so
-- and of the same year, opens again when the facts read it again; an open
-- stay takes the year the facts now give; and a site that reads in danger
-- with no open stay gets one after the stays it holds (a re-entry that would
-- overlap one waits for the slice that reads the stays' dates from Wikidata).
-- A record whose facts hold none of the seven keys was carried by an earlier
-- application of this file, so a replay leaves its stays as they stand.
UPDATE record_danger_periods p SET ended = true
 WHERE p.source_id = 1 AND p.decided_at IS NULL AND NOT p.ended
   AND EXISTS (SELECT 1 FROM source_records r
                WHERE r.id = p.record_id
                  AND r.facts ?| ARRAY['dateInscribed', 'inDanger', 'dangerList', 'criteria', 'region', 'transboundary', 'areaHectares'])
   AND NOT EXISTS (SELECT 1 FROM source_records r
                    WHERE r.id = p.record_id
                      AND CASE WHEN jsonb_typeof(r.facts->'inDanger') = 'boolean' THEN (r.facts->>'inDanger')::boolean
                           ELSE COALESCE(r.facts->>'dangerList' ~ '^\s*[Yy](\s+[0-9]{4})?\s*$', false) END);

UPDATE record_danger_periods p SET ended = false
  FROM (SELECT r.id, substring(r.facts->>'dangerList' FROM '^\s*[Yy]\s+([0-9]{4})\s*$')::integer AS y
          FROM source_records r
          JOIN experience_kinds k ON k.id = r.kind_id AND k.list_kept_outside
         WHERE r.source_id = 1
           AND CASE WHEN jsonb_typeof(r.facts->'inDanger') = 'boolean' THEN (r.facts->>'inDanger')::boolean
                ELSE COALESCE(r.facts->>'dangerList' ~ '^\s*[Yy](\s+[0-9]{4})?\s*$', false) END) d
 WHERE p.record_id = d.id AND p.source_id = 1 AND p.decided_at IS NULL AND p.ended AND p.until_year IS NULL
   AND (d.y IS NULL OR p.from_year IS NOT DISTINCT FROM d.y)
   AND p.ordinal = (SELECT max(s.ordinal) FROM record_danger_periods s WHERE s.record_id = p.record_id)
   AND NOT EXISTS (SELECT 1 FROM record_danger_periods o WHERE o.record_id = p.record_id AND NOT o.ended);

UPDATE record_danger_periods p SET from_year = d.y, from_first = day_index(d.y, 1, 1)
  FROM (SELECT r.id, substring(r.facts->>'dangerList' FROM '^\s*[Yy]\s+([0-9]{4})\s*$')::integer AS y
          FROM source_records r
          JOIN experience_kinds k ON k.id = r.kind_id AND k.list_kept_outside
         WHERE r.source_id = 1
           AND CASE WHEN jsonb_typeof(r.facts->'inDanger') = 'boolean' THEN (r.facts->>'inDanger')::boolean
                ELSE COALESCE(r.facts->>'dangerList' ~ '^\s*[Yy](\s+[0-9]{4})?\s*$', false) END) d
 WHERE p.record_id = d.id AND d.y IS NOT NULL
   AND p.source_id = 1 AND p.decided_at IS NULL AND NOT p.ended
   AND p.from_year IS DISTINCT FROM d.y;

INSERT INTO record_danger_periods (record_id, ordinal, from_year, from_first, ended, source_id)
SELECT d.id, COALESCE(prev.last_ordinal, 0) + 1, d.y, day_index(d.y, 1, 1), false, 1
  FROM (SELECT r.id, substring(r.facts->>'dangerList' FROM '^\s*[Yy]\s+([0-9]{4})\s*$')::integer AS y
          FROM source_records r
          JOIN experience_kinds k ON k.id = r.kind_id AND k.list_kept_outside
         WHERE r.source_id = 1
           AND CASE WHEN jsonb_typeof(r.facts->'inDanger') = 'boolean' THEN (r.facts->>'inDanger')::boolean
                ELSE COALESCE(r.facts->>'dangerList' ~ '^\s*[Yy](\s+[0-9]{4})?\s*$', false) END) d
 CROSS JOIN LATERAL (SELECT max(s.ordinal) AS last_ordinal, max(COALESCE(s.until_last, s.from_first)) AS last_day,
                            bool_or(NOT s.ended) AS open
                       FROM record_danger_periods s WHERE s.record_id = d.id) prev
 WHERE NOT COALESCE(prev.open, false)
   AND (prev.last_ordinal IS NULL OR (d.y IS NOT NULL AND day_index(d.y, 1, 1) > prev.last_day))
ON CONFLICT (record_id, ordinal) DO NOTHING;

-- The listing: from the year of inscription; ended where the list no longer
-- names the site.
INSERT INTO record_listings (record_id, ordinal, from_year, from_first, ended, ending, source_id)
SELECT l.id, 1, l.y, day_index(l.y, 1, 1), l.former, CASE WHEN l.former THEN 'delisted' END, 1
  FROM (SELECT r.id, substring(r.facts->>'dateInscribed' FROM '^\s*([0-9]{4})')::integer AS y,
               r.source_membership = 'former' AS former
          FROM source_records r
          JOIN experience_kinds k ON k.id = r.kind_id AND k.list_kept_outside
         WHERE r.source_id = 1) l
 WHERE l.y IS NOT NULL OR l.former
ON CONFLICT (record_id, ordinal) DO UPDATE
   SET from_year = EXCLUDED.from_year, from_first = EXCLUDED.from_first,
       ended = EXCLUDED.ended, ending = EXCLUDED.ending, updated_at = now()
 WHERE record_listings.source_id = 1 AND record_listings.decided_at IS NULL
   AND (record_listings.from_year, record_listings.ended, record_listings.ending)
       IS DISTINCT FROM (EXCLUDED.from_year, EXCLUDED.ended, EXCLUDED.ending);

-- The facts ----------------------------------------------------------------

UPDATE source_records
   SET facts = facts - ARRAY['dateInscribed', 'inDanger', 'dangerList', 'criteria', 'region', 'transboundary', 'areaHectares']
 WHERE facts ?| ARRAY['dateInscribed', 'inDanger', 'dangerList', 'criteria', 'region', 'transboundary', 'areaHectares'];

SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE source_records VALIDATE CONSTRAINT source_records_facts_hold_no_inscription_check;

COMMIT;

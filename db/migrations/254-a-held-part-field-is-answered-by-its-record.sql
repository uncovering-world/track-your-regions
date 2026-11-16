-- 254-a-held-part-field-is-answered-by-its-record.sql
--
-- A curator's answer to a held field of a serial site's part is keyed by the
-- part's record in the site (ADR-0213 decision 4, #2123): a line the list
-- renumbers or renames keeps its answer. The object's own field, a museum's work and a
-- cast keep the part as the record names it.
--
-- * experience_held_decisions gains record_id, and its one unique key becomes
--   two: the record's, and the named part's for every other row.
-- * Every answer about a part of a site is given its record: the site's part
--   record under the answer's reference, one whose part or view carries the
--   answer's name first (itemRecordSql, heldDecisions.ts). On the development
--   catalogue on 2026-11-16, all 35 answers about parts, on 20 sites, resolve
--   to one record each, and no two to one key. An answer no record answers
--   keeps its name and is matched by it, as before.
--
-- Re-runnable: the column and the keys are declared if missing, and the
-- backfill writes only answers that hold no record yet.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';

ALTER TABLE experience_held_decisions ADD COLUMN IF NOT EXISTS record_id INTEGER
    REFERENCES source_records(id) ON DELETE CASCADE;
ALTER TABLE experience_held_decisions DROP CONSTRAINT IF EXISTS experience_held_decisions_answer_key;
CREATE UNIQUE INDEX IF NOT EXISTS experience_held_decisions_named_key
    ON experience_held_decisions (experience_id, part_kind, part_ref, part_name, field, source_id)
    NULLS NOT DISTINCT WHERE record_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS experience_held_decisions_record_key
    ON experience_held_decisions (experience_id, record_id, field, source_id)
    NULLS NOT DISTINCT WHERE record_id IS NOT NULL;
COMMENT ON COLUMN experience_held_decisions.record_id IS 'The record of a serial site''s part the answer is about (ADR-0213 decision 4); NULL for the object own field and for every other part, named by part_ref and part_name';

UPDATE experience_held_decisions d
   SET record_id = (CASE WHEN d.part_kind = 'locations' THEN (
      SELECT ir.id FROM source_records ir JOIN experiences ip ON ip.id = ir.experience_id
       WHERE ir.whole_id = d.experience_id AND ir.source_id = 10 AND ir.whole_id IS NOT NULL AND ir.whole_id <> ir.experience_id
         AND lower(ir.external_id) = lower(d.part_ref)
       ORDER BY (btrim(regexp_replace(ip.name, '(\s|\u00a0|\u1680|\u2000|\u2001|\u2002|\u2003|\u2004|\u2005|\u2006|\u2007|\u2008|\u2009|\u200a|\u2028|\u2029|\u202f|\u205f|\u3000|\ufeff)+', ' ', 'g'), ' ') = btrim(regexp_replace(d.part_name, '(\s|\u00a0|\u1680|\u2000|\u2001|\u2002|\u2003|\u2004|\u2005|\u2006|\u2007|\u2008|\u2009|\u200a|\u2028|\u2029|\u202f|\u205f|\u3000|\ufeff)+', ' ', 'g'), ' ')
                 OR btrim(regexp_replace(ir.reported_name, '(\s|\u00a0|\u1680|\u2000|\u2001|\u2002|\u2003|\u2004|\u2005|\u2006|\u2007|\u2008|\u2009|\u200a|\u2028|\u2029|\u202f|\u205f|\u3000|\ufeff)+', ' ', 'g'), ' ') = btrim(regexp_replace(d.part_name, '(\s|\u00a0|\u1680|\u2000|\u2001|\u2002|\u2003|\u2004|\u2005|\u2006|\u2007|\u2008|\u2009|\u200a|\u2028|\u2029|\u202f|\u205f|\u3000|\ufeff)+', ' ', 'g'), ' ')) IS TRUE DESC, ir.id
       LIMIT 1) END)
 WHERE d.part_kind = 'locations' AND d.record_id IS NULL;

COMMIT;

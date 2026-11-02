-- 201-a-question-keeps-the-date-it-was-first-asked.sql
--
-- A review question was dated by the latest run that proposed it, so a held
-- Wikipedia article for My Son Sanctuary, proposed by every Places of worship
-- run since 2026-10-01, showed as 2026-11-01's question; 280 of the 289 open
-- held cards on the development catalogue had been proposed with the same
-- values before. Each changeset row now records, per proposed value, the run
-- that first proposed it (first_asked), and the latest of those per flag
-- (held_first_sync_log_id, conflict_first_sync_log_id), which is the date the
-- held and conflict cards carry (ADR-0173, #2229).
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent or replaced, and the
-- backfill stamps only rows not stamped yet.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_sync_changes ADD COLUMN IF NOT EXISTS first_asked JSONB;
ALTER TABLE experience_sync_changes ADD COLUMN IF NOT EXISTS held_first_sync_log_id INTEGER
  REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
ALTER TABLE experience_sync_changes ADD COLUMN IF NOT EXISTS conflict_first_sync_log_id INTEGER
  REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
COMMENT ON COLUMN experience_sync_changes.first_asked IS 'Per proposed value, the run that first proposed it (ADR-0173, #2229): {"held": {key: run}, "curatedConflict": {key: run}}, a key per field of the object (f:<field>) and per field of a part (p:<kind>:<item>:<field>). A value the source''s previous run proposed the same hands on that run''s; any other starts at this run. Stamped on insert by stamp_first_asked().';
COMMENT ON COLUMN experience_sync_changes.held_first_sync_log_id IS 'The latest of first_asked''s held runs: when the newest question this row holds was first asked, the date its held card carries (ADR-0173). Null where the row holds nothing.';
COMMENT ON COLUMN experience_sync_changes.conflict_first_sync_log_id IS 'The same as held_first_sync_log_id for the values a curator''s claim kept out (curatedConflict): the date a conflict card carries (ADR-0173).';

-- The values a row proposes under one flag ('held' or 'curatedConflict'), one
-- per field: the object's own as f:<field>, a part's as p:<kind>:<item>:<field>.
CREATE OR REPLACE FUNCTION proposal_entries(changed_fields jsonb, contents jsonb, flag text)
RETURNS TABLE (key text, value jsonb)
LANGUAGE sql IMMUTABLE AS $$
  SELECT 'f:' || (f->>'field'), COALESCE(f->'new', 'null'::jsonb)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(changed_fields) = 'array'
                                   THEN changed_fields ELSE '[]'::jsonb END) f
   WHERE (f->>flag)::boolean
  UNION ALL
  SELECT 'p:' || k.key || ':' || (c->'item')::text || ':' || (fl->>'field'), COALESCE(fl->'new', 'null'::jsonb)
    FROM jsonb_each(CASE WHEN jsonb_typeof(contents) = 'object' THEN contents ELSE '{}'::jsonb END) k
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(k.value->'changed') = 'array'
                                                THEN k.value->'changed' ELSE '[]'::jsonb END) c
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c->'fields') = 'array'
                                                THEN c->'fields' ELSE '[]'::jsonb END) fl
   WHERE (fl->>flag)::boolean
$$;

-- When each value of one flag was first proposed, for a row of run `run` about
-- `place` from `source`: a value the source's previous run for the place
-- proposed the same keeps that run's first run; any other value starts at this
-- run. A run that wrote no row for the place in between leaves the values
-- standing: it proposed nothing new. Dry runs are no runs here.
CREATE OR REPLACE FUNCTION first_asked_runs(
  place integer, source integer, run integer, changed_fields jsonb, contents jsonb, flag text
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  prev_run integer;
  prev_values jsonb := '{}'::jsonb;
  prev_firsts jsonb := '{}'::jsonb;
  firsts jsonb;
BEGIN
  IF place IS NOT NULL AND source IS NOT NULL THEN
    SELECT p.sync_log_id INTO prev_run
      FROM experience_sync_changes p
      JOIN experience_sync_logs pl ON pl.id = p.sync_log_id
     WHERE p.experience_id = place AND pl.source_id = source AND NOT pl.is_dry_run
       AND p.sync_log_id < run
     ORDER BY p.sync_log_id DESC
     LIMIT 1;
  END IF;
  IF prev_run IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO prev_values
      FROM experience_sync_changes p, proposal_entries(p.changed_fields, p.contents, flag) e
     WHERE p.experience_id = place AND p.sync_log_id = prev_run;
    SELECT COALESCE(jsonb_object_agg(x.key, x.value), '{}'::jsonb) INTO prev_firsts
      FROM experience_sync_changes p, jsonb_each(COALESCE(p.first_asked->flag, '{}'::jsonb)) x
     WHERE p.experience_id = place AND p.sync_log_id = prev_run;
  END IF;
  SELECT jsonb_object_agg(e.key, CASE WHEN prev_values->e.key = e.value
                                      THEN COALESCE(prev_firsts->e.key, to_jsonb(prev_run))
                                      ELSE to_jsonb(run) END)
    INTO firsts
    FROM proposal_entries(changed_fields, contents, flag) e;
  RETURN firsts;
END $$;

CREATE OR REPLACE FUNCTION stamp_first_asked() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source integer;
  dry boolean;
  held jsonb;
  claimed jsonb;
BEGIN
  SELECT l.source_id, l.is_dry_run INTO source, dry FROM experience_sync_logs l WHERE l.id = NEW.sync_log_id;
  IF dry THEN source := NULL; END IF;
  held := first_asked_runs(NEW.experience_id, source, NEW.sync_log_id, NEW.changed_fields, NEW.contents, 'held');
  claimed := first_asked_runs(NEW.experience_id, source, NEW.sync_log_id, NEW.changed_fields, NEW.contents, 'curatedConflict');
  NEW.first_asked := NULLIF(jsonb_strip_nulls(jsonb_build_object('held', held, 'curatedConflict', claimed)), '{}'::jsonb);
  NEW.held_first_sync_log_id := (SELECT max(v::int) FROM jsonb_each_text(held) AS x(k, v));
  NEW.conflict_first_sync_log_id := (SELECT max(v::int) FROM jsonb_each_text(claimed) AS x(k, v));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_first_asked ON experience_sync_changes;
CREATE TRIGGER trg_stamp_first_asked
  BEFORE INSERT ON experience_sync_changes
  FOR EACH ROW EXECUTE FUNCTION stamp_first_asked();

-- The rows already recorded, oldest run first, so a row's previous run is
-- stamped before the row reads it. Only rows that hold or meet a claim.
DO $$
DECLARE
  r record;
  held jsonb;
  claimed jsonb;
BEGIN
  FOR r IN
    SELECT ch.id, ch.sync_log_id, ch.experience_id, ch.changed_fields, ch.contents,
           CASE WHEN l.is_dry_run THEN NULL ELSE l.source_id END AS source_id
      FROM experience_sync_changes ch
      JOIN experience_sync_logs l ON l.id = ch.sync_log_id
     WHERE ch.first_asked IS NULL
       AND (EXISTS (SELECT 1 FROM proposal_entries(ch.changed_fields, ch.contents, 'held'))
            OR EXISTS (SELECT 1 FROM proposal_entries(ch.changed_fields, ch.contents, 'curatedConflict')))
     ORDER BY ch.sync_log_id, ch.id
  LOOP
    held := first_asked_runs(r.experience_id, r.source_id, r.sync_log_id, r.changed_fields, r.contents, 'held');
    claimed := first_asked_runs(r.experience_id, r.source_id, r.sync_log_id, r.changed_fields, r.contents, 'curatedConflict');
    UPDATE experience_sync_changes
       SET first_asked = NULLIF(jsonb_strip_nulls(jsonb_build_object('held', held, 'curatedConflict', claimed)), '{}'::jsonb),
           held_first_sync_log_id = (SELECT max(v::int) FROM jsonb_each_text(held) AS x(k, v)),
           conflict_first_sync_log_id = (SELECT max(v::int) FROM jsonb_each_text(claimed) AS x(k, v))
     WHERE id = r.id;
  END LOOP;
END $$;

COMMIT;

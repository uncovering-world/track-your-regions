-- 239-a-kind-record-fits-its-scheme.sql
--
-- A record in a kind carries an id of its source's scheme, as a record in a
-- whole already does (#2118, ADR-0198 decision 2): a World Heritage site's
-- number (whc-site, `383`), a Wikidata item (wikidata, `Q42`), or a curator's
-- own key (`curator-<user>-<ms>`, what a manual create and a curator's add to a
-- kind name a place by). source_record_fits_scheme() stops letting a record in
-- a kind through, so a run, a curator's write or a fixture that writes one
-- under an id of another shape is refused with the id, the scheme and the
-- source in its message (check_violation).
--
-- What it writes: no row. It asserts first that every record in a kind on the
-- database fits its source's scheme or a curator's key, and refuses a database
-- where one does not, naming up to twenty of them, rather than leave rows the
-- trigger would refuse on their next write. On the development catalogue on
-- 2026-11-12 every one of the 20,402 records in a kind fitted.
--
-- Writers of source_records wait from the assertion to the commit (SHARE
-- lock, ten seconds' lock timeout). Re-runnable: the assertion reads and the
-- function is replaced.

\set ON_ERROR_STOP on

BEGIN;

-- No writer of source_records may commit between the assertion and the
-- function's replacement, or a record of another shape could land under the
-- old function after the check has passed. SHARE is the weakest mode that
-- conflicts with a writer's ROW EXCLUSIVE, and readers go on; replacing the
-- function takes no lock on the table, so nothing stronger is needed. Held to
-- the commit, a few milliseconds; a long writer makes the file fail rather
-- than queue every write behind it.
SET LOCAL lock_timeout = '10s';
LOCK TABLE source_records IN SHARE MODE;

DO $$
DECLARE
    misfits TEXT;
    misfit_count INTEGER;
BEGIN
    SELECT count(*), string_agg(r.id || ' (source ' || r.source_id || ', ' || r.external_id || ')', ', ' ORDER BY r.id)
             FILTER (WHERE r.rn <= 20)
      INTO misfit_count, misfits
      FROM (SELECT rec.id, rec.source_id, rec.external_id, row_number() OVER (ORDER BY rec.id) AS rn
              FROM source_records rec JOIN experience_sources s ON s.id = rec.source_id
             WHERE rec.kind_id IS NOT NULL
               AND NOT (source_id_fits_scheme(s.id_scheme, rec.external_id)
                        OR source_id_fits_scheme('curator', rec.external_id))) r;
    IF misfit_count > 0 THEN
        RAISE EXCEPTION 'migration 239: % records in a kind whose id fits neither its source''s scheme nor a curator''s key: %',
            misfit_count, misfits;
    END IF;
END $$;

-- Every record carries an id of its source's scheme, or a curator's own key
-- (ADR-0198): a record in a whole, and since db/migrations/239 a record in a
-- kind, whose id a run finds its place by -- a World Heritage site's number, a
-- Wikidata item -- or a curator's create or add names (curator-<user>-<ms>).
CREATE OR REPLACE FUNCTION source_record_fits_scheme() RETURNS trigger AS $$
DECLARE
  scheme TEXT;
BEGIN
  SELECT s.id_scheme INTO scheme FROM experience_sources s WHERE s.id = NEW.source_id;
  IF NOT (source_id_fits_scheme(scheme, NEW.external_id) OR source_id_fits_scheme('curator', NEW.external_id)) THEN
    RAISE EXCEPTION 'source record id % does not fit the % scheme of source %', NEW.external_id, scheme, NEW.source_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;

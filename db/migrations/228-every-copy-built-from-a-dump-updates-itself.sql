-- 228-every-copy-built-from-a-dump-updates-itself.sql
--
-- Every copy built from a dump updates itself on a schedule (#2415,
-- ADR-0195), as the OpenStreetMap layer has since migration 147. The
-- schedules live in one table keyed by the dump: the layer's row, where an
-- admin chose one, moves into it, and its own table goes.
--
-- Order-independent with 01-schema.sql, which declares dump_schedules and no
-- longer osm_layer_schedule. Re-runnable: the table is created if absent, and
-- the layer's row is copied only where the old table still stands.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS workbench.dump_schedules (
    dump VARCHAR(40) PRIMARY KEY,
    every_days SMALLINT CHECK (every_days BETWEEN 1 AND 30),
    updated_by INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE workbench.dump_schedules IS 'How often the dump worker brings a copy built from a dump forward by itself (ADR-0195; the OpenStreetMap layer''s, ADR-0134 decision 6), where an admin chose otherwise than the copy''s default, which lives in code (keepers.ts). One row a dump at most; every_days NULL means the schedule is off and builds are started by hand. updated_by is the admin''s user id, a plain id because this table is workbench and users is serving (ADR-0124).';

DO $$
BEGIN
  IF to_regclass('workbench.osm_layer_schedule') IS NOT NULL THEN
    INSERT INTO workbench.dump_schedules (dump, every_days, updated_by, updated_at)
    SELECT 'osm-planet', every_days, updated_by, updated_at FROM workbench.osm_layer_schedule
    ON CONFLICT (dump) DO NOTHING;
    DROP TABLE workbench.osm_layer_schedule;
  END IF;
END $$;

COMMIT;

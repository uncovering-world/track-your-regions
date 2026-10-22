-- 147-the-openstreetmap-layer-updates-on-a-schedule.sql
--
-- How often the dump worker brings the OpenStreetMap layer forward by itself
-- (#1437, ADR-0134 decision 6), where an admin chose otherwise than the
-- default. The default, every 7 days, lives in code with its reason
-- (layerSchedule.ts); no row means no admin has decided. One row at most:
-- every_days from 1 to 30, or NULL where the admin turned the schedule off
-- and updates are started by hand.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: the table is created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS workbench.osm_layer_schedule (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    every_days SMALLINT CHECK (every_days BETWEEN 1 AND 30),
    updated_by INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE workbench.osm_layer_schedule IS 'How often the dump worker brings the OpenStreetMap layer forward by itself (#1437, ADR-0134 decision 6), where an admin chose otherwise than the default of every 7 days, which lives in code. One row at most; every_days NULL means the schedule is off and updates are started by hand. updated_by is the admin''s user id, a plain id because this table is workbench and users is serving (ADR-0124).';

COMMIT;

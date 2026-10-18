-- 129-a-visitor-chooses-the-maps-app-places-open-in.sql
--
-- A place's card offers "Open in maps" as several links side by side: the
-- device's own maps app where there is one, OpenStreetMap and Google Maps
-- (#1194, ADR-0115). A visitor who always navigates with one of them now
-- chooses it on the account page, and for a signed-in visitor the choice is
-- kept with the account so it travels between devices (#1604). No choice is
-- "ask each time": the links side by side, as before.
--
-- The values are `MAPS_APPS` in packages/shared/src/preferences.ts, which
-- backend/src/db/curationLogActions.test.ts holds to this enum.
--
-- Re-runnable: the type and the column are made only where missing.

\set ON_ERROR_STOP on

BEGIN;

DO $$ BEGIN
    CREATE TYPE maps_app AS ENUM ('device', 'osm', 'google');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS maps_app maps_app;

COMMENT ON COLUMN users.maps_app IS
    'The maps app the visitor opens places in (#1604): device, osm or google; NULL asks each time';

COMMIT;

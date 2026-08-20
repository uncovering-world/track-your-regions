-- 028: the trail can say a curator moved a point
--
-- `experience_curation_log.action` is a CHECK list, and every verdict a curator
-- can reach has a name in it. Correcting a point had none, because until 027 a
-- correction could not survive the next run and so was never offered.
--
-- Prefixed the way the location verdicts of 024 are: a trail about an object
-- must not read a component's correction as the whole site's. `edited` stays
-- what it has always been — the object's own fields.
--
-- Apply:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/028-location-edited-action.sql

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region',
                      'removed_from_region', 'marked_former', 'marked_lost', 'state_restored',
                      'accepted_source', 'declined_source', 'missing_dismissed',
                      'admission_confirmed', 'admission_overridden', 'published',
                      'location_marked_former', 'location_marked_lost', 'location_state_restored',
                      'location_missing_dismissed', 'location_edited'));

COMMIT;

-- 024: a curator may answer for a point, not only for the whole object
--
-- Five columns on `experience_locations` and four actions on the curation log.
-- ADR-0022 marked a withdrawn point and left the verdict
-- to "the contents-gate slice, together with the grouped curator card" — schema
-- ships with its consumers, and those consumers are the withdrawal card and the
-- endpoint behind it (ADR-0026, #541).
--
-- The same two axes an experience has carried since ADR-0020, and deliberately the
-- same words: `former` is about the source's list, `lost` is about the world. A
-- component of a serial site can be delisted while standing, or demolished while
-- still listed, exactly as a whole site can.
--
-- One thing works differently here, and it is the reason this is not a copy of the
-- experience-level verdict. There, every answer clears `missing_since`, because
-- nothing a reader sees is keyed on it. On a location that column is one of the two
-- terms a reader-facing read carries — `offeredLocationSql` is `missing_since IS NULL
-- AND existence <> 'lost'` — and each verdict is held by a different one. `former` is
-- held by the flag, so clearing it would put the pin back on the map for a place the
-- source no longer lists. `lost` is held by its own axis whatever the flag says, which
-- is what makes that verdict outlive a run — the writer clears the flag when the source
-- offers the point again — and what lets it hide a point readers could see. Only "the
-- source blinked" clears the flag, and leaving it standing is what takes an answered row
-- out of the queue, so no read had to learn a predicate for the queue's sake.
--
-- Nothing to backfill, and the numbers say why: exactly one point in the catalogue
-- carries `missing_since` today (Bilbao Fine Arts Museum, Q127064, marked
-- 2026-08-10). Every row therefore gets the defaults, which are what an unanswered
-- point has always meant.
--
-- The log's action list is restated whole, as every migration that widens it does,
-- and it names the four location actions with the `location_` prefix so a trail
-- about an object never confuses a verdict on the object with one on a point
-- inside it. `location_state_restored` is there for the correction case: a verdict
-- is answerable again through the same endpoint, and the experience-level design
-- made the same choice deliberately, having found that refusing decided rows made
-- `former` and `lost` terminal with no remedy short of SQL.
--
-- Order: this file may run before or after the next re-application of
-- `01-schema.sql`, in either order and any number of times. `ADD COLUMN IF NOT
-- EXISTS`, the guarded constraint block and the drop/add on the CHECK are all
-- idempotent, and `01-schema.sql` carries the same statements for the same reason.
--
-- Applying this file changes nothing anyone sees, and the reason is the defaults
-- rather than disuse: reads do consult both columns from this PR onward -- the
-- reader-facing predicate above, the withdrawn queue's join, the writer's fast
-- path -- but every existing row takes 'present' and 'extant', which is what an
-- unanswered point already implied. So each of those reads returns exactly what it
-- returned before, and the safety of applying this out of band rests on there
-- being no answered point yet rather than on the columns being inert.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/024-location-verdicts.sql

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS source_membership VARCHAR(10) NOT NULL DEFAULT 'present';
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS existence VARCHAR(10) NOT NULL DEFAULT 'extant';
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS state_decided_by INTEGER REFERENCES users(id);
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS state_decided_at TIMESTAMPTZ;
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS state_note TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_locations_source_membership_check') THEN
        ALTER TABLE experience_locations ADD CONSTRAINT experience_locations_source_membership_check
            CHECK (source_membership IN ('present', 'former'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_locations_existence_check') THEN
        ALTER TABLE experience_locations ADD CONSTRAINT experience_locations_existence_check
            CHECK (existence IN ('extant', 'lost'));
    END IF;
END $$;

COMMENT ON COLUMN experience_locations.source_membership IS 'present or former. Only a curator sets former: it means the source really did stop offering this point, and the row keeps its missing_since, so every read already hides it and the queue stops asking. A sync that lists the point again sets it back to present, wherever that point is - every arm that matches an offered row, and the fast path counts such a row as unmatched so one of them is reached (ADR-0026 decision 6). It only ever moves toward visibility, and moves nothing on its own: what a reader sees also needs existence <> lost, so a point a curator declared gone stays hidden through the restore (decision 7). Without the restore the point would return visible while recorded as delisted, and its next departure would raise no card at all.';
COMMENT ON COLUMN experience_locations.existence IS 'extant or lost, set by a curator only. lost = the component itself is gone — a demolished building of a serial site. Independent of whether the source still lists it.';

CREATE INDEX IF NOT EXISTS idx_experience_locations_undecided
    ON experience_locations(experience_id)
    WHERE missing_since IS NOT NULL AND source_membership = 'present' AND existence = 'extant';

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed'));

COMMIT;

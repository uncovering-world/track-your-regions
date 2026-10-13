-- 093-a-place-can-be-part-of-another.sql
--
-- A component of a serial World Heritage site is a place, part of the site
-- (ADR-0100, Epic #1422), and the relation is ADR-0046 decision 6's, which
-- #823 will also record for places that are not components (the Bremen Roland
-- on the Marketplace of Bremen). experience_parts holds it: the whole, the
-- part, why it was recorded, and for a component the membership that placed
-- it and the reference the site's source knows the part by.
--
-- The points a place shows - its own, and its parts' - are composed by the
-- readers from backend/src/db/placePoints.ts, not by a view: joined inside a
-- query a UNION ALL view made the planner sort every point of the catalogue
-- before the region filter, 30 ms more on Italy's locations read.
--
-- 01-schema.sql declares the same for a fresh database.
-- Re-runnable: the table and index are created where missing.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS experience_parts (
    id SERIAL PRIMARY KEY,
    whole_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    part_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    reason VARCHAR(20) NOT NULL CHECK (reason IN ('component', 'wikidata_part_of', 'curator')),
    membership_id INTEGER REFERENCES experience_kind_memberships(id) ON DELETE CASCADE,
    external_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (whole_id, part_id),
    CHECK (whole_id <> part_id),
    CHECK (reason <> 'component' OR membership_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_experience_parts_part ON experience_parts(part_id);
COMMENT ON TABLE experience_parts IS 'A place that is part of another (ADR-0046 decision 6, ADR-0100): a component of a serial World Heritage site, placed by the site''s membership under its reference (component); a Wikidata part-of statement (wikidata_part_of); or a curator''s (curator).';
COMMENT ON COLUMN experience_parts.external_ref IS 'The reference the site''s source knows a component by (527ter-002); null on a part that is not a component.';
COMMIT;

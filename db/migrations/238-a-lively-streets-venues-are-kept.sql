-- 238-a-lively-streets-venues-are-kept.sql
--
-- The cafés, restaurants and bars the place pass counts around a square or a
-- street (ADR-0192, ADR-0194) were read for the run's verdict and then
-- dropped, so a curator weighing a crowded city saw a place's fame and not the
-- venues that let it in: Largo do Machado (Rio de Janeiro) entered Squares &
-- streets by its 36 venues, and its card showed only its readers and editions
-- (#2454). The pass now keeps them, and this adds the table it keeps them in.
-- It fills on the next real place pass.
--
-- Re-runnable: the table is created only where it is missing.

\set ON_ERROR_STOP on

BEGIN;

-- The cafés, restaurants and bars around a place of a kind that reads them
-- (ADR-0192, #2454), as the place pass last counted them: within the cut's
-- radius of its point, or per 100 m along a street read along its line
-- (ADR-0194). Keyed by the source and the item that source knows the place by,
-- since the pass counts a candidate before its run writes the membership of a
-- new arrival. A curator reads it beside the place's fame in a crowded city;
-- it is no part of the score.
CREATE TABLE IF NOT EXISTS place_venues (
    source_id INTEGER NOT NULL REFERENCES experience_sources(id) ON DELETE CASCADE,
    qid TEXT NOT NULL CHECK (qid ~ '^Q[1-9][0-9]*$'),
    venues REAL NOT NULL CHECK (venues >= 0),
    radius_m INTEGER CHECK (radius_m > 0),
    along_m INTEGER CHECK (along_m > 0),
    measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_id, qid),
    CHECK ((radius_m IS NULL) <> (along_m IS NULL))
);
COMMENT ON TABLE place_venues IS 'The cafés, restaurants and bars the place pass last counted around each place of a kind that reads them (ADR-0192), by the source and the item it knows the place by. Written by a real pass that read the venue layer, replacing the source''s rows; a dry run and a pass that could not read the layer leave them as they stand. Read beside the place''s fame in a crowded city, never scored (#2454).';
COMMENT ON COLUMN place_venues.venues IS 'The venues within radius_m of the place''s point, or the venues per 100 m along its line where along_m is set (ADR-0194).';
COMMENT ON COLUMN place_venues.radius_m IS 'The radius of the point the venues were counted within; NULL for a street read along its line.';
COMMENT ON COLUMN place_venues.along_m IS 'The length of the street''s lines the venues were counted along; NULL for a place read at its point.';

COMMIT;

-- 121-a-pair-is-found-by-a-name-within-another.sql
--
-- The near-places pass finds a pair a second way (#1652): every significant
-- word of one place's name stands in the other's, as Geghard does in
-- "Monastery of Geghard and the Upper Azat Valley", whose names are 0.17 alike
-- by trigrams. A proposal records which rule found it, so its card says why
-- it was asked. Existing proposals were found by similarity.
--
-- Order-independent with 01-schema.sql, which declares the same column.
-- Re-runnable: the column is added if absent.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_merge_proposals ADD COLUMN IF NOT EXISTS found_by VARCHAR(10) NOT NULL DEFAULT 'similar'
    CHECK (found_by IN ('similar', 'words'));
COMMENT ON COLUMN experience_merge_proposals.found_by IS 'Which rule found the pair (#1652): similar, the names reach a trigram similarity of 0.5; words, every significant word of one name stands in the other''s, as Geghard does in "Monastery of Geghard and the Upper Azat Valley".';

COMMIT;

-- 197-a-pair-records-the-words-that-matched.sql
--
-- A pair of near places found by one name's significant words standing in
-- the other's (found_by = words, ADR-0120) said "one name within the other"
-- on its card. On the development catalogue on 2026-10-31, 53 of the 56 open
-- pairs so found matched by one word, a town's name both names carry:
-- "Historic Centre (Old Town) of Tallinn" beside "Freedom Square (Tallinn)",
-- 431 m apart, folds to the one word "tallinn" once the generic words are
-- taken out, and the card read as a name match that was not there (#2194).
-- The pass now records the words that matched, and the card says them. The
-- rule's version moves to 5, so the next drain pairs the whole catalogue and
-- fills the column on every open pair; an answered pair keeps null.
--
-- Order-independent with 01-schema.sql, which declares the same column.
-- Re-runnable: the column is added if absent.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_merge_proposals ADD COLUMN IF NOT EXISTS matched_words TEXT[];
COMMENT ON COLUMN experience_merge_proposals.matched_words IS 'For a pair found by one name''s words standing in the other''s (found_by = words): those words, folded as the rule reads them, so the card says what matched -- one word, as a town''s name both carry (tallinn), or several (#2194). Null for a pair found by similarity, and on a pair written before the column.';

COMMIT;

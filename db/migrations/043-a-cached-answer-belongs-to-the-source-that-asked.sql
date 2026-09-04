-- 043: A cached answer belongs to the source that asked (ADR-0047, #754)
--
-- `wikidata_query_cache.query_hash` was the SHA-256 of the query text alone
-- (ADR-0030 decision 1), which gave two sources asking the same question --
-- the children of `sculpture`, the tree under `museum` -- one row between
-- them. The public-art import's first dry run read the museums' week-old
-- class row and missed a class Wikidata had created since, and "Clear" on one
-- source left behind the shared rows the other had last written. The key is
-- the source's category_id and the query text together now (ADR-0047).
--
-- Every row keyed the old way is dead weight from here: never matched again,
-- never rewritten in place, and counted by the panel against the source that
-- last wrote it. This file empties the table -- it is a cache, and the next
-- run of each source asks Wikidata again -- and puts the column's comment
-- right, the way 01-schema.sql states it for a fresh database. Re-running it
-- clears the cache again, and the next run of each source starts cold. No
-- DDL beyond the comment, so it is order-independent with 01-schema.sql.

\set ON_ERROR_STOP on

BEGIN;

DELETE FROM wikidata_query_cache;

COMMENT ON COLUMN wikidata_query_cache.query_hash IS 'SHA-256 of the asking source''s category_id and the exact query text (ADR-0047). The query is the question, so a changed filter is a different key and misses by construction rather than by remembering to invalidate.';

COMMIT;

-- 227-two-dumps-nothing-reads-leave-the-catalogue.sql
--
-- Two dumps leave the catalogue (#2415): English Wikipedia's language links
-- (enwiki-langlinks), which nothing reads and which was never downloaded,
-- and Wikidata's lexemes (wikidata-lexemes), the small file the pipeline was
-- first tried on, whose job a trial on a sample of the entities dump now does
-- (#1527). Their builds and what the worker learnt of their newest files go
-- with them, since no reader knows their names any more.
--
-- Re-runnable: deleting the two dumps' rows again deletes nothing.

\set ON_ERROR_STOP on

BEGIN;

DELETE FROM workbench.dump_builds WHERE dump IN ('enwiki-langlinks', 'wikidata-lexemes');
DELETE FROM workbench.dump_newest_on_host WHERE dump IN ('enwiki-langlinks', 'wikidata-lexemes');

COMMIT;

-- 014: the museum category holds art museums, and says so.
--
-- `experiences.category` has been carrying UNESCO's vocabulary ('cultural') on all 128 museum
-- rows because the museum sync copied the UNESCO importer. The column is not UNESCO's enum: it
-- is the per-category venue type from docs/vision/EXPERIENCE-TYPE-AND-SIGNIFICANCE.md, and for
-- this category the only valid value is 'art'.
--
-- Nothing is deleted here. Rows the corrected import no longer offers are marked by the sync
-- and wait for a curator verdict (ADR-0022).
--
-- Order: apply this before the next re-application of 01-schema.sql. That file's seed now
-- conflicts on 'Top Art Museums' — the value this migration writes — so a database still
-- holding the old 'Top Museums' row won't collide on re-apply and ends up with both rows.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/014-top-art-museums.sql

\set ON_ERROR_STOP on

BEGIN;

UPDATE experience_categories
   SET name = 'Top Art Museums'
 WHERE id = 2 AND name = 'Top Museums';

COMMENT ON COLUMN experiences.category IS
  'Venue type within the category, per docs/vision/EXPERIENCE-TYPE-AND-SIGNIFICANCE.md: '
  '''art''/''history''/''archaeology''… for museums, ''cultural''/''natural''/''mixed'' for '
  'UNESCO, ''monument''/''sculpture'' for public art. Not one shared enum.';

COMMIT;

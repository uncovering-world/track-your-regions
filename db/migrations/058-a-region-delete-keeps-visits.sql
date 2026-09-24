-- 058-a-region-delete-keeps-visits.sql
--
-- Deleting a region that carries a traveller's visit is refused (#764).
--
-- user_visited_regions.region_id referenced regions(id) ON DELETE CASCADE, and
-- regions are deleted from region CRUD, the import tree's merge, remove,
-- dismiss and prune, flatten, and the world view delete. Only the world view
-- delete counted the visits it would take with it. Every other path erased
-- what a traveller had recorded, and said nothing.
--
-- NO ACTION rather than RESTRICT: NO ACTION is checked at the end of the
-- statement, so the world view delete -- whose visits the admin has seen
-- counted and confirmed -- removes them in the same statement as the regions
-- they stand on. Every other delete of a visited region fails, and the
-- backend answers 409 for it.
--
-- The constraint keeps its name, which the backend's error handler matches.
-- Re-runnable: dropping and adding the same constraint twice lands the same.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE user_visited_regions
  DROP CONSTRAINT IF EXISTS user_visited_regions_region_id_fkey,
  ADD CONSTRAINT user_visited_regions_region_id_fkey
    FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE NO ACTION;

COMMIT;

-- 146: The two kinds Public Art & Monuments split into file their own types (#1807)
--
-- Migration 144 copied every Public Art & Monuments membership into Monuments
-- & memorials with the old kind's two types, monument and sculpture. Those are
-- words of a vocabulary neither new kind has as a whole: Monuments & memorials
-- files a memorial, an arch, a column, an obelisk or a monument, and Public art
-- a sculpture, a fountain or street art. On a gated source each run's retype
-- of a place a reader sees was then a question for a curator -- 98 of them on
-- the dry runs of 2026-10-22 (Arc de Triomphe monument -> arch), none a change
-- the source made.
--
-- So the types both kinds inherited are cleared, and each source's next run
-- files its places in its own words past the gate (`type-outside-vocabulary`,
-- `changeSet.ts`). A type a curator claimed is left as it stands: 144 already
-- released a claim outside its kind's words. Until the next run a reader sees
-- these places with no type chip.
--
-- Re-runnable: a cleared type matches nothing a second time.

\set ON_ERROR_STOP on

BEGIN;

UPDATE experience_kind_memberships
   SET type = NULL
 WHERE source_id IN (3, 6)
   AND type IS NOT NULL
   AND NOT curated_fields ? 'type';

COMMIT;

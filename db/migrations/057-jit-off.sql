-- 057-jit-off.sql
--
-- The database answers without JIT compilation (#994).
--
-- PostgreSQL compiles a statement with LLVM once its plan estimate passes
-- jit_above_cost (100 000), and inlines and optimises it past 500 000. The
-- estimate is the planner's, not the run's: a statement with a LATERAL or a
-- recursive CTE is costed as though every row paid for the whole subquery, so
-- a read that runs in a fifth of a second is priced in the millions and pays
-- for a compile that takes longer than the read. The region location feed for
-- Europe (region 6737 of the development database's world view 5) ran for
-- 1 341 ms, of which JIT took 1 079 ms; with jit off it runs in 232 ms.
--
-- This workload is short interactive reads and batch geometry work, and JIT
-- helps neither: it compiles expression evaluation and tuple deforming, while
-- the batch work spends its time inside PostGIS functions it cannot compile.
-- The setting is the database's, so every client that connects -- the
-- backend, Martin, the sync and import scripts, psql -- reads it, and no
-- statement has to be kept under the threshold by hand.
--
-- ALTER DATABASE ... SET applies to sessions that connect after it, so a
-- running backend keeps JIT on its pooled connections until they are
-- replaced; restart it after applying this file. Re-runnable: setting the
-- same value twice is a no-op.

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET jit = off', current_database());
END
$$;

COMMIT;

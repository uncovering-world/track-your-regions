-- 007: Backfill world view visibility.
--
-- Self-sufficient: adds the column itself (idempotently) before backfilling,
-- so it runs standalone whether or not db/init/01-schema.sql has already been
-- re-applied to this database. 01-schema.sql keeps the same column too, since
-- a fresh install needs it there.
--
-- The column defaults to false, so without the backfill every existing world
-- view would vanish for non-admins the moment the server-side filter lands.
-- Today's rule is "the default world view is admin-only, everything else is
-- visible to all" — implemented until now as a client-side filter in
-- HierarchySwitcher. This reproduces exactly that state, so the change is
-- behaviour-preserving.
--
-- One-shot: re-running is harmless but will re-publish world views an admin has
-- since hidden, so do not fold the backfill into 01-schema.sql.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE world_views ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

UPDATE world_views
SET is_public = true
WHERE is_default = false
  AND is_public = false;

COMMIT;

-- 205-a-place-run-keeps-what-it-cannot-read.sql
--
-- A place run that cannot read a signal keeps what it last read (ADR-0175
-- decision 6, #2253). Without a readership year it admits by the readers'
-- bars of the source's last run that read one and by each membership's
-- readers as last read; without a Wikivoyage usage build, by each
-- membership's guide's mark as last read. Never a missing source read as
-- zero: that would drop every place the readers' bars or the guide's bar
-- admitted.
--
-- world_bars records on each place run's sync log the bars it admitted by.
-- readers_read_at and guides_read_at date the signals the crowding step read
-- (membership_fame), so the zero a membership is ranked at before its first
-- reading is never taken for a reading. No backfill: a row measured before
-- this migration is dated by the next run that reads the signal, and until
-- then a run without it keeps the place, as before.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS world_bars JSONB;
COMMENT ON COLUMN experience_sync_logs.world_bars IS 'The world bars a place kind''s run admitted by (ADR-0175): editions, readers, guidedReaders and pool, the readership year the readers'' bars were read over (year), and keptFrom, the sync log whose readers'' bars a run without a year kept (decision 6). Shaped as WorldBars (backend/src/services/sync/places/worldBars.ts). NULL for every other source, and for a run that read no pool.';

ALTER TABLE membership_fame ADD COLUMN IF NOT EXISTS readers_read_at TIMESTAMPTZ;
ALTER TABLE membership_fame ADD COLUMN IF NOT EXISTS guides_read_at TIMESTAMPTZ;
COMMENT ON COLUMN membership_fame.readers_read_at IS 'When readers was last read from a readership year. NULL: no reading is dated, so readers is the zero a membership is ranked at before its first reading or a value from before the column, and the place run never admits by it (ADR-0175 decision 6).';
COMMENT ON COLUMN membership_fame.guides_read_at IS 'When guide_editions was last read from a Wikivoyage usage build. NULL: no reading is dated, so guide_editions is the zero a membership is ranked at before its first reading or a value from before the column, and the place run never admits by it (ADR-0175 decision 6).';

COMMIT;

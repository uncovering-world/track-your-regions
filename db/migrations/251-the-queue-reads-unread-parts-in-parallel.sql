-- 251-the-queue-reads-unread-parts-in-parallel.sql
--
-- The review queue asks a serial site's part about its record in its site
-- (#2123, ADR-0213), through is_part_line_point(), the rule migration 250
-- declared for which of a part's points are its list line, over the set of
-- parts nobody has read.
--
-- * A function left parallel unsafe keeps every statement that calls it out
--   of a parallel plan. The queue's keys, which Postgres runs as a parallel
--   plan, measured 15 % slower on the development catalogue (2026-11-15)
--   while it was, and 5 % slower with the rule inlined, which a parallel-safe
--   function lets the planner run as it ran before. It only reads, so it is
--   parallel safe.
-- * The parts nobody has read are a few dozen records (75 there), where the
--   index of pending records holds every arrival of every kind (15,671): a
--   partial index of their own.
--
-- Order-independent with 01-schema.sql, which declares the same; re-runnable.

\set ON_ERROR_STOP on

BEGIN;

-- The index takes a lock on source_records that holds its writers until this
-- transaction commits.
SET LOCAL lock_timeout = '10s';

ALTER FUNCTION is_part_line_point(INTEGER, INTEGER) PARALLEL SAFE;

CREATE INDEX IF NOT EXISTS idx_source_records_unread_parts ON source_records(experience_id)
  WHERE source_id = 10 AND whole_id IS NOT NULL AND curation_state = 'pending';

COMMIT;

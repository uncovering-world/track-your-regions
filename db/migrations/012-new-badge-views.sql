-- 012: when a user was first shown the "New" chip (issue #480, slice 4)
--
-- The chip's lifetime is `max(category window, a week from the moment this
-- user first saw it)`. The first half is a property of the run and needs no
-- storage; the second is per user and per experience, and this is it.
--
-- Written by an explicit POST after the chips render, not as a side effect of
-- the read that produced them: a GET that records an impression is a GET that
-- lies about being safe to repeat, and a timestamp set by a prefetch or a
-- crawler is not an impression.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/012-new-badge-views.sql

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS user_new_badge_views (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    -- Only the *first* impression counts. A later view must not restart the
    -- week, or the chip would follow a returning reader around indefinitely.
    first_shown_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, experience_id)
);

-- The chip's first clause asks, per row, for the latest completed non-dry run
-- of the row's category. Postgres does not memoize a correlated subquery across rows,
-- so on a whole-region read (5000 rows) that is 5000 scans of every run in the
-- category, each sorted to take one. This turns each into a single backward
-- index scan. `id DESC` is in the key because it is the tiebreak in the same
-- ORDER BY: without it the scan is presorted only on `completed_at` and still
-- pays an incremental sort. Partial, because the predicate never varies.
CREATE INDEX IF NOT EXISTS idx_experience_sync_logs_latest
    ON experience_sync_logs(category_id, completed_at DESC, id DESC)
    WHERE is_dry_run = FALSE AND completed_at IS NOT NULL;

COMMIT;

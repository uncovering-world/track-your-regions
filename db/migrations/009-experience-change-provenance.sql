-- 009: change provenance for experiences (issue #480)
--
-- Adds the provenance and lifecycle columns, the per-run changeset table, and
-- backfills provenance for rows that predate all of it: every row that came
-- from a run is attributed to the newest run of its category that actually
-- wrote something, which is how it got there. Curator-created rows are left
-- out — they were inserted outside any run and keep NULL provenance.
--
-- The DDL below duplicates db/init/01-schema.sql and is idempotent, so
-- re-applying the schema file achieves the same thing. What only lives here is
-- the backfill at the bottom.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/009-experience-change-provenance.sql

\set ON_ERROR_STOP on

BEGIN;

-- Sync log: the counters a run can now distinguish.
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_unchanged INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_missing INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_curated_conflicts INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS is_dry_run BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS detection_skipped_reason TEXT;

-- Experiences: provenance, plus the two lifecycle axes.
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS last_seen_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS first_seen_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS missing_since TIMESTAMPTZ;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS source_membership VARCHAR(10) NOT NULL DEFAULT 'present';
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS existence VARCHAR(10) NOT NULL DEFAULT 'extant';
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS state_decided_by INTEGER REFERENCES users(id);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS state_decided_at TIMESTAMPTZ;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS state_note TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_source_membership_check') THEN
        ALTER TABLE experiences ADD CONSTRAINT experiences_source_membership_check
            CHECK (source_membership IN ('present', 'former'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_existence_check') THEN
        ALTER TABLE experiences ADD CONSTRAINT experiences_existence_check
            CHECK (existence IN ('extant', 'lost'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_experiences_missing ON experiences(category_id) WHERE missing_since IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experiences_membership ON experiences(source_membership) WHERE source_membership <> 'present';
CREATE INDEX IF NOT EXISTS idx_experiences_existence ON experiences(existence) WHERE existence <> 'extant';
CREATE INDEX IF NOT EXISTS idx_experiences_first_seen ON experiences(first_seen_sync_log_id);

ALTER TABLE experience_categories ADD COLUMN IF NOT EXISTS new_badge_days INTEGER NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS experience_sync_changes (
    id             BIGSERIAL PRIMARY KEY,
    sync_log_id    INTEGER NOT NULL REFERENCES experience_sync_logs(id) ON DELETE CASCADE,
    experience_id  INTEGER REFERENCES experiences(id) ON DELETE SET NULL,
    external_id    VARCHAR(255) NOT NULL,
    name_snapshot  VARCHAR(500),
    change_type    VARCHAR(20) NOT NULL CHECK (change_type IN ('created', 'updated', 'conflict', 'missing', 'returned', 'failed')),
    changed_fields JSONB,
    significance   VARCHAR(10) CHECK (significance IN ('major', 'minor')),
    error          TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_changes_log ON experience_sync_changes(sync_log_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_exp ON experience_sync_changes(experience_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_review ON experience_sync_changes(sync_log_id, change_type);

-- Backfill: attribute each source-derived row to the newest run of its category
-- that wrote something. Rows whose category never had such a run keep NULL,
-- which reads correctly as "provenance unknown", and so do curator-created
-- rows — permanently, since insertManualExperience writes no provenance either.
-- COALESCE keeps re-application inert.
WITH newest_run AS (
    SELECT DISTINCT ON (category_id) category_id, id, started_at
    FROM experience_sync_logs
    WHERE status IN ('success', 'partial') AND is_dry_run = FALSE
    ORDER BY category_id, started_at DESC
)
UPDATE experiences e
SET first_seen_sync_log_id = COALESCE(e.first_seen_sync_log_id, r.id),
    last_seen_sync_log_id  = COALESCE(e.last_seen_sync_log_id, r.id),
    last_seen_at           = COALESCE(e.last_seen_at, r.started_at)
FROM newest_run r
WHERE e.category_id = r.category_id
  AND e.last_seen_sync_log_id IS NULL
  -- Curator-created rows were inserted outside any run, so attributing them to
  -- one would be a fabricated provenance — and would later hand them the New
  -- chip on the strength of a run that never saw them.
  AND e.is_manual = FALSE;

COMMIT;

-- Migration: Curator System
-- Adds curator role, curation tables, and experience editing support
-- Run against an existing track_regions database

-- 1. Add 'curator' to user_role enum (must be outside transaction)
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'curator' BEFORE 'admin';

-- 2. Add new columns to experiences table
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS curated_fields JSONB DEFAULT '[]'::jsonb;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
DO $$ BEGIN
    ALTER TABLE experiences ADD CONSTRAINT chk_experience_status
        CHECK (status IN ('active', 'draft', 'archived'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Add assigned_by to experience_regions
ALTER TABLE experience_regions ADD COLUMN IF NOT EXISTS assigned_by INTEGER REFERENCES users(id);

-- 4. Create curator_assignments table
CREATE TABLE IF NOT EXISTS curator_assignments (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope_type  VARCHAR(20) NOT NULL CHECK (scope_type IN ('region', 'source', 'global')),
    region_id   INTEGER REFERENCES regions(id) ON DELETE CASCADE,
    source_id   INTEGER REFERENCES experience_sources(id) ON DELETE CASCADE,
    assigned_by INTEGER NOT NULL REFERENCES users(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes       TEXT,
    CONSTRAINT valid_scope CHECK (
        (scope_type = 'region' AND region_id IS NOT NULL AND source_id IS NULL) OR
        (scope_type = 'source' AND source_id IS NOT NULL AND region_id IS NULL) OR
        (scope_type = 'global' AND region_id IS NULL AND source_id IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_global_assignment
    ON curator_assignments(user_id) WHERE scope_type = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_region_assignment
    ON curator_assignments(user_id, region_id) WHERE scope_type = 'region';
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_source_assignment
    ON curator_assignments(user_id, source_id) WHERE scope_type = 'source';
CREATE INDEX IF NOT EXISTS idx_curator_assignments_user ON curator_assignments(user_id);

-- 5. Create experience_curation_log table
CREATE TABLE IF NOT EXISTS experience_curation_log (
    id              SERIAL PRIMARY KEY,
    experience_id   INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    curator_id      INTEGER NOT NULL REFERENCES users(id),
    action          VARCHAR(30) NOT NULL CHECK (action IN (
        'created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region'
    )),
    region_id       INTEGER REFERENCES regions(id) ON DELETE SET NULL,
    details         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_curation_log_experience ON experience_curation_log(experience_id);
CREATE INDEX IF NOT EXISTS idx_curation_log_curator ON experience_curation_log(curator_id);
CREATE INDEX IF NOT EXISTS idx_curation_log_created ON experience_curation_log(created_at DESC);

-- 6. Create experience_rejections table
CREATE TABLE IF NOT EXISTS experience_rejections (
    id              SERIAL PRIMARY KEY,
    experience_id   INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    region_id       INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    rejected_by     INTEGER NOT NULL REFERENCES users(id),
    reason          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (experience_id, region_id)
);

CREATE INDEX IF NOT EXISTS idx_experience_rejections_experience ON experience_rejections(experience_id);
CREATE INDEX IF NOT EXISTS idx_experience_rejections_region ON experience_rejections(region_id);

-- 7. Curator Picks source removed — curators assign new experiences to existing sources

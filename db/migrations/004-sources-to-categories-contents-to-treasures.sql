-- =============================================================================
-- Migration 004: Rename sources→categories, contents→treasures
-- =============================================================================
-- Renames:
--   experience_sources       → experience_categories
--   source_id                → category_id  (in experiences, sync_logs, curator_assignments)
--   experience_contents      → treasures + experience_treasures (many-to-many)
--   user_viewed_contents     → user_viewed_treasures (content_id → treasure_id)
--   content_type             → treasure_type
--   scope_type 'source'      → 'category'
-- Adds:
--   is_iconic on experiences and treasures
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Rename experience_sources → experience_categories
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE experience_sources RENAME TO experience_categories;
ALTER SEQUENCE experience_sources_id_seq RENAME TO experience_categories_id_seq;
ALTER INDEX experience_sources_pkey RENAME TO experience_categories_pkey;
ALTER INDEX experience_sources_name_key RENAME TO experience_categories_name_key;

-- Update comments
COMMENT ON TABLE experience_categories IS 'Experience categories (UNESCO, museums, landmarks, etc.)';
COMMENT ON COLUMN experience_categories.api_config IS 'Category-specific API configuration (pagination, auth, etc.)';
COMMENT ON COLUMN experience_categories.display_priority IS 'Display order in experience list (lower = shown first)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Rename source_id → category_id in experiences
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE experiences RENAME COLUMN source_id TO category_id;

-- Drop old indexes/constraints that reference source_id
DROP INDEX IF EXISTS idx_experiences_source;
DROP INDEX IF EXISTS idx_experiences_external_id;
ALTER TABLE experiences DROP CONSTRAINT IF EXISTS experiences_source_id_external_id_key;
ALTER TABLE experiences DROP CONSTRAINT IF EXISTS experiences_source_id_fkey;

-- Recreate with new names
ALTER TABLE experiences
    ADD CONSTRAINT experiences_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES experience_categories(id) ON DELETE CASCADE;
ALTER TABLE experiences
    ADD CONSTRAINT experiences_category_id_external_id_key
    UNIQUE (category_id, external_id);
CREATE INDEX idx_experiences_category_id ON experiences(category_id);
CREATE INDEX idx_experiences_external_id ON experiences(category_id, external_id);

-- Add is_iconic column
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS is_iconic BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_experiences_iconic ON experiences(is_iconic) WHERE is_iconic = true;
COMMENT ON COLUMN experiences.is_iconic IS 'Whether this experience is considered iconic/must-see';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Rename source_id → category_id in experience_sync_logs
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE experience_sync_logs RENAME COLUMN source_id TO category_id;

DROP INDEX IF EXISTS idx_experience_sync_logs_source;
ALTER TABLE experience_sync_logs DROP CONSTRAINT IF EXISTS experience_sync_logs_source_id_fkey;

ALTER TABLE experience_sync_logs
    ADD CONSTRAINT experience_sync_logs_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES experience_categories(id) ON DELETE CASCADE;
CREATE INDEX idx_experience_sync_logs_category ON experience_sync_logs(category_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Rename source_id → category_id in curator_assignments + scope changes
-- ─────────────────────────────────────────────────────────────────────────────

-- First update existing 'source' scope_type values to 'category'
-- (must do before dropping the old CHECK constraint)
UPDATE curator_assignments SET scope_type = 'category' WHERE scope_type = 'source';

-- Drop old constraints and indexes
ALTER TABLE curator_assignments DROP CONSTRAINT IF EXISTS curator_assignments_scope_type_check;
ALTER TABLE curator_assignments DROP CONSTRAINT IF EXISTS valid_scope;
ALTER TABLE curator_assignments DROP CONSTRAINT IF EXISTS curator_assignments_source_id_fkey;
DROP INDEX IF EXISTS idx_unique_source_assignment;

-- Rename column
ALTER TABLE curator_assignments RENAME COLUMN source_id TO category_id;

-- Recreate constraints with new names/values
ALTER TABLE curator_assignments
    ADD CONSTRAINT curator_assignments_scope_type_check
    CHECK (scope_type IN ('region', 'category', 'global'));

ALTER TABLE curator_assignments
    ADD CONSTRAINT valid_scope CHECK (
        (scope_type = 'global' AND region_id IS NULL AND category_id IS NULL) OR
        (scope_type = 'region' AND region_id IS NOT NULL AND category_id IS NULL) OR
        (scope_type = 'category' AND region_id IS NULL AND category_id IS NOT NULL)
    );

ALTER TABLE curator_assignments
    ADD CONSTRAINT curator_assignments_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES experience_categories(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX idx_unique_category_assignment
    ON curator_assignments(user_id, category_id) WHERE scope_type = 'category';

COMMENT ON COLUMN curator_assignments.scope_type IS
    'Permission scope: global (all), region (specific region + descendants), category (specific experience category)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Transform experience_contents → treasures (many-to-many)
-- ─────────────────────────────────────────────────────────────────────────────

-- 5a. Create the new treasures table (globally unique by external_id)
CREATE TABLE IF NOT EXISTS treasures (
    id SERIAL PRIMARY KEY,
    external_id VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(500) NOT NULL,
    treasure_type VARCHAR(50) NOT NULL,
    artist VARCHAR(500),
    year INTEGER,
    image_url VARCHAR(1000),
    sitelinks_count INTEGER NOT NULL DEFAULT 0,
    is_iconic BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE treasures IS 'Notable treasures (artworks, artifacts) that can belong to multiple venues';
COMMENT ON COLUMN treasures.external_id IS 'Wikidata QID for the artwork/item — globally unique';
COMMENT ON COLUMN treasures.sitelinks_count IS 'Wikipedia sitelinks count - proxy for fame/notability';
COMMENT ON COLUMN treasures.is_iconic IS 'Whether this treasure is considered iconic/must-see';

CREATE INDEX IF NOT EXISTS idx_treasures_type ON treasures(treasure_type);
CREATE INDEX IF NOT EXISTS idx_treasures_sitelinks ON treasures(sitelinks_count DESC);
CREATE INDEX IF NOT EXISTS idx_treasures_iconic ON treasures(is_iconic) WHERE is_iconic = true;

-- 5b. Create the junction table
CREATE TABLE IF NOT EXISTS experience_treasures (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    treasure_id INTEGER NOT NULL REFERENCES treasures(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(experience_id, treasure_id)
);

COMMENT ON TABLE experience_treasures IS 'Links treasures to experiences (many-to-many: one treasure can be in multiple venues)';

CREATE INDEX IF NOT EXISTS idx_experience_treasures_experience ON experience_treasures(experience_id);
CREATE INDEX IF NOT EXISTS idx_experience_treasures_treasure ON experience_treasures(treasure_id);

-- 5c. Migrate data: insert unique treasures, then create junction links
--     experience_contents has UNIQUE(experience_id, external_id), but
--     treasures has UNIQUE(external_id) globally — so we deduplicate.

INSERT INTO treasures (external_id, name, treasure_type, artist, year, image_url, sitelinks_count, metadata, created_at, updated_at)
SELECT DISTINCT ON (external_id)
    external_id,
    name,
    content_type,        -- old column → treasure_type
    artist,
    year,
    image_url,
    sitelinks_count,
    metadata,
    created_at,
    updated_at
FROM experience_contents
ORDER BY external_id, sitelinks_count DESC;  -- keep the most notable version if duplicates exist

-- 5d. Create junction rows linking experiences to their treasures
INSERT INTO experience_treasures (experience_id, treasure_id, created_at)
SELECT ec.experience_id, t.id, ec.created_at
FROM experience_contents ec
JOIN treasures t ON t.external_id = ec.external_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Transform user_viewed_contents → user_viewed_treasures
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_viewed_treasures (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    treasure_id INTEGER NOT NULL REFERENCES treasures(id) ON DELETE CASCADE,
    viewed_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    UNIQUE(user_id, treasure_id)
);

CREATE INDEX IF NOT EXISTS idx_user_viewed_treasures_user ON user_viewed_treasures(user_id);
CREATE INDEX IF NOT EXISTS idx_user_viewed_treasures_treasure ON user_viewed_treasures(treasure_id);

-- Migrate viewed records: map old content_id → new treasure_id via external_id
INSERT INTO user_viewed_treasures (user_id, treasure_id, viewed_at, notes)
SELECT uvc.user_id, t.id, uvc.viewed_at, uvc.notes
FROM user_viewed_contents uvc
JOIN experience_contents ec ON ec.id = uvc.content_id
JOIN treasures t ON t.external_id = ec.external_id
ON CONFLICT (user_id, treasure_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Drop old tables
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS user_viewed_contents;
DROP TABLE IF EXISTS experience_contents;

COMMIT;

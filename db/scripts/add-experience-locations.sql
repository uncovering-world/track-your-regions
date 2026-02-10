-- =============================================================================
-- Migration: Add Multi-Location Experience Support
-- =============================================================================
-- This migration:
-- 1. Creates new tables for experience locations
-- 2. Populates locations from existing experiences (single-location fallback)
-- 3. Migrates user_visited_experiences to user_visited_locations where applicable
--
-- Run this after updating the schema to add the new tables.
-- =============================================================================

-- Create new tables if they don't exist (idempotent)
CREATE TABLE IF NOT EXISTS experience_locations (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    name VARCHAR(500),
    external_ref VARCHAR(255),
    ordinal INTEGER NOT NULL DEFAULT 0,
    location GEOMETRY(Point, 4326) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(experience_id, ordinal)
);

CREATE TABLE IF NOT EXISTS user_visited_locations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES experience_locations(id) ON DELETE CASCADE,
    visited_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    UNIQUE(user_id, location_id)
);

CREATE TABLE IF NOT EXISTS experience_location_regions (
    id SERIAL PRIMARY KEY,
    location_id INTEGER NOT NULL REFERENCES experience_locations(id) ON DELETE CASCADE,
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    assignment_type VARCHAR(20) DEFAULT 'auto',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(location_id, region_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_experience_locations_experience ON experience_locations(experience_id);
CREATE INDEX IF NOT EXISTS idx_experience_locations_location ON experience_locations USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_user_visited_locations_user ON user_visited_locations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_visited_locations_location ON user_visited_locations(location_id);
CREATE INDEX IF NOT EXISTS idx_experience_location_regions_location ON experience_location_regions(location_id);
CREATE INDEX IF NOT EXISTS idx_experience_location_regions_region ON experience_location_regions(region_id);

-- =============================================================================
-- Step 1: Populate experience_locations from existing experiences
-- =============================================================================
-- For experiences without explicit locations, create a single location from
-- the experience's primary location point.

INSERT INTO experience_locations (experience_id, name, external_ref, ordinal, location, created_at)
SELECT
    e.id,
    NULL,  -- name is null for auto-generated single location
    NULL,  -- external_ref is null for auto-generated
    0,     -- ordinal 0 for primary location
    e.location,
    e.created_at
FROM experiences e
WHERE e.location IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM experience_locations el WHERE el.experience_id = e.id
  )
ON CONFLICT (experience_id, ordinal) DO NOTHING;

-- =============================================================================
-- Step 2: Migrate user_visited_experiences to user_visited_locations
-- =============================================================================
-- For each user_visited_experience, create a corresponding user_visited_location
-- entry for the experience's primary location (ordinal 0).

INSERT INTO user_visited_locations (user_id, location_id, visited_at, notes)
SELECT
    uve.user_id,
    el.id,
    uve.visited_at,
    uve.notes
FROM user_visited_experiences uve
JOIN experience_locations el ON el.experience_id = uve.experience_id AND el.ordinal = 0
WHERE NOT EXISTS (
    SELECT 1 FROM user_visited_locations uvl
    WHERE uvl.user_id = uve.user_id AND uvl.location_id = el.id
)
ON CONFLICT (user_id, location_id) DO NOTHING;

-- =============================================================================
-- Step 3: Populate experience_location_regions from experience_regions
-- =============================================================================
-- Copy region assignments to locations. This ensures existing assignments
-- are preserved. The sync service will update these for multi-location
-- experiences when re-run.

INSERT INTO experience_location_regions (location_id, region_id, assignment_type, created_at)
SELECT DISTINCT
    el.id,
    er.region_id,
    er.assignment_type,
    er.created_at
FROM experience_regions er
JOIN experience_locations el ON el.experience_id = er.experience_id AND el.ordinal = 0
WHERE NOT EXISTS (
    SELECT 1 FROM experience_location_regions elr
    WHERE elr.location_id = el.id AND elr.region_id = er.region_id
)
ON CONFLICT (location_id, region_id) DO NOTHING;

-- =============================================================================
-- Verification Queries
-- =============================================================================

-- Count experiences and their locations
SELECT
    COUNT(DISTINCT e.id) as total_experiences,
    COUNT(el.id) as total_locations,
    COUNT(CASE WHEN el.ordinal = 0 THEN 1 END) as primary_locations,
    COUNT(CASE WHEN el.ordinal > 0 THEN 1 END) as additional_locations
FROM experiences e
LEFT JOIN experience_locations el ON el.experience_id = e.id;

-- Count migrated visited locations
SELECT
    COUNT(*) as total_visited_experiences,
    (SELECT COUNT(*) FROM user_visited_locations) as total_visited_locations
FROM user_visited_experiences;

-- Count location-region assignments
SELECT
    COUNT(*) as total_experience_regions,
    (SELECT COUNT(*) FROM experience_location_regions) as total_location_regions
FROM experience_regions;

-- =============================================================================
-- Migration Complete
-- =============================================================================

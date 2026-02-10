-- =============================================================================
-- Migration: Add Experience System Tables
-- =============================================================================
-- This script adds the experience-related tables to an existing database.
-- Run against the golden DB (track_regions) to add UNESCO support.
-- Safe to run multiple times (uses IF NOT EXISTS).
-- =============================================================================

-- Experience data sources (UNESCO, future: national parks, landmarks, etc.)
CREATE TABLE IF NOT EXISTS experience_sources (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    api_endpoint VARCHAR(1000),
    api_config JSONB,
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMPTZ,
    last_sync_status VARCHAR(50),  -- 'success', 'partial', 'failed'
    last_sync_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE experience_sources IS 'External data sources for experiences (UNESCO, national parks, etc.)';
COMMENT ON COLUMN experience_sources.api_config IS 'Source-specific API configuration (pagination, auth, etc.)';
COMMENT ON COLUMN experience_sources.last_sync_status IS 'Status of last sync: success, partial, or failed';

-- Seed UNESCO as the first source
INSERT INTO experience_sources (name, description, api_endpoint, api_config)
VALUES (
    'UNESCO World Heritage Sites',
    'Official UNESCO World Heritage List - Cultural, Natural, and Mixed sites worldwide',
    'https://data.unesco.org/api/explore/v2.1/catalog/datasets/whc001/records',
    '{"pageSize": 100}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- Generic experiences (source-agnostic)
CREATE TABLE IF NOT EXISTS experiences (
    id SERIAL PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES experience_sources(id) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL,

    -- Names (multilingual support)
    name VARCHAR(500) NOT NULL,
    name_local JSONB,  -- {"en": "...", "fr": "...", "es": "...", ...}

    -- Description
    description TEXT,
    short_description TEXT,

    -- Classification
    category VARCHAR(100),  -- 'cultural', 'natural', 'mixed'
    tags JSONB,  -- ["architecture", "religious", "ancient"]

    -- Location (required point - every experience must have a location)
    location GEOMETRY(Point, 4326) NOT NULL,

    -- Optional boundary polygon (some sites have defined areas)
    boundary GEOMETRY(MultiPolygon, 4326),
    area_km2 DOUBLE PRECISION,

    -- Country information (supports transboundary sites)
    country_codes VARCHAR(10)[],  -- ['FR', 'ES'] for transboundary
    country_names VARCHAR(255)[],  -- ['France', 'Spain']

    -- Media
    image_url VARCHAR(1000),

    -- Source-specific metadata (UNESCO: date_inscribed, danger, criteria, etc.)
    metadata JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(source_id, external_id)
);

COMMENT ON TABLE experiences IS 'Location-based experiences from various sources (UNESCO sites, etc.)';
COMMENT ON COLUMN experiences.external_id IS 'ID from the source system (e.g., UNESCO id_no)';
COMMENT ON COLUMN experiences.name_local IS 'Multilingual names: {"en": "...", "fr": "...", ...}';
COMMENT ON COLUMN experiences.location IS 'Required point location for the experience';
COMMENT ON COLUMN experiences.boundary IS 'Optional boundary polygon for experiences with defined areas';
COMMENT ON COLUMN experiences.country_codes IS 'ISO country codes, array for transboundary sites';
COMMENT ON COLUMN experiences.metadata IS 'Source-specific data (UNESCO: date_inscribed, danger, criteria, etc.)';

-- Spatial indexes for experiences
CREATE INDEX IF NOT EXISTS idx_experiences_location ON experiences USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_experiences_boundary ON experiences USING GIST(boundary) WHERE boundary IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experiences_name_trgm ON experiences USING GIN(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_experiences_source ON experiences(source_id);
CREATE INDEX IF NOT EXISTS idx_experiences_category ON experiences(category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experiences_external_id ON experiences(source_id, external_id);

-- Experience-Region junction table (auto-computed via spatial containment)
CREATE TABLE IF NOT EXISTS experience_regions (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    assignment_type VARCHAR(20) DEFAULT 'auto',  -- 'auto' (spatial) or 'manual'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(experience_id, region_id)
);

COMMENT ON TABLE experience_regions IS 'Links experiences to regions via spatial containment or manual assignment';
COMMENT ON COLUMN experience_regions.assignment_type IS 'How the assignment was made: auto (spatial query) or manual';

CREATE INDEX IF NOT EXISTS idx_experience_regions_experience ON experience_regions(experience_id);
CREATE INDEX IF NOT EXISTS idx_experience_regions_region ON experience_regions(region_id);

-- User visited experiences (similar pattern to user_visited_regions)
CREATE TABLE IF NOT EXISTS user_visited_experiences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    visited_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    UNIQUE(user_id, experience_id)
);

COMMENT ON TABLE user_visited_experiences IS 'Tracks which experiences users have visited';
COMMENT ON COLUMN user_visited_experiences.rating IS 'Optional user rating from 1-5 stars';

CREATE INDEX IF NOT EXISTS idx_user_visited_experiences_user ON user_visited_experiences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_visited_experiences_experience ON user_visited_experiences(experience_id);

-- Sync audit log for tracking sync operations
CREATE TABLE IF NOT EXISTS experience_sync_logs (
    id SERIAL PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES experience_sources(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status VARCHAR(50) DEFAULT 'running',  -- 'running', 'success', 'partial', 'failed', 'cancelled'
    total_fetched INTEGER DEFAULT 0,
    total_created INTEGER DEFAULT 0,
    total_updated INTEGER DEFAULT 0,
    total_errors INTEGER DEFAULT 0,
    error_details JSONB,  -- Array of error objects with details
    triggered_by INTEGER REFERENCES users(id),  -- Admin who triggered the sync
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE experience_sync_logs IS 'Audit log for experience sync operations';
COMMENT ON COLUMN experience_sync_logs.status IS 'Sync status: running, success, partial, failed, cancelled';
COMMENT ON COLUMN experience_sync_logs.triggered_by IS 'Admin user who triggered the sync (NULL for scheduled syncs)';

CREATE INDEX IF NOT EXISTS idx_experience_sync_logs_source ON experience_sync_logs(source_id);
CREATE INDEX IF NOT EXISTS idx_experience_sync_logs_status ON experience_sync_logs(status) WHERE status = 'running';

-- =============================================================================
-- Verification
-- =============================================================================
DO $$
BEGIN
    RAISE NOTICE 'Experience tables created successfully!';
    RAISE NOTICE 'Tables: experience_sources, experiences, experience_regions, user_visited_experiences, experience_sync_logs';
END $$;

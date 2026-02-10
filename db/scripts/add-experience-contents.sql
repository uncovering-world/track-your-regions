-- =============================================================================
-- Migration: Add Experience Contents Table + Top Museums Source
-- =============================================================================
-- This migration:
-- 1. Creates experience_contents table for storing artworks/items within experiences
-- 2. Seeds "Top Museums" as experience source (id=2)
--
-- Run this after the experience tables and locations migrations.
-- =============================================================================

-- Seed "Top Museums" as experience source
INSERT INTO experience_sources (name, description, api_endpoint, api_config)
VALUES (
    'Top Museums',
    'World''s most notable museums ranked by artwork fame, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{"userAgent": "TrackYourRegions/1.0"}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- Create experience_contents table
CREATE TABLE IF NOT EXISTS experience_contents (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL,       -- Wikidata QID (e.g., "Q12418")
    name VARCHAR(500) NOT NULL,               -- "Mona Lisa"
    content_type VARCHAR(50) NOT NULL,        -- 'painting', 'sculpture'
    artist VARCHAR(500),                       -- "Leonardo da Vinci"
    year INTEGER,                              -- 1503
    image_url VARCHAR(1000),                   -- Wikimedia Commons URL (not downloaded)
    sitelinks_count INTEGER NOT NULL DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(experience_id, external_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_experience_contents_experience ON experience_contents(experience_id);
CREATE INDEX IF NOT EXISTS idx_experience_contents_type ON experience_contents(content_type);
CREATE INDEX IF NOT EXISTS idx_experience_contents_sitelinks ON experience_contents(sitelinks_count DESC);

COMMENT ON TABLE experience_contents IS 'Notable contents (artworks, artifacts) within experiences like museums';
COMMENT ON COLUMN experience_contents.external_id IS 'Wikidata QID for the artwork/item';
COMMENT ON COLUMN experience_contents.sitelinks_count IS 'Wikipedia sitelinks count - proxy for fame/notability';

-- Seed "Public Art & Monuments" as experience source
INSERT INTO experience_sources (name, description, api_endpoint, api_config)
VALUES (
    'Public Art & Monuments',
    'Notable outdoor sculptures and monuments worldwide, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{"userAgent": "TrackYourRegions/1.0"}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

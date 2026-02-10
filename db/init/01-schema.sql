-- =============================================================================
-- Track Your Regions - New Gen Database Schema
-- =============================================================================
-- This is the consolidated schema with NEW terminology (matching Drizzle ORM).
--
-- Terminology:
-- - administrative_divisions: Official GADM boundaries (countries, states, cities)
-- - world_views: Custom hierarchies for organizing regions
-- - regions: User-defined groupings within a WorldView
-- - region_members: Links regions to administrative divisions
-- - views / view_division_mapping: Saved collections of divisions
-- - users / user_visited_regions: User tracking
-- =============================================================================

-- =============================================================================
-- Extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- =============================================================================
-- Administrative Divisions (GADM boundaries)
-- =============================================================================
-- Stores official GADM boundaries with pre-simplified geometries for different
-- zoom levels. This is the source of truth for geographic boundaries.

CREATE TABLE IF NOT EXISTS administrative_divisions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    parent_id INTEGER REFERENCES administrative_divisions(id) ON DELETE SET NULL,
    has_children BOOLEAN NOT NULL DEFAULT false,
    gadm_uid INTEGER,
    -- Full resolution geometry
    geom GEOMETRY(MultiPolygon, 4326),
    -- Pre-simplified geometries for different zoom levels
    geom_simplified_low GEOMETRY(MultiPolygon, 4326),
    geom_simplified_medium GEOMETRY(MultiPolygon, 4326),
    -- User-customizable display geometry (manually editable in UI)
    display_geom GEOMETRY(MultiPolygon, 4326),
    anchor_point GEOMETRY(Point, 4326),
    geom_area_km2 DOUBLE PRECISION,
    is_archipelago BOOLEAN DEFAULT false,
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for administrative_divisions
CREATE INDEX IF NOT EXISTS idx_admin_divisions_parent ON administrative_divisions(parent_id);
CREATE INDEX IF NOT EXISTS idx_admin_divisions_name ON administrative_divisions(name);
CREATE INDEX IF NOT EXISTS idx_admin_divisions_name_trgm ON administrative_divisions USING GIN(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_admin_divisions_geom ON administrative_divisions USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_admin_divisions_geom_low ON administrative_divisions USING GIST(geom_simplified_low);
CREATE INDEX IF NOT EXISTS idx_admin_divisions_geom_medium ON administrative_divisions USING GIST(geom_simplified_medium);
CREATE INDEX IF NOT EXISTS idx_admin_div_display_geom ON administrative_divisions USING GIST(display_geom);
CREATE INDEX IF NOT EXISTS idx_admin_div_anchor_point ON administrative_divisions USING GIST(anchor_point);

-- =============================================================================
-- World Views (custom hierarchies)
-- =============================================================================
-- Allows users to create custom organizational hierarchies like "Cultural Regions",
-- "Historical Regions", "Travel Regions", etc.

CREATE TABLE IF NOT EXISTS world_views (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description VARCHAR(1000),
    source VARCHAR(1000),
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    last_assignment_at TIMESTAMPTZ,  -- Last time region assignment was run
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert GADM as the default hierarchy
INSERT INTO world_views (name, description, is_default, is_active)
VALUES ('GADM', 'Global Administrative Areas - Default hierarchy from GADM database', true, true)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Regions (user-defined groupings within a WorldView)
-- =============================================================================
-- User-created regions that group administrative divisions together.
-- Examples: "Western Europe", "Caribbean Islands", "Nordic Countries"

CREATE TABLE IF NOT EXISTS regions (
    id SERIAL PRIMARY KEY,
    world_view_id INTEGER NOT NULL REFERENCES world_views(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description VARCHAR(1000),
    parent_region_id INTEGER REFERENCES regions(id) ON DELETE SET NULL,
    color VARCHAR(7),
    -- Geometry (merged from member divisions or custom-drawn)
    geom GEOMETRY(MultiPolygon, 4326),
    is_custom_boundary BOOLEAN DEFAULT false,
    -- User-customizable display geometry (manually editable in UI)
    display_geom GEOMETRY(MultiPolygon, 4326),
    anchor_point GEOMETRY(Point, 4326),
    geom_area_km2 DOUBLE PRECISION,
    is_archipelago BOOLEAN DEFAULT false,
    -- Materialized flag: true if region has no child regions (for fast tile queries)
    is_leaf BOOLEAN NOT NULL DEFAULT true,
    -- TypeScript-generated hull with proper dateline handling
    ts_hull_geom GEOMETRY(MultiPolygon, 4326),
    ts_hull_params JSONB,
    -- Pre-computed bounding box for fitBounds() [west, south, east, north]
    -- West > east indicates antimeridian crossing (GeoJSON standard)
    focus_bbox double precision[4],
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for regions
CREATE INDEX IF NOT EXISTS idx_regions_world_view ON regions(world_view_id);
CREATE INDEX IF NOT EXISTS idx_regions_parent ON regions(parent_region_id);
CREATE INDEX IF NOT EXISTS idx_regions_geom ON regions USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_regions_display_geom ON regions USING GIST(display_geom);
CREATE INDEX IF NOT EXISTS idx_regions_anchor_point ON regions USING GIST(anchor_point);
CREATE INDEX IF NOT EXISTS idx_regions_ts_hull_geom ON regions USING GIST(ts_hull_geom);
CREATE INDEX IF NOT EXISTS idx_regions_is_leaf ON regions(is_leaf) WHERE is_leaf = true;
CREATE INDEX IF NOT EXISTS idx_regions_focus_bbox ON regions USING gin(focus_bbox) WHERE focus_bbox IS NOT NULL;

-- Trigger to maintain is_leaf column
CREATE OR REPLACE FUNCTION update_is_leaf() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.parent_region_id IS NOT NULL THEN
      UPDATE regions SET is_leaf = false WHERE id = NEW.parent_region_id AND is_leaf = true;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.parent_region_id IS DISTINCT FROM NEW.parent_region_id THEN
      IF OLD.parent_region_id IS NOT NULL THEN
        UPDATE regions SET is_leaf = NOT EXISTS(
          SELECT 1 FROM regions c WHERE c.parent_region_id = OLD.parent_region_id AND c.id != OLD.id
        ) WHERE id = OLD.parent_region_id;
      END IF;
      IF NEW.parent_region_id IS NOT NULL THEN
        UPDATE regions SET is_leaf = false WHERE id = NEW.parent_region_id AND is_leaf = true;
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.parent_region_id IS NOT NULL THEN
      UPDATE regions SET is_leaf = NOT EXISTS(
        SELECT 1 FROM regions c WHERE c.parent_region_id = OLD.parent_region_id AND c.id != OLD.id
      ) WHERE id = OLD.parent_region_id;
    END IF;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_is_leaf ON regions;
CREATE TRIGGER trg_update_is_leaf
  AFTER INSERT OR UPDATE OF parent_region_id OR DELETE ON regions
  FOR EACH ROW EXECUTE FUNCTION update_is_leaf();

-- Comments
COMMENT ON COLUMN regions.display_geom IS 'User-customizable display geometry (manually editable in UI)';
COMMENT ON COLUMN regions.ts_hull_geom IS 'TypeScript-generated concave hull with proper dateline handling';
COMMENT ON COLUMN regions.ts_hull_params IS 'Hull generation parameters (bufferKm, concavity, simplifyTolerance) - preserved when regenerating';

-- =============================================================================
-- Region Members (links regions to administrative divisions)
-- =============================================================================
-- Maps administrative divisions to user-defined regions.
-- A division can appear multiple times in the same region if each has a different
-- custom_geom (for splitting divisions into parts, like partial island coverage).

CREATE TABLE IF NOT EXISTS region_members (
    id SERIAL PRIMARY KEY,
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    division_id INTEGER NOT NULL REFERENCES administrative_divisions(id) ON DELETE CASCADE,
    -- Custom geometry for partial coverage (e.g., just part of a county)
    custom_geom GEOMETRY(MultiPolygon, 4326),
    -- Optional display name for this division part
    custom_name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
    -- Note: No unique constraint - allows same division multiple times with different custom_geom
);

-- Indexes for region_members
CREATE INDEX IF NOT EXISTS idx_region_members_region ON region_members(region_id);
CREATE INDEX IF NOT EXISTS idx_region_members_division ON region_members(division_id);
CREATE INDEX IF NOT EXISTS idx_region_members_custom_geom ON region_members USING GIST(custom_geom) WHERE custom_geom IS NOT NULL;

-- Comments
COMMENT ON TABLE region_members IS 'Maps administrative divisions to regions. A division can appear multiple times in the same region if each has a different custom_geom (for splitting divisions into parts).';
COMMENT ON COLUMN region_members.custom_name IS 'Optional display name for this division part (e.g., "Marshall Islands - Part 1")';

-- =============================================================================
-- Views (saved collections of divisions)
-- =============================================================================
-- Simple saved collections of administrative divisions for quick access.

CREATE TABLE IF NOT EXISTS views (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- View-Division mapping
CREATE TABLE IF NOT EXISTS view_division_mapping (
    id SERIAL PRIMARY KEY,
    view_id INTEGER NOT NULL REFERENCES views(id) ON DELETE CASCADE,
    division_id INTEGER NOT NULL REFERENCES administrative_divisions(id) ON DELETE CASCADE,
    UNIQUE(view_id, division_id)
);

-- Indexes for view_division_mapping
CREATE INDEX IF NOT EXISTS idx_view_mapping_view ON view_division_mapping(view_id);
CREATE INDEX IF NOT EXISTS idx_view_mapping_division ON view_division_mapping(division_id);

-- =============================================================================
-- Authentication Enums
-- =============================================================================

-- User roles
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('user', 'curator', 'admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Authentication providers (extensible via ALTER TYPE later)
DO $$ BEGIN
    CREATE TYPE auth_provider AS ENUM ('local', 'google', 'apple');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =============================================================================
-- Users (with authentication support)
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    uuid VARCHAR(36) NOT NULL UNIQUE,
    display_name VARCHAR(255),
    -- Authentication columns
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),
    role user_role NOT NULL DEFAULT 'user',
    avatar_url VARCHAR(1000),
    auth_provider auth_provider,
    provider_id VARCHAR(255),
    email_verified BOOLEAN NOT NULL DEFAULT false,
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_provider ON users(auth_provider, provider_id) WHERE provider_id IS NOT NULL;

-- =============================================================================
-- User Auth Providers (for linking multiple OAuth accounts)
-- =============================================================================
-- Allows users to link multiple OAuth providers to a single account
-- e.g., same user can link both Google and Apple accounts

CREATE TABLE IF NOT EXISTS user_auth_providers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider auth_provider NOT NULL,
    provider_id VARCHAR(255) NOT NULL,
    provider_email VARCHAR(255),
    provider_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(provider, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_user_auth_providers_user ON user_auth_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_auth_providers_lookup ON user_auth_providers(provider, provider_id);

COMMENT ON TABLE user_auth_providers IS 'Links multiple OAuth providers to one user account for future "link another account" functionality';
COMMENT ON COLUMN user_auth_providers.provider_data IS 'Raw profile data from OAuth provider (for reference)';

-- =============================================================================
-- Refresh Tokens
-- =============================================================================
-- Stores hashed refresh tokens with expiry per user
-- Allows for token rotation and invalidation

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    family_id VARCHAR(64),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id) WHERE family_id IS NOT NULL;

COMMENT ON TABLE refresh_tokens IS 'Stores hashed refresh tokens for JWT token rotation';
COMMENT ON COLUMN refresh_tokens.token_hash IS 'SHA-256 hash of the refresh token (never store plain tokens)';
COMMENT ON COLUMN refresh_tokens.family_id IS 'Token family for reuse detection — all rotated tokens share a family';
COMMENT ON COLUMN refresh_tokens.revoked_at IS 'If set, token has been invalidated (logout or rotation)';

-- =============================================================================
-- Cleanup Function for Refresh Tokens
-- =============================================================================
-- Removes expired and revoked refresh tokens periodically

CREATE OR REPLACE FUNCTION cleanup_refresh_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM refresh_tokens
    WHERE expires_at < NOW()
       OR revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_refresh_tokens IS 'Call periodically to remove expired/revoked tokens';

-- =============================================================================
-- Email Verification Tokens
-- =============================================================================
-- One-time tokens sent via email to verify user email addresses.
-- Tokens are hashed (SHA-256) before storage; raw token is sent in the email link.

CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_evt_hash ON email_verification_tokens(token_hash);

COMMENT ON TABLE email_verification_tokens IS 'One-time tokens for email address verification (hashed with SHA-256)';
COMMENT ON COLUMN email_verification_tokens.token_hash IS 'SHA-256 hash of the verification token (never store plain tokens)';

-- Cleanup function for expired verification tokens
CREATE OR REPLACE FUNCTION cleanup_verification_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM email_verification_tokens WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_verification_tokens IS 'Call periodically to remove expired email verification tokens';

-- =============================================================================
-- User Visited Regions
-- =============================================================================
-- Tracks which regions users have visited.

CREATE TABLE IF NOT EXISTS user_visited_regions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    visited_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    UNIQUE(user_id, region_id)
);

CREATE INDEX IF NOT EXISTS idx_user_visited_regions_user ON user_visited_regions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_visited_regions_region ON user_visited_regions(region_id);

-- =============================================================================
-- Functions: Geometry Simplification
-- =============================================================================

-- Function to update simplified geometries for administrative_divisions
CREATE OR REPLACE FUNCTION update_simplified_geometries()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.geom IS NOT NULL THEN
        -- Low detail: ~0.1 degree tolerance (good for world view)
        NEW.geom_simplified_low := ST_SimplifyPreserveTopology(NEW.geom, 0.1);
        -- Medium detail: ~0.01 degree tolerance (good for country view)
        NEW.geom_simplified_medium := ST_SimplifyPreserveTopology(NEW.geom, 0.01);
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-simplify geometries on insert/update
DROP TRIGGER IF EXISTS trigger_simplify_geom ON administrative_divisions;
CREATE TRIGGER trigger_simplify_geom
    BEFORE INSERT OR UPDATE OF geom ON administrative_divisions
    FOR EACH ROW
    EXECUTE FUNCTION update_simplified_geometries();

-- =============================================================================
-- Functions: Display Geometry Generation
-- =============================================================================

-- Function to generate anchor point (representative point for labels)
CREATE OR REPLACE FUNCTION generate_anchor_point(p_geom GEOMETRY)
RETURNS GEOMETRY AS $$
DECLARE
    result GEOMETRY;
BEGIN
    IF p_geom IS NULL THEN
        RETURN NULL;
    END IF;

    -- Try to get a point that's actually inside the geometry
    result := ST_PointOnSurface(p_geom);

    -- Fallback to centroid if PointOnSurface fails
    IF result IS NULL THEN
        result := ST_Centroid(p_geom);
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to detect if geometry is an archipelago
-- OPTIMIZED and CONSERVATIVE: Avoids false positives for continental regions
CREATE OR REPLACE FUNCTION is_archipelago_geometry(p_geom GEOMETRY)
RETURNS BOOLEAN AS $$
DECLARE
    num_parts INTEGER;
    lng_span DOUBLE PRECISION;
    lat_span DOUBLE PRECISION;
    bbox_area_approx DOUBLE PRECISION;
    geom_area_approx DOUBLE PRECISION;
    sparsity DOUBLE PRECISION;
    area_per_part DOUBLE PRECISION;
BEGIN
    IF p_geom IS NULL THEN
        RETURN false;
    END IF;

    num_parts := ST_NumGeometries(p_geom);

    -- Low part count - definitely not an archipelago
    -- Must have at least 10 separate parts (islands)
    IF num_parts < 10 THEN
        RETURN false;
    END IF;

    -- Check if geometry crosses antimeridian (bbox spans nearly full longitude)
    lng_span := ST_XMax(p_geom) - ST_XMin(p_geom);
    lat_span := ST_YMax(p_geom) - ST_YMin(p_geom);

    -- Calculate areas
    bbox_area_approx := lng_span * lat_span;
    geom_area_approx := ST_Area(p_geom);
    IF geom_area_approx < 0.0001 THEN
        geom_area_approx := 0.0001;
    END IF;

    sparsity := bbox_area_approx / geom_area_approx;
    area_per_part := geom_area_approx / num_parts;

    -- Exclude large continental regions
    IF area_per_part > 0.5 THEN
        RETURN false;
    END IF;

    -- For antimeridian-crossing geometries
    IF lng_span > 350 THEN
        RETURN num_parts >= 100 AND area_per_part < 0.1;
    END IF;

    -- Archipelago criteria
    IF num_parts >= 100 AND sparsity > 100 AND area_per_part < 0.2 THEN
        RETURN true;
    END IF;

    RETURN num_parts >= 10 AND sparsity > 200 AND area_per_part < 0.5;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =============================================================================
-- Trigger: Update metadata for regions when geom changes
-- =============================================================================
-- NOTE: display_geom is user-controlled and NOT auto-generated
-- is_archipelago is auto-detected ONLY on INSERT, preserved on UPDATE

CREATE OR REPLACE FUNCTION update_region_metadata()
RETURNS TRIGGER AS $$
DECLARE
    detected_archipelago BOOLEAN;
BEGIN
    IF NEW.geom IS NOT NULL THEN
        -- NOTE: anchor_point is computed by update_region_focus_data() which handles
        -- antimeridian-crossing and full-globe regions correctly. Do NOT set it here.
        NEW.geom_area_km2 := ST_Area(NEW.geom::geography) / 1000000;

        -- Only auto-detect archipelago on INSERT (new region creation)
        -- On UPDATE, always preserve the existing value (user may have changed it manually)
        IF TG_OP = 'INSERT' THEN
            detected_archipelago := is_archipelago_geometry(NEW.geom);
            NEW.is_archipelago := detected_archipelago;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to regions table
DROP TRIGGER IF EXISTS trigger_display_geom ON regions;
DROP TRIGGER IF EXISTS trigger_region_metadata ON regions;
CREATE TRIGGER trigger_region_metadata
    BEFORE INSERT OR UPDATE OF geom ON regions
    FOR EACH ROW
    EXECUTE FUNCTION update_region_metadata();

-- =============================================================================
-- Trigger: Update focus_bbox and anchor_point when geometry changes
-- =============================================================================
-- Uses ST_ShiftLongitude to detect and handle antimeridian-crossing regions

CREATE OR REPLACE FUNCTION update_region_focus_data()
RETURNS TRIGGER AS $$
DECLARE
  effective_geom geometry;  -- for lat bounds (visual extent)
  bbox_geom geometry;       -- for lng bounds (antimeridian-safe)
  min_lat double precision;
  max_lat double precision;
  -- Normal [-180,180] bbox
  norm_west double precision;
  norm_east double precision;
  norm_span double precision;
  -- Shifted [0,360] bbox (for antimeridian detection)
  shifted_geom geometry;
  shift_west double precision;
  shift_east double precision;
  shift_span double precision;
  -- Final values
  final_west double precision;
  final_east double precision;
  center_lng double precision;
  center_lat double precision;
  -- Children-based focus (for full-globe regions)
  child_shift_west double precision;
  child_shift_east double precision;
  child_min_lat double precision;
  child_max_lat double precision;
BEGIN
  -- Visual extent geometry (for lat bounds)
  effective_geom := COALESCE(NEW.display_geom, NEW.ts_hull_geom, NEW.geom);
  -- Antimeridian-safe geometry: use hull or raw geom (display_geom spans globe for archipelagos)
  bbox_geom := COALESCE(NEW.ts_hull_geom, NEW.geom);

  IF effective_geom IS NOT NULL THEN
    -- Latitude bounds from visual extent (same either way)
    min_lat := ST_YMin(effective_geom);
    max_lat := ST_YMax(effective_geom);
    center_lat := (min_lat + max_lat) / 2;

    -- Compute normal bbox from effective_geom
    norm_west := ST_XMin(effective_geom);
    norm_east := ST_XMax(effective_geom);
    norm_span := norm_east - norm_west;

    -- Compute shifted bbox from bbox_geom (hull/geom, not display_geom)
    -- ST_ShiftLongitude moves negative coords to [180,360] range
    IF bbox_geom IS NOT NULL THEN
      shifted_geom := ST_ShiftLongitude(bbox_geom);
      shift_west := ST_XMin(shifted_geom);
      shift_east := ST_XMax(shifted_geom);
      shift_span := shift_east - shift_west;
    ELSE
      shift_span := norm_span + 1; -- ensure normal wins
    END IF;

    IF norm_span > 350 THEN
      -- Full-globe region (e.g. Oceania): geometry spans nearly all longitudes.
      -- Derive focus_bbox from children's focus data in shifted [0,360] space.
      SELECT
        MIN(CASE WHEN c.focus_bbox[1] < 0 THEN c.focus_bbox[1] + 360 ELSE c.focus_bbox[1] END),
        MAX(CASE WHEN c.focus_bbox[3] < 0 THEN c.focus_bbox[3] + 360 ELSE c.focus_bbox[3] END),
        MIN(c.focus_bbox[2]),
        MAX(c.focus_bbox[4])
      INTO child_shift_west, child_shift_east, child_min_lat, child_max_lat
      FROM regions c
      WHERE c.parent_region_id = NEW.id
        AND c.focus_bbox IS NOT NULL;

      IF child_shift_west IS NOT NULL THEN
        -- Use children's aggregated bbox
        final_west := CASE WHEN child_shift_west > 180 THEN child_shift_west - 360 ELSE child_shift_west END;
        final_east := CASE WHEN child_shift_east > 180 THEN child_shift_east - 360 ELSE child_shift_east END;
        center_lng := (child_shift_west + child_shift_east) / 2;
        IF center_lng > 180 THEN
          center_lng := center_lng - 360;
        END IF;
        center_lat := (child_min_lat + child_max_lat) / 2;
        min_lat := child_min_lat;
        max_lat := child_max_lat;
      ELSE
        -- No children with focus data: fall back to normal bbox
        final_west := norm_west;
        final_east := norm_east;
        center_lng := (norm_west + norm_east) / 2;
      END IF;
    ELSIF shift_span < norm_span THEN
      -- Antimeridian crossing: shifted bbox is more compact
      -- Convert shifted coords back to [-180,180] with west > east convention
      final_west := CASE WHEN shift_west > 180 THEN shift_west - 360 ELSE shift_west END;
      final_east := CASE WHEN shift_east > 180 THEN shift_east - 360 ELSE shift_east END;
      -- Center from shifted space, then normalize
      center_lng := (shift_west + shift_east) / 2;
      IF center_lng > 180 THEN
        center_lng := center_lng - 360;
      END IF;
    ELSE
      -- Normal case: use effective_geom bbox directly
      final_west := norm_west;
      final_east := norm_east;
      center_lng := (norm_west + norm_east) / 2;
    END IF;

    -- Store bbox as [west, south, east, north]
    NEW.focus_bbox := ARRAY[final_west, min_lat, final_east, max_lat];
    NEW.anchor_point := ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326);
  ELSE
    NEW.anchor_point := NULL;
    NEW.focus_bbox := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_region_focus_data ON regions;
CREATE TRIGGER trigger_update_region_focus_data
  BEFORE INSERT OR UPDATE OF geom, ts_hull_geom, display_geom ON regions
  FOR EACH ROW
  EXECUTE FUNCTION update_region_focus_data();

COMMENT ON FUNCTION update_region_focus_data() IS 'Trigger function to auto-update anchor_point and focus_bbox when region geometry changes.';

-- =============================================================================
-- Function: Search regions (full-text with similarity)
-- =============================================================================

CREATE OR REPLACE FUNCTION search_divisions(
    p_query TEXT,
    p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
    division_id INTEGER,
    division_name VARCHAR,
    path TEXT,
    relevance REAL
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE ancestors AS (
        SELECT
            d.id,
            d.name,
            d.parent_id,
            d.name::TEXT AS path,
            d.id AS target_id
        FROM administrative_divisions d
        WHERE d.name ILIKE '%' || p_query || '%'

        UNION ALL

        SELECT
            parent.id,
            parent.name,
            parent.parent_id,
            parent.name || ' > ' || child.path,
            child.target_id
        FROM administrative_divisions parent
        JOIN ancestors child ON parent.id = child.parent_id
    )
    SELECT DISTINCT ON (a.target_id)
        a.target_id,
        (SELECT name FROM administrative_divisions WHERE id = a.target_id),
        a.path,
        similarity(
            (SELECT name FROM administrative_divisions WHERE id = a.target_id),
            p_query
        )
    FROM ancestors a
    WHERE a.parent_id IS NULL
    ORDER BY a.target_id, length(a.path) DESC, similarity(
        (SELECT name FROM administrative_divisions WHERE id = a.target_id),
        p_query
    ) DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Helper Function: Bounding box dimensions in km
-- =============================================================================

CREATE OR REPLACE FUNCTION bbox_dimensions_km(p_geom GEOMETRY)
RETURNS TABLE(width_km DOUBLE PRECISION, height_km DOUBLE PRECISION) AS $$
DECLARE
    min_lng DOUBLE PRECISION;
    max_lng DOUBLE PRECISION;
    min_lat DOUBLE PRECISION;
    max_lat DOUBLE PRECISION;
    center_lat DOUBLE PRECISION;
BEGIN
    min_lng := ST_XMin(p_geom);
    max_lng := ST_XMax(p_geom);
    min_lat := ST_YMin(p_geom);
    max_lat := ST_YMax(p_geom);
    center_lat := (min_lat + max_lat) / 2;

    height_km := (max_lat - min_lat) * 111.0;
    width_km := (max_lng - min_lng) * 111.0 * COS(RADIANS(center_lat));

    RETURN NEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =============================================================================
-- SRID 3857 Geometry Columns for Fast Vector Tile Generation
-- =============================================================================
-- The main performance bottleneck in MVT generation is ST_Transform.
-- By pre-computing geometries in SRID 3857, we eliminate this at query time.
-- We also pre-simplify geometries for different zoom levels.
-- =============================================================================

-- Add 3857 geometry columns to regions table
ALTER TABLE regions ADD COLUMN IF NOT EXISTS geom_3857 geometry(MultiPolygon, 3857);
ALTER TABLE regions ADD COLUMN IF NOT EXISTS ts_hull_geom_3857 geometry(MultiPolygon, 3857);
ALTER TABLE regions ADD COLUMN IF NOT EXISTS display_geom_3857 geometry(MultiPolygon, 3857);

-- Add simplified geometry columns for low zoom levels (zoom 0-4)
ALTER TABLE regions ADD COLUMN IF NOT EXISTS geom_simplified_low geometry(MultiPolygon, 3857);
-- Add simplified geometry columns for medium zoom levels (zoom 5-8)
ALTER TABLE regions ADD COLUMN IF NOT EXISTS geom_simplified_medium geometry(MultiPolygon, 3857);

-- Add 3857 geometry columns to administrative_divisions table
ALTER TABLE administrative_divisions ADD COLUMN IF NOT EXISTS geom_3857 geometry(MultiPolygon, 3857);
ALTER TABLE administrative_divisions ADD COLUMN IF NOT EXISTS geom_simplified_low_3857 geometry(MultiPolygon, 3857);
ALTER TABLE administrative_divisions ADD COLUMN IF NOT EXISTS geom_simplified_medium_3857 geometry(MultiPolygon, 3857);

-- Helper function: simplify geometry with fallback for small islands, smooth corners.
-- Three-stage pipeline:
--   Stage 1: ST_Simplify at requested tolerance (aggressive vertex removal)
--   Stage 2: If nothing survived (small islands), retry with tolerance scaled
--            to the largest polygon's width
--   Stage 3: ST_ChaikinSmoothing to round off Douglas-Peucker angular artifacts
CREATE OR REPLACE FUNCTION simplify_for_zoom(
    geom geometry,
    tolerance double precision,
    min_area double precision,
    smooth_iterations integer DEFAULT 0
) RETURNS geometry AS $$
DECLARE
    result geometry;
    max_poly_width double precision;
BEGIN
    -- Stage 1: simplify at requested tolerance, filter small polygons
    SELECT ST_Multi(ST_CollectionExtract(
        ST_MakeValid(ST_Collect(dump.geom)), 3))
    INTO result
    FROM (
        SELECT (ST_Dump(
            ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Simplify(geom, tolerance)), 3))
        )).geom
    ) AS dump
    WHERE ST_Area(dump.geom) >= min_area;

    -- Stage 2: if nothing survived (geometry smaller than tolerance), retry
    -- with tolerance scaled to the largest individual polygon's width
    IF result IS NULL OR ST_IsEmpty(result) THEN
        SELECT max(sqrt(ST_Area(ST_Envelope(d.geom))))
        INTO max_poly_width
        FROM (SELECT (ST_Dump(geom)).geom) AS d;

        IF max_poly_width IS NOT NULL AND max_poly_width > 0 THEN
            SELECT ST_Multi(ST_CollectionExtract(
                ST_MakeValid(ST_Collect(dump.geom)), 3))
            INTO result
            FROM (
                SELECT (ST_Dump(
                    ST_Multi(ST_CollectionExtract(ST_MakeValid(
                        ST_Simplify(geom, max_poly_width / 10.0)
                    ), 3))
                )).geom
            ) AS dump
            WHERE NOT ST_IsEmpty(dump.geom);
        END IF;
    END IF;

    -- Stage 3: smooth corners
    IF smooth_iterations > 0 AND result IS NOT NULL AND NOT ST_IsEmpty(result) THEN
        result := ST_ChaikinSmoothing(result, smooth_iterations);
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- Create spatial indexes on the new columns
CREATE INDEX IF NOT EXISTS idx_regions_geom_3857 ON regions USING GIST(geom_3857);
CREATE INDEX IF NOT EXISTS idx_regions_ts_hull_geom_3857 ON regions USING GIST(ts_hull_geom_3857);
CREATE INDEX IF NOT EXISTS idx_regions_display_geom_3857 ON regions USING GIST(display_geom_3857);
CREATE INDEX IF NOT EXISTS idx_regions_geom_simplified_low ON regions USING GIST(geom_simplified_low);
CREATE INDEX IF NOT EXISTS idx_regions_geom_simplified_medium ON regions USING GIST(geom_simplified_medium);

CREATE INDEX IF NOT EXISTS idx_admin_div_geom_3857 ON administrative_divisions USING GIST(geom_3857);
CREATE INDEX IF NOT EXISTS idx_admin_div_geom_low_3857 ON administrative_divisions USING GIST(geom_simplified_low_3857);
CREATE INDEX IF NOT EXISTS idx_admin_div_geom_medium_3857 ON administrative_divisions USING GIST(geom_simplified_medium_3857);

-- =============================================================================
-- Triggers: Auto-update 3857 columns when 4326 columns change
-- =============================================================================

-- Trigger function for regions
-- Handles both INSERT (OLD is NULL) and UPDATE operations
CREATE OR REPLACE FUNCTION update_regions_geom_3857()
RETURNS TRIGGER AS $$
DECLARE
    effective_geom geometry;
    geom_changed boolean;
    ts_hull_changed boolean;
    display_changed boolean;
BEGIN
    geom_changed := (TG_OP = 'INSERT' AND NEW.geom IS NOT NULL)
                    OR (TG_OP = 'UPDATE' AND NEW.geom IS DISTINCT FROM OLD.geom);
    ts_hull_changed := (TG_OP = 'INSERT' AND NEW.ts_hull_geom IS NOT NULL)
                       OR (TG_OP = 'UPDATE' AND NEW.ts_hull_geom IS DISTINCT FROM OLD.ts_hull_geom);
    display_changed := (TG_OP = 'INSERT' AND NEW.display_geom IS NOT NULL)
                       OR (TG_OP = 'UPDATE' AND NEW.display_geom IS DISTINCT FROM OLD.display_geom);

    -- Transform changed geometries to 3857
    IF geom_changed AND NEW.geom IS NOT NULL THEN
        NEW.geom_3857 := ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Transform(NEW.geom, 3857)), 3));
    END IF;
    IF ts_hull_changed AND NEW.ts_hull_geom IS NOT NULL THEN
        NEW.ts_hull_geom_3857 := ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Transform(NEW.ts_hull_geom, 3857)), 3));
    END IF;
    IF display_changed AND NEW.display_geom IS NOT NULL THEN
        NEW.display_geom_3857 := ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Transform(NEW.display_geom, 3857)), 3));
    END IF;

    -- Update simplified geometries when any source geometry changes
    IF geom_changed OR ts_hull_changed OR display_changed THEN
        effective_geom := COALESCE(NEW.ts_hull_geom_3857, NEW.display_geom_3857, NEW.geom_3857);
        IF effective_geom IS NOT NULL THEN
            NEW.geom_simplified_low := simplify_for_zoom(effective_geom, 5000, 0, 0);
            NEW.geom_simplified_medium := simplify_for_zoom(effective_geom, 1000, 0, 0);
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for administrative_divisions
CREATE OR REPLACE FUNCTION update_admin_div_geom_3857()
RETURNS TRIGGER AS $$
DECLARE
    geom_changed boolean;
    low_changed boolean;
    medium_changed boolean;
BEGIN
    geom_changed := (TG_OP = 'INSERT' AND NEW.geom IS NOT NULL)
                    OR (TG_OP = 'UPDATE' AND NEW.geom IS DISTINCT FROM OLD.geom);
    low_changed := (TG_OP = 'INSERT' AND NEW.geom_simplified_low IS NOT NULL)
                   OR (TG_OP = 'UPDATE' AND NEW.geom_simplified_low IS DISTINCT FROM OLD.geom_simplified_low);
    medium_changed := (TG_OP = 'INSERT' AND NEW.geom_simplified_medium IS NOT NULL)
                      OR (TG_OP = 'UPDATE' AND NEW.geom_simplified_medium IS DISTINCT FROM OLD.geom_simplified_medium);

    IF geom_changed AND NEW.geom IS NOT NULL THEN
        NEW.geom_3857 := ST_Transform(NEW.geom, 3857);
    END IF;

    IF (geom_changed OR low_changed) AND NEW.geom_3857 IS NOT NULL THEN
        NEW.geom_simplified_low_3857 := simplify_for_zoom(NEW.geom_3857, 5000, 0, 0);
    END IF;
    IF (geom_changed OR medium_changed) AND NEW.geom_3857 IS NOT NULL THEN
        NEW.geom_simplified_medium_3857 := simplify_for_zoom(NEW.geom_3857, 1000, 0, 0);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
DROP TRIGGER IF EXISTS trg_regions_geom_3857 ON regions;
CREATE TRIGGER trg_regions_geom_3857
    BEFORE INSERT OR UPDATE ON regions
    FOR EACH ROW
    EXECUTE FUNCTION update_regions_geom_3857();

DROP TRIGGER IF EXISTS trg_admin_div_geom_3857 ON administrative_divisions;
CREATE TRIGGER trg_admin_div_geom_3857
    BEFORE INSERT OR UPDATE ON administrative_divisions
    FOR EACH ROW
    EXECUTE FUNCTION update_admin_div_geom_3857();

COMMENT ON COLUMN regions.geom_3857 IS 'Pre-computed geometry in SRID 3857 for fast MVT generation';
COMMENT ON COLUMN regions.ts_hull_geom_3857 IS 'Pre-computed TS hull in SRID 3857 for fast MVT generation';
COMMENT ON COLUMN regions.display_geom_3857 IS 'Pre-computed display geometry in SRID 3857 for fast MVT generation';
COMMENT ON COLUMN administrative_divisions.geom_3857 IS 'Pre-computed geometry in SRID 3857 for fast MVT generation';

-- =============================================================================
-- Martin Vector Tile Functions
-- =============================================================================
-- These functions generate MVT tiles for the RegionMap component.
-- They implement smart geometry selection (ts_hull > display_geom > geom)
-- and proper simplification based on zoom level.

-- Drop old functions if they exist (with different signatures)
DROP FUNCTION IF EXISTS tile_world_view_root_regions(integer, integer, integer, integer);
DROP FUNCTION IF EXISTS tile_region_subregions(integer, integer, integer, integer);
DROP FUNCTION IF EXISTS tile_gadm_root_divisions(integer, integer, integer);
DROP FUNCTION IF EXISTS tile_gadm_subdivisions(integer, integer, integer, integer);
DROP FUNCTION IF EXISTS tile_region_islands(integer, integer, integer, integer);

-- -----------------------------------------------------------------------------
-- Function: tile_world_view_root_regions
-- Returns root-level regions for a world view as MVT
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tile_world_view_root_regions(
    z integer,
    x integer,
    y integer,
    query_params json DEFAULT '{}'::json
)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    result bytea;
    bounds geometry;
    p_world_view_id integer;
BEGIN
    p_world_view_id := (query_params->>'world_view_id')::integer;
    bounds := ST_TileEnvelope(z, x, y);

    SELECT ST_AsMVT(tile, 'regions', 4096, 'geom', 'id') INTO result
    FROM (
        SELECT
            r.id,
            r.id as region_id,
            r.name,
            r.world_view_id,
            r.parent_region_id,
            r.color,
            r.is_archipelago,
            EXISTS(SELECT 1 FROM regions c WHERE c.parent_region_id = r.id LIMIT 1) as has_subregions,
            (r.is_archipelago AND r.ts_hull_geom IS NOT NULL) as using_ts_hull,
            (r.is_archipelago AND r.display_geom IS NOT NULL AND r.ts_hull_geom IS NULL) as using_display_geom,
            ST_AsMVTGeom(
                CASE
                    WHEN z <= 2 AND r.geom_simplified_low IS NOT NULL
                        THEN ST_SimplifyPreserveTopology(r.geom_simplified_low, 50000)
                    WHEN z <= 4 AND r.geom_simplified_low IS NOT NULL THEN r.geom_simplified_low
                    WHEN z <= 8 AND r.geom_simplified_medium IS NOT NULL THEN r.geom_simplified_medium
                    WHEN r.is_archipelago AND r.ts_hull_geom_3857 IS NOT NULL THEN r.ts_hull_geom_3857
                    WHEN r.is_archipelago AND r.display_geom_3857 IS NOT NULL THEN r.display_geom_3857
                    ELSE r.geom_3857
                END,
                bounds, 4096, 64, true
            ) AS geom
        FROM regions r
        WHERE r.parent_region_id IS NULL
          AND (p_world_view_id IS NULL OR r.world_view_id = p_world_view_id)
          AND r.geom_3857 IS NOT NULL
          AND r.geom_3857 && bounds
    ) AS tile
    WHERE tile.geom IS NOT NULL;

    RETURN COALESCE(result, '');
END;
$$;

COMMENT ON FUNCTION tile_world_view_root_regions IS 'MVT tiles for root regions of a world view. Query params: world_view_id';

-- -----------------------------------------------------------------------------
-- Function: tile_region_subregions
-- Returns subregions of a parent region as MVT
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tile_region_subregions(
    z integer,
    x integer,
    y integer,
    query_params json DEFAULT '{}'::json
)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    result bytea;
    bounds geometry;
    p_parent_id integer;
BEGIN
    p_parent_id := (query_params->>'parent_id')::integer;

    IF p_parent_id IS NULL THEN
        RETURN '';
    END IF;

    bounds := ST_TileEnvelope(z, x, y);

    SELECT ST_AsMVT(tile, 'regions', 4096, 'geom', 'id') INTO result
    FROM (
        SELECT
            r.id,
            r.id as region_id,
            r.name,
            r.world_view_id,
            r.parent_region_id,
            r.color,
            r.is_archipelago,
            EXISTS(SELECT 1 FROM regions c WHERE c.parent_region_id = r.id LIMIT 1) as has_subregions,
            (r.is_archipelago AND r.ts_hull_geom IS NOT NULL) as using_ts_hull,
            (r.is_archipelago AND r.display_geom IS NOT NULL AND r.ts_hull_geom IS NULL) as using_display_geom,
            ST_AsMVTGeom(
                CASE
                    WHEN z <= 2 AND r.geom_simplified_low IS NOT NULL
                        THEN ST_SimplifyPreserveTopology(r.geom_simplified_low, 50000)
                    WHEN z <= 4 AND r.geom_simplified_low IS NOT NULL THEN r.geom_simplified_low
                    WHEN z <= 8 AND r.geom_simplified_medium IS NOT NULL THEN r.geom_simplified_medium
                    WHEN r.is_archipelago AND r.ts_hull_geom_3857 IS NOT NULL THEN r.ts_hull_geom_3857
                    WHEN r.is_archipelago AND r.display_geom_3857 IS NOT NULL THEN r.display_geom_3857
                    ELSE r.geom_3857
                END,
                bounds, 4096, 64, true
            ) AS geom
        FROM regions r
        WHERE r.parent_region_id = p_parent_id
          AND r.geom_3857 IS NOT NULL
          AND r.geom_3857 && bounds
    ) AS tile
    WHERE tile.geom IS NOT NULL;

    RETURN COALESCE(result, '');
END;
$$;

COMMENT ON FUNCTION tile_region_subregions IS 'MVT tiles for subregions of a parent region. Query params: parent_id';

-- -----------------------------------------------------------------------------
-- Function: tile_gadm_root_divisions
-- Returns root-level GADM divisions (continents) as MVT
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tile_gadm_root_divisions(
    z integer,
    x integer,
    y integer,
    query_params json DEFAULT '{}'::json
)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    result bytea;
    bounds geometry;
BEGIN
    bounds := ST_TileEnvelope(z, x, y);

    SELECT ST_AsMVT(tile, 'divisions', 4096, 'geom', 'id') INTO result
    FROM (
        SELECT
            d.id,
            d.id as division_id,
            d.name,
            d.parent_id,
            d.has_children,
            ST_AsMVTGeom(
                CASE
                    WHEN z <= 4 AND d.geom_simplified_low_3857 IS NOT NULL THEN d.geom_simplified_low_3857
                    WHEN z <= 8 AND d.geom_simplified_medium_3857 IS NOT NULL THEN d.geom_simplified_medium_3857
                    ELSE d.geom_3857
                END,
                bounds, 4096, 64, true
            ) AS geom
        FROM administrative_divisions d
        WHERE d.parent_id IS NULL
          AND d.geom_3857 IS NOT NULL
          AND d.geom_3857 && bounds
    ) AS tile
    WHERE tile.geom IS NOT NULL;

    RETURN COALESCE(result, '');
END;
$$;

COMMENT ON FUNCTION tile_gadm_root_divisions IS 'MVT tiles for root GADM divisions (continents)';

-- -----------------------------------------------------------------------------
-- Function: tile_gadm_subdivisions
-- Returns subdivisions of a parent GADM division as MVT
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tile_gadm_subdivisions(
    z integer,
    x integer,
    y integer,
    query_params json DEFAULT '{}'::json
)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    result bytea;
    bounds geometry;
    p_parent_id integer;
BEGIN
    p_parent_id := (query_params->>'parent_id')::integer;

    IF p_parent_id IS NULL THEN
        RETURN '';
    END IF;

    bounds := ST_TileEnvelope(z, x, y);

    SELECT ST_AsMVT(tile, 'divisions', 4096, 'geom', 'id') INTO result
    FROM (
        SELECT
            d.id,
            d.id as division_id,
            d.name,
            d.parent_id,
            d.has_children,
            ST_AsMVTGeom(
                CASE
                    WHEN z <= 4 AND d.geom_simplified_low_3857 IS NOT NULL THEN d.geom_simplified_low_3857
                    WHEN z <= 8 AND d.geom_simplified_medium_3857 IS NOT NULL THEN d.geom_simplified_medium_3857
                    ELSE d.geom_3857
                END,
                bounds, 4096, 64, true
            ) AS geom
        FROM administrative_divisions d
        WHERE d.parent_id = p_parent_id
          AND d.geom_3857 IS NOT NULL
          AND d.geom_3857 && bounds
    ) AS tile
    WHERE tile.geom IS NOT NULL;

    RETURN COALESCE(result, '');
END;
$$;

COMMENT ON FUNCTION tile_gadm_subdivisions IS 'MVT tiles for GADM subdivisions of a parent. Query params: parent_id';

-- -----------------------------------------------------------------------------
-- Function: tile_region_islands
-- Returns real island boundaries for archipelago regions
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tile_region_islands(
    z integer,
    x integer,
    y integer,
    query_params json DEFAULT '{}'::json
)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    result bytea;
    bounds geometry;
    p_parent_id integer;
BEGIN
    p_parent_id := (query_params->>'parent_id')::integer;
    bounds := ST_TileEnvelope(z, x, y);

    SELECT ST_AsMVT(tile, 'islands', 4096, 'geom', 'id') INTO result
    FROM (
        SELECT
            r.id,
            r.id as region_id,
            r.name,
            r.color,
            ST_AsMVTGeom(r.geom_3857, bounds, 4096, 64, true) AS geom
        FROM regions r
        WHERE r.is_archipelago = true
          AND (r.ts_hull_geom IS NOT NULL OR r.display_geom IS NOT NULL)
          AND r.geom_3857 IS NOT NULL
          AND (p_parent_id IS NULL OR r.parent_region_id = p_parent_id)
          AND r.geom_3857 && bounds
    ) AS tile
    WHERE tile.geom IS NOT NULL;

    RETURN COALESCE(result, '');
END;
$$;

COMMENT ON FUNCTION tile_region_islands IS 'MVT tiles for real island boundaries of archipelago regions. Query params: parent_id (optional)';

-- -----------------------------------------------------------------------------
-- Function: tile_world_view_all_leaf_regions
-- Returns ALL leaf regions (regions without subregions) for a world view
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tile_world_view_all_leaf_regions(
    z integer,
    x integer,
    y integer,
    query_params json DEFAULT '{}'::json
)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    result bytea;
    bounds geometry;
    p_world_view_id integer;
BEGIN
    p_world_view_id := (query_params->>'world_view_id')::integer;
    bounds := ST_TileEnvelope(z, x, y);

    SELECT ST_AsMVT(tile, 'regions', 4096, 'geom', 'id') INTO result
    FROM (
        SELECT
            r.id,
            r.id as region_id,
            r.name,
            r.world_view_id,
            r.parent_region_id,
            r.color,
            r.is_archipelago,
            false as has_subregions,
            (r.is_archipelago AND r.ts_hull_geom IS NOT NULL) as using_ts_hull,
            (r.is_archipelago AND r.display_geom IS NOT NULL AND r.ts_hull_geom IS NULL) as using_display_geom,
            ST_AsMVTGeom(
                CASE
                    WHEN z <= 2 AND r.geom_simplified_low IS NOT NULL
                        THEN ST_SimplifyPreserveTopology(r.geom_simplified_low, 50000)
                    WHEN z <= 4 AND r.geom_simplified_low IS NOT NULL THEN r.geom_simplified_low
                    WHEN z <= 8 AND r.geom_simplified_medium IS NOT NULL THEN r.geom_simplified_medium
                    WHEN r.is_archipelago AND r.ts_hull_geom_3857 IS NOT NULL THEN r.ts_hull_geom_3857
                    WHEN r.is_archipelago AND r.display_geom_3857 IS NOT NULL THEN r.display_geom_3857
                    ELSE r.geom_3857
                END,
                bounds, 4096, 64, true
            ) AS geom
        FROM regions r
        WHERE (p_world_view_id IS NULL OR r.world_view_id = p_world_view_id)
          AND r.geom_3857 IS NOT NULL
          AND r.geom_3857 && bounds
          AND r.is_leaf = true
    ) AS tile
    WHERE tile.geom IS NOT NULL;

    RETURN COALESCE(result, '');
END;
$$;

COMMENT ON FUNCTION tile_world_view_all_leaf_regions IS 'MVT tiles for all leaf regions (no subregions) of a world view. Query params: world_view_id';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION tile_world_view_root_regions TO PUBLIC;
GRANT EXECUTE ON FUNCTION tile_region_subregions TO PUBLIC;
GRANT EXECUTE ON FUNCTION tile_gadm_root_divisions TO PUBLIC;
GRANT EXECUTE ON FUNCTION tile_gadm_subdivisions TO PUBLIC;
GRANT EXECUTE ON FUNCTION tile_region_islands TO PUBLIC;
GRANT EXECUTE ON FUNCTION tile_world_view_all_leaf_regions TO PUBLIC;

-- Additional indexes for tile functions
CREATE INDEX IF NOT EXISTS idx_regions_geom_gist ON regions USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_regions_parent_region_id ON regions(parent_region_id);
CREATE INDEX IF NOT EXISTS idx_regions_world_view_id ON regions(world_view_id);

-- =============================================================================
-- Experience System (UNESCO World Heritage Sites and future sources)
-- =============================================================================
-- Generic system for location-based experiences that can be assigned to regions.
-- Designed to be extensible for multiple data sources (UNESCO, national parks, etc.)

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
    display_priority INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE experience_sources IS 'External data sources for experiences (UNESCO, national parks, etc.)';
COMMENT ON COLUMN experience_sources.api_config IS 'Source-specific API configuration (pagination, auth, etc.)';
COMMENT ON COLUMN experience_sources.last_sync_status IS 'Status of last sync: success, partial, or failed';
COMMENT ON COLUMN experience_sources.display_priority IS 'Display order in experience list (lower = shown first)';

-- Seed UNESCO as the first source
INSERT INTO experience_sources (name, description, api_endpoint, api_config, display_priority)
VALUES (
    'UNESCO World Heritage Sites',
    'Official UNESCO World Heritage List - Cultural, Natural, and Mixed sites worldwide',
    'https://data.unesco.org/api/explore/v2.1/catalog/datasets/whc001/records',
    '{"pageSize": 100}'::jsonb,
    1
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

    -- Curation fields
    is_manual BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(id),
    curated_fields JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),

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
-- When an experience point falls within a region's geometry, it gets assigned
-- Ancestor regions are also assigned (Moscow Kremlin → Moscow → Russia → Eastern Europe)
CREATE TABLE IF NOT EXISTS experience_regions (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    assignment_type VARCHAR(20) DEFAULT 'auto',  -- 'auto' (spatial) or 'manual'
    assigned_by INTEGER REFERENCES users(id),
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
-- Experience Locations (Multi-Location Support)
-- =============================================================================
-- Supports experiences with multiple physical locations (e.g., UNESCO serial
-- nominations like "Berlin Modernism Housing Estates" with 6 separate buildings).
-- Each location can be visited independently.

-- Individual locations for multi-location experiences
CREATE TABLE IF NOT EXISTS experience_locations (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    name VARCHAR(500),                    -- Component name (e.g., "Raigad Fort")
    external_ref VARCHAR(255),            -- Source reference (e.g., "1739-005")
    ordinal INTEGER NOT NULL DEFAULT 0,   -- Display order
    location GEOMETRY(Point, 4326) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(experience_id, ordinal)
);

COMMENT ON TABLE experience_locations IS 'Individual locations for multi-location experiences (UNESCO serial nominations, etc.)';
COMMENT ON COLUMN experience_locations.name IS 'Component name (e.g., individual fort name within a serial nomination)';
COMMENT ON COLUMN experience_locations.external_ref IS 'Source-specific reference (e.g., "1739-005" for UNESCO)';
COMMENT ON COLUMN experience_locations.ordinal IS 'Display order within the experience (0-indexed)';

CREATE INDEX IF NOT EXISTS idx_experience_locations_experience ON experience_locations(experience_id);
CREATE INDEX IF NOT EXISTS idx_experience_locations_location ON experience_locations USING GIST(location);

-- User visited locations (tracks visits to individual locations)
CREATE TABLE IF NOT EXISTS user_visited_locations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES experience_locations(id) ON DELETE CASCADE,
    visited_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    UNIQUE(user_id, location_id)
);

COMMENT ON TABLE user_visited_locations IS 'Tracks which individual locations users have visited';

CREATE INDEX IF NOT EXISTS idx_user_visited_locations_user ON user_visited_locations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_visited_locations_location ON user_visited_locations(location_id);

-- Location-Region junction (assigns locations to regions based on spatial containment)
CREATE TABLE IF NOT EXISTS experience_location_regions (
    id SERIAL PRIMARY KEY,
    location_id INTEGER NOT NULL REFERENCES experience_locations(id) ON DELETE CASCADE,
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    assignment_type VARCHAR(20) DEFAULT 'auto',  -- 'auto' (spatial) or 'manual'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(location_id, region_id)
);

COMMENT ON TABLE experience_location_regions IS 'Links experience locations to regions via spatial containment';
COMMENT ON COLUMN experience_location_regions.assignment_type IS 'How the assignment was made: auto (spatial query) or manual';

CREATE INDEX IF NOT EXISTS idx_experience_location_regions_location ON experience_location_regions(location_id);
CREATE INDEX IF NOT EXISTS idx_experience_location_regions_region ON experience_location_regions(region_id);

-- =============================================================================
-- Experience Contents (artworks, artifacts within experiences)
-- =============================================================================
-- Stores notable items within experiences like museums (e.g., paintings,
-- sculptures). Used for ranking museums by artwork fame.

-- Seed "Top Museums" as experience source
INSERT INTO experience_sources (name, description, api_endpoint, api_config, display_priority)
VALUES (
    'Top Museums',
    'World''s most notable museums ranked by artwork fame, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{"userAgent": "TrackYourRegions/1.0"}'::jsonb,
    2
)
ON CONFLICT (name) DO NOTHING;

-- Seed "Public Art & Monuments" as experience source
INSERT INTO experience_sources (name, description, api_endpoint, api_config, display_priority)
VALUES (
    'Public Art & Monuments',
    'Notable outdoor sculptures and monuments worldwide, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{"userAgent": "TrackYourRegions/1.0"}'::jsonb,
    3
)
ON CONFLICT (name) DO NOTHING;

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

COMMENT ON TABLE experience_contents IS 'Notable contents (artworks, artifacts) within experiences like museums';
COMMENT ON COLUMN experience_contents.external_id IS 'Wikidata QID for the artwork/item';
COMMENT ON COLUMN experience_contents.sitelinks_count IS 'Wikipedia sitelinks count - proxy for fame/notability';

CREATE INDEX IF NOT EXISTS idx_experience_contents_experience ON experience_contents(experience_id);
CREATE INDEX IF NOT EXISTS idx_experience_contents_type ON experience_contents(content_type);
CREATE INDEX IF NOT EXISTS idx_experience_contents_sitelinks ON experience_contents(sitelinks_count DESC);

-- =============================================================================
-- User Viewed Contents (artwork "seen" tracking)
-- =============================================================================
-- Tracks which artworks/contents a user has seen within an experience.
-- Marking a content as viewed auto-marks the parent experience as visited.

CREATE TABLE IF NOT EXISTS user_viewed_contents (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_id INTEGER NOT NULL REFERENCES experience_contents(id) ON DELETE CASCADE,
    viewed_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    UNIQUE(user_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_user_viewed_contents_user ON user_viewed_contents(user_id);
CREATE INDEX IF NOT EXISTS idx_user_viewed_contents_content ON user_viewed_contents(content_id);

-- =============================================================================
-- Curator System
-- =============================================================================
-- Allows trusted users (curators) to manually fix, extend, and filter
-- experience collections with scoped permissions.

-- Curator assignments (scoped permissions)
CREATE TABLE IF NOT EXISTS curator_assignments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope_type VARCHAR(20) NOT NULL CHECK (scope_type IN ('region', 'source', 'global')),
    region_id INTEGER REFERENCES regions(id) ON DELETE CASCADE,
    source_id INTEGER REFERENCES experience_sources(id) ON DELETE CASCADE,
    assigned_by INTEGER NOT NULL REFERENCES users(id),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    -- Ensure correct nullable combinations per scope_type
    CONSTRAINT valid_scope CHECK (
        (scope_type = 'global' AND region_id IS NULL AND source_id IS NULL) OR
        (scope_type = 'region' AND region_id IS NOT NULL AND source_id IS NULL) OR
        (scope_type = 'source' AND region_id IS NULL AND source_id IS NOT NULL)
    )
);

-- Partial unique indexes (PostgreSQL treats NULLs as distinct in UNIQUE)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_global_assignment
    ON curator_assignments(user_id) WHERE scope_type = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_region_assignment
    ON curator_assignments(user_id, region_id) WHERE scope_type = 'region';
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_source_assignment
    ON curator_assignments(user_id, source_id) WHERE scope_type = 'source';

CREATE INDEX IF NOT EXISTS idx_curator_assignments_user ON curator_assignments(user_id);

COMMENT ON TABLE curator_assignments IS 'Scoped curator permissions: global, per-region, or per-source';
COMMENT ON COLUMN curator_assignments.scope_type IS 'Permission scope: global (all), region (specific region + descendants), source (specific experience source)';

-- Experience curation audit log
CREATE TABLE IF NOT EXISTS experience_curation_log (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    curator_id INTEGER NOT NULL REFERENCES users(id),
    action VARCHAR(30) NOT NULL CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region')),
    region_id INTEGER REFERENCES regions(id) ON DELETE SET NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_curation_log_experience ON experience_curation_log(experience_id);
CREATE INDEX IF NOT EXISTS idx_curation_log_curator ON experience_curation_log(curator_id);
CREATE INDEX IF NOT EXISTS idx_curation_log_created ON experience_curation_log(created_at DESC);

COMMENT ON TABLE experience_curation_log IS 'Audit trail of all curator actions on experiences';

-- Experience rejections (per region)
CREATE TABLE IF NOT EXISTS experience_rejections (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    rejected_by INTEGER NOT NULL REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(experience_id, region_id)
);

CREATE INDEX IF NOT EXISTS idx_experience_rejections_experience ON experience_rejections(experience_id);
CREATE INDEX IF NOT EXISTS idx_experience_rejections_region ON experience_rejections(region_id);

COMMENT ON TABLE experience_rejections IS 'Experiences rejected from specific regions by curators (hidden from regular users)';

-- =============================================================================
-- Schema Complete
-- =============================================================================

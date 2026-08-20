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
-- - users / user_visited_regions: User tracking
-- =============================================================================

-- =============================================================================
-- Extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- =============================================================================
-- Helper: Immutable unaccent wrapper (needed for generated columns / indexes)
-- =============================================================================
-- The built-in unaccent() is STABLE, not IMMUTABLE, which prevents use in
-- generated columns and index expressions. This wrapper is safe because
-- unaccent rules don't change at runtime.

CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$
  SELECT public.unaccent($1);
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- =============================================================================
-- Helper: Canonical geometry validation
-- =============================================================================
-- Every geometry write must go through this function.
-- Ensures: valid, MultiPolygon, polygons only, NULL for empty.

CREATE OR REPLACE FUNCTION validate_multipolygon(geom geometry)
RETURNS geometry AS $$
  SELECT CASE
    WHEN geom IS NULL THEN NULL
    WHEN ST_IsEmpty(geom) THEN NULL
    ELSE ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
  END;
$$ LANGUAGE SQL IMMUTABLE PARALLEL SAFE;

-- =============================================================================
-- Helper: Safe geography area computation
-- =============================================================================
-- ST_Area(geom::geography) can fail on extreme geometries (e.g. polar regions
-- like Antarctica where the union polygon wraps the pole). This wrapper catches
-- the error and returns NULL instead of aborting the query.

CREATE OR REPLACE FUNCTION safe_geo_area(geom geometry)
RETURNS double precision AS $$
BEGIN
  RETURN ST_Area(geom::geography);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

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
    anchor_point GEOMETRY(Point, 4326),
    geom_area_km2 DOUBLE PRECISION,
    -- Pre-computed normalized name for accent-insensitive matching (generated)
    name_normalized TEXT GENERATED ALWAYS AS (lower(immutable_unaccent(name::text))) STORED,
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for administrative_divisions
CREATE INDEX IF NOT EXISTS idx_admin_divisions_parent ON administrative_divisions(parent_id);
CREATE INDEX IF NOT EXISTS idx_admin_divisions_name ON administrative_divisions(name);
CREATE INDEX IF NOT EXISTS idx_admin_divisions_name_trgm ON administrative_divisions USING GIN(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_admin_div_name_norm_trgm ON administrative_divisions USING GIN(name_normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_admin_div_name_norm_btree ON administrative_divisions(name_normalized);
CREATE INDEX IF NOT EXISTS idx_admin_divisions_geom ON administrative_divisions USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_admin_divisions_geom_low ON administrative_divisions USING GIST(geom_simplified_low);
CREATE INDEX IF NOT EXISTS idx_admin_divisions_geom_medium ON administrative_divisions USING GIST(geom_simplified_medium);
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
    source_type VARCHAR(50) DEFAULT 'manual',  -- 'manual', 'wikivoyage', etc.
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    last_assignment_at TIMESTAMPTZ,  -- Last time region assignment was run
    tile_version INTEGER DEFAULT 0,  -- Incremented when geometry changes, used for tile cache busting
    dismissed_coverage_ids INTEGER[] DEFAULT '{}',  -- GADM division IDs dismissed from coverage checks
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- At most one world view carries is_default (GADM's). That is all an index can
-- state — zero defaults satisfies it too, which is why deleteWorldView refuses
-- to delete the default one (backend/src/controllers/worldView/worldViewCrud.ts);
-- the two together keep it at exactly one.
--
-- The index also doubles as the arbiter for the seed below, which is what makes
-- re-applying this file to an existing database idempotent. Without it the
-- seed's ON CONFLICT had nothing to fire on — world_views has no unique
-- constraint besides the serial primary key, so every re-application inserted
-- another "GADM (Default)" row. Databases that predate the index get it from
-- db/migrations/006-single-default-world-view.sql, which clears the duplicates
-- the index would otherwise reject.
CREATE UNIQUE INDEX IF NOT EXISTS idx_world_views_single_default ON world_views(is_default) WHERE is_default;

-- Visibility: a world view is admin-only until an admin publishes it. New
-- imports and the seeded base-layer default start hidden, which is why the
-- column defaults to false. Enforced server-side in getWorldViews and the
-- requireVisibleWorldView middleware, not in the browser.
ALTER TABLE world_views ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN world_views.is_public IS 'False = admin-only. True = listed and readable for everyone.';

-- Insert GADM as the default hierarchy
INSERT INTO world_views (name, description, is_default, is_active)
VALUES ('GADM', 'Global Administrative Areas - Default hierarchy from GADM database', true, true)
ON CONFLICT (is_default) WHERE is_default DO NOTHING;

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
    anchor_point GEOMETRY(Point, 4326),
    geom_area_km2 DOUBLE PRECISION,
    uses_hull BOOLEAN DEFAULT false,
    -- Materialized flag: true if region has no child regions (for fast tile queries)
    is_leaf BOOLEAN NOT NULL DEFAULT true,
    -- Concave hull with proper dateline handling (generated in TypeScript)
    hull_geom GEOMETRY(MultiPolygon, 4326),
    hull_params JSONB,
    -- Pre-computed bounding box for fitBounds() [west, south, east, north]
    -- West > east indicates antimeridian crossing (GeoJSON standard)
    focus_bbox double precision[4],
    -- Source-specific metadata (Wikivoyage URLs, match status, suggestions, etc.)
    metadata JSONB,
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for regions
CREATE INDEX IF NOT EXISTS idx_regions_world_view ON regions(world_view_id);
CREATE INDEX IF NOT EXISTS idx_regions_parent ON regions(parent_region_id);
CREATE INDEX IF NOT EXISTS idx_regions_geom ON regions USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_regions_anchor_point ON regions USING GIST(anchor_point);
CREATE INDEX IF NOT EXISTS idx_regions_hull_geom ON regions USING GIST(hull_geom);
CREATE INDEX IF NOT EXISTS idx_regions_is_leaf ON regions(is_leaf) WHERE is_leaf = true;
CREATE INDEX IF NOT EXISTS idx_regions_focus_bbox ON regions USING gin(focus_bbox) WHERE focus_bbox IS NOT NULL;
-- Partial unique index: prevents two sibling subregions with the same name under the
-- same parent in the same world view. Lets ensureSubregion use ON CONFLICT for race
-- resolution (see #378 / migration 004). Root regions (parent_region_id IS NULL) are
-- intentionally excluded — duplicate root names per world view are allowed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_regions_unique_subregion_name
  ON regions(world_view_id, parent_region_id, name)
  WHERE parent_region_id IS NOT NULL;

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

CREATE OR REPLACE TRIGGER trg_update_is_leaf
  AFTER INSERT OR UPDATE OF parent_region_id OR DELETE ON regions
  FOR EACH ROW EXECUTE FUNCTION update_is_leaf();

-- Comments
COMMENT ON COLUMN regions.hull_geom IS 'Concave hull with proper dateline handling (generated in TypeScript)';
COMMENT ON COLUMN regions.hull_params IS 'Hull generation parameters (bufferKm, concavity, simplifyTolerance) - preserved when regenerating';

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
-- Prevent duplicate (region, division) when no custom geometry — ON CONFLICT DO NOTHING relies on this
CREATE UNIQUE INDEX IF NOT EXISTS idx_region_members_unique_no_custom ON region_members(region_id, division_id) WHERE custom_geom IS NULL;

-- =============================================================================
-- Geometry Resolution Views
-- =============================================================================
-- Centralize geometry logic to prevent bugs from scattered COALESCE patterns.

-- Effective geometry for each region member (custom_geom if drawn, otherwise division geom)
CREATE OR REPLACE VIEW region_member_effective_geom AS
SELECT rm.id, rm.region_id, rm.division_id,
       COALESCE(rm.custom_geom, ad.geom) AS geom,
       rm.custom_geom IS NOT NULL AS is_partial,
       COALESCE(rm.custom_name, ad.name) AS name,
       ad.name AS division_name
FROM region_members rm
JOIN administrative_divisions ad ON rm.division_id = ad.id;

-- Render geometry for each region (hull for uses_hull regions, raw geom otherwise)
CREATE OR REPLACE VIEW region_render_geom AS
SELECT r.id, r.world_view_id,
       CASE
         WHEN r.uses_hull AND r.hull_geom IS NOT NULL THEN r.hull_geom
         ELSE r.geom
       END AS render_geom,
       r.geom AS real_geom,
       r.uses_hull,
       r.is_custom_boundary,
       r.anchor_point,
       r.focus_bbox
FROM regions r;

-- Comments
COMMENT ON TABLE region_members IS 'Maps administrative divisions to regions. A division can appear multiple times in the same region if each has a different custom_geom (for splitting divisions into parts).';
COMMENT ON COLUMN region_members.custom_name IS 'Optional display name for this division part (e.g., "Marshall Islands - Part 1")';

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
    IF NEW.geom IS NOT NULL AND NOT ST_IsEmpty(NEW.geom) THEN
        -- Low detail: ~0.1 degree tolerance (good for world view)
        NEW.geom_simplified_low := validate_multipolygon(ST_SimplifyPreserveTopology(NEW.geom, 0.1));
        -- Medium detail: ~0.01 degree tolerance (good for country view)
        NEW.geom_simplified_medium := validate_multipolygon(ST_SimplifyPreserveTopology(NEW.geom, 0.01));
    ELSE
        NEW.geom_simplified_low := NULL;
        NEW.geom_simplified_medium := NULL;
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-simplify geometries on insert/update
CREATE OR REPLACE TRIGGER trigger_simplify_geom
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

-- Function to detect if a region should use hull display.
-- Three criteria (any match → true):
--   (a) Small multi-part: ≥2 parts AND < 5000 km² (island groups like Bermuda)
--   (b) Many-part with high sparsity: ≥10 parts, area/hull ratio < 0.1 (large archipelagos like Fiji)
--   (c) Single small isolated: < 100 km² AND not touching any sibling region (tiny islands like Nauru)
CREATE OR REPLACE FUNCTION should_use_hull(
    p_geom GEOMETRY,
    p_parent_region_id INTEGER,
    p_region_id INTEGER
) RETURNS BOOLEAN AS $$
    SELECT CASE
        WHEN p_geom IS NULL OR ST_IsEmpty(p_geom) THEN false
        -- (a) Small multi-part: island groups (Bermuda, Saint-Barthélemy)
        WHEN ST_NumGeometries(p_geom) >= 2
             AND ST_Area(p_geom::geography) / 1e6 < 5000 THEN true
        -- (b) Many-part with high sparsity: large archipelagos (Fiji, Indonesia)
        WHEN ST_NumGeometries(p_geom) >= 10
             AND ST_Area(p_geom) / NULLIF(ST_Area(ST_ConvexHull(p_geom)), 0) < 0.1
             THEN true
        -- (c) Single small isolated: tiny island not touching siblings
        WHEN ST_Area(p_geom::geography) / 1e6 < 100
             AND NOT EXISTS (
                 SELECT 1 FROM regions r2
                 WHERE r2.parent_region_id = p_parent_region_id
                 AND r2.id != p_region_id
                 AND r2.geom IS NOT NULL
                 AND ST_Intersects(r2.geom, p_geom)
             ) THEN true
        ELSE false
    END;
$$ LANGUAGE SQL STABLE;

-- Function to refresh uses_hull flags for all children of a parent region.
-- Call after batch geometry computation to correct order-dependent false positives.
CREATE OR REPLACE FUNCTION refresh_uses_hull_flags(p_parent_region_id INTEGER)
RETURNS void AS $$
    UPDATE regions SET uses_hull = should_use_hull(geom, parent_region_id, id)
    WHERE parent_region_id = p_parent_region_id AND geom IS NOT NULL;
$$ LANGUAGE SQL;

-- =============================================================================
-- Trigger: Update metadata for regions when geom changes
-- =============================================================================
-- uses_hull is auto-detected ONLY on INSERT, preserved on UPDATE

CREATE OR REPLACE FUNCTION update_region_metadata()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.geom IS NOT NULL AND NOT ST_IsEmpty(NEW.geom) THEN
        -- NOTE: anchor_point is computed by update_region_focus_data() which handles
        -- antimeridian-crossing and full-globe regions correctly. Do NOT set it here.
        NEW.geom_area_km2 := ST_Area(NEW.geom::geography) / 1000000;

        -- Auto-detect uses_hull ONLY on INSERT (new region).
        -- On UPDATE, always preserve the existing value — invalidateRegionGeometry()
        -- clears geom to NULL before recompute, so NULL→non-NULL on UPDATE is NOT
        -- a "first time" scenario. The user may have manually set uses_hull=false.
        IF TG_OP = 'INSERT' THEN
            NEW.uses_hull := should_use_hull(NEW.geom, NEW.parent_region_id, NEW.id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to regions table
CREATE OR REPLACE TRIGGER trigger_region_metadata
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
  effective_geom geometry;  -- hull or raw geom for bounds calculation
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
  -- Use hull for hull regions, otherwise raw geometry
  effective_geom := COALESCE(NEW.hull_geom, NEW.geom);

  IF effective_geom IS NOT NULL THEN
    -- Latitude bounds
    min_lat := ST_YMin(effective_geom);
    max_lat := ST_YMax(effective_geom);
    center_lat := (min_lat + max_lat) / 2;

    -- Compute normal bbox
    norm_west := ST_XMin(effective_geom);
    norm_east := ST_XMax(effective_geom);
    norm_span := norm_east - norm_west;

    -- Compute shifted bbox for antimeridian detection
    -- ST_ShiftLongitude moves negative coords to [180,360] range
    shifted_geom := ST_ShiftLongitude(effective_geom);
    shift_west := ST_XMin(shifted_geom);
    shift_east := ST_XMax(shifted_geom);
    shift_span := shift_east - shift_west;

    IF norm_span > 350 THEN
      -- Near-full-globe span: geometry touches both sides of the antimeridian.
      -- ST_ShiftLongitude can't help (shifted span may be even wider).
      -- Strategy: try children's focus data first, fall back to hull bbox.

      -- Try children's aggregated focus data (for parent regions like Oceania)
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
      ELSIF NEW.hull_geom IS NOT NULL AND NOT ST_IsEmpty(NEW.hull_geom) THEN
        -- Leaf region with hull (e.g. Fiji after hull generation): use hull bbox
        -- Hull is compact and doesn't span 360°
        shift_west := ST_XMin(ST_ShiftLongitude(NEW.hull_geom));
        shift_east := ST_XMax(ST_ShiftLongitude(NEW.hull_geom));
        final_west := CASE WHEN shift_west > 180 THEN shift_west - 360 ELSE shift_west END;
        final_east := CASE WHEN shift_east > 180 THEN shift_east - 360 ELSE shift_east END;
        center_lng := (shift_west + shift_east) / 2;
        IF center_lng > 180 THEN center_lng := center_lng - 360; END IF;
      ELSIF shift_span < norm_span THEN
        -- No children/hull but shifted bbox is more compact (e.g. Russia): use shifted
        final_west := CASE WHEN shift_west > 180 THEN shift_west - 360 ELSE shift_west END;
        final_east := CASE WHEN shift_east > 180 THEN shift_east - 360 ELSE shift_east END;
        center_lng := (shift_west + shift_east) / 2;
        IF center_lng > 180 THEN center_lng := center_lng - 360; END IF;
      ELSE
        -- Truly global: best effort with normal bbox
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

CREATE OR REPLACE TRIGGER trigger_update_region_focus_data
  BEFORE INSERT OR UPDATE OF geom, hull_geom ON regions
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
ALTER TABLE regions ADD COLUMN IF NOT EXISTS hull_geom_3857 geometry(MultiPolygon, 3857);

-- Add simplified geometry columns for low zoom levels (zoom 3-4; zoom 0-2 reads
-- geom_overview below)
-- For uses_hull regions, these derive from hull (correct overview representation)
ALTER TABLE regions ADD COLUMN IF NOT EXISTS geom_simplified_low geometry(MultiPolygon, 3857);
-- Add simplified geometry columns for medium zoom levels (zoom 5-8)
ALTER TABLE regions ADD COLUMN IF NOT EXISTS geom_simplified_medium geometry(MultiPolygon, 3857);

-- Overview zoom levels (0-2), where one tile spans the whole world at roughly
-- 10 km per MVT unit. `geom_simplified_low` still carries far more detail than
-- that scale can represent — half a million vertices for eight continents — and
-- the tile functions used to cut it down per request with
-- ST_SimplifyPreserveTopology, which cost more than everything else in the query
-- combined while removing under a third of the vertices. Precomputed here
-- instead. NULL means "not computed": callers fall through to the low rung, so
-- an un-backfilled database renders as it always did. See simplify_for_overview().
ALTER TABLE regions ADD COLUMN IF NOT EXISTS geom_overview geometry(MultiPolygon, 3857);

-- Real-geometry simplified columns (always from geom_3857, never from hull)
-- Used by island tile source to show real coastlines at overview zoom
ALTER TABLE regions ADD COLUMN IF NOT EXISTS geom_simplified_low_real geometry(MultiPolygon, 3857);
ALTER TABLE regions ADD COLUMN IF NOT EXISTS geom_simplified_medium_real geometry(MultiPolygon, 3857);

-- Add 3857 geometry columns to administrative_divisions table
ALTER TABLE administrative_divisions ADD COLUMN IF NOT EXISTS geom_3857 geometry(MultiPolygon, 3857);
ALTER TABLE administrative_divisions ADD COLUMN IF NOT EXISTS geom_simplified_low_3857 geometry(MultiPolygon, 3857);
-- Overview rung, same reasoning as regions.geom_overview above: the low rung
-- holds 619,254 vertices for the eight root divisions, which a zoom-0 tile
-- cannot represent and pays for anyway.
ALTER TABLE administrative_divisions ADD COLUMN IF NOT EXISTS geom_overview_3857 geometry(MultiPolygon, 3857);
ALTER TABLE administrative_divisions ADD COLUMN IF NOT EXISTS geom_simplified_medium_3857 geometry(MultiPolygon, 3857);

-- Helper function: reduce geometry to what an overview-zoom tile can actually show.
--
-- Uses Douglas-Peucker where simplify_for_zoom() uses ST_SimplifyVW, because VW
-- does not reach overview scale: at this tolerance it left 490,680 of 773,264
-- vertices and took 107 s to precompute, against 29,863 in under two seconds
-- here. VW's better coastal character (rule 13) is worth its cost at zoom 3-8,
-- where the shape is actually legible; at zoom 0 a coastline is a few pixels.
--
-- Keeps simplify_for_zoom()'s three-stage shape, because rule 12 applies here
-- too: never drop a geometry entirely. Douglas-Peucker annihilates anything
-- narrower than the tolerance, and 50km annihilates 1,324 of the administrative
-- mirror's 3,594 leaves — a world view made only of small regions would render
-- an empty map when zoomed out.
--
-- Stage 2 scales the tolerance to the widest constituent polygon, not to the
-- whole MultiPolygon's envelope. The distinction is the difference between
-- working and not for scattered geography: France's leaf is 845 pieces spread
-- across 3,385km, none wider than 49km, so an envelope-derived tolerance stays
-- an order of magnitude above every island and stage 2 collapses too.
--
-- Stage 3 then simplifies with the topology-preserving variant rather than
-- returning the input. It is the slow one this rung exists to avoid, but it
-- never annihilates, it is what these rows went through before, and only the
-- handful that survive two Douglas-Peucker passes ever reach it.
--
-- NULL in, NULL out — and NULL in the column means "not computed", which is what
-- lets callers fall through to geom_simplified_low on a database that has not run
-- the backfill.
CREATE OR REPLACE FUNCTION simplify_for_overview(
    geom geometry,
    tolerance double precision DEFAULT 50000
) RETURNS geometry AS $$
DECLARE
    result geometry;
    widest_part double precision;
BEGIN
    IF geom IS NULL THEN
        RETURN NULL;
    END IF;

    -- Stage 1: simplify at the overview tolerance
    result := ST_Multi(ST_CollectionExtract(
        ST_MakeValid(ST_Simplify(geom, tolerance)), 3));

    -- Stage 2: smaller than the tolerance — scale it to the widest piece
    IF result IS NULL OR ST_IsEmpty(result) THEN
        SELECT max(sqrt(ST_Area(ST_Envelope(part.geom))))
        INTO widest_part
        FROM (SELECT (ST_Dump(geom)).geom) AS part;

        IF widest_part > 0 THEN
            result := ST_Multi(ST_CollectionExtract(
                ST_MakeValid(ST_Simplify(geom, widest_part / 10.0)), 3));
        END IF;
    END IF;

    -- Stage 3: nothing survives Douglas-Peucker — use the variant that cannot
    -- annihilate rather than keeping the input unsimplified (rule 12)
    IF result IS NULL OR ST_IsEmpty(result) THEN
        result := ST_SimplifyPreserveTopology(geom, tolerance);
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- Helper function: simplify geometry with fallback for small islands, smooth corners.
-- Three-stage pipeline:
--   Stage 1: ST_SimplifyVW at requested tolerance (area-based, better coastal preservation)
--            VW tolerance is area-based: DP distance `d` → VW area `d²`
--   Stage 2: If nothing survived (small islands), retry with tolerance scaled
--            to the largest polygon's width. Minimum vertex floor: ≥4 vertices per polygon.
--   Stage 3: ST_ChaikinSmoothing to round off angular artifacts
CREATE OR REPLACE FUNCTION simplify_for_zoom(
    geom geometry,
    tolerance double precision,
    min_area double precision,
    smooth_iterations integer DEFAULT 0
) RETURNS geometry AS $$
DECLARE
    result geometry;
    max_poly_width double precision;
    vw_tolerance double precision;
BEGIN
    -- Convert DP-style distance tolerance to VW area tolerance
    vw_tolerance := tolerance * tolerance;

    -- Stage 1: simplify at requested tolerance, filter small polygons,
    -- enforce minimum vertex floor (≥4 vertices per polygon)
    SELECT ST_Multi(ST_CollectionExtract(
        ST_MakeValid(ST_Collect(dump.geom)), 3))
    INTO result
    FROM (
        SELECT (ST_Dump(
            ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyVW(geom, vw_tolerance)), 3))
        )).geom
    ) AS dump
    WHERE ST_Area(dump.geom) >= min_area
      AND ST_NPoints(dump.geom) >= 4;

    -- Stage 2: if nothing survived (geometry smaller than tolerance), retry
    -- with tolerance scaled to the largest individual polygon's width
    IF result IS NULL OR ST_IsEmpty(result) THEN
        SELECT max(sqrt(ST_Area(ST_Envelope(d.geom))))
        INTO max_poly_width
        FROM (SELECT (ST_Dump(geom)).geom) AS d;

        IF max_poly_width IS NOT NULL AND max_poly_width > 0 THEN
            vw_tolerance := (max_poly_width / 10.0) * (max_poly_width / 10.0);
            SELECT ST_Multi(ST_CollectionExtract(
                ST_MakeValid(ST_Collect(dump.geom)), 3))
            INTO result
            FROM (
                SELECT (ST_Dump(
                    ST_Multi(ST_CollectionExtract(ST_MakeValid(
                        ST_SimplifyVW(geom, vw_tolerance)
                    ), 3))
                )).geom
            ) AS dump
            WHERE NOT ST_IsEmpty(dump.geom)
              AND ST_NPoints(dump.geom) >= 4;
        END IF;
    END IF;

    -- If still nothing survived, return the original unsimplified geometry
    -- (small islands that can't be simplified without degenerating)
    IF result IS NULL OR ST_IsEmpty(result) THEN
        result := geom;
    END IF;

    -- Stage 3: smooth corners
    IF smooth_iterations > 0 AND result IS NOT NULL AND NOT ST_IsEmpty(result) THEN
        result := ST_ChaikinSmoothing(result, smooth_iterations);
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- Coverage-aware simplification for GADM sibling divisions.
-- Uses ST_CoverageSimplify (requires GEOS 3.12+) for gap-free borders.
-- Call from precalculate-geometries.py after computing parent geometries.
CREATE OR REPLACE FUNCTION simplify_coverage_siblings(
    parent_division_id integer,
    tolerance_low double precision DEFAULT 0.1,
    tolerance_medium double precision DEFAULT 0.01
) RETURNS void AS $$
BEGIN
    -- Low detail simplification (gap-free)
    UPDATE administrative_divisions ad
    SET geom_simplified_low = sub.simplified
    FROM (
        SELECT id, validate_multipolygon(
            ST_CoverageSimplify(geom, tolerance_low) OVER ()
        ) as simplified
        FROM administrative_divisions
        WHERE parent_id = parent_division_id AND geom IS NOT NULL
    ) sub
    WHERE ad.id = sub.id;

    -- Medium detail simplification (gap-free)
    UPDATE administrative_divisions ad
    SET geom_simplified_medium = sub.simplified
    FROM (
        SELECT id, validate_multipolygon(
            ST_CoverageSimplify(geom, tolerance_medium) OVER ()
        ) as simplified
        FROM administrative_divisions
        WHERE parent_id = parent_division_id AND geom IS NOT NULL
    ) sub
    WHERE ad.id = sub.id;
END;
$$ LANGUAGE plpgsql;

-- Coverage-aware simplification for sibling regions.
-- Uses ST_CoverageSimplify (requires GEOS 3.12+) for gap-free borders.
-- Call after computing region geometry to fix slivers between siblings.
-- Only affects non-hull regions (hull regions derive simplified from hull).
-- Tolerances are in SRID 3857 units (meters): 5000m low, 1000m medium.
CREATE OR REPLACE FUNCTION simplify_coverage_regions(
    p_parent_region_id integer,
    tolerance_low double precision DEFAULT 5000,
    tolerance_medium double precision DEFAULT 1000
) RETURNS integer AS $$
DECLARE
    sibling_count integer;
BEGIN
    -- Coverage needs ≥2 non-hull siblings with geometry
    SELECT COUNT(*) INTO sibling_count
    FROM regions
    WHERE parent_region_id = p_parent_region_id
      AND geom_3857 IS NOT NULL
      AND NOT COALESCE(uses_hull, false);

    IF sibling_count < 2 THEN
        RETURN 0;
    END IF;

    -- Low detail coverage simplification (gap-free)
    UPDATE regions r
    SET geom_simplified_low = sub.simplified
    FROM (
        SELECT id, validate_multipolygon(
            ST_CoverageSimplify(geom_3857, tolerance_low) OVER ()
        ) as simplified
        FROM regions
        WHERE parent_region_id = p_parent_region_id
          AND geom_3857 IS NOT NULL
          AND NOT COALESCE(uses_hull, false)
    ) sub
    WHERE r.id = sub.id;

    -- Medium detail coverage simplification (gap-free)
    UPDATE regions r
    SET geom_simplified_medium = sub.simplified
    FROM (
        SELECT id, validate_multipolygon(
            ST_CoverageSimplify(geom_3857, tolerance_medium) OVER ()
        ) as simplified
        FROM regions
        WHERE parent_region_id = p_parent_region_id
          AND geom_3857 IS NOT NULL
          AND NOT COALESCE(uses_hull, false)
    ) sub
    WHERE r.id = sub.id;

    RETURN sibling_count;
END;
$$ LANGUAGE plpgsql;

-- Create spatial indexes on the new columns
CREATE INDEX IF NOT EXISTS idx_regions_geom_3857 ON regions USING GIST(geom_3857);
CREATE INDEX IF NOT EXISTS idx_regions_hull_geom_3857 ON regions USING GIST(hull_geom_3857);
CREATE INDEX IF NOT EXISTS idx_regions_geom_simplified_low ON regions USING GIST(geom_simplified_low);
CREATE INDEX IF NOT EXISTS idx_regions_geom_simplified_medium ON regions USING GIST(geom_simplified_medium);
CREATE INDEX IF NOT EXISTS idx_regions_geom_simp_low_real ON regions USING GIST(geom_simplified_low_real);
CREATE INDEX IF NOT EXISTS idx_regions_geom_simp_med_real ON regions USING GIST(geom_simplified_medium_real);

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
    hull_changed boolean;
    low_changed boolean;
BEGIN
    geom_changed := (TG_OP = 'INSERT' AND NEW.geom IS NOT NULL)
                    OR (TG_OP = 'UPDATE' AND NEW.geom IS DISTINCT FROM OLD.geom);
    hull_changed := (TG_OP = 'INSERT' AND NEW.hull_geom IS NOT NULL)
                    OR (TG_OP = 'UPDATE' AND NEW.hull_geom IS DISTINCT FROM OLD.hull_geom);

    -- Read before the block below writes it: simplify_coverage_regions() sets
    -- geom_simplified_low directly, touching neither geom nor hull_geom, so
    -- nothing else here would notice. The tile functions used to simplify that
    -- column per request and so always rendered the coverage result; the
    -- precomputed overview has to follow it. Computed up here rather than after
    -- the write, or the trigger would see its own assignment and recompute the
    -- overview a second time on every ordinary geometry change.
    low_changed := (TG_OP = 'UPDATE'
                    AND NEW.geom_simplified_low IS DISTINCT FROM OLD.geom_simplified_low);

    -- Transform changed geometries to 3857
    IF geom_changed AND NEW.geom IS NOT NULL THEN
        BEGIN
            NEW.geom_3857 := validate_multipolygon(ST_Transform(NEW.geom, 3857));
        EXCEPTION WHEN OTHERS THEN
            NEW.geom_3857 := validate_multipolygon(ST_Transform(
                ST_Intersection(NEW.geom, ST_MakeEnvelope(-180, -85.06, 180, 85.06, 4326)),
                3857
            ));
        END;
    END IF;
    IF hull_changed AND NEW.hull_geom IS NOT NULL THEN
        BEGIN
            NEW.hull_geom_3857 := validate_multipolygon(ST_Transform(NEW.hull_geom, 3857));
        EXCEPTION WHEN OTHERS THEN
            NEW.hull_geom_3857 := validate_multipolygon(ST_Transform(
                ST_Intersection(NEW.hull_geom, ST_MakeEnvelope(-180, -85.06, 180, 85.06, 4326)),
                3857
            ));
        END;
    END IF;

    -- Always compute real-geometry-based simplified (for island tile source)
    IF geom_changed AND NEW.geom_3857 IS NOT NULL THEN
        NEW.geom_simplified_low_real := simplify_for_zoom(NEW.geom_3857, 5000, 0, 0);
        NEW.geom_simplified_medium_real := simplify_for_zoom(NEW.geom_3857, 1000, 0, 0);
    END IF;

    -- Hull-based simplified (for main tile source overview)
    -- For uses_hull regions, simplified columns derive from hull (correct overview)
    IF geom_changed OR hull_changed THEN
        effective_geom := CASE WHEN NEW.uses_hull THEN COALESCE(NEW.hull_geom_3857, NEW.geom_3857) ELSE NEW.geom_3857 END;
        IF effective_geom IS NOT NULL THEN
            NEW.geom_simplified_low := simplify_for_zoom(effective_geom, 5000, 0, 0);
            NEW.geom_simplified_medium := simplify_for_zoom(effective_geom, 1000, 0, 0);
            -- Derived from the low rung rather than effective_geom: it is the
            -- input the tile functions simplified before, so the overview keeps
            -- the same hull-aware shape, and starting from 5 km of detail is
            -- cheaper than starting from full.
            NEW.geom_overview := simplify_for_overview(NEW.geom_simplified_low);
        END IF;
    END IF;

    -- No NULL guard: simplify_for_overview(NULL) returns NULL, which is what a
    -- cleared low rung has to leave behind. Skipping the write instead would
    -- keep the previous shape and go on serving it at zoom 0-2.
    IF low_changed THEN
        NEW.geom_overview := simplify_for_overview(NEW.geom_simplified_low);
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
        BEGIN
            NEW.geom_3857 := validate_multipolygon(ST_Transform(NEW.geom, 3857));
        EXCEPTION WHEN OTHERS THEN
            -- Polar geometries (lat > ±85.06°) can't be projected to Web Mercator.
            -- Fall back to clipping to valid 3857 extent; NULL if nothing remains.
            NEW.geom_3857 := validate_multipolygon(ST_Transform(
                ST_Intersection(NEW.geom, ST_MakeEnvelope(-180, -85.06, 180, 85.06, 4326)),
                3857
            ));
        END;
    END IF;

    IF (geom_changed OR low_changed) AND NEW.geom_3857 IS NOT NULL THEN
        NEW.geom_simplified_low_3857 := simplify_for_zoom(NEW.geom_3857, 5000, 0, 0);
        NEW.geom_overview_3857 := simplify_for_overview(NEW.geom_simplified_low_3857);
    END IF;
    IF (geom_changed OR medium_changed) AND NEW.geom_3857 IS NOT NULL THEN
        NEW.geom_simplified_medium_3857 := simplify_for_zoom(NEW.geom_3857, 1000, 0, 0);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE OR REPLACE TRIGGER trg_regions_geom_3857
    BEFORE INSERT OR UPDATE ON regions
    FOR EACH ROW
    EXECUTE FUNCTION update_regions_geom_3857();

CREATE OR REPLACE TRIGGER trg_admin_div_geom_3857
    BEFORE INSERT OR UPDATE ON administrative_divisions
    FOR EACH ROW
    EXECUTE FUNCTION update_admin_div_geom_3857();

COMMENT ON COLUMN regions.geom_3857 IS 'Pre-computed geometry in SRID 3857 for fast MVT generation';
COMMENT ON COLUMN regions.hull_geom_3857 IS 'Pre-computed hull in SRID 3857 for fast MVT generation';
COMMENT ON COLUMN administrative_divisions.geom_3857 IS 'Pre-computed geometry in SRID 3857 for fast MVT generation';

-- =============================================================================
-- Martin Vector Tile Functions
-- =============================================================================
-- These functions generate MVT tiles for the RegionMap component.
-- They implement smart geometry selection (hull > geom for uses_hull regions)
-- and proper simplification based on zoom level.

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
            r.uses_hull,
            EXISTS(SELECT 1 FROM regions c WHERE c.parent_region_id = r.id LIMIT 1) as has_subregions,
            (r.uses_hull AND r.hull_geom IS NOT NULL) as using_hull,
            ST_AsMVTGeom(
                CASE
                    -- Precomputed; see simplify_for_overview(). A NULL here
                    -- means "not computed yet" and falls through to the low rung
                    -- so an un-backfilled database renders as it always did.
                    WHEN z <= 2 AND r.geom_overview IS NOT NULL
                        THEN r.geom_overview
                    WHEN z <= 4 AND r.geom_simplified_low IS NOT NULL THEN r.geom_simplified_low
                    WHEN z <= 8 AND r.geom_simplified_medium IS NOT NULL THEN r.geom_simplified_medium
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
            r.uses_hull,
            EXISTS(SELECT 1 FROM regions c WHERE c.parent_region_id = r.id LIMIT 1) as has_subregions,
            (r.uses_hull AND r.hull_geom IS NOT NULL) as using_hull,
            ST_AsMVTGeom(
                CASE
                    -- Precomputed; see simplify_for_overview(). A NULL here
                    -- means "not computed yet" and falls through to the low rung
                    -- so an un-backfilled database renders as it always did.
                    WHEN z <= 2 AND r.geom_overview IS NOT NULL
                        THEN r.geom_overview
                    WHEN z <= 4 AND r.geom_simplified_low IS NOT NULL THEN r.geom_simplified_low
                    WHEN z <= 8 AND r.geom_simplified_medium IS NOT NULL THEN r.geom_simplified_medium
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
                    -- Precomputed; see simplify_for_overview(). NULL here means
                    -- "not computed yet" and falls through to the low rung.
                    WHEN z <= 2 AND d.geom_overview_3857 IS NOT NULL THEN d.geom_overview_3857
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
                    -- Precomputed; see simplify_for_overview(). NULL here means
                    -- "not computed yet" and falls through to the low rung.
                    WHEN z <= 2 AND d.geom_overview_3857 IS NOT NULL THEN d.geom_overview_3857
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
-- Returns real island boundaries for regions using hull display
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
            ST_AsMVTGeom(
                CASE
                    WHEN z <= 4 AND r.geom_simplified_low_real IS NOT NULL THEN r.geom_simplified_low_real
                    WHEN z <= 8 AND r.geom_simplified_medium_real IS NOT NULL THEN r.geom_simplified_medium_real
                    ELSE r.geom_3857
                END,
                bounds, 4096, 64, true
            ) AS geom
        FROM regions r
        WHERE r.uses_hull = true
          AND r.hull_geom IS NOT NULL
          AND r.geom_3857 IS NOT NULL
          AND (p_parent_id IS NULL OR r.parent_region_id = p_parent_id)
          AND r.geom_3857 && bounds
    ) AS tile
    WHERE tile.geom IS NOT NULL;

    RETURN COALESCE(result, '');
END;
$$;

COMMENT ON FUNCTION tile_region_islands IS 'MVT tiles for real island boundaries of hull regions. Query params: parent_id (optional)';

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
            r.uses_hull,
            false as has_subregions,
            (r.uses_hull AND r.hull_geom IS NOT NULL) as using_hull,
            ST_AsMVTGeom(
                CASE
                    -- Precomputed; see simplify_for_overview(). A NULL here
                    -- means "not computed yet" and falls through to the low rung
                    -- so an un-backfilled database renders as it always did.
                    WHEN z <= 2 AND r.geom_overview IS NOT NULL
                        THEN r.geom_overview
                    WHEN z <= 4 AND r.geom_simplified_low IS NOT NULL THEN r.geom_simplified_low
                    WHEN z <= 8 AND r.geom_simplified_medium IS NOT NULL THEN r.geom_simplified_medium
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

-- Experience categories (UNESCO, museums, landmarks, etc.)
CREATE TABLE IF NOT EXISTS experience_categories (
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

COMMENT ON TABLE experience_categories IS 'Experience categories (UNESCO, museums, landmarks, etc.)';
COMMENT ON COLUMN experience_categories.api_config IS 'Category-specific API configuration (pagination, auth, etc.)';
COMMENT ON COLUMN experience_categories.last_sync_status IS 'Status of last sync: success, partial, or failed';
COMMENT ON COLUMN experience_categories.display_priority IS 'Display order in experience list (lower = shown first)';

ALTER TABLE experience_categories ADD COLUMN IF NOT EXISTS new_badge_days INTEGER NOT NULL DEFAULT 30;
COMMENT ON COLUMN experience_categories.new_badge_days IS 'How long an object keeps the "New" chip after it becomes visible to readers. Per category, because sources have different cadences. Counted from published_at, not from the run that found the row: under a gate those are a curator week apart (#529).';

-- The curation gate (ADR-0025). A category is a source here, and this is the
-- per-source decision: does what a run brings in wait for a person, or publish
-- on arrival. The default is `true` so a source nobody has decided about does
-- not publish unread.
--
-- The three sources that predate the gate are the exception, and creating the
-- column is the only moment at which they can be given their answer. So the
-- two happen inside one guard, atomically, in both schema homes: whichever of
-- this file and migration 018 reaches a database first creates the column and
-- names those three in the same breath, and every later application of either
-- file sees the column and does nothing. That is what keeps an admin's later
-- decision safe -- `true` on a source they chose to gate survives any number of
-- re-applications -- and it is also why the guard cannot be `ADD COLUMN IF NOT
-- EXISTS`: on a database that predates the column, the `DEFAULT true` backfill
-- would gate all three, and a separate `UPDATE` outside the guard would then be
-- either unsafe (resetting the admin) or skipped (leaving them gated).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'experience_categories' AND column_name = 'requires_curation'
    ) THEN
        ALTER TABLE experience_categories
            ADD COLUMN requires_curation BOOLEAN NOT NULL DEFAULT true;
        UPDATE experience_categories SET requires_curation = false
         WHERE name IN ('UNESCO World Heritage Sites', 'Top Art Museums', 'Public Art & Monuments');
    END IF;
END $$;
COMMENT ON COLUMN experience_categories.requires_curation IS 'Does a run from this source wait for a curator before its rows reach a reader (ADR-0025). Only an admin sets it; no run ever changes it.';

-- Seed UNESCO as the first category
INSERT INTO experience_categories (name, description, api_endpoint, api_config, display_priority, requires_curation)
VALUES (
    'UNESCO World Heritage Sites',
    'Official UNESCO World Heritage List - Cultural, Natural, and Mixed sites worldwide',
    'https://data.unesco.org/api/explore/v2.1/catalog/datasets/whc001/records',
    '{"pageSize": 100}'::jsonb,
    1,
    false
)
ON CONFLICT (name) DO NOTHING;

-- Generic experiences (category-agnostic)
CREATE TABLE IF NOT EXISTS experiences (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES experience_categories(id) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL,

    -- Names (multilingual support)
    name VARCHAR(500) NOT NULL,
    name_local JSONB,  -- {"en": "...", "fr": "...", "es": "...", ...}

    -- Description
    description TEXT,
    short_description TEXT,

    -- Classification
    category VARCHAR(100),
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

    -- Category-specific metadata (UNESCO: date_inscribed, danger, criteria, etc.)
    metadata JSONB,

    -- Curation fields
    is_manual BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(id),
    curated_fields JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
    is_iconic BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(category_id, external_id)
);

COMMENT ON TABLE experiences IS 'Location-based experiences from various categories (UNESCO sites, museums, etc.)';
COMMENT ON COLUMN experiences.external_id IS 'ID from the category system (e.g., UNESCO id_no)';
COMMENT ON COLUMN experiences.name_local IS 'Multilingual names: {"en": "...", "fr": "...", ...}';
COMMENT ON COLUMN experiences.category IS
  'Venue type within the category, per docs/vision/EXPERIENCE-TYPE-AND-SIGNIFICANCE.md: '
  '''art''/''history''/''archaeology''… for museums, ''cultural''/''natural''/''mixed'' for '
  'UNESCO, ''monument''/''sculpture'' for public art. Not one shared enum.';
COMMENT ON COLUMN experiences.location IS 'Required point location for the experience';
COMMENT ON COLUMN experiences.boundary IS 'Optional boundary polygon for experiences with defined areas';
COMMENT ON COLUMN experiences.country_codes IS 'ISO country codes, array for transboundary sites';
COMMENT ON COLUMN experiences.metadata IS 'Category-specific data (UNESCO: date_inscribed, danger, criteria, etc.)';
COMMENT ON COLUMN experiences.is_iconic IS 'Whether this experience is considered iconic/must-see';

-- Spatial indexes for experiences
CREATE INDEX IF NOT EXISTS idx_experiences_location ON experiences USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_experiences_boundary ON experiences USING GIST(boundary) WHERE boundary IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experiences_name_trgm ON experiences USING GIN(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_experiences_category_id ON experiences(category_id);
CREATE INDEX IF NOT EXISTS idx_experiences_category ON experiences(category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experiences_external_id ON experiences(category_id, external_id);
CREATE INDEX IF NOT EXISTS idx_experiences_iconic ON experiences(is_iconic) WHERE is_iconic = true;

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
    category_id INTEGER NOT NULL REFERENCES experience_categories(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_experience_sync_logs_category ON experience_sync_logs(category_id);
CREATE INDEX IF NOT EXISTS idx_experience_sync_logs_status ON experience_sync_logs(status) WHERE status = 'running';

ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_unchanged INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_missing INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_curated_conflicts INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS is_dry_run BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS detection_skipped_reason TEXT;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_filtered INTEGER DEFAULT 0;

COMMENT ON COLUMN experience_sync_logs.total_updated IS 'Rows whose fields actually changed. Runs before migration 009 counted every row that passed through ON CONFLICT, changed or not — the two are not comparable.';
COMMENT ON COLUMN experience_sync_logs.total_unchanged IS 'Rows the run wrote nothing to. Two kinds: ones that turned out identical, and ones the run proposed a change to and was refused - a curated_fields claim (counted again in total_curated_conflicts) or the category gate holding a row a reader can already see. A held row is not identical, so this counter alone cannot say how many decisions a gated run left waiting; the changeset rows can, and issue #523 tracks giving the log its own total_held. Counted here, never stored per object.';
COMMENT ON COLUMN experience_sync_logs.is_dry_run IS 'TRUE for preview runs: the changeset was computed but experiences were not written. Excluded from every "latest run" query.';
COMMENT ON COLUMN experience_sync_logs.total_filtered IS 'Entities the source offered that are not of the kind this category holds — e.g. a Wikidata collection with no physical address answering a museum query. Not errors: nothing failed, and the run stays successful.';
COMMENT ON COLUMN experience_sync_logs.detection_skipped_reason IS 'Why missing-object detection did not run: ranked source, force run, cancelled, errors, or coverage below the floor. Every value missingDetectionSkipReason() produces lands here.';

-- Built for the "New" chip's per-row lookup of the latest completed non-dry run
-- of a category, which #529 deleted: the chip now counts from published_at and
-- reads no sync log at all. Kept because dropping an index is its own decision
-- with its own measurement, but nothing about the chip should be read from it.
-- Declared here rather than beside the other sync-log indexes above because it
-- reads is_dry_run, which the ALTER just above adds.
CREATE INDEX IF NOT EXISTS idx_experience_sync_logs_latest
    ON experience_sync_logs(category_id, completed_at DESC, id DESC)
    WHERE is_dry_run = FALSE AND completed_at IS NOT NULL;

-- =============================================================================
-- Experience Change Provenance (issue #480)
-- =============================================================================
-- Which run each experience came from, and what state that leaves it in.
--
-- Two independent axes, because they genuinely are: the Bamiyan Buddhas were
-- destroyed but remain listed, while Dresden Elbe Valley is intact but was
-- delisted. Axis 2 (existence) is the one no machine ever writes. Axis 1 the
-- machine both observes, via missing_since, and writes in one direction: a sync
-- that lists a 'former' row again restores 'present'. Only that direction, so
-- an outage still cannot hide anything; 'former' itself stays curator-only. See ADR-0020.

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

COMMENT ON COLUMN experiences.missing_since IS 'When a clean run of an authoritative source first failed to list this object. A machine observation, not a verdict.';
COMMENT ON COLUMN experiences.source_membership IS 'present or former. Only a curator sets former: a source outage must never change what users see. A sync that lists the row again sets it back to present, which only ever restores visibility.';
COMMENT ON COLUMN experiences.existence IS 'extant or lost. Whether the object still physically exists — independent of whether the source lists it.';

CREATE INDEX IF NOT EXISTS idx_experiences_missing ON experiences(category_id) WHERE missing_since IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experiences_membership ON experiences(source_membership) WHERE source_membership <> 'present';
CREATE INDEX IF NOT EXISTS idx_experiences_existence ON experiences(existence) WHERE existence <> 'extant';
CREATE INDEX IF NOT EXISTS idx_experiences_first_seen ON experiences(first_seen_sync_log_id);

-- =============================================================================
-- Admission (ADR-0024)
-- =============================================================================
-- A third axis, independent of the two above, and the only one the machine
-- decides. The two above are statements about the world — the source stopped
-- listing it; it no longer exists — and neither is true of a venue our own rule
-- turned down. Wikidata goes on listing the British Museum, which stands open;
-- what changed is that *Top Art Museums* holds art museums and that one is an
-- archaeological collection. Folding that into `former` would reproduce exactly
-- the conflation ADR-0020 removed.
--
-- The machine may write this one because a refusal is not an observation: it is
-- a deterministic rule applied to data we hold, naming the object before it
-- says no, and re-running it gives the same answer. A curator who disagrees
-- pins 'admission' in curated_fields, and every write below skips the row.

ALTER TABLE experiences ADD COLUMN IF NOT EXISTS admission VARCHAR(10) NOT NULL DEFAULT 'admitted';
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS admission_reason TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_admission_check') THEN
        ALTER TABLE experiences ADD CONSTRAINT experiences_admission_check
            CHECK (admission IN ('admitted', 'refused'));
    END IF;
END $$;

COMMENT ON COLUMN experiences.admission IS
    'admitted or refused. Whether this category accepts the row, independent of whether the source still lists it. '
    'The machine sets this one: a refusal is our own rule applied to an object the run named, not an observation. '
    'A refused row is hidden from every read that offers somewhere to go, and from none that records a visit.';
COMMENT ON COLUMN experiences.admission_reason IS
    'Why the category refused it, stated verbatim to the curator. On the row rather than in '
    'experience_sync_changes because a changeset is keyed by the external id the run named, which is not always this row''s.';

CREATE INDEX IF NOT EXISTS idx_experiences_admission ON experiences(admission) WHERE admission <> 'admitted';

-- The fourth column that can take a row off a reader's screen, and it is not
-- interchangeable with the other three (ADR-0025): `existence` answers is it
-- still standing, `admission` does it belong in this catalogue,
-- `missing_since` does the source still offer this point, and this one answers
-- has anyone looked at it yet. They compose rather than collapse.
--
-- Default `auto`, not `pending`: the sync path sets `pending` explicitly
-- because it knows about the gate, so a writer that forgets this column keeps
-- today's behaviour. The other default would let such a writer remove its rows
-- from the product silently.
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS curation_state VARCHAR(10) NOT NULL DEFAULT 'auto';
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
-- ON DELETE SET NULL, like the two provenance pointers beside it: deleting a
-- sync log is a supported operation here, and a pointer to a log that no longer
-- exists names nothing. The hold itself is carried by `curation_state`, so
-- losing the pointer loses the way to find the proposal, not the hold.
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS pending_change_sync_log_id INTEGER
    REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
COMMENT ON COLUMN experiences.curation_state IS 'pending = arrived from a gated source and nobody has passed it; auto = published unread; verified = a curator passed what is live now. No reader-facing read may offer a pending row (ADR-0025).';
COMMENT ON COLUMN experiences.published_at IS 'When the row became visible. NULL while pending and for every row that predates the gate. This is what the "New" chip counts from (#529): a gated row is found months before a reader can see it, so the run that found it is the wrong clock.';
COMMENT ON COLUMN experiences.pending_change_sync_log_id IS 'The run whose content proposal is held for an already-visible row. NULL when nothing is held. Contents need no equivalent — a content row is held by being written pending rather than withheld.';
CREATE INDEX IF NOT EXISTS idx_experiences_curation_state ON experiences(curation_state) WHERE curation_state = 'pending';

-- Per-object record of what a run did. 'unchanged' is deliberately NOT stored;
-- it is only counted, or every UNESCO run would write 1247 rows of noise.
CREATE TABLE IF NOT EXISTS experience_sync_changes (
    id             BIGSERIAL PRIMARY KEY,
    sync_log_id    INTEGER NOT NULL REFERENCES experience_sync_logs(id) ON DELETE CASCADE,
    experience_id  INTEGER REFERENCES experiences(id) ON DELETE SET NULL,
    external_id    VARCHAR(255) NOT NULL,
    name_snapshot  VARCHAR(500),
    change_type    VARCHAR(20) NOT NULL CHECK (change_type IN ('created', 'updated', 'conflict', 'held', 'contents', 'missing', 'returned', 'failed', 'filtered')),
    changed_fields JSONB,
    contents       JSONB,
    significance   VARCHAR(10) CHECK (significance IN ('major', 'minor')),
    error          TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE experience_sync_changes IS 'Per-object provenance for a sync run (issue #480). See ADR-0020.';
COMMENT ON COLUMN experience_sync_changes.name_snapshot IS 'The name at the time of the run, so the report stays readable if the row is later deleted.';
-- Declared in the CREATE TABLE above and added again here, in that order:
-- `CREATE TABLE IF NOT EXISTS` is a no-op on a database that already holds this
-- table, so a new column reaches one only through the ALTER — and the COMMENT
-- below it would fail on such a database if it ran first.
ALTER TABLE experience_sync_changes ADD COLUMN IF NOT EXISTS contents JSONB;

COMMENT ON COLUMN experience_sync_changes.contents IS 'What the run did to what the object holds, keyed by kind of contents: {"locations": {"added": [{"name","ref"}], "withdrawn": [...], "returned": [...]}, "treasures": {...}}. See ADR-0026. Keyed rather than one column per kind so a new kind of contents costs no migration; a kind the run did nothing to is absent. Items are named, never identified by id, so the record stays legible after the row it names is renamed. NULL means the run recorded nothing here - for a run older than this column that is not the same as "the contents did not move", and the location rows cannot be asked instead (created_at was overwritten wholesale on 2026-08-04).';

COMMENT ON COLUMN experience_sync_changes.changed_fields IS 'Array of {field, old, new, significance, curatedConflict, held}. Each entry holds the value the source proposed for that field even when the run refused to write it, so a curator can answer it later; the two flags say why it was refused - curatedConflict = a curator had claimed the field (answered by accept-source), held = the category gate kept it out of a row a reader can already see (answered by publishing). Both false on a field the run applied.';

-- CREATE TABLE IF NOT EXISTS is a no-op where the table already exists, so a
-- widened CHECK has to be applied on its own or re-applying this file would
-- leave an older database rejecting the newer change types.
ALTER TABLE experience_sync_changes DROP CONSTRAINT IF EXISTS experience_sync_changes_change_type_check;
ALTER TABLE experience_sync_changes ADD CONSTRAINT experience_sync_changes_change_type_check
    CHECK (change_type IN ('created', 'updated', 'conflict', 'held', 'contents', 'missing', 'returned', 'failed', 'filtered'));

CREATE INDEX IF NOT EXISTS idx_sync_changes_log ON experience_sync_changes(sync_log_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_exp ON experience_sync_changes(experience_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_review ON experience_sync_changes(sync_log_id, change_type);

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
    ordinal INTEGER DEFAULT 0,            -- Display order; NULL once unoffered
    location GEOMETRY(Point, 4326) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    missing_since TIMESTAMPTZ,            -- NULL = the source still offers this point
    UNIQUE(experience_id, ordinal)
);

COMMENT ON TABLE experience_locations IS 'Individual locations for multi-location experiences (UNESCO serial nominations, etc.)';
COMMENT ON COLUMN experience_locations.name IS 'Component name (e.g., individual fort name within a serial nomination)';
COMMENT ON COLUMN experience_locations.external_ref IS 'Source-specific reference (e.g., "1739-005" for UNESCO)';

-- A location the source stopped offering is marked, not deleted: both
-- `user_visited_locations.location_id` and
-- `experience_location_regions.location_id` cascade on delete, so removing the
-- row destroys the user's record of having been there and every region
-- assignment on it, manual ones included. `ordinal` goes with it — a row the
-- source no longer lists has no position in that list, and NULL sorts last.
-- Repeated as ALTERs so a database created before this picks them up when this
-- file is re-applied; both are no-ops on a fresh one. See db/migrations/013.
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS missing_since TIMESTAMPTZ;
ALTER TABLE experience_locations ALTER COLUMN ordinal DROP NOT NULL;

-- After the ALTER, not before it: on a database that predates the column,
-- `CREATE TABLE IF NOT EXISTS` above is a no-op, so commenting the column
-- first aborts the whole re-application with "column does not exist" — which
-- is exactly the workflow the ALTERs exist to serve.
COMMENT ON COLUMN experience_locations.ordinal IS 'Display order within the experience. A sync numbers from 1; a curator-created first location is 0. NULL when the source no longer lists this point — whether that is already recorded (missing_since) or still waiting on the point that replaces it (withdrawal_deferred_for_location_id).';
COMMENT ON COLUMN experience_locations.missing_since IS 'When a run first offered this experience without this point. A machine observation, not a verdict. NULL = currently offered.';

CREATE INDEX IF NOT EXISTS idx_experience_locations_experience ON experience_locations(experience_id);
CREATE INDEX IF NOT EXISTS idx_experience_locations_location ON experience_locations USING GIST(location);

-- Every read of an experience's current points carries `missing_since IS NULL`,
-- and the sync's fast path counts them per experience on every object of every
-- run. Partial, because no read ever asks for the marked rows alone.
--
-- Those reads also carry `existence <> 'lost'` since ADR-0026, and this index
-- deliberately does not: the term is a curator's verdict on a component, true of
-- almost no row, so narrowing the index by it would buy nothing while making it
-- unusable for the fast path, which asks only about offered rows. A query with the
-- extra AND still uses this index.
CREATE INDEX IF NOT EXISTS idx_experience_locations_offered
    ON experience_locations(experience_id) WHERE missing_since IS NULL;

ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS curation_state VARCHAR(10) NOT NULL DEFAULT 'auto';
COMMENT ON COLUMN experience_locations.curation_state IS 'A pending point is written, indexed and placed into regions like any other; keeping it off reader-facing reads is the job of one predicate rather than a reason to withhold the row (ADR-0025).';

-- What a curator decided about this point, kept from the next run. Every arm of
-- `locationWriter` writes the source's name and coordinate over whatever is
-- stored, so before this the answer to "that pin is in the wrong place" lasted
-- until the source was asked again. Same shape as `experiences.curated_fields`
-- (#488), NOT NULL for the reason given on `treasures.curated_fields`. See
-- db/migrations/027.
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS curated_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN experience_locations.curated_fields IS 'Column names a curator has claimed on this point: name, location. Never external_ref or ordinal — those are the source''s handle on the row and its place in the source''s list, and a claim on them would break the pairing that decides whether a point moved or was replaced.';

-- A moved point is a withdrawal plus an insert, and under a gated source the two
-- halves become visible at different moments: the insert lands `pending`, so
-- applying the withdrawal at once would take the old pin off the map while the
-- new one is still invisible. 1119 of 1604 experiences hold exactly one point,
-- so for most of the catalogue that is an object still in every list with
-- nothing on the map. The arrival therefore names the point it replaces, and the
-- withdrawal waits until a curator publishes the arrival — see
-- `locationWriter.ts` for how the pairing is built and `publishController.ts`
-- for the one transaction that releases it.
--
-- `ON DELETE SET NULL` rather than CASCADE: deleting the old point must not take
-- the new one with it. The pairing is then simply gone, which is the right
-- reading — there is no longer a withdrawal to hold.
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS withdrawal_deferred_for_location_id INTEGER REFERENCES experience_locations(id) ON DELETE SET NULL;
COMMENT ON COLUMN experience_locations.withdrawal_deferred_for_location_id IS 'Set on a pending point that replaces another: the named point stopped being offered, and its missing_since is held back until this one is published (ADR-0025 decision 5). NULL on every other row.';

-- The withdrawal statement asks, for each stored row, whether anything is
-- waiting on it — a predicate with no experience_id to narrow it. Partial,
-- because the column is NULL on all but the handful of rows in flight, and every
-- query asks only about those. It is also the index the foreign key above needs:
-- Postgres does not create one for a referencing column, so without it every
-- delete of a location scans this table.
CREATE INDEX IF NOT EXISTS idx_experience_locations_deferred_withdrawal ON experience_locations(withdrawal_deferred_for_location_id) WHERE withdrawal_deferred_for_location_id IS NOT NULL;

-- A curator's verdict on a point the source stopped offering (ADR-0026, #541).
-- The same two axes an experience has carried since ADR-0020, and deliberately
-- the same words: `former` is the source's list, `lost` is the world.
-- ADR-0022 held these back until they had consumers -- its rejected alternatives say
-- so in as many words, "nothing would write or read either yet" -- which is the
-- withdrawal card and the endpoint behind it.
--
-- What differs from the experience-level verdict is `missing_since`. There, every
-- answer clears it, because nothing a reader sees is keyed on it. Here it is one of
-- the two terms a reader-facing read carries — `offeredLocationSql` is
-- `missing_since IS NULL AND existence <> 'lost'` — and each verdict is held by a
-- different one: `former` by the flag, so clearing it would put the pin back on the
-- map for a place the source no longer lists; `lost` by its own axis, whatever the
-- flag says, which is what makes that verdict outlive a run (the writer clears the
-- flag when the source offers the point again) and what lets it hide a point readers
-- could see. Only "the source blinked" clears the flag, and leaving it standing is
-- what takes an answered row out of the queue without any read learning a predicate
-- for the queue's sake.
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS source_membership VARCHAR(10) NOT NULL DEFAULT 'present';
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS existence VARCHAR(10) NOT NULL DEFAULT 'extant';
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS state_decided_by INTEGER REFERENCES users(id);
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS state_decided_at TIMESTAMPTZ;
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS state_note TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_locations_source_membership_check') THEN
        ALTER TABLE experience_locations ADD CONSTRAINT experience_locations_source_membership_check
            CHECK (source_membership IN ('present', 'former'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_locations_existence_check') THEN
        ALTER TABLE experience_locations ADD CONSTRAINT experience_locations_existence_check
            CHECK (existence IN ('extant', 'lost'));
    END IF;
END $$;

COMMENT ON COLUMN experience_locations.source_membership IS 'present or former. Only a curator sets former: it means the source really did stop offering this point, and the row keeps its missing_since, so every read already hides it and the queue stops asking. A sync that lists the point again sets it back to present, wherever that point is - every arm that matches an offered row, and the fast path counts such a row as unmatched so one of them is reached (ADR-0026 decision 6). It only ever moves toward visibility, and moves nothing on its own: what a reader sees also needs existence <> lost, so a point a curator declared gone stays hidden through the restore (decision 7). Without the restore the point would return visible while recorded as delisted, and its next departure would raise no card at all.';
COMMENT ON COLUMN experience_locations.existence IS 'extant or lost, set by a curator only. lost = the component itself is gone — a demolished building of a serial site. Independent of whether the source still lists it.';

-- The queue asks about points still waiting for that verdict, so it reads the
-- two axes together with the flag. Partial on the same reasoning as the
-- experience-level pair: answered rows are the rare ones, and no read asks for
-- them alone.
CREATE INDEX IF NOT EXISTS idx_experience_locations_undecided
    ON experience_locations(experience_id)
    WHERE missing_since IS NOT NULL AND source_membership = 'present' AND existence = 'extant';

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

-- Seed "Top Art Museums" as experience category
INSERT INTO experience_categories (name, description, api_endpoint, api_config, display_priority, requires_curation)
VALUES (
    'Top Art Museums',
    'World''s most notable museums ranked by artwork fame, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{"userAgent": "TrackYourRegions/1.0"}'::jsonb,
    2,
    false
)
ON CONFLICT (name) DO NOTHING;

-- Seed "Public Art & Monuments" as experience category
INSERT INTO experience_categories (name, description, api_endpoint, api_config, display_priority, requires_curation)
VALUES (
    'Public Art & Monuments',
    'Notable outdoor sculptures and monuments worldwide, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{"userAgent": "TrackYourRegions/1.0"}'::jsonb,
    3,
    false
)
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- Treasures (artworks, artifacts — can belong to multiple venues)
-- =============================================================================
-- Globally unique items (e.g., Mona Lisa) linked to experiences via junction table.
-- A treasure can appear in multiple venues (many-to-many).

CREATE TABLE IF NOT EXISTS treasures (
    id SERIAL PRIMARY KEY,
    external_id VARCHAR(255) NOT NULL UNIQUE, -- Wikidata QID (e.g., "Q12418") — globally unique
    name VARCHAR(500) NOT NULL,               -- "Mona Lisa"
    -- The Wikidata class the work was collected under, as a label: 'painting',
    -- 'fresco', 'woodblock print', 'painting series'. Not an enum — the museum
    -- pipeline clips to this width because a class label can be longer than it
    -- (Q574422 is 68 characters), and a clipped display string is a cheaper
    -- failure than an insert that takes the whole museum down with it.
    treasure_type VARCHAR(50) NOT NULL,
    artist VARCHAR(500),                       -- "Leonardo da Vinci"
    year INTEGER,                              -- 1503
    image_url VARCHAR(1000),                   -- Wikimedia Commons URL (not downloaded)
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

-- A work carries state here and its link carries state too, and they answer
-- different questions (ADR-0025): this one says the work is real and correctly
-- described, checked once globally; the link says it is here, which is the fact
-- that changes as works are sold, moved and lent.
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS curation_state VARCHAR(10) NOT NULL DEFAULT 'auto';
COMMENT ON COLUMN treasures.curation_state IS 'Whether this work has been passed by a curator — checked once, globally (ADR-0025).';

-- A verdict on a work needs somewhere to survive: the upsert sets every column
-- from EXCLUDED, so before this a curator's correction lasted until the next
-- run. Same shape and same reading as `experiences.curated_fields` (#488), and
-- NOT NULL because the guard is SQL — `jsonb ? 'name'` on a NULL is NULL, not
-- false, which would take the source's value on every unclaimed row. See
-- db/migrations/027.
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS curated_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN treasures.curated_fields IS 'Column names a curator has claimed on this work: name, artist, year, image_url. Not sitelinks_count or is_iconic, which are a measurement and a threshold rather than a judgement, and not external_id, which is identity.';

-- Junction table: many-to-many between experiences and treasures
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

ALTER TABLE experience_treasures ADD COLUMN IF NOT EXISTS curation_state VARCHAR(10) NOT NULL DEFAULT 'auto';
COMMENT ON COLUMN experience_treasures.curation_state IS 'Whether this work has been passed as being HERE. A link may be offered to a reader only when neither it nor its work is pending (ADR-0025).';

-- Guarded rather than dropped-and-added: these are new constraints, not widened
-- ones, so the drop/add idiom used for the changeset's change_type check would
-- be doing nothing on a fresh database and hiding a failure on an old one.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_curation_state_check') THEN
        ALTER TABLE experiences ADD CONSTRAINT experiences_curation_state_check
            CHECK (curation_state IN ('pending', 'auto', 'verified'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_locations_curation_state_check') THEN
        ALTER TABLE experience_locations ADD CONSTRAINT experience_locations_curation_state_check
            CHECK (curation_state IN ('pending', 'auto', 'verified'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_treasures_curation_state_check') THEN
        ALTER TABLE experience_treasures ADD CONSTRAINT experience_treasures_curation_state_check
            CHECK (curation_state IN ('pending', 'auto', 'verified'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasures_curation_state_check') THEN
        ALTER TABLE treasures ADD CONSTRAINT treasures_curation_state_check
            CHECK (curation_state IN ('pending', 'auto', 'verified'));
    END IF;
END $$;

-- =============================================================================
-- User Viewed Treasures (artwork "seen" tracking)
-- =============================================================================
-- Tracks which treasures a user has seen.
-- Marking a treasure as viewed auto-marks the parent experience as visited.

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

-- =============================================================================
-- Curator System
-- =============================================================================
-- Allows trusted users (curators) to manually fix, extend, and filter
-- experience collections with scoped permissions.

-- Curator assignments (scoped permissions)
CREATE TABLE IF NOT EXISTS curator_assignments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope_type VARCHAR(20) NOT NULL CHECK (scope_type IN ('region', 'category', 'global')),
    region_id INTEGER REFERENCES regions(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES experience_categories(id) ON DELETE CASCADE,
    assigned_by INTEGER NOT NULL REFERENCES users(id),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    -- Ensure correct nullable combinations per scope_type
    CONSTRAINT valid_scope CHECK (
        (scope_type = 'global' AND region_id IS NULL AND category_id IS NULL) OR
        (scope_type = 'region' AND region_id IS NOT NULL AND category_id IS NULL) OR
        (scope_type = 'category' AND region_id IS NULL AND category_id IS NOT NULL)
    )
);

-- Partial unique indexes (PostgreSQL treats NULLs as distinct in UNIQUE)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_global_assignment
    ON curator_assignments(user_id) WHERE scope_type = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_region_assignment
    ON curator_assignments(user_id, region_id) WHERE scope_type = 'region';
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_category_assignment
    ON curator_assignments(user_id, category_id) WHERE scope_type = 'category';

CREATE INDEX IF NOT EXISTS idx_curator_assignments_user ON curator_assignments(user_id);

COMMENT ON TABLE curator_assignments IS 'Scoped curator permissions: global, per-region, or per-category';
COMMENT ON COLUMN curator_assignments.scope_type IS 'Permission scope: global (all), region (specific region + descendants), category (specific experience category)';

-- Experience curation audit log
CREATE TABLE IF NOT EXISTS experience_curation_log (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    curator_id INTEGER NOT NULL REFERENCES users(id),
    action VARCHAR(30) NOT NULL CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited')),
    region_id INTEGER REFERENCES regions(id) ON DELETE SET NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CREATE TABLE IF NOT EXISTS is a no-op where the table exists, so a widened
-- CHECK has to be applied on its own — see the same shape on
-- experience_sync_changes above.
--
-- 'declined_source' is the newest of them and rides in
-- db/migrations/022-conflict-decisions.sql for a database that already holds
-- data. The list is a closed one, so a curator's action cannot be recorded at
-- all until it is named here: the audit insert is inside the same transaction
-- as the decision, and a rejected action rolls the decision back with it. That
-- is why widening it is a schema change and not a code-only one.
ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited'));

CREATE INDEX IF NOT EXISTS idx_curation_log_experience ON experience_curation_log(experience_id);
CREATE INDEX IF NOT EXISTS idx_curation_log_curator ON experience_curation_log(curator_id);
CREATE INDEX IF NOT EXISTS idx_curation_log_created ON experience_curation_log(created_at DESC);

COMMENT ON TABLE experience_curation_log IS 'Audit trail of all curator actions on experiences';

-- The proposals a curator has refused, so the queue stops asking about them.
--
-- A conflict is a field a curator claimed and a source keeps proposing otherwise. The
-- stored value already wins every time — `curated_fields` decides that — so standing by
-- it required no action, and the card came back after every run: Aksum's arrived three
-- times in two days, with the source proposing the identical value each time.
--
-- What is stored is the refused **value**, not the field, and the queue suppresses a
-- proposal only while it is jsonb-equal to this one. A field-level rule would hide the
-- one case a curator must see — a source that has changed its mind.
--
-- One row per field, replaced rather than appended: this is the standing answer, and the
-- history of answers is what experience_curation_log is for. Deleted when the claim is
-- released by accepting the source, since an answer to a question nobody is asking must
-- not silence the field the day someone claims it again.
CREATE TABLE IF NOT EXISTS experience_conflict_decisions (
    id BIGSERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    field VARCHAR(100) NOT NULL,
    declined JSONB NOT NULL,
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (experience_id, field)
);

-- No index beyond the unique constraint: its btree leads on experience_id, so it already
-- serves the queue's lookup (experience_id AND field — which it serves better than a
-- single-column index would) and accept-source's delete by experience and field list.

COMMENT ON TABLE experience_conflict_decisions IS 'Source proposals a curator refused; suppresses the queue card while the proposal is unchanged';

-- When a user was first shown the "New" chip (issue #480). The chip lives for
-- max(category window, a week from this timestamp), so only the first
-- impression matters — a later view must not restart the week. No index beyond
-- the primary key: that is what the chip's lookup uses, and there is no sweep.
CREATE TABLE IF NOT EXISTS user_new_badge_views (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    first_shown_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, experience_id)
);

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
-- WorldView Import System (source-agnostic region import + GADM matching)
-- =============================================================================
-- Supports importing region hierarchies from any source (Wikivoyage, OSM, etc.)
-- and matching leaf regions to GADM administrative divisions.

-- Import run tracking (one per import operation)
CREATE TABLE IF NOT EXISTS import_runs (
    id SERIAL PRIMARY KEY,
    world_view_id INTEGER REFERENCES world_views(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL,  -- 'wikivoyage', 'osm', etc.
    status VARCHAR(20) DEFAULT 'running',  -- running, matching, reviewing, finalized, failed
    data_path TEXT,  -- filesystem path to raw JSON (/data/imports/{id}.json)
    stats JSONB,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_runs_wv ON import_runs(world_view_id);

COMMENT ON TABLE import_runs IS 'Tracks WorldView import operations from external sources';
COMMENT ON COLUMN import_runs.source_type IS 'Import source identifier: wikivoyage, osm, natural_earth, etc.';
COMMENT ON COLUMN import_runs.data_path IS 'Filesystem path to the raw import JSON file';

-- Region import state (1:1 with region, only for imported regions)
CREATE TABLE IF NOT EXISTS region_import_state (
    region_id INTEGER PRIMARY KEY REFERENCES regions(id) ON DELETE CASCADE,
    import_run_id INTEGER REFERENCES import_runs(id) ON DELETE SET NULL,
    source_url TEXT,
    source_external_id TEXT,  -- wikidata ID, etc.
    match_status VARCHAR(30) NOT NULL DEFAULT 'no_candidates',
    needs_manual_fix BOOLEAN DEFAULT FALSE,
    fix_note TEXT,
    region_map_url TEXT,
    map_image_reviewed BOOLEAN DEFAULT FALSE,
    marker_points JSONB,
    geo_available BOOLEAN,  -- NULL = unknown, set after geoshape lookup (geoshapeCoverage.ts)
    hierarchy_reviewed BOOLEAN NOT NULL DEFAULT FALSE,  -- admin confirmed child set via AI Review Children
    hierarchy_warnings TEXT[]  -- AI-flagged issues with the region's child set
);

CREATE INDEX IF NOT EXISTS idx_ris_status ON region_import_state(match_status);
CREATE INDEX IF NOT EXISTS idx_ris_run ON region_import_state(import_run_id);

COMMENT ON TABLE region_import_state IS 'Import metadata for regions created via WorldView Import (1:1 with region)';
COMMENT ON COLUMN region_import_state.match_status IS 'Match lifecycle: no_candidates, needs_review, auto_matched, manual_matched, children_matched, suggested';
COMMENT ON COLUMN region_import_state.source_external_id IS 'External identifier from import source (e.g. Wikidata QID)';
COMMENT ON COLUMN region_import_state.geo_available IS 'Whether a Wikidata geoshape is available for this region (NULL until checked)';
COMMENT ON COLUMN region_import_state.hierarchy_reviewed IS 'True once an admin has run AI Review Children on this region';
COMMENT ON COLUMN region_import_state.hierarchy_warnings IS 'AI-flagged issues with the current child set (empty/NULL = none)';

-- Match suggestions (1:N per region, replaces metadata.suggestions + rejectedDivisionIds)
CREATE TABLE IF NOT EXISTS region_match_suggestions (
    id SERIAL PRIMARY KEY,
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    division_id INTEGER NOT NULL REFERENCES administrative_divisions(id),
    name TEXT NOT NULL,
    path TEXT,
    score INTEGER DEFAULT 0,
    rejected BOOLEAN DEFAULT FALSE,
    conflict_type TEXT,
    donor_region_id INTEGER REFERENCES regions(id) ON DELETE SET NULL,
    donor_division_id INTEGER REFERENCES administrative_divisions(id) ON DELETE SET NULL,
    donor_region_name TEXT,
    donor_division_name TEXT,
    geo_similarity FLOAT
);

CREATE INDEX IF NOT EXISTS idx_rms_region ON region_match_suggestions(region_id);

COMMENT ON TABLE region_match_suggestions IS 'GADM division match suggestions for imported regions (1:N per region)';
COMMENT ON COLUMN region_match_suggestions.rejected IS 'True if admin rejected this suggestion (prevents re-suggestion)';

-- Map image candidates (1:N per region, replaces metadata.mapImageCandidates)
CREATE TABLE IF NOT EXISTS region_map_images (
    id SERIAL PRIMARY KEY,
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rmi_region ON region_map_images(region_id);

COMMENT ON TABLE region_map_images IS 'Candidate map images for imported regions (from Wikimedia Commons etc.)';

-- Wikidata geoshape cache (geometry for geoshape-based GADM matching)
-- Cache-first proxy: filled from maps.wikimedia.org and from composite unions of
-- child entity geoshapes. Keyed by Wikidata QID or "commons:{filename}".
-- See backend/src/services/worldViewImport/geoshapeCache.ts / geoshapeComposite.ts.
CREATE TABLE IF NOT EXISTS wikidata_geoshapes (
    wikidata_id TEXT PRIMARY KEY,            -- Wikidata QID or "commons:{filename}"
    geom geometry(MultiPolygon, 4326),       -- NULL when not_available; SRID 4326
    not_available BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE = no geoshape exists (negative cache)
    -- Negative-cache invariant: a row is either a real geoshape or a not_available
    -- marker. Stops a NULL geom with not_available=FALSE from reaching PostGIS calls
    -- (e.g. geoshapeCoverage.ts) and blocks a degenerate composite union from
    -- overwriting a valid cached geom with NULL via ON CONFLICT DO UPDATE.
    CONSTRAINT wikidata_geoshapes_geom_presence CHECK (not_available OR geom IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_wikidata_geoshapes_geom ON wikidata_geoshapes USING GIST (geom);

COMMENT ON TABLE wikidata_geoshapes IS 'Cache of Wikidata/Commons geoshapes (and composite unions) for WorldView Import geoshape matching';
COMMENT ON COLUMN wikidata_geoshapes.not_available IS 'Negative cache: TRUE means a geoshape lookup confirmed none exists';

-- =============================================================================
-- AI Settings
-- =============================================================================
-- Key-value store for admin-configurable AI settings (model selections,
-- pipeline implementation toggles, etc.). Loaded by aiSettingsService.ts
-- with a 60s in-memory cache.

CREATE TABLE IF NOT EXISTS ai_settings (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE ai_settings IS 'Admin-configurable AI settings: model selections, feature toggles, etc.';
COMMENT ON COLUMN ai_settings.key IS 'Setting key, e.g. model.matching, cv_pipeline_implementation';

-- =============================================================================
-- AI Usage Logging
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_usage_log (
    id SERIAL PRIMARY KEY,
    feature VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    description TEXT,
    api_calls INTEGER DEFAULT 1,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_cost NUMERIC(10,6) DEFAULT 0,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created ON ai_usage_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_feature ON ai_usage_log(feature, model);

COMMENT ON TABLE ai_usage_log IS 'Per-session AI API usage logs for cost tracking and dashboard';

-- =============================================================================
-- AI Learned Rules
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_learned_rules (
    id SERIAL PRIMARY KEY,
    feature VARCHAR(100) NOT NULL,
    rule_text TEXT NOT NULL,
    context TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_learned_rules_feature ON ai_learned_rules(feature);

COMMENT ON TABLE ai_learned_rules IS 'User-provided rules injected into AI prompts to improve future extractions';

-- =============================================================================
-- Schema Complete
-- =============================================================================

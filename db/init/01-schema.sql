-- =============================================================================
-- Track Your Regions - New Gen Database Schema
-- =============================================================================
-- This is the consolidated schema, and the one file the backend's row types
-- are generated from (backend/src/db/schema.generated.ts, ADR-0064).
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

-- No JIT compilation (#994). A plan estimate past jit_above_cost is the
-- planner's guess, and a LATERAL or recursive CTE is priced as though every
-- row ran the whole subquery: the region location feed for Europe was priced
-- at 6.3 million, compiled for about a second and ran in a fifth of one. The
-- setting is the database's, so every client reads it. Migration 057 carries
-- it to a database that already exists.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET jit = off', current_database());
END
$$;

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
-- Schema Migrations (which files in db/migrations/ this database has seen)
-- =============================================================================
-- This file is the canonical schema and is re-applied by hand as it grows; the
-- numbered files in db/migrations/ carry the one-shot changes a database that
-- already holds data cannot get from re-applying it. Which of those a given
-- database has been through is written down here and nowhere else, by
-- scripts/db-migrate.sh and by nothing else (#435, ADR-0041): a database
-- says what it has seen rather than anyone remembering it.
--
-- ran = false records a file asserted to be applied without being executed here
-- (npm run db:baseline) -- how a database older than the ledger states what it
-- already carries, and how a database created from this file states that its
-- backfills have nothing to fix. It is a person's claim rather than an
-- observation, so db:status reports the two apart.
--
-- checksum is the SHA-256 of the file as it stood when it was recorded, so a
-- migration edited afterwards can be told from one that has not moved.

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    checksum   TEXT NOT NULL,
    ran        BOOLEAN NOT NULL DEFAULT TRUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE schema_migrations IS 'One row per file in db/migrations/ that this database has been through. Written by scripts/db-migrate.sh (#435, ADR-0041).';
COMMENT ON COLUMN schema_migrations.checksum IS 'SHA-256 of the migration file as recorded, so a file edited afterwards can be told from one that has not moved.';
COMMENT ON COLUMN schema_migrations.ran IS 'TRUE when this database executed the file; FALSE when a person asserted it was already applied (npm run db:baseline).';

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
    -- [west, south, east, north]; west > east = antimeridian crossing. Written by
    -- trigger_division_focus_data with anchor_point, from geometry_focus() (#674)
    focus_bbox DOUBLE PRECISION[],
    geom_area_km2 DOUBLE PRECISION,
    -- Pre-computed normalized name for accent-insensitive matching (generated)
    name_normalized TEXT GENERATED ALWAYS AS (lower(immutable_unaccent(name::text))) STORED,
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- gadm_uid keeps its provider's name on purpose (#625): it is GADM's own key
-- for the one polygon a leaf was loaded from, written only by GADM's loader
-- (db/init-db.py) and read only by the division-tree check. A base layer from
-- another provider would carry its own key in a column of its own, rather than
-- reuse this one under a neutral name that hides whose key it is.
COMMENT ON COLUMN administrative_divisions.gadm_uid IS 'GADM UID of the single GeoPackage polygon a leaf division was loaded from (db/init-db.py); NULL on a division assembled from its children. Named for GADM on purpose: it is that dataset''s key, not a provider-neutral one.';

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
-- Databases that predate #674 gain the column here; 033-division-focus-data.sql fills it
ALTER TABLE administrative_divisions ADD COLUMN IF NOT EXISTS focus_bbox DOUBLE PRECISION[];

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
--
-- A visit is the traveller's record, and a hierarchy edit is a curator's
-- (#764): deleting a region that carries a visit is refused, whichever of the
-- region writers asks. NO ACTION rather than RESTRICT, because NO ACTION is
-- checked at the end of the statement: deleting a world view, whose visits
-- the admin has seen counted and confirmed, removes them in the same
-- statement as the regions they stand on.

CREATE TABLE IF NOT EXISTS user_visited_regions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE NO ACTION,
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
--
-- NOT the source of regions.anchor_point: update_region_focus_data() owns that column
-- and computes the centre of the frame it also stores in focus_bbox. A point on the
-- surface is a different answer, and for a region crossing the antimeridian a worse
-- one -- it lands inside whichever component ST_PointOnSurface picks, which is where
-- the camera then goes. Nothing calls this today (#666).
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
--
-- The area goes with the geometry it measures. A geometry write that clears
-- geom -- ancestor invalidation (ADR-0035), a member edit -- must clear
-- geom_area_km2 with it, or the column holds the area of an outline that is
-- not there: Europe reading as NULL and 4,095,971 km2 at once, a Catalogue
-- Check reading the area seeing a different world from one reading the
-- geometry (#763). An
-- empty geometry has no area either: geometry_focus() files it as NULL, and
-- so does this.

CREATE OR REPLACE FUNCTION update_region_metadata()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.geom IS NULL OR ST_IsEmpty(NEW.geom) THEN
        NEW.geom_area_km2 := NULL;
        RETURN NEW;
    END IF;

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
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to regions table
CREATE OR REPLACE TRIGGER trigger_region_metadata
    BEFORE INSERT OR UPDATE OF geom ON regions
    FOR EACH ROW
    EXECUTE FUNCTION update_region_metadata();

-- =============================================================================
-- Function: geometry_focus -- where a shape is, in one measurement
-- =============================================================================
-- The one place that decides how a shape is framed: its longitude window, its
-- latitude bounds and the centre of that frame. Both focus triggers call it --
-- regions through update_region_focus_data(), divisions through
-- update_division_focus_data() -- and frontend/src/utils/mapUtils.ts applies
-- the same rule as focusFromGeoJson() to a shape that exists only in the
-- client: a boundary being drawn, a combined selection. Nothing else in the
-- tree decides this; everything else reads focus_bbox (#674).
--
-- The rule. Measure the shape twice: as it stands in [-180, 180], and with
-- negative longitudes carried up by 360. Whichever is tighter is the truth. A
-- shape crossing the antimeridian is compact only in the shifted frame and is
-- returned in the west > east convention; one that is wide either way wraps
-- the world and keeps a full-width box, because no window onto it is a frame.
-- near_global_deg() is where "wide" begins.
--
-- The snap. GADM geometry overshoots the antimeridian by 1e-13 degrees, about
-- 11 nanometres on the ground -- 5 vertices of the Far Eastern Federal
-- District sit at 180.0000000000001, 9 of Fiji's do -- and ST_ShiftLongitude
-- wraps both ways, so it carried those vertices back to -179.9999999999999.
-- The shifted span then came out wider than the unshifted one (370 degrees
-- against 360), both regions were filed as global, and the map framed the
-- whole world with the anchor in the wrong ocean (#666). Snapping to 1e-9
-- degrees (about 0.1 mm) before measuring removes the overshoot; the stored
-- geometry is untouched.
--
-- near_global reports that the plain span exceeds the threshold. The box
-- returned is then either a compact crossing window or the global one, and a
-- parent whose own union is coarser than the boxes beneath it may prefer its
-- children's -- that is the regions trigger's business, since only it can see
-- the regions table.

CREATE OR REPLACE FUNCTION near_global_deg()
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT 350.0::double precision $$;

COMMENT ON FUNCTION near_global_deg() IS 'A longitude span this wide is the whole world however it is measured. Stated once, for geometry_focus() and children_focus_arc(); NEAR_GLOBAL_DEG in frontend/src/utils/mapUtils.ts mirrors it.';

CREATE OR REPLACE FUNCTION geometry_focus(
  g geometry,
  OUT west double precision,
  OUT south double precision,
  OUT east double precision,
  OUT north double precision,
  OUT center_lng double precision,
  OUT center_lat double precision,
  OUT near_global boolean
)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  measure_geom geometry;    -- g snapped, for measurement only
  -- Plain [-180,180] bbox
  norm_west double precision;
  norm_east double precision;
  norm_span double precision;
  -- Shifted [0,360] bbox
  shifted_geom geometry;
  shift_west double precision;
  shift_east double precision;
  shift_span double precision;
BEGIN
  measure_geom := ST_SnapToGrid(g, 1e-9);

  south := ST_YMin(measure_geom);
  north := ST_YMax(measure_geom);
  center_lat := (south + north) / 2;

  norm_west := ST_XMin(measure_geom);
  norm_east := ST_XMax(measure_geom);
  norm_span := norm_east - norm_west;

  shifted_geom := ST_ShiftLongitude(measure_geom);
  shift_west := ST_XMin(shifted_geom);
  shift_east := ST_XMax(shifted_geom);
  shift_span := shift_east - shift_west;

  near_global := norm_span > near_global_deg();

  IF shift_span < norm_span AND shift_span <= near_global_deg() THEN
    -- Compact only in the shifted frame: a crossing window, west > east.
    west := CASE WHEN shift_west > 180 THEN shift_west - 360 ELSE shift_west END;
    east := CASE WHEN shift_east > 180 THEN shift_east - 360 ELSE shift_east END;
    center_lng := (shift_west + shift_east) / 2;
    IF center_lng > 180 THEN center_lng := center_lng - 360; END IF;
  ELSE
    -- Ordinary, or wide either way: the plain box.
    west := norm_west;
    east := norm_east;
    center_lng := (norm_west + norm_east) / 2;
  END IF;
END;
$$;

COMMENT ON FUNCTION geometry_focus(geometry) IS 'The one measurement of where a shape is: [west, south, east, north] with west > east for an antimeridian crossing, the centre of that frame, and whether the plain span is near-global. Both focus triggers call it.';

-- =============================================================================
-- Function: children_focus_arc -- the smallest window round a parent's children
-- =============================================================================
-- A region whose own union spans nearly every longitude -- Oceania, whose
-- members sit either side of the antimeridian -- takes its focus from its
-- children's boxes instead. Combining those boxes is not MIN and MAX: each is an
-- interval on a circle, and the window round a set of intervals on a circle is
-- the complement of the widest gap between them. Taking the least west and the
-- greatest east of the shifted edges read a child crossing Greenwich (west < 0
-- < east, which the shift turns into west + 360 > east) as two unrelated
-- numbers: a parent with Russia [37.54 .. -169.65] and France [-5.1 .. 8.2]
-- beneath it came out as [37.54 .. -5.1], a window ending at France's western
-- edge (#673).
--
-- Each child contributes [start, start + span] with start in [0, 360) and span
-- measured the way its box says -- the short way round for a crossing box.
-- An interval running past 360 is folded back in as [0, end - 360], since the
-- sweep only looks back. Sorted by start, a running maximum of the ends finds
-- every gap the union leaves; the gap between the last end and the first start
-- plus 360 closes the circle. The widest gap is where the window is not; the
-- window starts where that gap ends. No positive gap, or a window wider than
-- near_global_deg(), means the parent is global too (covers_globe), and the
-- caller keeps geometry_focus()'s answer; a child whose own box is global is
-- one such window by construction.

CREATE OR REPLACE FUNCTION children_focus_arc(
  p_region_id integer,
  OUT west double precision,
  OUT south double precision,
  OUT east double precision,
  OUT north double precision,
  OUT center_lng double precision,
  OUT center_lat double precision,
  OUT covers_globe boolean
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  gap_width double precision;
  gap_end double precision;   -- where the widest gap ends: the window starts here, in [0, 360)
  arc_width double precision;
BEGIN
  SELECT
    MIN(c.focus_bbox[2]),
    MAX(c.focus_bbox[4])
  INTO south, north
  FROM regions c
  WHERE c.parent_region_id = p_region_id
    AND c.focus_bbox IS NOT NULL;

  IF south IS NULL THEN
    RETURN;  -- no children with focus data: every OUT stays NULL
  END IF;

  WITH raw AS (
    SELECT
      CASE WHEN c.focus_bbox[1] < 0 THEN c.focus_bbox[1] + 360 ELSE c.focus_bbox[1] END AS s,
      CASE WHEN c.focus_bbox[1] > c.focus_bbox[3]
           THEN c.focus_bbox[3] + 360 - c.focus_bbox[1]
           ELSE c.focus_bbox[3] - c.focus_bbox[1] END AS span
    FROM regions c
    WHERE c.parent_region_id = p_region_id
      AND c.focus_bbox IS NOT NULL
  ),
  intervals AS (
    SELECT s, span FROM raw
    UNION ALL
    -- An interval running past 360 comes back round as [0, e - 360]: a
    -- Greenwich-crossing child starts near 355 and covers the first degrees
    -- of the circle too. Without this row the sweep, which only looks back,
    -- would read a gap there that the child fills.
    SELECT 0, s + span - 360 FROM raw WHERE s + span > 360
  ),
  reached AS (
    SELECT s, s + span AS e,
           MAX(s + span) OVER (ORDER BY s ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS reach_before
    FROM intervals
  ),
  gaps AS (
    SELECT s - reach_before AS width, s AS ends_at FROM reached WHERE reach_before IS NOT NULL
    UNION ALL
    SELECT (MIN(s) + 360) - MAX(e), MIN(s) FROM reached
  )
  SELECT width, ends_at INTO gap_width, gap_end
  FROM gaps
  ORDER BY width DESC
  LIMIT 1;

  -- The arc contains every child, so a child whose own box is global makes
  -- the arc global by construction -- no term of its own is needed for it.
  arc_width := 360 - GREATEST(gap_width, 0);
  covers_globe := gap_width <= 0 OR arc_width > near_global_deg();
  IF covers_globe THEN
    RETURN;  -- no window: the caller keeps geometry_focus()'s answer, latitudes included
  END IF;

  -- Back into [-180, 180]: the arc's end may sit past 360 -- France's western
  -- edge at 354.9 plus a 195-degree window reaches 550 -- so one subtraction
  -- is not enough; wrap by however many turns it takes. The two edges close
  -- the range at opposite ends on purpose. A window that starts on the
  -- antimeridian stores west = -180 and one that ends on it stores east = 180;
  -- either edge landing on the other side of the line would put west > east
  -- and read as a crossing for a box that only touches it.
  west := gap_end - 360 * floor((gap_end + 180) / 360);
  east := (gap_end + arc_width) - 360 * ceil((gap_end + arc_width - 180) / 360);
  center_lng := (gap_end + arc_width / 2) - 360 * ceil((gap_end + arc_width / 2 - 180) / 360);
  center_lat := (south + north) / 2;
END;
$$;

COMMENT ON FUNCTION children_focus_arc(integer) IS 'The smallest longitude window round a region''s children''s focus boxes, as an arc on the circle rather than a MIN/MAX of edges; covers_globe when no window would be a frame.';

-- =============================================================================
-- Trigger: Update focus_bbox and anchor_point when geometry changes
-- =============================================================================
-- The measurement is geometry_focus()'s. What this trigger adds is the one
-- thing that needs the regions table: a parent whose own union spans nearly
-- every longitude may take its box from its children instead.

CREATE OR REPLACE FUNCTION update_region_focus_data()
RETURNS TRIGGER AS $$
DECLARE
  effective_geom geometry;  -- hull or raw geom for bounds calculation
  f record;                 -- geometry_focus() of it
  ch record;                -- children_focus_arc() of NEW.id, for a near-global parent
  -- Final values
  final_west double precision;
  final_east double precision;
  min_lat double precision;
  max_lat double precision;
  center_lng double precision;
  center_lat double precision;
BEGIN
  -- Use hull for hull regions, otherwise raw geometry
  effective_geom := COALESCE(NEW.hull_geom, NEW.geom);

  IF effective_geom IS NULL THEN
    NEW.anchor_point := NULL;
    NEW.focus_bbox := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO f FROM geometry_focus(effective_geom);
  final_west := f.west;
  final_east := f.east;
  min_lat := f.south;
  max_lat := f.north;
  center_lng := f.center_lng;
  center_lat := f.center_lat;

  IF f.near_global THEN
    -- Near-full-globe span in [-180,180]: either the geometry reaches both
    -- sides of the antimeridian, or it really does wrap the world.
    -- geometry_focus() has told them apart already -- but children have a
    -- tighter answer first, which they do for a parent whose own union is
    -- coarser than the boxes underneath it (Oceania). children_focus_arc()
    -- finds the window round them as an arc on the circle, and says
    -- covers_globe where no window would be a frame: a child whose own box is
    -- global, or children that between them leave no gap. That is how
    -- Antarctica's continent row once claimed a 347-degree window with a
    -- 13-degree gap over Queen Maud Land, and how a parent with Russia and
    -- France beneath it came out ending at France's western edge (#673).
    SELECT * INTO ch FROM children_focus_arc(NEW.id);

    IF ch.west IS NOT NULL AND NOT ch.covers_globe THEN
      -- Use the children's window
      final_west := ch.west;
      final_east := ch.east;
      center_lng := ch.center_lng;
      center_lat := ch.center_lat;
      min_lat := ch.south;
      max_lat := ch.north;
    END IF;
    -- Otherwise geometry_focus() already answered: a compact crossing window
    -- (the Far Eastern Federal District, Fiji, Russia) or, wide either way,
    -- the global box.
  END IF;

  -- Store bbox as [west, south, east, north]
  NEW.focus_bbox := ARRAY[final_west, min_lat, final_east, max_lat];
  NEW.anchor_point := ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_update_region_focus_data
  BEFORE INSERT OR UPDATE OF geom, hull_geom ON regions
  FOR EACH ROW
  EXECUTE FUNCTION update_region_focus_data();

COMMENT ON FUNCTION update_region_focus_data() IS 'Trigger function to auto-update anchor_point and focus_bbox when region geometry changes.';

-- =============================================================================
-- Trigger: A region that gains a geometry leaves its parent describing less
-- =============================================================================
-- A region's outline is the union of its children and of its own member
-- divisions, so whatever writes regions.geom leaves every derived ancestor
-- covering a smaller world than it contains. Those ancestors are nulled rather
-- than recomputed on the spot -- recomputing Asia is a hundred seconds of union
-- and a curator computing one oblast should not wait for it -- and the next
-- world-view run rebuilds them bottom-up, its closure being every derived
-- region with no geometry and every derived ancestor of one. Catalogue Checks
-- reports the gap meanwhile: loud and absent beats quiet and wrong (#667).
--
-- The rule lives here rather than at each writer because there is no count of
-- writers to keep correct: a rule spelled at each writer is one a new writer
-- can skip, and a write that skips it consumes the NULL its own convergence
-- depends on while the run goes on reporting Complete (#679). Here it runs inside the writing
-- statement, so no writer can bypass it and it cannot fail separately from the
-- write it belongs to. ADR-0035; the same reasoning that keeps the antimeridian
-- rule in geometry_focus() rather than in each reader (#674).
--
-- Only the immediate parent, because the walk upward IS the cascade: nulling
-- the parent is itself an UPDATE OF geom that changes the value, so this fires
-- again for the grandparent. It stops where the hand-written walk stopped:
--
--   * at a hand-drawn boundary -- is_custom_boundary IS NOT TRUE writes no row,
--     so nothing fires above it. Its outline is drawn rather than unioned, so a
--     descendant gaining geometry cannot have moved it, and nothing over it is
--     stale either. The same stop loadGroupsToCompute() makes on both arms of
--     its closure (#283);
--   * at an ancestor that is already NULL -- geom IS NOT NULL writes no row.
--     That is also what makes a cycle in parent_region_id terminate, where the
--     recursive CTE this replaces would not.
--
-- Four columns, because a cleared geom does not clear its own derivatives:
-- trg_regions_geom_3857 only recomputes them from a geometry that is there.
-- The two cheap rungs do follow on their own -- that trigger sees
-- geom_simplified_low go to NULL (low_changed) and clears geom_overview and
-- geom_simplified_coarse with it.
--
-- Locks are taken strictly upward, child before parent before grandparent, so
-- two concurrent computes under one parent queue rather than deadlock.

CREATE OR REPLACE FUNCTION invalidate_parent_region_geometry() RETURNS TRIGGER AS $$
BEGIN
  UPDATE regions
  SET geom = NULL,
      geom_3857 = NULL,
      geom_simplified_low = NULL,
      geom_simplified_medium = NULL
  WHERE id = NEW.parent_region_id
    AND is_custom_boundary IS NOT TRUE
    AND geom IS NOT NULL;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION invalidate_parent_region_geometry() IS 'Trigger function: a write to regions.geom marks the derived ancestors above it stale, one level per firing (ADR-0035).';

-- Two triggers on one function rather than AFTER INSERT OR UPDATE OF geom: OLD
-- is not available in an INSERT trigger's WHEN clause, so the two conditions
-- cannot be one expression -- and an unconditional INSERT arm would call the
-- function for every row of an import, thousands of times, to do nothing.

-- IS DISTINCT FROM on geometry is exact equality in PostGIS, not a bounding-box
-- test (verified on 3.5.6): a collinear redraw of the same outline reads as a
-- change and an identical geometry does not. So this is a real change test,
-- and a write that changes nothing invalidates nothing.
CREATE OR REPLACE TRIGGER trg_regions_geom_invalidates_parent
  AFTER UPDATE OF geom ON regions
  FOR EACH ROW
  WHEN (OLD.geom IS DISTINCT FROM NEW.geom)
  EXECUTE FUNCTION invalidate_parent_region_geometry();

-- A region born with a drawn shape -- createRegion from the create-from-staged
-- and single-division custom dialogs. It has geometry from the moment it
-- exists, so it never seeds the run's closure, and its parent already had one,
-- so neither does that. A region born without geometry seeds the closure by
-- itself and needs nothing here.
CREATE OR REPLACE TRIGGER trg_regions_geom_insert_invalidates_parent
  AFTER INSERT ON regions
  FOR EACH ROW
  WHEN (NEW.geom IS NOT NULL)
  EXECUTE FUNCTION invalidate_parent_region_geometry();

-- A member change is a geometry change of its region (ADR-0068). A region's
-- outline is the union of its children and of its own members, so a write to
-- region_members makes that region's stored geom stale exactly as moving a
-- child does. Nulling it here -- in the statement that changed the member --
-- lets the trigger above carry the news to the ancestors, and leaves no writer
-- to remember a call: the import review had a dozen that did not (#718).
--
-- Statement-level, with transition tables, so a bulk write (an import's match,
-- a re-match of a world view) nulls each touched region once rather than once
-- per row. A drawn boundary is not derived from its members and is left as
-- drawn; a region with no geometry yet has nothing to clear.
CREATE OR REPLACE FUNCTION invalidate_member_regions_geometry() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE regions r
    SET geom = NULL, geom_3857 = NULL, geom_simplified_low = NULL, geom_simplified_medium = NULL
    WHERE r.id IN (SELECT region_id FROM new_members)
      AND r.is_custom_boundary IS NOT TRUE AND r.geom IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE regions r
    SET geom = NULL, geom_3857 = NULL, geom_simplified_low = NULL, geom_simplified_medium = NULL
    WHERE r.id IN (SELECT region_id FROM old_members)
      AND r.is_custom_boundary IS NOT TRUE AND r.geom IS NOT NULL;
  ELSE
    -- Only what changes the union: the row's region, its division or its cut.
    -- A renamed part (custom_name) draws the same outline.
    UPDATE regions r
    SET geom = NULL, geom_3857 = NULL, geom_simplified_low = NULL, geom_simplified_medium = NULL
    WHERE r.id IN (
        SELECT o.region_id FROM old_members o JOIN new_members n ON n.id = o.id
         WHERE o.region_id IS DISTINCT FROM n.region_id
            OR o.division_id IS DISTINCT FROM n.division_id
            OR o.custom_geom IS DISTINCT FROM n.custom_geom
        UNION
        SELECT n.region_id FROM old_members o JOIN new_members n ON n.id = o.id
         WHERE o.region_id IS DISTINCT FROM n.region_id
            OR o.division_id IS DISTINCT FROM n.division_id
            OR o.custom_geom IS DISTINCT FROM n.custom_geom
      )
      AND r.is_custom_boundary IS NOT TRUE AND r.geom IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION invalidate_member_regions_geometry() IS 'Trigger function: a write to region_members marks the regions whose union it changed stale, and the geom trigger carries it to their ancestors (ADR-0068).';

-- Three triggers on one function: a statement trigger with transition tables
-- takes one event, and an UPDATE one cannot take a column list, which is why
-- the UPDATE arm compares the rows itself.
CREATE OR REPLACE TRIGGER trg_region_members_insert_invalidates_region
  AFTER INSERT ON region_members
  REFERENCING NEW TABLE AS new_members
  FOR EACH STATEMENT
  EXECUTE FUNCTION invalidate_member_regions_geometry();

CREATE OR REPLACE TRIGGER trg_region_members_delete_invalidates_region
  AFTER DELETE ON region_members
  REFERENCING OLD TABLE AS old_members
  FOR EACH STATEMENT
  EXECUTE FUNCTION invalidate_member_regions_geometry();

CREATE OR REPLACE TRIGGER trg_region_members_update_invalidates_region
  AFTER UPDATE ON region_members
  REFERENCING OLD TABLE AS old_members NEW TABLE AS new_members
  FOR EACH STATEMENT
  EXECUTE FUNCTION invalidate_member_regions_geometry();

-- =============================================================================
-- Table + Trigger: a leaf region's geometry, cut into pieces for placement
-- =============================================================================
-- Placement asks which regions hold a point (regionAssignmentService.ts), and
-- asked of a region's whole geometry, one test reads all of it. A bounding box
-- narrows that only where the box is small: Russia's parts reach both sides of
-- the antimeridian, so the boxes of Russia and of Asia -- 7.1 million vertices --
-- span every longitude, and a point in Paris was tested against both. The first
-- run of the Places of worship source spent 25 minutes placing its 1078 points
-- that way (#851).
--
-- A row here is one piece of a leaf's geometry, cut by ST_Subdivide to at most
-- 256 vertices and indexed on its own, so a point meets the one or two small
-- pieces whose boxes hold it. Leaves only: placement tests the leaves first,
-- takes every ancestor's row from the tree, and asks the other regions only
-- about the points no leaf holds (ADR-0054). Cutting a continent as well would
-- add minutes to every write of its union, for a pass that reaches a few
-- hundred points.
--
-- Kept by the statement that writes the geometry, for ADR-0035's reason: a copy
-- each writer has to remember is a copy some writer forgets. The pieces exist to
-- test containment and are never drawn. ADR-0031 turned down storing a
-- subdivided geometry for tiles, where the cuts would be drawn as borders, and
-- that stands; Martin publishes no table.

CREATE TABLE IF NOT EXISTS region_geom_pieces (
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    geom GEOMETRY(MultiPolygon, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_region_geom_pieces_geom ON region_geom_pieces USING GIST(geom);
-- The refresh below and the cascade from regions both find a region's pieces by it.
CREATE INDEX IF NOT EXISTS idx_region_geom_pieces_region ON region_geom_pieces(region_id);

COMMENT ON TABLE region_geom_pieces IS 'A leaf region''s geometry cut into pieces of at most 256 vertices, for testing which leaf holds a point. Kept by trg_regions_geom_pieces; never drawn (ADR-0054).';

-- Cuts one region's geometry into pieces, if the region is a leaf with a
-- geometry. The one spelling of the cut: the trigger below and the backfill in
-- migration 054 both call it.
--
-- It reads the row rather than taking a geometry, because by the time a trigger
-- runs its NEW can be older than the row: trg_update_is_leaf flips a parent's
-- is_leaf and the invalidation above nulls a parent's geometry, both inside the
-- statement that fired it. An empty geometry cuts into no pieces.
CREATE OR REPLACE FUNCTION cut_region_geom_pieces(p_region_id INTEGER) RETURNS INTEGER AS $$
DECLARE
  cut INTEGER;
BEGIN
  INSERT INTO region_geom_pieces (region_id, geom)
  SELECT r.id, ST_Multi(piece)
  FROM regions r
  CROSS JOIN LATERAL ST_Subdivide(r.geom, 256) AS piece
  WHERE r.id = p_region_id
    AND r.is_leaf
    AND r.geom IS NOT NULL;
  GET DIAGNOSTICS cut = ROW_COUNT;
  RETURN cut;
END;
$$ LANGUAGE plpgsql;

-- Replaces a region's pieces with the cut of the geometry it holds now, on every
-- write of that geometry.
--
-- On a geometry write only, not when is_leaf changes. A structural edit that
-- leaves a parent without children -- deleting or moving its last child, pruning
-- an import tree -- makes it a leaf, and the handler then nulls its geometry for
-- the next run to recompute: cutting the old outline in between would spend up
-- to a minute inside the request on pieces the next statement throws away. So
-- the pieces a region has are always those of its current geometry, and a leaf
-- may have none, which placement reads as "test the whole geometry": its first
-- pass joins is_leaf, and its second takes every region that is not a leaf with
-- pieces.
--
-- A cut that fails leaves the region without pieces and says so, rather than
-- failing the geometry write it rides on: the pieces make placement fast, not
-- right, and a region without them is still placed into. The delete stays
-- outside the handled block, so a failed cut cannot leave the previous
-- geometry's pieces behind.
CREATE OR REPLACE FUNCTION refresh_region_geom_pieces() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM region_geom_pieces WHERE region_id = NEW.id;
  BEGIN
    PERFORM cut_region_geom_pieces(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'region % keeps no pieces for placement: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_region_geom_pieces() IS 'Trigger function: a write to regions.geom replaces that region''s pieces with the cut of its current geometry, if it is a leaf (ADR-0054).';

-- Two arms on one function, for the reason the invalidation has two: OLD is not
-- available in an INSERT trigger's WHEN clause. Named under trg_regions_geom, so
-- the guard that no bulk load switches those off holds for these as well -- a
-- load without them would leave pieces of geometries that are no longer there,
-- and a point tested against a stale piece is placed wrongly, not slowly.
CREATE OR REPLACE TRIGGER trg_regions_geom_pieces
  AFTER UPDATE OF geom ON regions
  FOR EACH ROW
  WHEN (OLD.geom IS DISTINCT FROM NEW.geom)
  EXECUTE FUNCTION refresh_region_geom_pieces();

CREATE OR REPLACE TRIGGER trg_regions_geom_insert_pieces
  AFTER INSERT ON regions
  FOR EACH ROW
  WHEN (NEW.geom IS NOT NULL)
  EXECUTE FUNCTION refresh_region_geom_pieces();

-- =============================================================================
-- Trigger: Update a division's focus_bbox and anchor_point when its geometry changes
-- =============================================================================
-- The same measurement regions get, stored once so a read is a column read: a
-- division used to have focus data nowhere, and framing one meant downloading
-- its full geometry to measure it in the browser -- 775 000 vertices for the
-- Far Eastern Federal District, on every click (#674).
--
-- No children aggregation here. It exists for a region whose own union spans
-- nearly every longitude while the boxes beneath it are tighter; after the snap
-- Russia and Oceania measure compact on their own, and the only divisions that
-- are wide either way are the two Antarctica rows, which wrap the pole and are
-- global in truth. 033-division-focus-data.sql lists what comes out global so a
-- database can check that claim against its own rows.
--
-- Disabled during the bulk GADM load, like the two geometry triggers beside it:
-- init-db.py computes the columns in one pass afterwards (step 4 of its derived
-- columns). precalculate-geometries.py writes parent geometry with triggers on,
-- so parents get theirs per row.

CREATE OR REPLACE FUNCTION update_division_focus_data()
RETURNS TRIGGER AS $$
DECLARE
  f record;
BEGIN
  IF NEW.geom IS NULL THEN
    NEW.anchor_point := NULL;
    NEW.focus_bbox := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO f FROM geometry_focus(NEW.geom);
  NEW.focus_bbox := ARRAY[f.west, f.south, f.east, f.north];
  NEW.anchor_point := ST_SetSRID(ST_MakePoint(f.center_lng, f.center_lat), 4326);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_division_focus_data
  BEFORE INSERT OR UPDATE OF geom ON administrative_divisions
  FOR EACH ROW
  EXECUTE FUNCTION update_division_focus_data();

COMMENT ON FUNCTION update_division_focus_data() IS 'Trigger function to auto-update a division''s anchor_point and focus_bbox from geometry_focus() when its geometry changes.';

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

-- Simplified geometry at 5 km. Not the rung a tile function reaches for —
-- the coarse rung below covers zoom 3-4 — but still the arm
-- the ladder falls through to at zoom 0-4 when a cheap rung is NULL, still the
-- input both cheap rungs are derived from, and its 4326 twin on
-- administrative_divisions is what the GeoJSON API answers with.
-- For uses_hull regions, these derive from hull (correct overview representation)
ALTER TABLE regions ADD COLUMN IF NOT EXISTS geom_simplified_low geometry(MultiPolygon, 3857);
-- Add simplified geometry columns for medium zoom levels (zoom 5-8)
ALTER TABLE regions ADD COLUMN IF NOT EXISTS geom_simplified_medium geometry(MultiPolygon, 3857);

-- Coarse rung, zoom 3-4: 10 km of tolerance and a 100 km^2 floor under the
-- parts, which is one screen pixel at zoom 3. The rung the ladder was missing:
-- geom_overview is eight times coarser than zoom 3 can show, while the 5 km rung
-- that used to serve these zooms carried three quarters of a million vertices
-- across the administrative mirror and made a zoom-3 tile cost 483 ms (#551).
-- Same NULL contract as geom_overview: not computed, fall through to the 5 km rung.
ALTER TABLE regions ADD COLUMN IF NOT EXISTS geom_simplified_coarse geometry(MultiPolygon, 3857);

-- Overview zoom levels (0-2), where a screen pixel is 78 km down to 19.6 km wide
-- and `geom_simplified_low` carries far more detail than that scale can
-- represent. 50 km of tolerance, with the 2,500 km^2 floor that follows from it.
-- NULL means "not computed": callers fall through to the low rung, so an
-- un-backfilled database renders as it always did. See simplify_for_overview()
-- and drop_small_parts().
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
--
-- Unlike regions, every 3857 rung on this table is simplified per row — the
-- coverage pass this table has (simplify_coverage_siblings) works on the 4326
-- columns the GeoJSON API reads, and nothing has ever made the rendered columns
-- gap-free. Two neighbouring divisions can therefore diverge by up to twice the
-- tolerance along a shared border. Tracked as part of #560.
ALTER TABLE administrative_divisions ADD COLUMN IF NOT EXISTS geom_overview_3857 geometry(MultiPolygon, 3857);
-- Coarse rung, zoom 3-4, same parameters as regions.geom_simplified_coarse.
ALTER TABLE administrative_divisions ADD COLUMN IF NOT EXISTS geom_simplified_coarse_3857 geometry(MultiPolygon, 3857);
ALTER TABLE administrative_divisions ADD COLUMN IF NOT EXISTS geom_simplified_medium_3857 geometry(MultiPolygon, 3857);

-- Helper function: drop the parts of a MultiPolygon too small to be seen.
--
-- The weight of an overview rung is not in the detail of its outlines, it is in
-- the number of rings it carries: no simplification this pipeline uses deletes a
-- ring, so they bottom out at roughly four points per ring no matter the
-- tolerance. (Plain ST_SimplifyVW did delete one, which is a defect rather than
-- a saving and went with ADR-0036 -- see simplify_for_zoom below.) Europe's root region holds 84,217
-- points and still holds 49,942 after Douglas-Peucker at 50 km, because it is
-- some twelve thousand pieces. Dropping the pieces is the only thing that makes
-- an overview rung cheap.
--
-- The floor is measured in SRID 3857 area on purpose. Web Mercator inflates area
-- away from the equator by the same factor it inflates everything else on the
-- screen, so a fixed 3857 area IS a fixed number of pixels at a given zoom —
-- which is the question being asked: can a reader see this piece at all.
--
-- The largest part is kept unconditionally, so a region that IS an archipelago
-- (Aland, the Aegean islands, Nauru) never simplifies away to nothing. That is
-- the surviving half of rule 12: geometry is never annihilated, but a speck a
-- reader cannot see is no longer carried up the ladder. See ADR-0031.
CREATE OR REPLACE FUNCTION drop_small_parts(
    geom geometry,
    min_part_area double precision
) RETURNS geometry AS $$
    SELECT CASE WHEN $1 IS NULL THEN NULL ELSE (
        SELECT validate_multipolygon(ST_Collect(part.geom))
        FROM (
            SELECT d.geom AS geom,
                   ST_Area(d.geom) AS part_area,
                   row_number() OVER (ORDER BY ST_Area(d.geom) DESC) AS size_rank
            FROM ST_Dump($1) d
        ) part
        WHERE part.size_rank = 1 OR part.part_area >= $2
    ) END;
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

COMMENT ON FUNCTION drop_small_parts IS 'Keeps the parts of a MultiPolygon at or above min_part_area (SRID 3857 area = screen area), plus the largest part unconditionally';

-- Helper function: reduce geometry to what an overview-zoom tile can actually show.
--
-- Two things happen, and the order matters. The parts below the floor go first,
-- because they are the cost (see drop_small_parts above). Only then are the
-- outlines simplified, with the topology-preserving variant: what is left is
-- what a reader looks for on the map, and it must not be annihilated.
--
-- The floor is the tolerance squared — the area of a tolerance-sized square, so
-- one knob sets the rung's scale for both outlines and pieces. The two are
-- different kinds of number, deliberately: ST_SimplifyPreserveTopology takes a
-- distance, and the part floor takes the area a piece of that size covers on
-- the screen.
--
-- Both cheap rungs come from here. geom_simplified_coarse is called at one
-- screen pixel of the finest zoom it serves — 10 km against the 9,784 m zoom 3
-- draws to the pixel, so its 100 km^2 floor is 1.05 square pixels there.
-- geom_overview keeps the 50 km it has always had instead, which is 2.5 pixels
-- at zoom 2 and a floor of 6.5 square pixels: coarser than the pixel rule, and
-- deliberately so, because sizing it by that rule costs 898 ms for the world
-- tile of the administrative mirror against 626 ms.
--
-- One rung cannot do both jobs — measured, a single 10 km rung stretched down to
-- zoom 0 turns that same tile from 217 ms into 1,494 ms and its payload from
-- 158 kB into 428 kB, for detail eight times finer than that zoom can draw.
--
-- Per-row simplification cannot keep a border shared: two neighbours simplified
-- independently diverge by up to twice the tolerance, and at this tolerance that
-- is a visible white sliver between them. simplify_coverage_regions() runs the
-- same reduction over a whole sibling set with ST_CoverageSimplify and overwrites
-- what this function wrote, exactly as it already does for the low and medium
-- rungs (rule 15). What survives from here is what falls outside a sibling set:
-- a world view's root regions, which have siblings but no parent for the pass to
-- be keyed on, and every row of administrative_divisions. See ADR-0031 decision 3.
--
-- NULL in, NULL out — and NULL in the column means "not computed", which is what
-- lets callers fall through to geom_simplified_low on a database that has not run
-- the backfill.
CREATE OR REPLACE FUNCTION simplify_for_overview(
    geom geometry,
    tolerance double precision DEFAULT 50000
) RETURNS geometry AS $$
DECLARE
    floored geometry;
BEGIN
    IF geom IS NULL THEN
        RETURN NULL;
    END IF;

    floored := drop_small_parts(geom, tolerance * tolerance);

    IF floored IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN validate_multipolygon(ST_SimplifyPreserveTopology(floored, tolerance));
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- Helper function: reduce a row's outlines to a display rung, without changing
-- what the shape is made of.
--
-- ST_CoverageSimplify is topology-preserving Visvalingam-Whyatt (GEOS
-- TPVWSimplifier) -- rule 13's algorithm, carrying the guarantee ST_SimplifyVW
-- does not. VW moves every ring on its own, so a simplified outline crosses
-- itself and two parts that were disjoint come to overlap. The ST_MakeValid that
-- every geometry write ends with then resolves the overlap the only way it can:
-- by carving it out as an interior ring. That is where the holes on the map came
-- from. Australia's continent row carried 328 of them at the 1 km rung against
-- the single lake its full-resolution geometry holds, and the rung a visitor
-- reads over north-eastern Thailand drew 66 where the data has 8 (#685).
--
-- The parts of a valid MultiPolygon are a coverage by construction -- disjoint
-- polygons -- so the row goes through the pass as one element, the way
-- simplify_coverage_regions() puts a whole sibling set through it (rule 15).
-- What that function makes shared between two rows, this makes consistent within
-- one, and neither can do the other's job. Measured over the eight root regions
-- of the Administrative world view, which hold 610 interior rings between them:
-- the 1 km rung carried 1,933 and the 5 km rung 7,057, and both come back with
-- 610 -- for 1.1 % and 2.1 % fewer vertices rather than more. See ADR-0036.
--
-- Nothing is annihilated, which is what the two fallback stages the VW version
-- carried existed for. Measured on PostGIS 3.5.6 / GEOS 3.14.1, coverage
-- simplification drops neither a part nor a hole: a 100 m speck 50 km from a
-- square and a 200 m lake inside it both survive a 5 km pass, and all 26,151 of
-- Asia's pieces survive both rungs. VW did not -- it dropped 436 of them at the
-- 1 km rung on the vertex floor below, against rule 12. docker-compose.yml pins
-- postgis/postgis:17-3.5-alpine, which floats GEOS, so the day that stops being
-- true is caught by the catalogue check rung-unlike-its-source rather than by
-- this comment. The last resort below stays for the same reason: a rung that
-- came back empty keeps the unsimplified shape rather than nothing.
--
-- The tolerance is now passed as the distance it is. ST_SimplifyVW reads an area
-- and was handed the square; ST_CoverageSimplify reads a distance and squares it
-- itself for the same Visvalingam-Whyatt criterion, so the rung keeps its scale
-- rather than becoming a thousand times finer -- 243,877 points for Asia at the
-- 1 km rung against VW's 247,651.
--
-- min_area and smooth_iterations are passed as 0 by every caller. They stay in
-- the signature because narrowing it would leave the four-argument function
-- behind on every database that already holds it, beside the new one.
CREATE OR REPLACE FUNCTION simplify_for_zoom(
    geom geometry,
    tolerance double precision,
    min_area double precision,
    smooth_iterations integer DEFAULT 0
) RETURNS geometry AS $$
DECLARE
    result geometry;
BEGIN
    IF geom IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT validate_multipolygon(ST_Collect(part.geom))
    INTO result
    FROM (
        SELECT (ST_Dump(pass.simplified)).geom
        FROM (
            SELECT ST_CoverageSimplify(src.g, tolerance) OVER () AS simplified
            FROM (SELECT geom AS g) AS src
        ) AS pass
    ) AS part
    WHERE ST_Area(part.geom) >= min_area
      AND ST_NPoints(part.geom) >= 4;

    -- Only a floor can empty this now, and no caller passes one. Keep the
    -- unsimplified shape rather than annihilate the row (rule 12).
    IF result IS NULL OR ST_IsEmpty(result) THEN
        result := geom;
    END IF;

    IF smooth_iterations > 0 THEN
        result := ST_ChaikinSmoothing(result, smooth_iterations);
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

COMMENT ON FUNCTION simplify_for_zoom IS 'Simplifies a row''s outlines with ST_CoverageSimplify, so a rung carries the interior rings its source has and no others (ADR-0036)';

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
    -- Not parameters: the signature is what every caller passes today (the
    -- parent id alone), and widening it would leave an overload behind on every
    -- database that already holds the three-argument version — with both
    -- reachable, a one-argument call stops resolving at all.
    tolerance_overview constant double precision := 50000;
    tolerance_coarse constant double precision := 10000;
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

    -- The two cheap rungs, gap-free, from the low rung the two statements above
    -- have just made coverage-clean. They run last, because the low write fires
    -- the trigger that recomputes both per row, and these are the values that
    -- have to survive: at these tolerances a per-row border and its neighbour
    -- diverge by up to twice the tolerance, which is a white sliver wide enough
    -- to see — measured around the Alps at zoom 5, and across all of Scandinavia
    -- at zoom 2 before this pass existed.
    --
    -- The floor goes on before the coverage pass, not after: dropping a piece
    -- cannot open a gap along a shared border (a speck has no neighbour to share
    -- one with), while simplifying first would pay for every speck it is about
    -- to throw away.
    UPDATE regions r
    SET geom_overview = sub.overview,
        geom_simplified_coarse = sub.coarse
    FROM (
        SELECT id,
            validate_multipolygon(
                ST_CoverageSimplify(
                    drop_small_parts(geom_simplified_low, tolerance_overview * tolerance_overview),
                    tolerance_overview
                ) OVER ()
            ) AS overview,
            validate_multipolygon(
                ST_CoverageSimplify(
                    drop_small_parts(geom_simplified_low, tolerance_coarse * tolerance_coarse),
                    tolerance_coarse
                ) OVER ()
            ) AS coarse
        FROM regions
        WHERE parent_region_id = p_parent_region_id
          AND geom_simplified_low IS NOT NULL
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
    hull_flag_changed boolean;
    low_changed boolean;
BEGIN
    geom_changed := (TG_OP = 'INSERT' AND NEW.geom IS NOT NULL)
                    OR (TG_OP = 'UPDATE' AND NEW.geom IS DISTINCT FROM OLD.geom);
    hull_changed := (TG_OP = 'INSERT' AND NEW.hull_geom IS NOT NULL)
                    OR (TG_OP = 'UPDATE' AND NEW.hull_geom IS DISTINCT FROM OLD.hull_geom);

    -- Read before the block below writes it: simplify_coverage_regions() sets
    -- geom_simplified_low directly, touching neither geom nor hull_geom, so
    -- nothing else here would notice. The tile functions read the precomputed
    -- overview rather than simplifying that column per request, so the
    -- overview has to follow it. Computed up here rather than after
    -- the write, or the trigger would see its own assignment and recompute the
    -- overview a second time on every ordinary geometry change.
    low_changed := (TG_OP = 'UPDATE'
                    AND NEW.geom_simplified_low IS DISTINCT FROM OLD.geom_simplified_low);

    -- uses_hull chooses which shape the four rungs below are made from, so
    -- flipping it changes them without touching a geometry. It is documented as
    -- manually editable (rule 17) and updateRegion writes it on its own, so
    -- without this a region toggled to hull display keeps rungs traced from its
    -- real outline while the island tile source switches to the hull at once --
    -- two layers drawing two different shapes for one region. The writer owns
    -- its invalidation and the writer here is the database (ADR-0035).
    hull_flag_changed := (TG_OP = 'UPDATE'
                          AND NEW.uses_hull IS DISTINCT FROM OLD.uses_hull);

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
    IF geom_changed OR hull_changed OR hull_flag_changed THEN
        effective_geom := CASE WHEN NEW.uses_hull THEN COALESCE(NEW.hull_geom_3857, NEW.geom_3857) ELSE NEW.geom_3857 END;
        IF effective_geom IS NOT NULL THEN
            NEW.geom_simplified_low := simplify_for_zoom(effective_geom, 5000, 0, 0);
            NEW.geom_simplified_medium := simplify_for_zoom(effective_geom, 1000, 0, 0);
            -- Derived from the low rung rather than effective_geom: it is the
            -- input the tile functions simplified before, so the overview keeps
            -- the same hull-aware shape, and starting from 5 km of detail is
            -- cheaper than starting from full.
            NEW.geom_overview := simplify_for_overview(NEW.geom_simplified_low, 50000);
            NEW.geom_simplified_coarse := simplify_for_overview(NEW.geom_simplified_low, 10000);
        END IF;
    END IF;

    -- No NULL guard: simplify_for_overview(NULL) returns NULL, which is what a
    -- cleared low rung has to leave behind. Skipping the write instead would
    -- keep the previous shape and go on serving it at zoom 0-4.
    IF low_changed THEN
        NEW.geom_overview := simplify_for_overview(NEW.geom_simplified_low, 50000);
        NEW.geom_simplified_coarse := simplify_for_overview(NEW.geom_simplified_low, 10000);
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
        NEW.geom_overview_3857 := simplify_for_overview(NEW.geom_simplified_low_3857, 50000);
        NEW.geom_simplified_coarse_3857 := simplify_for_overview(NEW.geom_simplified_low_3857, 10000);
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

-- A write that changes what a tile draws changes the URL that tile is fetched
-- from (ADR-0075, #688). Martin caches a tile by its URL, and the web puts the
-- world view's tile_version on every one as _v, so a region written without a
-- bump is drawn as it was, from the cache, at cache speed. The tile functions
-- read a region's name, color, parent, world view, uses_hull, is_leaf and
-- every geometry rung, and whether it has a child; so the bump belongs to the
-- table, where no writer can leave it out, as ADR-0035 and ADR-0068 settled
-- for the invalidations.
--
-- The triggers are deferred to the commit. The world_views row is then locked
-- last and held only until the commit, so two transactions that write regions
-- of one world view never wait on each other for it while each holds a region
-- the other needs. They bump once per transaction per world view: the ids
-- already bumped are kept in a transaction-local setting. A constraint trigger
-- cannot be created OR REPLACE, so each is dropped first.
CREATE OR REPLACE FUNCTION bump_region_tile_version()
RETURNS TRIGGER AS $$
DECLARE
    bumped text := COALESCE(current_setting('tyr.tile_version_bumped', true), '');
    world_view integer;
BEGIN
    FOREACH world_view IN ARRAY ARRAY[
        CASE WHEN TG_OP <> 'INSERT' THEN OLD.world_view_id END,
        CASE WHEN TG_OP <> 'DELETE' THEN NEW.world_view_id END
    ] LOOP
        CONTINUE WHEN world_view IS NULL OR position(',' || world_view || ',' IN bumped) > 0;
        UPDATE world_views SET tile_version = COALESCE(tile_version, 0) + 1 WHERE id = world_view;
        bumped := CASE WHEN bumped = '' THEN ',' ELSE bumped END || world_view || ',';
        PERFORM set_config('tyr.tile_version_bumped', bumped, true);
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- A region that appears or goes changes its own tiles and its parent's
-- has_subregions.
DROP TRIGGER IF EXISTS trg_regions_tile_version_rows ON regions;
CREATE CONSTRAINT TRIGGER trg_regions_tile_version_rows
    AFTER INSERT OR DELETE ON regions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION bump_region_tile_version();

-- A statement that sets a geometry column is taken to change it. Comparing
-- the old and new value would detoast both, and a root region's outline is
-- tens of megabytes; the writes that set one unchanged (the focus refresh's
-- hull_geom = hull_geom) bump once more than they need to.
DROP TRIGGER IF EXISTS trg_regions_tile_version_geometry ON regions;
CREATE CONSTRAINT TRIGGER trg_regions_tile_version_geometry
    AFTER UPDATE OF geom, hull_geom, geom_3857, hull_geom_3857,
        geom_simplified_low, geom_simplified_medium, geom_simplified_coarse, geom_overview,
        geom_simplified_low_real, geom_simplified_medium_real
    ON regions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION bump_region_tile_version();

-- The drawn attributes are compared, so a form saved unchanged, or a
-- find-or-create that lands on its conflict arm, busts no URL.
DROP TRIGGER IF EXISTS trg_regions_tile_version_attributes ON regions;
CREATE CONSTRAINT TRIGGER trg_regions_tile_version_attributes
    AFTER UPDATE OF name, color, parent_region_id, world_view_id, uses_hull, is_leaf ON regions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    WHEN (OLD.name IS DISTINCT FROM NEW.name
        OR OLD.color IS DISTINCT FROM NEW.color
        OR OLD.parent_region_id IS DISTINCT FROM NEW.parent_region_id
        OR OLD.world_view_id IS DISTINCT FROM NEW.world_view_id
        OR OLD.uses_hull IS DISTINCT FROM NEW.uses_hull
        OR OLD.is_leaf IS DISTINCT FROM NEW.is_leaf)
    EXECUTE FUNCTION bump_region_tile_version();
COMMENT ON COLUMN regions.hull_geom_3857 IS 'Pre-computed hull in SRID 3857 for fast MVT generation';
COMMENT ON COLUMN administrative_divisions.geom_3857 IS 'Pre-computed geometry in SRID 3857 for fast MVT generation';

-- =============================================================================
-- Martin Vector Tile Functions
-- =============================================================================
-- These functions generate MVT tiles for the RegionMap component.
-- They implement smart geometry selection (hull > geom for uses_hull regions)
-- and proper simplification based on zoom level.

-- -----------------------------------------------------------------------------
-- Function: query_param_int
-- A tile source's id parameter, or NULL when the request sent none that reads
-- as one
-- -----------------------------------------------------------------------------
-- Martin publishes these sources on an unauthenticated port, and a bare
-- `(query_params->>'x')::integer` raised on a value that is not an integer:
-- Martin answered HTTP 500 with the database's error text (#664). Read through
-- this instead, a missing, empty or malformed value is no scope at all, and the
-- source's own early return answers an empty tile (HTTP 204), as it does for a
-- request that named nothing. A guarded cast rather than an exception block,
-- which would open a subtransaction on every tile request; plpgsql, so the
-- digit check runs before the cast even when the planner is handed a constant.
-- It is never published itself: Martin serves only functions shaped
-- (z, x, y, query_params) returning bytea.
CREATE OR REPLACE FUNCTION query_param_int(query_params json, name text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
    raw text := query_params->>name;
BEGIN
    IF raw ~ '^[0-9]{1,10}$' THEN
        -- Ten digits reach past integer's range; the bigint compare keeps
        -- 9999999999 from raising where 'abc' does not.
        IF raw::bigint <= 2147483647 THEN
            RETURN raw::integer;
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION query_param_int IS 'A tile source''s integer parameter, or NULL for a missing, empty or malformed one (#664)';

-- Whether a request sent a parameter at all: present and not empty. The island
-- source asks it of its optional parent_id, so that one sent malformed narrows
-- to nothing where one left out means the whole world view. A source reads
-- query_params only through these two helpers (tileScopeGuards.test.ts).
CREATE OR REPLACE FUNCTION query_param_sent(query_params json, name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT COALESCE(query_params->>name, '') <> ''
$$;

COMMENT ON FUNCTION query_param_sent IS 'Whether a tile request sent a parameter: present and not empty (#664)';

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
    p_world_view_id := query_param_int(query_params, 'world_view_id');

    -- Required, the way parent_id is on the two subdivision sources and
    -- world_view_id is on the island one: a tile parameter whose answer is
    -- meaningless without it is refused rather than defaulted. Otherwise the
    -- only other filter here is parent_region_id IS NULL, which every world
    -- view's roots satisfy, so a request that named none answered with all of
    -- them at once (#662). Nothing draws that way -- useTileUrls names the
    -- world view on both URLs it builds from this function -- but Martin is
    -- published unauthenticated, so what this answers to a request the
    -- application never makes is reachable all the same.
    IF p_world_view_id IS NULL THEN
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
                    WHEN z <= 4 AND r.geom_simplified_coarse IS NOT NULL
                        THEN r.geom_simplified_coarse
                    WHEN z <= 4 AND r.geom_simplified_low IS NOT NULL THEN r.geom_simplified_low
                    WHEN z <= 8 AND r.geom_simplified_medium IS NOT NULL THEN r.geom_simplified_medium
                    -- Display budget. What a tile costs is dominated by what it
                    -- has to read: the eight root divisions weigh 386 MB and take
                    -- 1.9 s to detoast, which is the floor under every tile that
                    -- touches them, at any zoom, even one answering 62 bytes.
                    -- pg_column_size() reads the TOAST header rather than the
                    -- geometry (0.4 ms for those same 386 MB), so a feature too
                    -- heavy to serve at full resolution is served one rung down.
                    WHEN pg_column_size(r.geom_3857) > 10485760
                         AND r.geom_simplified_medium IS NOT NULL
                        THEN r.geom_simplified_medium
                    ELSE r.geom_3857
                END,
                bounds, 4096, 64, true
            ) AS geom
        FROM regions r
        WHERE r.parent_region_id IS NULL
          AND r.world_view_id = p_world_view_id
          AND r.geom_3857 IS NOT NULL
          AND r.geom_3857 && bounds
    ) AS tile
    WHERE tile.geom IS NOT NULL;

    RETURN COALESCE(result, '');
END;
$$;

COMMENT ON FUNCTION tile_world_view_root_regions IS 'MVT tiles for root regions of a world view. Query params: world_view_id (required)';

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
    p_parent_id := query_param_int(query_params, 'parent_id');

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
                    WHEN z <= 4 AND r.geom_simplified_coarse IS NOT NULL
                        THEN r.geom_simplified_coarse
                    WHEN z <= 4 AND r.geom_simplified_low IS NOT NULL THEN r.geom_simplified_low
                    WHEN z <= 8 AND r.geom_simplified_medium IS NOT NULL THEN r.geom_simplified_medium
                    -- Display budget. What a tile costs is dominated by what it
                    -- has to read: the eight root divisions weigh 386 MB and take
                    -- 1.9 s to detoast, which is the floor under every tile that
                    -- touches them, at any zoom, even one answering 62 bytes.
                    -- pg_column_size() reads the TOAST header rather than the
                    -- geometry (0.4 ms for those same 386 MB), so a feature too
                    -- heavy to serve at full resolution is served one rung down.
                    WHEN pg_column_size(r.geom_3857) > 10485760
                         AND r.geom_simplified_medium IS NOT NULL
                        THEN r.geom_simplified_medium
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

COMMENT ON FUNCTION tile_region_subregions IS 'MVT tiles for subregions of a parent region. Query params: parent_id (required)';

-- -----------------------------------------------------------------------------
-- Function: tile_root_divisions
-- Returns the base layer's root divisions (continents) as MVT. The name says
-- no provider: the base layer is whichever dataset administrative_divisions
-- holds (ADR-0018), and this name is the public tile URL
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tile_root_divisions(
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
                    WHEN z <= 4 AND d.geom_simplified_coarse_3857 IS NOT NULL
                        THEN d.geom_simplified_coarse_3857
                    WHEN z <= 4 AND d.geom_simplified_low_3857 IS NOT NULL THEN d.geom_simplified_low_3857
                    WHEN z <= 8 AND d.geom_simplified_medium_3857 IS NOT NULL THEN d.geom_simplified_medium_3857
                    -- Display budget, as in tile_world_view_root_regions: North
                    -- America's division weighs 86 MB, and a zoom-9 tile over
                    -- Lisbon spent 2,746 ms reading rows like it to answer 62
                    -- bytes. One rung down answers the same tile in 83 ms.
                    WHEN pg_column_size(d.geom_3857) > 10485760
                         AND d.geom_simplified_medium_3857 IS NOT NULL
                        THEN d.geom_simplified_medium_3857
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

COMMENT ON FUNCTION tile_root_divisions IS 'MVT tiles for the root divisions of the administrative base layer (continents)';

-- -----------------------------------------------------------------------------
-- Function: tile_division_subdivisions
-- Returns the subdivisions of a parent division as MVT
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tile_division_subdivisions(
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
    p_parent_id := query_param_int(query_params, 'parent_id');

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
                    WHEN z <= 4 AND d.geom_simplified_coarse_3857 IS NOT NULL
                        THEN d.geom_simplified_coarse_3857
                    WHEN z <= 4 AND d.geom_simplified_low_3857 IS NOT NULL THEN d.geom_simplified_low_3857
                    WHEN z <= 8 AND d.geom_simplified_medium_3857 IS NOT NULL THEN d.geom_simplified_medium_3857
                    -- Display budget, as in tile_world_view_root_regions: North
                    -- America's division weighs 86 MB, and a zoom-9 tile over
                    -- Lisbon spent 2,746 ms reading rows like it to answer 62
                    -- bytes. One rung down answers the same tile in 83 ms.
                    WHEN pg_column_size(d.geom_3857) > 10485760
                         AND d.geom_simplified_medium_3857 IS NOT NULL
                        THEN d.geom_simplified_medium_3857
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

COMMENT ON FUNCTION tile_division_subdivisions IS 'MVT tiles for the subdivisions of a parent division. Query params: parent_id (required)';

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
    p_world_view_id integer;
    p_parent_id integer;
BEGIN
    p_world_view_id := query_param_int(query_params, 'world_view_id');
    p_parent_id := query_param_int(query_params, 'parent_id');

    -- Optional, so NULL means the whole world view; a parent_id that was sent
    -- and does not read as an id narrows to nothing rather than widening to
    -- that (#664). An empty one is what a URL built from an unset variable
    -- carries, and reads as absent.
    IF p_parent_id IS NULL AND query_param_sent(query_params, 'parent_id') THEN
        RETURN '';
    END IF;

    -- Required, the way parent_id is on the two subdivision sources: a tile
    -- parameter whose answer is meaningless without it is refused rather than
    -- defaulted. This one filters on uses_hull alone otherwise, so a request
    -- that named no scope answered with the islands of every hull region in the
    -- database: drawn over whichever world view was open, above the main source,
    -- and clickable there (#660). A parent id belongs to one world view already;
    -- what the root of a world view asks for is the whole of it, and that is
    -- the request that carried nothing. The two other world-view sources
    -- require theirs the same way (#662).
    IF p_world_view_id IS NULL THEN
        RETURN '';
    END IF;

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
                    -- No cheap rung here on purpose: this layer exists to draw
                    -- the small parts drop_small_parts() throws away.
                    WHEN z <= 4 AND r.geom_simplified_low_real IS NOT NULL THEN r.geom_simplified_low_real
                    WHEN z <= 8 AND r.geom_simplified_medium_real IS NOT NULL THEN r.geom_simplified_medium_real
                    -- The display budget is orthogonal to that, and applies as
                    -- it does in the other five functions: the rows this layer
                    -- serves are hull regions, whose real geometry is every
                    -- island they are made of.
                    WHEN pg_column_size(r.geom_3857) > 10485760
                         AND r.geom_simplified_medium_real IS NOT NULL
                        THEN r.geom_simplified_medium_real
                    ELSE r.geom_3857
                END,
                bounds, 4096, 64, true
            ) AS geom
        FROM regions r
        WHERE r.world_view_id = p_world_view_id
          AND r.uses_hull = true
          AND r.hull_geom IS NOT NULL
          AND r.geom_3857 IS NOT NULL
          AND (p_parent_id IS NULL OR r.parent_region_id = p_parent_id)
          AND r.geom_3857 && bounds
    ) AS tile
    WHERE tile.geom IS NOT NULL;

    RETURN COALESCE(result, '');
END;
$$;

COMMENT ON FUNCTION tile_region_islands IS 'MVT tiles for real island boundaries of hull regions. Query params: world_view_id (required), parent_id (optional)';

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
    p_world_view_id := query_param_int(query_params, 'world_view_id');

    -- Required, as on the root-region source above and for the same reason.
    -- This one is the broader leak of the two: is_leaf is a property of a row
    -- rather than a scope, so an unscoped request answered with every leaf
    -- region in the database -- the whole of every world view, at the zoom a
    -- world view's own map opens on (#662).
    IF p_world_view_id IS NULL THEN
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
            false as has_subregions,
            (r.uses_hull AND r.hull_geom IS NOT NULL) as using_hull,
            ST_AsMVTGeom(
                CASE
                    -- Precomputed; see simplify_for_overview(). A NULL here
                    -- means "not computed yet" and falls through to the low rung
                    -- so an un-backfilled database renders as it always did.
                    WHEN z <= 2 AND r.geom_overview IS NOT NULL
                        THEN r.geom_overview
                    WHEN z <= 4 AND r.geom_simplified_coarse IS NOT NULL
                        THEN r.geom_simplified_coarse
                    WHEN z <= 4 AND r.geom_simplified_low IS NOT NULL THEN r.geom_simplified_low
                    WHEN z <= 8 AND r.geom_simplified_medium IS NOT NULL THEN r.geom_simplified_medium
                    -- Display budget. What a tile costs is dominated by what it
                    -- has to read: the eight root divisions weigh 386 MB and take
                    -- 1.9 s to detoast, which is the floor under every tile that
                    -- touches them, at any zoom, even one answering 62 bytes.
                    -- pg_column_size() reads the TOAST header rather than the
                    -- geometry (0.4 ms for those same 386 MB), so a feature too
                    -- heavy to serve at full resolution is served one rung down.
                    WHEN pg_column_size(r.geom_3857) > 10485760
                         AND r.geom_simplified_medium IS NOT NULL
                        THEN r.geom_simplified_medium
                    ELSE r.geom_3857
                END,
                bounds, 4096, 64, true
            ) AS geom
        FROM regions r
        WHERE r.world_view_id = p_world_view_id
          AND r.geom_3857 IS NOT NULL
          AND r.geom_3857 && bounds
          AND r.is_leaf = true
    ) AS tile
    WHERE tile.geom IS NOT NULL;

    RETURN COALESCE(result, '');
END;
$$;

COMMENT ON FUNCTION tile_world_view_all_leaf_regions IS 'MVT tiles for all leaf regions (no subregions) of a world view. Query params: world_view_id (required)';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION tile_world_view_root_regions TO PUBLIC;
GRANT EXECUTE ON FUNCTION tile_region_subregions TO PUBLIC;
GRANT EXECUTE ON FUNCTION tile_root_divisions TO PUBLIC;
GRANT EXECUTE ON FUNCTION tile_division_subdivisions TO PUBLIC;
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

-- Experience sources and kinds (UNESCO, museums, landmarks, etc.)
-- =============================================================================
-- Kinds of place (ADR-0045 decision 1)
-- =============================================================================
-- What a traveller browses by, and what they would call the thing in front of
-- them: a World Heritage site, an art museum, a monument. Each kind is its own
-- list, pin colour and count, and it is offered to readers only once a sync
-- fills it on its own terms (decision 2). A *source* -- a row of
-- experience_sources below -- is a list we read to fill a kind: a kind may
-- have several, and one source may feed several kinds (decision 3). The kinds
-- are seeded under the ids of the sources that fill them, so a colour or an
-- order keyed on those ids reads the same through the membership's kind_id
-- as it did through the source row (#819).
CREATE TABLE IF NOT EXISTS experience_kinds (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    display_priority INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE experience_kinds IS 'A kind of place a traveller browses by (ADR-0045 decision 1): its own list, pin colour and count. Filled by one or more sources (experience_sources); a place''s membership in it is a row of experience_kind_memberships.';
COMMENT ON COLUMN experience_kinds.name IS 'What a traveller calls the thing in front of them -- World Heritage Sites, Art Museums -- never a source''s name for a selection rule (ADR-0045 decision 8).';
COMMENT ON COLUMN experience_kinds.display_priority IS 'Display order of the kind''s list and pills (lower = shown first).';

-- The kinds the sources fill, under the sources' own ids (see
-- above). Explicit ids, so the sequence is moved past them afterwards.
INSERT INTO experience_kinds (id, name, display_priority) VALUES
    (1, 'World Heritage Sites', 1),
    (2, 'Art Museums', 2),
    (3, 'Public Art & Monuments', 3)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_kinds_id_seq', GREATEST((SELECT MAX(id) FROM experience_kinds), 1));

-- The fourth kind: a cathedral, a mosque, a temple a traveller enters (#753, ADR-0052).
INSERT INTO experience_kinds (id, name, display_priority) VALUES
    (4, 'Places of worship', 4)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_kinds_id_seq', GREATEST((SELECT MAX(id) FROM experience_kinds), 1));

-- The fifth kind: sites and museums in one list; two lines on the row, one
-- for places and one for finds (ADR-0058).
INSERT INTO experience_kinds (id, name, display_priority) VALUES
    (5, 'Archaeology', 5)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_kinds_id_seq', GREATEST((SELECT MAX(id) FROM experience_kinds), 1));

-- =============================================================================
-- Sources (ADR-0045 decision 3)
-- =============================================================================
-- One row per list we read to fill a kind -- the UNESCO API, a Wikidata query --
-- with its endpoint, its config, its gate (requires_curation) and the sync
-- service registered under it. Named `experience_categories` until migration
-- 055 (#819) gave the source side its word; a reader that means the kind reads
-- the membership's kind_id, and nothing in this file says "category" now.
--
-- A database that predates that migration must apply it before this file:
-- `CREATE TABLE IF NOT EXISTS` would otherwise stand a second, empty source
-- table beside the full one, and every row would keep pointing at the old.
-- The guard fires whenever the old table exists -- also beside the new one,
-- which is exactly that state, reached by a run of this file past the error
-- (psql without ON_ERROR_STOP), and the one a silent guard would then keep
-- reporting as fine.
DO $$
BEGIN
    IF to_regclass('experience_categories') IS NOT NULL THEN
        RAISE EXCEPTION 'experience_categories still exists: apply db/migrations/055-sources-are-named-as-sources.sql before re-applying 01-schema.sql (an empty experience_sources beside it is the state that file repairs)';
    END IF;
END $$;
CREATE TABLE IF NOT EXISTS experience_sources (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    api_endpoint VARCHAR(1000),
    api_config JSONB,
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMPTZ,
    last_sync_status VARCHAR(50) CHECK (last_sync_status IN ('success', 'partial', 'failed', 'cancelled')),
    last_sync_error TEXT,
    display_priority INTEGER NOT NULL DEFAULT 100,
    kind_id INTEGER REFERENCES experience_kinds(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Which Wikidata the source's runs read (#1459): live, or the local subset (ADR-0105).
    wikidata_reader VARCHAR(10) NOT NULL DEFAULT 'live' CHECK (wikidata_reader IN ('live', 'subset'))
);

COMMENT ON TABLE experience_sources IS 'Sources: the lists a sync reads to fill a kind (ADR-0045 decision 3). One row per sync service, with its endpoint, config and gate.';
-- For a database that predates the column; a fresh one has it from the CREATE.
-- Filled and made required below the seeds, once every row can name its kind.
ALTER TABLE experience_sources ADD COLUMN IF NOT EXISTS kind_id INTEGER REFERENCES experience_kinds(id);
COMMENT ON COLUMN experience_sources.kind_id IS 'The kind this source fills (ADR-0045 decision 3). One kind per source today; a membership records which source brought it, so a kind can have several sources.';
COMMENT ON COLUMN experience_sources.api_config IS 'Source-specific API configuration (pagination, auth, etc.)';
COMMENT ON COLUMN experience_sources.last_sync_status IS 'How the source''s last sync ended: success, partial, failed or cancelled (CHECK; @tyr/shared/runStatuses)';
COMMENT ON COLUMN experience_sources.display_priority IS 'Display order in experience list (lower = shown first)';

ALTER TABLE experience_sources ADD COLUMN IF NOT EXISTS new_badge_days INTEGER NOT NULL DEFAULT 30;
COMMENT ON COLUMN experience_sources.new_badge_days IS 'How long an object keeps the "New" chip after it becomes visible to readers. Per source, because sources have different cadences. Counted from published_at, not from the run that found the row: under a gate those are a curator week apart (#529).';

-- The curation gate (ADR-0025). This is the
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
         WHERE table_name = 'experience_sources' AND column_name = 'requires_curation'
    ) THEN
        ALTER TABLE experience_sources
            ADD COLUMN requires_curation BOOLEAN NOT NULL DEFAULT true;
        UPDATE experience_sources SET requires_curation = false
         WHERE name IN ('UNESCO World Heritage Sites', 'Top Art Museums', 'Public Art & Monuments');
    END IF;
END $$;
COMMENT ON COLUMN experience_sources.requires_curation IS 'Does a run from this source wait for a curator before its rows reach a reader (ADR-0025). Only an admin sets it; no run ever changes it.';

-- Seed UNESCO as the first source, filling the World Heritage kind
INSERT INTO experience_sources (name, description, api_endpoint, api_config, display_priority, requires_curation, kind_id)
VALUES (
    'UNESCO World Heritage Sites',
    'Official UNESCO World Heritage List - Cultural, Natural, and Mixed sites worldwide',
    'https://data.unesco.org/api/explore/v2.1/catalog/datasets/whc001/records',
    '{"pageSize": 100}'::jsonb,
    1,
    false,
    (SELECT id FROM experience_kinds WHERE name = 'World Heritage Sites')
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

    -- The type within a kind is the membership's (experience_kind_memberships.type,
    -- ADR-0084): the Pantheon is a church as a place of worship and a site as archaeology.
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

COMMENT ON TABLE experiences IS 'Location-based experiences from various sources (UNESCO sites, museums, etc.)';
COMMENT ON COLUMN experiences.external_id IS 'The id the source that first brought this row knows it by (e.g., a UNESCO id_no). Provenance only since ADR-0084: a run finds a place through its membership''s external_id, never through this.';
COMMENT ON COLUMN experiences.name_local IS 'Multilingual names: {"en": "...", "fr": "...", ...}';
COMMENT ON COLUMN experiences.location IS 'Required point location for the experience';
COMMENT ON COLUMN experiences.boundary IS 'Optional boundary polygon for experiences with defined areas';
COMMENT ON COLUMN experiences.country_codes IS 'ISO country codes, array for transboundary sites';
COMMENT ON COLUMN experiences.metadata IS 'Source-specific data (UNESCO: date_inscribed, danger, criteria, etc.)';
COMMENT ON COLUMN experiences.curated_fields IS 'What a curator has claimed on this place, so every run keeps the stored value: column names (name, short_description, image_url, ...) and, for metadata, one entry per key (metadata.website, metadata.inDanger). Never the bare name metadata (ADR-0077 decision 3): a claim is in the grain the run records, so every key it protects is a key a curator can be asked about.';

-- A claim on metadata names its key (ADR-0077 decision 3, #729): the bare
-- column name would protect every key while matching none of the names the
-- run records them under, so no review card or answer could reach them.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_curated_fields_per_key_metadata_check') THEN
        ALTER TABLE experiences ADD CONSTRAINT experiences_curated_fields_per_key_metadata_check
            CHECK (NOT (curated_fields ? 'metadata'));
    END IF;
END $$;

-- Spatial indexes for experiences
CREATE INDEX IF NOT EXISTS idx_experiences_location ON experiences USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_experiences_boundary ON experiences USING GIST(boundary) WHERE boundary IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experiences_name_trgm ON experiences USING GIN(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_experiences_source_id ON experiences(source_id);
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
    status VARCHAR(50) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'failed', 'cancelled')),
    total_fetched INTEGER DEFAULT 0,
    total_created INTEGER DEFAULT 0,
    total_updated INTEGER DEFAULT 0,
    total_errors INTEGER DEFAULT 0,
    error_details JSONB,  -- Array of error objects with details
    triggered_by INTEGER REFERENCES users(id),  -- Admin who triggered the sync
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE experience_sync_logs IS 'Audit log for experience sync operations';
COMMENT ON COLUMN experience_sync_logs.status IS 'Sync status: running, then success, partial, failed or cancelled (CHECK; @tyr/shared/runStatuses)';
COMMENT ON COLUMN experience_sync_logs.triggered_by IS 'Admin user who triggered the sync (NULL for scheduled syncs)';

CREATE INDEX IF NOT EXISTS idx_experience_sync_logs_source ON experience_sync_logs(source_id);
CREATE INDEX IF NOT EXISTS idx_experience_sync_logs_status ON experience_sync_logs(status) WHERE status = 'running';

ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_unchanged INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_missing INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_curated_conflicts INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS is_dry_run BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS detection_skipped_reason TEXT;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS component_items JSONB;
COMMENT ON COLUMN experience_sync_logs.component_items IS 'A World Heritage run''s account of its components'' Wikidata items (#1269), in the shape of ComponentItems (backend/src/api/responses/admin.ts). NULL for every other source, for a preview, and for a run that counted no component.';
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_filtered INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_held INTEGER DEFAULT 0;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS withdrawal_skipped_reason TEXT;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS admission_sweep_skipped_reason TEXT;

COMMENT ON COLUMN experience_sync_logs.total_updated IS 'Rows whose fields actually changed. Runs before migration 009 counted every row that passed through ON CONFLICT, changed or not — the two are not comparable.';
COMMENT ON COLUMN experience_sync_logs.total_unchanged IS 'Rows the run wrote nothing to. Two kinds: ones that turned out identical, and ones the run proposed a change to and was refused - a curated_fields claim (each claimed field counted again in total_curated_conflicts) or the source''s gate holding a row a reader can already see (the row counted again in total_held). Counted here, never stored per object.';
COMMENT ON COLUMN experience_sync_logs.total_held IS 'Rows a reader can already see whose every proposed change the source''s gate kept out, so a verdict is waiting on each (#523). A subset of total_unchanged - nothing was written - counted again here so a gated run stops reading as one that touched nothing: run 68 held all 1272 UNESCO sites and reported unchanged 1272. Decided per row by the predicate that files the changeset row as held, so it equals the number of held rows the run recorded; migration 038 filled it from those rows for the runs that predate the column. A row the gate wrote pending is created, not held.';
COMMENT ON COLUMN experience_sync_logs.is_dry_run IS 'TRUE for preview runs: the changeset was computed but experiences were not written. Excluded from every "latest run" query.';
COMMENT ON COLUMN experience_sync_logs.total_filtered IS 'Entities the source offered that are not of the kind this source fills — e.g. a Wikidata collection with no physical address answering a museum query. Not errors: nothing failed, and the run stays successful.';
COMMENT ON COLUMN experience_sync_logs.detection_skipped_reason IS 'Why missing-object detection did not run: ranked source, force run, cancelled, errors, or coverage below the floor. Every value missingDetectionSkipReason() produces lands here.';
COMMENT ON COLUMN experience_sync_logs.withdrawal_skipped_reason IS 'Why this run marked none of the works its museums stopped holding: works coverage below the floor (ADR-0044). Every value worksCoverageSkipReason() produces lands here, and a run carrying one is partial, never success. NULL where withdrawals were applied, and on every run of a source whose contents need no floor: points are paired per object, not measured per pool.';
COMMENT ON COLUMN experience_sync_logs.admission_sweep_skipped_reason IS 'Why this run''s admission sweep delisted nothing the run''s own rule would have (ADR-0024): cancelled, errors, nothing admitted, or an admitted set below half the previous one. NULL when the sweep ran, when the source does not recompute membership, or on runs from before the column (#751).';

-- A run writes where it stands to its row as it goes (#1131), and its running
-- counts to the total_* columns above: a restart then leaves a row that says
-- how far the run got, and the status endpoint can read a run this process
-- does not hold.
ALTER TABLE experience_sync_logs
  ADD COLUMN IF NOT EXISTS phase VARCHAR(20)
    CHECK (phase IN ('fetching', 'processing', 'assigning'));
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS status_message TEXT;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS current_item TEXT;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS progress_done INTEGER;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS progress_total INTEGER;
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS progress_at TIMESTAMPTZ;

COMMENT ON COLUMN experience_sync_logs.phase IS 'The phase the run was last in while it ran: fetching, processing or assigning. Written with its progress (#1131) and left as it stood when the row closed, so a run the startup sweep closed says whether it had got past collecting from the source. NULL on runs from before the column.';
COMMENT ON COLUMN experience_sync_logs.status_message IS 'The line the admin panel shows over the running bar, as the run last wrote it.';
COMMENT ON COLUMN experience_sync_logs.current_item IS 'The object the run was on when it last wrote its progress; empty between objects.';
COMMENT ON COLUMN experience_sync_logs.progress_done IS 'Items the run had gone through when it last wrote its progress.';
COMMENT ON COLUMN experience_sync_logs.progress_total IS 'Items the run was given to go through; 0 while it is still collecting. The startup sweep closes a killed run with this as its total_fetched, the figure a failed run closes with.';
COMMENT ON COLUMN experience_sync_logs.progress_at IS 'When the running run last wrote its progress: at each change of phase, at most every two seconds while its counts move, and every fifteen seconds while they do not. Its progress writes only ever touch a running row.';

-- The objects a run moved and has not placed yet (#1152): placement runs after
-- the row closes, so a restart during it would otherwise leave them in no
-- region with the run reading success. The default is set apart from the
-- column so the rows from before keep NULL (migration 067).
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS unplaced_experience_ids INTEGER[];
ALTER TABLE experience_sync_logs ALTER COLUMN unplaced_experience_ids SET DEFAULT '{}';

COMMENT ON COLUMN experience_sync_logs.unplaced_experience_ids IS 'The objects whose points this run moved and that are not yet placed in their regions (#1152). Written with the run''s progress, emptied when placement succeeds, taken over by the source''s next real run, and read by the startup sweep, which marks a closed run still naming any partial. Empty on a preview, which moves nothing; NULL on runs from before the column.';

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
--
-- Axis 1 is a statement about one source, so it is each membership's since
-- ADR-0084 (#1251), with the run's own record of when its source first and last
-- saw the place. The place's missing_since and source_membership are derived
-- from its memberships by derive_place_listing() below: missing only when every
-- membership is, former only when every membership is.

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

COMMENT ON COLUMN experiences.missing_since IS 'Derived from the place''s memberships by derive_place_listing(): when the last of them was flagged, once every membership''s source has stopped listing the place; NULL while any source still lists it. Written only by that trigger (ADR-0084).';
COMMENT ON COLUMN experiences.source_membership IS 'Derived from the place''s memberships by derive_place_listing(): former once every membership is former, present otherwise. Written only by that trigger (ADR-0084).';
COMMENT ON COLUMN experiences.existence IS 'extant or lost. Whether the object still physically exists — independent of whether the source lists it.';

CREATE INDEX IF NOT EXISTS idx_experiences_missing ON experiences(source_id) WHERE missing_since IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experiences_membership ON experiences(source_membership) WHERE source_membership <> 'present';
CREATE INDEX IF NOT EXISTS idx_experiences_existence ON experiences(existence) WHERE existence <> 'extant';

-- =============================================================================
-- A place's membership in a kind (ADR-0045 decision 4; #822)
-- =============================================================================
-- A row of `experiences` is the place: its identity, its locations, its
-- picture, a traveller's visit. What a *kind* says about it -- that it is an
-- art museum, that the works-first source brought it, that the rule admitted
-- or refused it and why, the must-see badge, whether a curator has passed its
-- arrival -- is its membership in that kind, one row here per (place, kind).
-- Cologne Cathedral is one place and, once a second kind admits it, two
-- memberships: a card in each list, a pin in each colour, one visit seen
-- through both.
--
-- What each half carries. The badge and the gate state are decided here, per
-- membership: the badge is the world tier of a kind (decision 5), and a kind
-- fed by a gated source holds the gated members per member (decision 7).
--
--   place       name, description, location, boundary, picture, tags,
--               what a source observes about the row (missing_since,
--               source_membership) and what the world says of it (existence),
--               the visit
--   membership  kind, source and the id the source knows the place by
--               (external_id), the type within the kind, whether the source
--               still lists the place, admission and its reason, admitted_for,
--               is_iconic, the curator's pins on those, curation_state,
--               published_at, pending_change_sync_log_id
--
-- A place belongs to no source and no kind (ADR-0084): a run finds its places
-- through its own memberships, by (source_id, external_id) here.
-- `experiences.source_id` and `experiences.external_id` stay as provenance --
-- the source that first brought the row and the id it brought it under -- and
-- nothing arbitrates on them. Every row's membership names that same pair
-- today, and the admin panel's catalogue checks say so
-- (`membership-source-disagrees-with-row`).
--
-- Four columns can take a row off a reader's screen, and they compose rather
-- than collapse (ADR-0025): `existence` answers is it still standing,
-- `admission` does this kind accept it, `missing_since` does the source still
-- offer this point, `curation_state` has anyone looked at it yet. The first
-- and third stay on the place; the second and fourth are here, and a
-- reader-facing read asks them of the place through its memberships
-- (`backend/src/db/membership.ts`): a place is offered when some membership
-- of it is admitted and passed.
--
-- Admission (ADR-0024) is the one axis the machine writes: a refusal is not an
-- observation but our own rule applied to data we hold, naming the object
-- before it says no, and re-running it gives the same answer. Wikidata goes on
-- listing the British Museum, which stands open; what changed is that Art
-- Museums holds art museums and that one is an archaeological collection --
-- folding that into `former` would reproduce exactly the conflation ADR-0020
-- removed. A curator who disagrees pins 'admission' in the membership's
-- curated_fields, and every write skips the row.
--
-- Default `auto` for curation_state, not `pending`: the sync path sets
-- `pending` explicitly because it knows about the gate, so a writer that
-- forgets this column keeps today's behaviour. The other default would let
-- such a writer remove its rows from the product silently.
CREATE TABLE IF NOT EXISTS experience_kind_memberships (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    kind_id INTEGER NOT NULL REFERENCES experience_kinds(id),
    source_id INTEGER NOT NULL REFERENCES experience_sources(id) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL,
    type VARCHAR(100),
    admission VARCHAR(10) NOT NULL DEFAULT 'admitted' CHECK (admission IN ('admitted', 'refused')),
    admission_reason TEXT,
    admission_answered_at TIMESTAMPTZ,
    -- What a curator's admission pin answered, and what a later run asks
    -- about it (#1367): the constraints below the table.
    admission_pin_verdict VARCHAR(10),
    admission_pin_reason TEXT,
    admission_question_verdict VARCHAR(10),
    admission_question_reason TEXT,
    admission_questioned_at TIMESTAMPTZ,
    admission_question_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL,
    admitted_for JSONB,
    is_iconic BOOLEAN NOT NULL DEFAULT FALSE,
    curated_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    curation_state VARCHAR(10) NOT NULL DEFAULT 'auto' CHECK (curation_state IN ('pending', 'auto', 'verified')),
    published_at TIMESTAMPTZ,
    -- ON DELETE SET NULL, like the provenance pointers on the place: deleting a
    -- sync log is a supported operation here, and a pointer to a log that no
    -- longer exists names nothing. The hold itself is carried by
    -- curation_state, so losing the pointer loses the way to find the
    -- proposal, not the hold.
    pending_change_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL,
    -- Whether this membership's source still lists the place, and when it first
    -- and last saw it (ADR-0020's axis 1, per source since ADR-0084).
    missing_since TIMESTAMPTZ,
    source_membership VARCHAR(10) NOT NULL DEFAULT 'present' CHECK (source_membership IN ('present', 'former')),
    first_seen_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL,
    last_seen_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL,
    last_seen_at TIMESTAMPTZ,
    -- The source's view of the place: what it last reported, whatever the
    -- place keeps (ADR-0084, #1246).
    reported_name TEXT,
    reported_description TEXT,
    reported_image_url TEXT,
    reported_location geometry(Point, 4326),
    reported_image_credit JSONB,
    wikidata_items TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (experience_id, kind_id),
    CONSTRAINT experience_kind_memberships_source_external_key UNIQUE (source_id, external_id)
);

-- Declared in the CREATE TABLE above and added again here: CREATE TABLE IF NOT
-- EXISTS is a no-op on a database that already holds the table. NOT NULL makes
-- this fail on one whose memberships carry no id yet, which is migration 070's
-- to backfill first.
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS external_id VARCHAR(255) NOT NULL;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS type VARCHAR(100);
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS missing_since TIMESTAMPTZ;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS source_membership VARCHAR(10) NOT NULL DEFAULT 'present'
    CHECK (source_membership IN ('present', 'former'));
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS first_seen_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS last_seen_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS reported_name TEXT;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS reported_description TEXT;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS reported_image_url TEXT;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS reported_location geometry(Point, 4326);
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS reported_image_credit JSONB;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS wikidata_items TEXT[];
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS admission_pin_verdict VARCHAR(10);
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS admission_pin_reason TEXT;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS admission_question_verdict VARCHAR(10);
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS admission_question_reason TEXT;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS admission_questioned_at TIMESTAMPTZ;
ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS admission_question_sync_log_id INTEGER
    REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
-- db/migrations/090-a-pin-holds-for-the-reason-it-answered.sql for a database
-- that already holds pins: it also gives each its view.
ALTER TABLE experience_kind_memberships DROP CONSTRAINT IF EXISTS experience_kind_memberships_pin_verdict_check;
ALTER TABLE experience_kind_memberships ADD CONSTRAINT experience_kind_memberships_pin_verdict_check
    CHECK (admission_pin_verdict IN ('admitted', 'refused') AND admission_question_verdict IN ('admitted', 'refused'));
ALTER TABLE experience_kind_memberships DROP CONSTRAINT IF EXISTS experience_kind_memberships_question_check;
ALTER TABLE experience_kind_memberships ADD CONSTRAINT experience_kind_memberships_question_check
    CHECK ((admission_questioned_at IS NULL) = (admission_question_verdict IS NULL)
       AND (admission_questioned_at IS NULL OR curated_fields ? 'admission'));
ALTER TABLE experience_kind_memberships DROP CONSTRAINT IF EXISTS experience_kind_memberships_source_external_key;
ALTER TABLE experience_kind_memberships ADD CONSTRAINT experience_kind_memberships_source_external_key
    UNIQUE (source_id, external_id);

COMMENT ON TABLE experience_kind_memberships IS 'A place''s membership in a kind (ADR-0045 decision 4): one row per (place, kind), carrying what the kind says about the place -- the source that brought it, the admission verdict, the badge, and whether a curator has passed the arrival. The place itself is the experiences row.';
COMMENT ON COLUMN experience_kind_memberships.source_id IS 'The source that brought this membership (ADR-0045 decision 3): a kind may have several, and a run writes, refuses and badges only the memberships its own source brought.';
COMMENT ON COLUMN experience_kind_memberships.external_id IS 'The id the source knows the place by -- a World Heritage id, a Wikidata item -- unique per source (ADR-0084 decision 2). A run finds, admits and marks its places through it; the place''s own source_id and external_id only say which source first brought the row.';
COMMENT ON COLUMN experience_kind_memberships.type IS
  'The type within this membership''s kind, where the kind has types a traveller still browses together '
  '(ADR-0045): ''cultural''/''natural''/''mixed'' for World Heritage, ''monument''/''sculpture'' '
  'for public art, ''cathedral''/''church''/''chapel''/''monastery''/''mosque''/''temple''/''shrine''/''synagogue'' '
  'for a place of worship, ''site''/''museum'' for archaeology. NULL for an art museum. One vocabulary per kind (#814), '
  'and the membership''s rather than the place''s, since a place in two kinds has a type in each (ADR-0084). '
  'A curator''s claim on it is ''type'' in this row''s curated_fields.';
COMMENT ON COLUMN experience_kind_memberships.missing_since IS 'When a clean run of this membership''s source, an authoritative one, first failed to list the place. A machine observation, not a verdict (ADR-0020); the source''s own, since another source may still list the place (ADR-0084).';
COMMENT ON COLUMN experience_kind_memberships.source_membership IS 'present or former: whether this membership''s source still lists the place. Only a curator sets former; a run that lists the place again sets present, which only ever restores visibility (ADR-0020).';
COMMENT ON COLUMN experience_kind_memberships.first_seen_sync_log_id IS 'The run of this membership''s source that first brought the place into this kind.';
COMMENT ON COLUMN experience_kind_memberships.last_seen_sync_log_id IS 'The newest run of this membership''s source that listed the place. A conflict this source proposed in an earlier run is withdrawn once a later landed run of the same source saw the place and proposed nothing.';
COMMENT ON COLUMN experience_kind_memberships.reported_name IS 'The name this membership''s source last reported for the place, tidied as the place stores a name. With the three columns beside it, the source''s view of the place (ADR-0084): written by every run of the source whatever the place keeps, and read to tell whether the sources of one place disagree (#1246). NULL where the source reports nothing, which contradicts no other view.';
COMMENT ON COLUMN experience_kind_memberships.reported_description IS 'The description this membership''s source last reported for the place (its view, #1246).';
COMMENT ON COLUMN experience_kind_memberships.reported_image_url IS 'The picture this membership''s source last reported for the place, after the run''s picture rule (its view, #1246). Its credit is reported_image_credit.';
COMMENT ON COLUMN experience_kind_memberships.wikidata_items IS 'The Wikidata items a source that knows the place by another id resolves it to (#1248): for a World Heritage membership, the items its site resolves to through P757 (siteItems, ADR-0088 as narrowed by ADR-0094), leaving out an item whose every such statement is deprecated. NULL for a Wikidata source, whose external_id is the item. One item and one point make the place that item''s, for the catalogue''s merge on an equal item (sharedItemsSql).';
COMMENT ON COLUMN experience_kind_memberships.reported_image_credit IS 'The credit of reported_image_url as the run resolved it from Commons ({author, license, licenseUrl, detailsUrl}, the shape of metadata.imageCredit): shown beside the picture wherever a curator is asked to choose it, and written with it to the place when chosen (#1246).';
COMMENT ON COLUMN experience_kind_memberships.reported_location IS 'The coordinate this membership''s source last reported for the place (its view, #1246). Two views within ten metres agree (ADR-0027).';
COMMENT ON COLUMN experience_kind_memberships.admission IS 'admitted or refused. Whether this kind accepts the place, independent of whether the source still lists it (ADR-0024). The machine sets this one: a refusal is our own rule applied to an object the run named, not an observation. A place with no admitted membership is hidden from every read that offers somewhere to go, and from none that records a visit.';
COMMENT ON COLUMN experience_kind_memberships.admission_reason IS 'Why the kind refused it, stated verbatim to the curator. Here rather than in experience_sync_changes because a changeset is keyed by the external id the run named, which is not always this row''s.';
COMMENT ON COLUMN experience_kind_memberships.admission_answered_at IS 'When a batch answer confirmed this refusal without pinning it (ADR-0067): the question is closed, and the next run applies the rule again. A run that refuses a row it had admitted clears it, so a refusal that comes back is asked again.';
COMMENT ON COLUMN experience_kind_memberships.admission_pin_verdict IS 'The run''s verdict a curator''s admission pin answered (#1367): refused for a put-back or a confirmed refusal, admitted for a refused arrival. With admission_pin_reason, the view a later run is compared with; NULL on a row with no pin.';
COMMENT ON COLUMN experience_kind_memberships.admission_pin_reason IS 'The run''s reason a curator''s admission pin answered (#1367), compared with a later run''s with its numbers folded; NULL for an admission.';
COMMENT ON COLUMN experience_kind_memberships.admission_question_verdict IS 'What a run said about a pinned row against the curator''s answer (#1367): its verdict, with admission_question_reason. The row''s admission is untouched; the review queue asks the curator. NULL when nothing is asked.';
COMMENT ON COLUMN experience_kind_memberships.admission_question_reason IS 'The asking run''s reason for a refusal; NULL for an admission (#1367).';
COMMENT ON COLUMN experience_kind_memberships.admission_questioned_at IS 'When a run first asked the open question about this row''s pin (#1367); a later run that asks the same keeps it, one that agrees again clears it.';
COMMENT ON COLUMN experience_kind_memberships.admission_question_sync_log_id IS 'The run that last asked about this row''s pin (#1367).';
COMMENT ON COLUMN experience_kind_memberships.admitted_for IS 'The work whose fame qualified a museum for the works-first source ({qid, label}, ADR-0023): the reason this membership exists. The run''s own bookkeeping, never proposed to a curator (#571).';
COMMENT ON COLUMN experience_kind_memberships.is_iconic IS 'The must-see badge, the world tier of this kind (ADR-0045 decision 5): set by a source whose admission rule is a fame line, cleared with a refusal, pinned by a curator in curated_fields. The membership''s, not the place''s: a place admitted to a second kind carries that kind''s badge on that kind''s terms.';
COMMENT ON COLUMN experience_kind_memberships.curated_fields IS 'Field names a curator has pinned on this membership -- admission (a confirmed or overridden refusal), is_iconic, type -- in the shape of experiences.curated_fields. A pinned field is skipped by every run.';
COMMENT ON COLUMN experience_kind_memberships.curation_state IS 'pending = arrived from a gated source and nobody has passed it; auto = published unread; verified = a curator passed what is live now. No reader-facing read may offer a place none of whose memberships has passed (ADR-0025; per member since ADR-0045 decision 7).';
COMMENT ON COLUMN experience_kind_memberships.published_at IS 'When this membership became visible. NULL while pending and for every row that predates the gate. What the "New" chip counts from (#529): a gated row is found months before a reader can see it, so the run that found it is the wrong clock.';
COMMENT ON COLUMN experience_kind_memberships.pending_change_sync_log_id IS 'The run of this membership''s source whose content proposal for the place is held while a reader can see it. NULL when nothing is held. Contents need no equivalent -- a content row is held by being written pending rather than withheld.';

CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_kind ON experience_kind_memberships(kind_id, admission);
CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_source ON experience_kind_memberships(source_id, experience_id);
CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_pending ON experience_kind_memberships(experience_id) WHERE curation_state = 'pending';
CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_held ON experience_kind_memberships(experience_id) WHERE pending_change_sync_log_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_iconic ON experience_kind_memberships(kind_id) WHERE is_iconic;
CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_missing ON experience_kind_memberships(source_id) WHERE missing_since IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_first_seen ON experience_kind_memberships(first_seen_sync_log_id);

-- The place's own missing_since and source_membership, derived from its
-- memberships (ADR-0084, #1251): missing only once every membership's source
-- has stopped listing it, the latest flag standing for when; former only once
-- every membership is. One owner, the way invalidate_member_regions_geometry()
-- owns a region's geometry for every member writer (ADR-0068): the run, missing
-- detection and a curator's verdict write the membership, and none of them
-- writes the place's copy. A membership moving between places (a merge, #1247)
-- recomputes both. A place with no membership reads as listed.
CREATE OR REPLACE FUNCTION recompute_place_listing(place_id INTEGER) RETURNS void AS $$
BEGIN
    UPDATE experiences e
       SET missing_since = d.missing_since,
           source_membership = d.source_membership
      FROM (SELECT CASE WHEN bool_and(m.missing_since IS NOT NULL) THEN max(m.missing_since) END AS missing_since,
                   CASE WHEN bool_and(m.source_membership = 'former') THEN 'former' ELSE 'present' END AS source_membership
              FROM experience_kind_memberships m
             WHERE m.experience_id = place_id) d
     WHERE e.id = place_id
       AND (e.missing_since IS DISTINCT FROM d.missing_since
            OR e.source_membership IS DISTINCT FROM d.source_membership);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION derive_place_listing() RETURNS trigger AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        PERFORM recompute_place_listing(OLD.experience_id);
    END IF;
    IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.experience_id <> OLD.experience_id) THEN
        PERFORM recompute_place_listing(NEW.experience_id);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_derive_place_listing ON experience_kind_memberships;
CREATE TRIGGER trg_derive_place_listing
    AFTER INSERT OR DELETE OR UPDATE OF missing_since, source_membership, experience_id
    ON experience_kind_memberships
    FOR EACH ROW EXECUTE FUNCTION derive_place_listing();

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

COMMENT ON COLUMN experience_sync_changes.contents IS 'What the run did to what the object holds, keyed by kind of contents: {"locations": {"added": [{"name","ref"}], "withdrawn": [...], "returned": [...], "changed": [{"item": {"name","ref"}, "fields": [{field, old, new, significance, curatedConflict, held}]}]}, "treasures": {...}}. See ADR-0026, and ADR-0029 decision 7 for the fourth key. That key is read by two write paths, not only by a report: accepting the source coordinate takes the value it puts a released pin on out of contents.locations.changed, and publishing writes a held field of a part - a place name, a work attribution, picture and credit - from an entry whose field carries held = true (ADR-0037), so the item shape here is a contract rather than a description, and the row an entry names is found by one rule (backend partRecord.ts): the reference narrows, the name decides among duplicated references, the lowest id breaks a tie. Keyed rather than one column per kind so a new kind of contents costs no migration; a kind the run did nothing to is absent. Items are named, never identified by id, so the record stays legible after the row it names is renamed. NULL means the run recorded nothing here - for a run older than this column that is not the same as "the contents did not move", and the location rows cannot be asked instead (created_at was overwritten wholesale on 2026-08-04).';

COMMENT ON COLUMN experience_sync_changes.changed_fields IS 'Array of {field, old, new, significance, curatedConflict, held}. Each entry holds the value the source proposed for that field even when the run refused to write it, so a curator can answer it later; the two flags say why it was refused - curatedConflict = a curator had claimed the field (answered by accept-source), held = the source''s gate kept it out of a row a reader can already see (answered by publishing). Both false on a field the run applied.';

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
    -- Display order; NULL once unoffered. Not unique per place: two sources'
    -- lists may both start at 1 (ADR-0084), and a run renumbers in place.
    ordinal INTEGER DEFAULT 0,
    location GEOMETRY(Point, 4326) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    missing_since TIMESTAMPTZ             -- NULL = the source still offers this point
);
-- Dropped on a database that still has it: see the column comment above.
ALTER TABLE experience_locations DROP CONSTRAINT IF EXISTS experience_locations_experience_id_ordinal_key;

COMMENT ON TABLE experience_locations IS 'Individual locations for multi-location experiences (UNESCO serial nominations, etc.)';

-- Which memberships place a point (ADR-0084, #1256). A place two sources fill
-- holds the points each source places there, and a point both place is one
-- point -- the row a visit is recorded on. A run adds its own placement on
-- every point it pairs or inserts and, when it stops offering one, takes its
-- own away; the point is marked missing only once no placement is left
-- (services/sync/locationWriter.ts). A curator's point is placed by its
-- place's manual membership, which no run brings. Deleted rather than marked,
-- unlike the point: a placement is the run's bookkeeping.
CREATE TABLE IF NOT EXISTS experience_location_placements (
    location_id INTEGER NOT NULL REFERENCES experience_locations(id) ON DELETE CASCADE,
    membership_id INTEGER NOT NULL REFERENCES experience_kind_memberships(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (location_id, membership_id)
);
COMMENT ON TABLE experience_location_placements IS 'Which memberships place a point (ADR-0084): a run adds and takes away only its own, and the point is marked missing once none is left.';
CREATE INDEX IF NOT EXISTS idx_experience_location_placements_membership
    ON experience_location_placements(membership_id);
COMMENT ON COLUMN experience_locations.name IS 'Component name (e.g., individual fort name within a serial nomination)';
COMMENT ON COLUMN experience_locations.external_ref IS 'Source-specific reference (e.g., "1739-005" for UNESCO)';
-- The point's own Wikidata item, where Wikidata has one (#1269).
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS wikidata_item VARCHAR(20);
COMMENT ON COLUMN experience_locations.wikidata_item IS 'The Wikidata item this point is, where one is known: for a World Heritage component, the item whose World Heritage Site ID (P757, any rank but a deprecated-only statement) equals external_ref, recorded by every run; null where no item or more than one carries the reference. A claim on it (''wikidata_item'' in curated_fields) is written when a curator accepts a proposed item on the review queue (#1272), and is never overridden by a run (#1269).';
-- The point's own picture, its credit and its description, from its Wikidata
-- item (#1270). See db/migrations/081.
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN experience_locations.image_url IS 'The point''s own picture, a Wikimedia Commons file or, where a curator chose one, an /images/ path we host (ADR-0043): for a World Heritage component, its Wikidata item''s P18, written by the run through the gate as a field of a part (ADR-0037, ADR-0089) unless a curator claimed it. NULL = the point shows its object''s picture, and says so (#1270).';
COMMENT ON COLUMN experience_locations.description IS 'The point''s own short description: for a World Heritage component, its Wikidata item''s English description, written like image_url (#1270).';
COMMENT ON COLUMN experience_locations.metadata IS 'Facts about the point that are not columns: imageCredit, the credit of image_url, captured from Commons when the picture is written (#1270).';

-- A candidate Wikidata item for a component no item records the reference of
-- (#1272): a proposal for a curator, never a fact (ADR-0046). See
-- db/migrations/082.
CREATE TABLE IF NOT EXISTS experience_component_item_proposals (
    id SERIAL PRIMARY KEY,
    location_id INTEGER NOT NULL REFERENCES experience_locations(id) ON DELETE CASCADE,
    wikidata_item VARCHAR(20) NOT NULL,
    item_label TEXT NOT NULL,
    distance_m INTEGER NOT NULL,
    name_similarity REAL NOT NULL,
    exact BOOLEAN NOT NULL DEFAULT false,
    basis VARCHAR(10) NOT NULL CHECK (basis IN ('part_of', 'near', 'numbered', 'toponym')),
    proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answer VARCHAR(10) CHECK (answer IN ('accepted', 'refused')),
    answered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    answered_at TIMESTAMPTZ,
    item_location GEOMETRY(Point, 4326),
    UNIQUE (location_id, wikidata_item)
);
CREATE INDEX IF NOT EXISTS idx_component_item_proposals_open
    ON experience_component_item_proposals(location_id) WHERE answer IS NULL;
COMMENT ON TABLE experience_component_item_proposals IS 'A candidate Wikidata item for a World Heritage component whose reference no item records (#1272), and what the match rests on: the item says it is part of the site (part_of), it lies near the point and is of a class the site''s resolved components are of (near), or it carries the component''s number under another variant of the inscription and is named like it (numbered, #1394), or it is of the site''s kind near the point and its label holds a place name from the component''s name as a whole word (toponym, #1340); the distance, the name similarity and whether the names are the same. A curator answers it on the review queue: accepted records the item on the point as a curator''s choice; refused is kept so the candidate is never proposed again.';
-- Where the candidate stands, for the card's map, and the index that answers
-- whether a candidate's item is already some point's. See db/migrations/083.
ALTER TABLE experience_component_item_proposals ADD COLUMN IF NOT EXISTS item_location GEOMETRY(Point, 4326);
COMMENT ON COLUMN experience_component_item_proposals.item_location IS 'The coordinate of the item nearest the point, as the finder read it, so the card can show the candidate beside the point; null on a proposal recorded before it was kept.';
-- A candidate a curator confirmed and took back (#1336) is open again and
-- marked, so neither batch confirmation takes it a second time. See
-- db/migrations/086.
ALTER TABLE experience_component_item_proposals ADD COLUMN IF NOT EXISTS taken_back_at TIMESTAMPTZ;
COMMENT ON COLUMN experience_component_item_proposals.taken_back_at IS 'When a curator took this candidate back after confirming it (#1336): open again, and skipped by both batch confirmations until a curator confirms it by hand.';
-- A candidate's national register code and whether its group disagrees with
-- the site's (#1340). See db/migrations/092.
ALTER TABLE experience_component_item_proposals ADD COLUMN IF NOT EXISTS register_code TEXT;
ALTER TABLE experience_component_item_proposals
    ADD COLUMN IF NOT EXISTS register_disagrees BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN experience_component_item_proposals.register_code IS 'The candidate''s national register code as the card shows it, the register named first ("LMI CJ-I-s-A-07208"); null where the item carries none the finder reads (#1340).';
COMMENT ON COLUMN experience_component_item_proposals.register_disagrees IS 'Whether the code''s group differs from the group most of the site''s coded candidates carry: an architecture entry offered for a Roman fort. Such a candidate sorts below the ones that agree (#1340).';
CREATE INDEX IF NOT EXISTS idx_experience_locations_wikidata_item
    ON experience_locations(wikidata_item) WHERE wikidata_item IS NOT NULL;

-- A World Heritage reference without the inscription's variant: `829ter-001`
-- and `829bis-001` are both `829-001`, the property's number and the part. The
-- pairing of a run's incoming points with the stored rows reads it, so a
-- component the list renumbered at an extension is the same row where the
-- geometry says the place is the same (ADR-0090). The grammar is parseWhcRef's
-- in backend/src/services/sync/unescoWikidata.ts, and a parity spec holds the
-- two to each other. Lower-cased and with runs of blanks folded, as the reader
-- compares references. See db/migrations/087.
CREATE OR REPLACE FUNCTION whc_ref_bare(ref TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
    SELECT regexp_replace(regexp_replace(lower(btrim(ref)), '\s+', ' ', 'g'), '^(\d+)[a-z]+', '\1')
$$;

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

-- A curator's no to an unread point (#852, ADR-0053): a mark beside the
-- state, never a fourth state. Every reader hides a point by the one word
-- `pending`, spelled in a dozen statements, so a refused point stays
-- `pending` and stays hidden; what the mark changes is the *question* -- the
-- review queue and the publish stop offering the point once it is set. Who
-- refused, and the note, are the curation log's (`contents_refused`).
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS refused_at TIMESTAMPTZ;
COMMENT ON COLUMN experience_locations.refused_at IS 'When a curator refused this unread point (ADR-0053). The row stays pending and hidden; the queue and the publish stop asking about it, placement stops counting it toward a region, and a withdrawal it was holding is released. NULL = not refused.';

-- The review page's turned-down list asks, per object, whether it holds a
-- refused point at all (#859). Partial, because the mark is on a handful of rows
-- and no read ever wants the unmarked ones through this index -- the same shape
-- and the same reason as idx_experience_locations_undecided below.
CREATE INDEX IF NOT EXISTS idx_experience_locations_refused ON experience_locations(experience_id) WHERE refused_at IS NOT NULL;

-- What a curator decided about this point, kept from the next run. Every arm of
-- `locationWriter` writes the source's name and coordinate over whatever is
-- stored, so before this the answer to "that pin is in the wrong place" lasted
-- until the source was asked again. Same shape as `experiences.curated_fields`
-- (#488), NOT NULL for the reason given on `treasures.curated_fields`. See
-- db/migrations/027.
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS curated_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN experience_locations.curated_fields IS 'Column names a curator has claimed on this point: name, location, image_url and description (#1270), and wikidata_item, written when a curator confirms a proposed item on the review queue (#1272) and respected by every run. Never external_ref or ordinal — those are the source''s handle on the row and its place in the source''s list, and a claim on them would break the pairing that decides whether a point moved or was replaced.';

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

-- Seed the works-first museum source, filling the Art Museums kind. The row's
-- name is the reader's (ADR-0045 decision 8, #818); it was seeded as "Top Art
-- Museums" — the works-first selection rule's name — until migration 045
-- renamed it.
INSERT INTO experience_sources (name, description, api_endpoint, api_config, display_priority, requires_curation, kind_id)
VALUES (
    'Art Museums',
    'World''s most notable museums ranked by artwork fame, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{}'::jsonb,
    2,
    false,
    (SELECT id FROM experience_kinds WHERE name = 'Art Museums')
)
ON CONFLICT (name) DO NOTHING;

-- Seed the public-art source, filling the Public Art & Monuments kind
INSERT INTO experience_sources (name, description, api_endpoint, api_config, display_priority, requires_curation, kind_id)
VALUES (
    'Public Art & Monuments',
    'Notable outdoor sculptures and monuments worldwide, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{}'::jsonb,
    3,
    false,
    (SELECT id FROM experience_kinds WHERE name = 'Public Art & Monuments')
)
ON CONFLICT (name) DO NOTHING;

-- Its one source: Wikidata, through two doors -- the place's own fame and the
-- fame of a work it holds. The line is on the row (enterSitelinks /
-- staySitelinks), read by every run and set from the admin panel; gated on
-- arrival, since a community-edited source's first rows wait for a person
-- (ADR-0025).
INSERT INTO experience_sources (id, name, description, api_endpoint, api_config, display_priority, requires_curation, kind_id)
VALUES (
    4,
    'Places of worship',
    'Cathedrals, churches, mosques, temples and shrines the world knows, and the works inside them, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{"enterSitelinks": 22, "staySitelinks": 18}'::jsonb,
    4,
    true,
    (SELECT id FROM experience_kinds WHERE name = 'Places of worship')
)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_sources_id_seq', GREATEST((SELECT MAX(id) FROM experience_sources), 1));

-- Its one source: Wikidata, sites and museums in one list; two lines on the
-- row, one for places and one for finds (ADR-0058) -- a find has fewer
-- Wikipedia articles than the museum that holds it, so its pair sits lower.
-- Gated on arrival like the source before it (ADR-0025); the first live run
-- waits for the site door (ADR-0058 decision 7).
INSERT INTO experience_sources (id, name, description, api_endpoint, api_config, display_priority, requires_curation, kind_id)
VALUES (
    5,
    'Archaeology',
    'Archaeological sites and archaeology museums the world knows, and the finds inside the museums, sourced from Wikidata',
    'https://query.wikidata.org/sparql',
    '{"enterSitelinks": 22, "staySitelinks": 18, "findEnterSitelinks": 18, "findStaySitelinks": 15}'::jsonb,
    5,
    true,
    (SELECT id FROM experience_kinds WHERE name = 'Archaeology')
)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_sources_id_seq', GREATEST((SELECT MAX(id) FROM experience_sources), 1));

-- Every source names the kind it fills (ADR-0045 decision 3). Filled by name
-- for a database whose rows predate the column -- the museum source under
-- either of its names -- and then required: a source row naming no kind would
-- fill nothing a reader can browse. Guarded so a re-application changes
-- nothing once the column is required.
UPDATE experience_sources c
   SET kind_id = k.id
  FROM experience_kinds k
 WHERE c.kind_id IS NULL
   AND k.name = CASE c.name
                  WHEN 'UNESCO World Heritage Sites' THEN 'World Heritage Sites'
                  WHEN 'Top Art Museums' THEN 'Art Museums'
                  ELSE c.name
                END;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM experience_sources WHERE kind_id IS NULL) THEN
        ALTER TABLE experience_sources ALTER COLUMN kind_id SET NOT NULL;
    END IF;
END $$;

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

-- Every maker the source names (#720, ADR-0040).
--
-- A list because most works have one maker and a minority have several, and the
-- minority is where the catalogue was wrong rather than incomplete: `Morning in
-- a Pine Forest` is Shishkin's forest and Savitsky's bears, and a single column
-- made which of the two a reader was told an accident of which row the endpoint
-- answered with first. Measured on 2026-08-31, 30 of the 1232 stored works with
-- a creator have more than one, up to the Moon Museum's six.
--
-- **The stored order is not the source's**, which is what the column comment
-- below says and what the ADR measured: SPARQL exposes no statement order at
-- all, the banded pool answers in reverse of Wikidata's own on all eight works
-- sampled, and the narrow-class pool beside it answers in statement order — so
-- which order a work is stored in depends on which query found it. Who leads is
-- a curator's judgement, recorded by claiming this column.
--
-- NOT NULL with an empty default rather than nullable: "no maker recorded" is
-- 114 works, and giving it a second shape would put a COALESCE in front of every
-- read. Each element keeps `artist`'s old width, which is the label's bound.
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS artists VARCHAR(500)[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN treasures.artists IS 'Every creator the source names for the work. The stored order is not the source''s and asserts nothing; a curator confirms it by claiming the column (ADR-0040).';

CREATE INDEX IF NOT EXISTS idx_treasures_type ON treasures(treasure_type);
CREATE INDEX IF NOT EXISTS idx_treasures_sitelinks ON treasures(sitelinks_count DESC);
CREATE INDEX IF NOT EXISTS idx_treasures_iconic ON treasures(is_iconic) WHERE is_iconic = true;
-- The finds of a site: a treasure whose discovery place names the site's item
-- (ADR-0058 decision 3), asked per site row by a region's list for its "finds
-- on view" count (#907) and by a site's own list. Without it every site row in
-- a region's list scans the table: 346 scans in Europe's list on 2026-09-29.
CREATE INDEX IF NOT EXISTS idx_treasures_found_at ON treasures ((metadata->'foundAt'->>'qid'));

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
COMMENT ON COLUMN treasures.curated_fields IS 'Column names a curator has claimed on this work: name, artists, year, image_url. Not sitelinks_count or is_iconic, which are a measurement and a threshold rather than a judgement, and not external_id, which is identity.';

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

-- A curator's no to an unread work, on the link and not on the work (#852,
-- ADR-0053): the refusal is "not this work here", the same axis the link's
-- own state is on, and the work stays askable at every other venue that
-- holds it. Same shape as `experience_locations.refused_at`.
ALTER TABLE experience_treasures ADD COLUMN IF NOT EXISTS refused_at TIMESTAMPTZ;
COMMENT ON COLUMN experience_treasures.refused_at IS 'When a curator refused this unread link (ADR-0053). Written together with curation_state = pending on the link itself, since a link can be unread on the work''s axis alone and readers hide by that word, never by this mark. The queue and the publish stop asking about it. NULL = not refused.';

-- The turned-down list's other half, asked per object exactly as the points'
-- index above is (#859).
CREATE INDEX IF NOT EXISTS idx_experience_treasures_refused ON experience_treasures(experience_id) WHERE refused_at IS NOT NULL;

-- A link the source stops placing here is marked, never deleted -- the same
-- observation a point carries (ADR-0022), for the same reason: the row is what
-- a person's viewed record points at. Written only by a run that has seen enough
-- of the works its museums hold to be believed (the coverage floor, ADR-0044).
ALTER TABLE experience_treasures ADD COLUMN IF NOT EXISTS missing_since TIMESTAMPTZ;
COMMENT ON COLUMN experience_treasures.missing_since IS 'When a run first placed this work somewhere other than here, or nowhere, having seen enough of the works its museums hold to be believed (the coverage floor, ADR-0044). A machine observation, not a verdict. NULL = the source still places the work here; every reader-facing read of a museum''s works carries missing_since IS NULL. A run that places the work here again clears it.';

-- Every reader-facing read of a museum's works carries `missing_since IS NULL`,
-- and the withdrawal arm asks it per museum on every run. Partial, like the
-- points' index, because no read ever asks for the marked rows alone.
CREATE INDEX IF NOT EXISTS idx_experience_treasures_offered
    ON experience_treasures(experience_id) WHERE missing_since IS NULL;

-- Which memberships place a link (ADR-0084, #1252). A place two sources fill
-- holds the works each source places there, and a work both place is one link:
-- the Louvre holds its paintings through Art Museums and its finds through
-- Archaeology. A run adds its own placement on every link it offers and, past
-- the coverage floor, takes away its own from a link it no longer offers; the
-- link is marked missing only once no placement is left
-- (services/sync/museum/linkWithdrawal.ts). Deleted rather than marked, unlike
-- the link: a placement is the run's bookkeeping, and the link it leaves is
-- what a reader's record points at.
CREATE TABLE IF NOT EXISTS experience_treasure_placements (
    link_id INTEGER NOT NULL REFERENCES experience_treasures(id) ON DELETE CASCADE,
    membership_id INTEGER NOT NULL REFERENCES experience_kind_memberships(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (link_id, membership_id)
);
COMMENT ON TABLE experience_treasure_placements IS 'Which memberships place a work link (ADR-0084): a run adds and takes away only its own, and the link is marked missing once none is left.';
CREATE INDEX IF NOT EXISTS idx_experience_treasure_placements_membership
    ON experience_treasure_placements(membership_id);

-- Guarded rather than dropped-and-added: these are new constraints, not widened
-- ones, so the drop/add idiom used for the changeset's change_type check would
-- be doing nothing on a fresh database and hiding a failure on an old one.
-- The object's own state is on its membership (#822), whose CREATE TABLE
-- carries the CHECK inline; the three parts keep theirs here.
DO $$
BEGIN
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

-- A curation_state move the gate does not allow is refused (#794, ADR-0070).
--
-- Two moves would break the gate of ADR-0025 without anything failing:
-- verified -> pending takes a published row off every reader's screen, and
-- pending -> auto publishes one nobody has passed. The moves each table may
-- make are listed in @tyr/shared/lifecycle (CURATION_MOVES) and here, and a
-- database-lane spec (curationMoves.db.test.ts) walks every pair against the
-- list, so the two cannot come to disagree. An insert is not a move: a row is
-- created in whatever state its writer chose, and the gate is on what happens
-- to it after.
CREATE OR REPLACE FUNCTION guard_curation_state_move() RETURNS TRIGGER AS $$
DECLARE
  allowed BOOLEAN;
BEGIN
  allowed := CASE TG_TABLE_NAME
    WHEN 'experience_kind_memberships' THEN (OLD.curation_state, NEW.curation_state) IN
      (('pending', 'verified'), ('auto', 'verified'), ('verified', 'auto'))
    WHEN 'experience_locations' THEN (OLD.curation_state, NEW.curation_state) IN
      (('pending', 'verified'))
    WHEN 'treasures' THEN (OLD.curation_state, NEW.curation_state) IN
      (('pending', 'verified'))
    WHEN 'experience_treasures' THEN (OLD.curation_state, NEW.curation_state) IN
      (('pending', 'verified'), ('auto', 'pending'))
    ELSE FALSE
  END;
  IF NOT allowed THEN
    RAISE EXCEPTION 'curation_state may not move from % to % on %', OLD.curation_state, NEW.curation_state, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_curation_state_move ON experience_kind_memberships;
CREATE TRIGGER guard_curation_state_move
  BEFORE UPDATE OF curation_state ON experience_kind_memberships
  FOR EACH ROW WHEN (OLD.curation_state IS DISTINCT FROM NEW.curation_state)
  EXECUTE FUNCTION guard_curation_state_move();
DROP TRIGGER IF EXISTS guard_curation_state_move ON experience_locations;
CREATE TRIGGER guard_curation_state_move
  BEFORE UPDATE OF curation_state ON experience_locations
  FOR EACH ROW WHEN (OLD.curation_state IS DISTINCT FROM NEW.curation_state)
  EXECUTE FUNCTION guard_curation_state_move();
DROP TRIGGER IF EXISTS guard_curation_state_move ON treasures;
CREATE TRIGGER guard_curation_state_move
  BEFORE UPDATE OF curation_state ON treasures
  FOR EACH ROW WHEN (OLD.curation_state IS DISTINCT FROM NEW.curation_state)
  EXECUTE FUNCTION guard_curation_state_move();
DROP TRIGGER IF EXISTS guard_curation_state_move ON experience_treasures;
CREATE TRIGGER guard_curation_state_move
  BEFORE UPDATE OF curation_state ON experience_treasures
  FOR EACH ROW WHEN (OLD.curation_state IS DISTINCT FROM NEW.curation_state)
  EXECUTE FUNCTION guard_curation_state_move();

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
COMMENT ON COLUMN curator_assignments.scope_type IS 'Permission scope: global (all), region (specific region + descendants), source (every place one source brought)';

-- Experience curation audit log
CREATE TABLE IF NOT EXISTS experience_curation_log (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    -- Null on the catalogue's own merge alone (ADR-0086): the check below.
    curator_id INTEGER REFERENCES users(id),
    action VARCHAR(30) NOT NULL CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen', 'component_items_answered', 'component_item_taken_back', 'admission_pin_released', 'admission_pin_kept', 'admission_pin_handed_back', 'merge_proposal_answered')),
    region_id INTEGER REFERENCES regions(id) ON DELETE SET NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CREATE TABLE IF NOT EXISTS is a no-op where the table exists, so a widened
-- CHECK has to be applied on its own — see the same shape on
-- experience_sync_changes above.
--
-- 'arrival_refused' and 'contents_refused' are the newest of them and ride in
-- db/migrations/051-curator-refusal-of-arrival-and-contents.sql for a database
-- that already holds data; 'declined_held' rides in 039 and 'declined_source',
-- its neighbour one gate over, in 022. The list is a
-- closed one, so a curator's action cannot be recorded at all until it is named
-- here: the audit insert is inside the same transaction as the decision, and a
-- rejected action rolls the decision back with it. That is why widening it is a
-- schema change and not a code-only one.
ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen', 'component_items_answered', 'component_item_taken_back', 'admission_pin_released', 'admission_pin_kept', 'admission_pin_handed_back', 'merge_proposal_answered'));

-- An existing database's NOT NULL goes with migration 076; a fresh one never had it.
ALTER TABLE experience_curation_log ALTER COLUMN curator_id DROP NOT NULL;
ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_curator_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_curator_check
    CHECK (curator_id IS NOT NULL OR action = 'merged');
CREATE INDEX IF NOT EXISTS idx_curation_log_experience ON experience_curation_log(experience_id);
CREATE INDEX IF NOT EXISTS idx_curation_log_curator ON experience_curation_log(curator_id);
CREATE INDEX IF NOT EXISTS idx_curation_log_created ON experience_curation_log(created_at DESC);

COMMENT ON TABLE experience_curation_log IS 'Audit trail of all curator actions on experiences';

-- Two rows that are one place become one place by a merge that can be undone
-- (#1247, ADR-0046, ADR-0086). A merge is a row here recording what it moved,
-- which the undo moves back; merged_by is null on the catalogue's own merge
-- (an equal Wikidata item). The folded place and a point folded into one of
-- the survivor's are marked merged_into_id and kept, never deleted.
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS merged_into_id INTEGER REFERENCES experiences(id);
CREATE INDEX IF NOT EXISTS idx_experiences_merged_into ON experiences(merged_into_id) WHERE merged_into_id IS NOT NULL;
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS merged_into_id INTEGER REFERENCES experience_locations(id);
CREATE INDEX IF NOT EXISTS idx_experience_locations_merged_into
  ON experience_locations(merged_into_id) WHERE merged_into_id IS NOT NULL;
-- The point a published move replaced this one with (#1448). See db/migrations/098.
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS moved_to_location_id INTEGER
    REFERENCES experience_locations(id) ON DELETE SET NULL;
COMMENT ON COLUMN experience_locations.moved_to_location_id IS 'The point a curator''s published move replaced this one with (#1448): the old spot of the Trevi Fountain names the point 24 m away. Set with source_membership former by the publish, which is its answer; the answered withdrawals leave it out, and a run that lists the old spot again, or a curator who answers it still listed, clears it.';
CREATE TABLE IF NOT EXISTS experience_merges (
    id SERIAL PRIMARY KEY,
    survivor_id INTEGER NOT NULL REFERENCES experiences(id),
    folded_id INTEGER NOT NULL REFERENCES experiences(id),
    merged_by INTEGER REFERENCES users(id),
    reason VARCHAR(30) NOT NULL CHECK (reason IN ('equal_wikidata_item', 'curator')),
    moved JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    undone_at TIMESTAMPTZ,
    undone_by INTEGER REFERENCES users(id),
    CHECK (survivor_id <> folded_id)
);
CREATE INDEX IF NOT EXISTS idx_experience_merges_survivor ON experience_merges(survivor_id);
CREATE INDEX IF NOT EXISTS idx_experience_merges_folded ON experience_merges(folded_id);
COMMENT ON TABLE experience_merges IS 'A merge of one place into another (ADR-0086): what moved, for the undo; merged_by null on the catalogue''s own.';

-- A place that is part of another (ADR-0100). See db/migrations/093.
CREATE TABLE IF NOT EXISTS experience_parts (
    id SERIAL PRIMARY KEY,
    whole_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    part_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    reason VARCHAR(20) NOT NULL CHECK (reason IN ('component', 'wikidata_part_of', 'curator')),
    membership_id INTEGER REFERENCES experience_kind_memberships(id) ON DELETE CASCADE,
    external_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (whole_id, part_id),
    CHECK (whole_id <> part_id),
    CHECK (reason <> 'component' OR membership_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_experience_parts_part ON experience_parts(part_id);
COMMENT ON TABLE experience_parts IS 'A place that is part of another (ADR-0046 decision 6, ADR-0100): a component of a serial World Heritage site, placed by the site''s membership under its reference (component); a Wikidata part-of statement (wikidata_part_of); or a curator''s (curator).';
COMMENT ON COLUMN experience_parts.external_ref IS 'The reference the site''s source knows a component by (527ter-002); null on a part that is not a component.';

-- Two places near each other with similar names, proposed as one place
-- (ADR-0046 decision 2, #1249). See db/migrations/117.
CREATE TABLE IF NOT EXISTS experience_merge_proposals (
    id SERIAL PRIMARY KEY,
    place_a INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    place_b INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    distance_m INTEGER NOT NULL,
    name_similarity REAL NOT NULL,
    exact BOOLEAN NOT NULL DEFAULT false,
    reach_m INTEGER NOT NULL,
    proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answer VARCHAR(10) CHECK (answer IN ('one', 'two', 'part_of')),
    part_id INTEGER REFERENCES experiences(id),
    answered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    answered_at TIMESTAMPTZ,
    merge_id INTEGER REFERENCES experience_merges(id) ON DELETE SET NULL,
    UNIQUE (place_a, place_b),
    CHECK (place_a < place_b),
    CHECK ((answer IS NULL) = (answered_at IS NULL)),
    CHECK (answer IS DISTINCT FROM 'part_of' OR part_id = place_a OR part_id = place_b),
    CHECK (answer = 'part_of' OR part_id IS NULL),
    CHECK (merge_id IS NULL OR answer = 'one')
);
CREATE INDEX IF NOT EXISTS idx_experience_merge_proposals_open
  ON experience_merge_proposals(place_a) WHERE answer IS NULL;
CREATE INDEX IF NOT EXISTS idx_experience_merge_proposals_place_b ON experience_merge_proposals(place_b);
COMMENT ON TABLE experience_merge_proposals IS 'Two places near each other with similar names, or with one name standing within the other, proposed as one place (ADR-0046 decision 2, ADR-0120, #1249): the pair in id order, its distance, similarity and reach, and the curator''s answer -- one place, two places, or one part of the other. An answered pair is kept and never proposed again.';
ALTER TABLE experience_merge_proposals ADD COLUMN IF NOT EXISTS found_by VARCHAR(10) NOT NULL DEFAULT 'similar'
    CHECK (found_by IN ('similar', 'words'));
COMMENT ON COLUMN experience_merge_proposals.found_by IS 'Which rule found the pair (#1652): similar, the names reach a trigram similarity of 0.5; words, every significant word of one name stands in the other''s, as Geghard does in "Monastery of Geghard and the Upper Azat Valley".';
COMMENT ON COLUMN experience_merge_proposals.exact IS 'The two places carry one and the same folded name within fifty metres: the pairs a batch confirms.';
COMMENT ON COLUMN experience_merge_proposals.reach_m IS 'The distance the pair was found under: 300 m, or the radius of a World Heritage property''s area up to 3 km.';
COMMENT ON COLUMN experience_merge_proposals.part_id IS 'Which of the two is the part, when the answer is part_of; recorded here for #823, never written to experience_parts by this answer.';

-- What a kind's rule refused as another place's, and where it found it held
-- (ADR-0102): Public Art refuses the Bamberg Horseman as inside Bamberg
-- Cathedral. Written by the refusing source's run from what it filtered,
-- whether or not the source ever held the work as a row; a works kind that
-- admits one of the places takes the work. See db/migrations/097.
CREATE TABLE IF NOT EXISTS experience_hand_overs (
    source_id INTEGER NOT NULL REFERENCES experience_sources(id) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL,
    name TEXT,
    reason TEXT NOT NULL,
    held_in TEXT[] NOT NULL CHECK (cardinality(held_in) > 0),
    sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_id, external_id)
);
COMMENT ON TABLE experience_hand_overs IS 'A work a source''s rule refused as held by another place (ADR-0102): the reason, and the places it found it held in, item ids nearest first (the Cornaro chapel, then Santa Maria della Vittoria). The refusing run writes what it filtered and, on a complete run, drops what it no longer refuses this way; a works kind admitting one of the places takes the work.';

-- A serial site's components are places, part of the site (ADR-0100): the one
-- statement of which of a site's points are its components and how each
-- becomes a part. Called by migration 094 over every World Heritage site and
-- by the World Heritage run after it writes a site's points
-- (writeExperienceLocations, under the site's lock). `site_membership` is the site's
-- World Heritage membership. A component is a point of the site's own that
-- this membership places, or that no membership places (a row from before
-- placements); another source's point on the place (an Archaeology dig the
-- same row holds) is not one. A site whose components are parts already gets
-- every new one parted; one of a single component stays one place (ADR-0088).
-- Each part is a place of one point: the point keeps its id, so its
-- placements, regions, claims and candidates follow it. A traveller's visit
-- to the component becomes a visit to the part (ADR-0100 decision 5), the
-- record a merge reconciles with another kind's visits to the same place.
-- Its name and coordinate are the point's; the rest of its content stays on
-- the point until the part's card reads the place. A part with no kind of
-- its own has no regions of its own: lists find it through its site. Answers
-- how many points it parted.
CREATE OR REPLACE FUNCTION part_site_components(site INTEGER, site_membership INTEGER)
RETURNS INTEGER AS $$
DECLARE
  parted INTEGER := 0;
  component RECORD;
  part INTEGER;
BEGIN
  -- Serial by its standing components: a point the source withdrew, a lost
  -- one, a refused one, or an arrival that replaces a moved one is no second
  -- component (the Pilgrimage Church of Wies, moved once, is one place).
  IF NOT EXISTS (SELECT 1 FROM experience_parts WHERE whole_id = site AND reason = 'component')
     AND (SELECT count(*) FROM experience_locations el
           WHERE el.experience_id = site AND el.merged_into_id IS NULL
             AND el.missing_since IS NULL AND el.existence <> 'lost' AND el.refused_at IS NULL
             AND el.withdrawal_deferred_for_location_id IS NULL
             AND (EXISTS (SELECT 1 FROM experience_location_placements pl
                           WHERE pl.location_id = el.id AND pl.membership_id = site_membership)
                  OR NOT EXISTS (SELECT 1 FROM experience_location_placements pl
                                  WHERE pl.location_id = el.id))) < 2
  THEN
    RETURN 0;
  END IF;

  FOR component IN
    SELECT el.id, el.name, el.external_ref, el.location
      FROM experience_locations el
     WHERE el.experience_id = site AND el.merged_into_id IS NULL
       AND (EXISTS (SELECT 1 FROM experience_location_placements pl
                     WHERE pl.location_id = el.id AND pl.membership_id = site_membership)
            OR NOT EXISTS (SELECT 1 FROM experience_location_placements pl
                            WHERE pl.location_id = el.id))
     ORDER BY el.id
  LOOP
    INSERT INTO experiences (source_id, external_id, name, location)
    SELECT whole.source_id, 'part:' || component.id,
           COALESCE(NULLIF(component.name, ''), component.external_ref, whole.name), component.location
      FROM experiences whole WHERE whole.id = site
    RETURNING id INTO part;

    INSERT INTO experience_parts (whole_id, part_id, reason, membership_id, external_ref)
    VALUES (site, part, 'component', site_membership, component.external_ref);

    UPDATE experience_locations SET experience_id = part WHERE id = component.id;

    INSERT INTO user_visited_experiences (user_id, experience_id, visited_at, notes)
    SELECT uvl.user_id, part, uvl.visited_at, uvl.notes
      FROM user_visited_locations uvl WHERE uvl.location_id = component.id
    ON CONFLICT (user_id, experience_id) DO NOTHING;
    DELETE FROM user_visited_locations WHERE location_id = component.id;

    parted := parted + 1;
  END LOOP;
  RETURN parted;
END;
$$ LANGUAGE plpgsql;

-- One row per build of a public dump (ADR-0101 decision 3): which dump, which
-- file of which date, how it was read, whether it was verified, and what the
-- build made of it. A reader of a dump-derived table names the build it reads.
CREATE TABLE IF NOT EXISTS dump_builds (
    id SERIAL PRIMARY KEY,
    dump VARCHAR(60) NOT NULL,
    -- The file is known once the build resolves it; a queued build has none yet (#1467).
    file_name TEXT,
    dump_date DATE,
    url TEXT,
    mode VARCHAR(10) NOT NULL CHECK (mode IN ('stream', 'local')),
    bytes BIGINT NOT NULL DEFAULT 0,
    expected_bytes BIGINT,
    checksum_kind VARCHAR(10) CHECK (checksum_kind IN ('md5', 'sha1')),
    checksum_expected TEXT,
    checksum_actual TEXT,
    lines BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
    error TEXT,
    started_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    heartbeat_at TIMESTAMPTZ,
    runner TEXT,
    request JSONB,
    progress JSONB,
    cancel_requested_at TIMESTAMPTZ,
    outcome TEXT
);
CREATE INDEX IF NOT EXISTS idx_dump_builds_dump ON dump_builds(dump, started_at DESC);
-- At most one build of a dump is queued or running, in any process (#1463, #1467).
CREATE UNIQUE INDEX IF NOT EXISTS idx_dump_builds_one_active ON dump_builds(dump) WHERE status IN ('queued', 'running');
COMMENT ON COLUMN dump_builds.heartbeat_at IS 'When the running build last said it is alive, every few seconds, whatever process runs it (#1463). A running row that has not beaten for five minutes is a build that stopped.';
COMMENT ON COLUMN dump_builds.runner IS 'What runs the build: the dump worker on this host (worker:<hostname>), or a script. A worker that starts closes the running rows of its own runner, which its previous run left.';
COMMENT ON COLUMN dump_builds.request IS 'What the admin asked for (#1467): kind (verify, keep, rederive, sample or trial) and, for a build that reads a local file, only (that file''s name: the local copy, or the sample a trial reads), which the worker reads when it takes the queued build.';
COMMENT ON COLUMN dump_builds.outcome IS 'What a build that ended well did, in words (#1527): what it kept, how long each step took, an older copy removed. Null while it runs and for one that failed or was cancelled, whose reason is in error.';
COMMENT ON COLUMN dump_builds.progress IS 'The running build''s progress as the panel shows it (#1467): phase message, bytes downloaded and read, lines; written by the worker with its heartbeat.';
COMMENT ON COLUMN dump_builds.cancel_requested_at IS 'When an admin asked the build to stop (#1467); the worker reads it with its heartbeat and cancels.';
COMMENT ON TABLE dump_builds IS 'A build of a public dump (ADR-0101): the dump, the dated file, stream or local copy, the checksum it was verified against (or its size and a clean end of stream where none is published), the lines read and the outcome. A consumer commits only after verification.';

-- A world view's geometry computation, queued for the dump worker (#1658,
-- ADR-0122) through a ledger of its own, as a dump build is (ADR-0106).
CREATE TABLE IF NOT EXISTS geometry_computations (
    id SERIAL PRIMARY KEY,
    world_view_id INTEGER NOT NULL REFERENCES world_views(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
    force BOOLEAN NOT NULL DEFAULT FALSE,
    skip_snapping BOOLEAN NOT NULL DEFAULT FALSE,
    regions INTEGER NOT NULL DEFAULT 0,
    started_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    heartbeat_at TIMESTAMPTZ,
    runner TEXT,
    progress JSONB,
    cancel_requested_at TIMESTAMPTZ,
    outcome TEXT,
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_geometry_computations_world_view ON geometry_computations(world_view_id, queued_at DESC);
-- At most one computation of a world view is queued or running, in any process.
CREATE UNIQUE INDEX IF NOT EXISTS idx_geometry_computations_one_active ON geometry_computations(world_view_id) WHERE status IN ('queued', 'running');
COMMENT ON TABLE geometry_computations IS 'A world view''s geometry computation (#1658, ADR-0122): queued by an admin from the panel, taken and run by the dump worker, closed with its outcome. The row is the only channel between the backend and the worker, as a dump build''s is (ADR-0106).';
COMMENT ON COLUMN geometry_computations.force IS 'Every region is computed again, not only those with no geometry and their ancestors.';
COMMENT ON COLUMN geometry_computations.regions IS 'How many regions the computation was queued to compute, counted when it was queued.';
COMMENT ON COLUMN geometry_computations.heartbeat_at IS 'When the running computation last said it is alive, every few seconds. A running row that has not beaten for five minutes is a computation that stopped.';
COMMENT ON COLUMN geometry_computations.runner IS 'What runs the computation: the dump worker on this host (worker:<hostname>). A worker that starts closes the running rows of its own runner, which its previous run left.';
COMMENT ON COLUMN geometry_computations.progress IS 'The running computation''s progress as the panel shows it: regions done, computed, skipped and failed, the region in hand, and the step; written by the worker with its heartbeat.';
COMMENT ON COLUMN geometry_computations.cancel_requested_at IS 'When an admin asked the computation to stop; the worker reads it with its heartbeat and cancels the statement in flight in the database (ADR-0123).';
COMMENT ON COLUMN geometry_computations.outcome IS 'What a computation that ended well did, in words: regions computed, skipped and failed. Null while it runs and for one that failed or was cancelled, whose reason is in error.';

-- The local Wikidata subset (ADR-0101 decision 2, ADR-0105, #1434): the items
-- in scope kept whole in a compact form, and the tables the hot reads use,
-- derived from it. A build writes a full copy of each beside the live one and
-- swaps them in whole, so a reader never sees half a build. They are UNLOGGED:
-- each is rebuilt from its dump, and writing tens of gigabytes through the WAL
-- would double what a build writes for no reader's sake.
CREATE TABLE IF NOT EXISTS wikidata_subset_builds (
    build_id INTEGER PRIMARY KEY REFERENCES dump_builds(id),
    dump_date DATE NOT NULL,
    counts JSONB NOT NULL,
    swapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rules JSONB
);
COMMENT ON COLUMN wikidata_subset_builds.rules IS 'The versions of the rules the build was made under (#1583): scope (the first pass''s version and rules), write (how a line is written), derive (how the derived tables are made). Null on a build from before they were recorded, read as current.';
COMMENT ON TABLE wikidata_subset_builds IS 'Each build of the local Wikidata subset that was swapped in (ADR-0105): the dump build it read, the dump date, and what it kept. The newest row is what the wikidata_* tables hold.';

CREATE UNLOGGED TABLE IF NOT EXISTS wikidata_entities (
    id TEXT PRIMARY KEY,
    sitelink_count INTEGER NOT NULL,
    entity JSONB COMPRESSION lz4 NOT NULL
) WITH (toast_tuple_target = 128);
COMMENT ON TABLE wikidata_entities IS 'An item or property the local Wikidata subset keeps (ADR-0105), whole in a compact form: every statement at every rank with its qualifiers and statement id, every sitelink, labels and descriptions in the subset''s languages; no references or aliases.';

CREATE UNLOGGED TABLE IF NOT EXISTS wikidata_claims (
    subject TEXT NOT NULL,
    property TEXT NOT NULL,
    statement_id TEXT NOT NULL,
    rank SMALLINT NOT NULL CHECK (rank IN (-1, 0, 1)),
    value_item TEXT,
    value JSONB,
    qualifiers JSONB
);
CREATE INDEX IF NOT EXISTS idx_wikidata_claims_subject ON wikidata_claims (subject, property);
CREATE INDEX IF NOT EXISTS idx_wikidata_claims_value_item ON wikidata_claims (property, value_item) WHERE value_item IS NOT NULL;
COMMENT ON TABLE wikidata_claims IS 'The statements of the properties the catalogue reads, one row each, derived from wikidata_entities: rank 1 preferred, 0 normal, -1 deprecated; value_item for an item value, value otherwise.';

CREATE UNLOGGED TABLE IF NOT EXISTS wikidata_labels (
    id TEXT NOT NULL,
    language TEXT NOT NULL,
    label TEXT,
    description TEXT,
    PRIMARY KEY (id, language)
);
COMMENT ON TABLE wikidata_labels IS 'Labels and descriptions in the subset''s languages: of every kept entity, and of every entity a kept item names (the labels ring), so a work''s maker has a name.';

CREATE UNLOGGED TABLE IF NOT EXISTS wikidata_sitelinks (
    id TEXT NOT NULL,
    site TEXT NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (id, site)
);
CREATE INDEX IF NOT EXISTS idx_wikidata_sitelinks_title ON wikidata_sitelinks (site, title);
COMMENT ON TABLE wikidata_sitelinks IS 'Every sitelink of a kept item: the article each Wikipedia edition (and every other site) has about it.';

CREATE UNLOGGED TABLE IF NOT EXISTS wikidata_class_closure (
    class TEXT NOT NULL,
    ancestor TEXT NOT NULL,
    PRIMARY KEY (class, ancestor)
);
CREATE INDEX IF NOT EXISTS idx_wikidata_class_closure_ancestor ON wikidata_class_closure (ancestor);
COMMENT ON TABLE wikidata_class_closure IS 'For every class a kept item is an instance of, the class itself and every class above it through subclass of (P279, deprecated statements left out).';

-- English Wikipedia's structure (#1440, ADR-0121): its articles and
-- categories, their Wikidata items and which category each is filed under,
-- read from the enwiki SQL dumps of one date. Unlogged, rebuilt from the
-- dumps: a build writes _next copies and swaps them in whole, and the record
-- of the build is unlogged too, so a crash empties it with the tables.
CREATE UNLOGGED TABLE IF NOT EXISTS enwiki_structure_builds (
    build_id INTEGER PRIMARY KEY REFERENCES dump_builds(id),
    dump_date DATE NOT NULL,
    counts JSONB NOT NULL,
    swapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE enwiki_structure_builds IS 'Each build of English Wikipedia''s structure that was swapped in (#1440, ADR-0121): the dump build that read it, the dump date its four tables share, and what it kept. The newest row is what the enwiki_* tables hold; unlogged like them, so a crash empties the record with the tables and the panel asks for a build.';

CREATE UNLOGGED TABLE IF NOT EXISTS enwiki_pages (
    id INTEGER PRIMARY KEY,
    namespace SMALLINT NOT NULL CHECK (namespace IN (0, 14)),
    title TEXT NOT NULL,
    UNIQUE (namespace, title)
);
COMMENT ON TABLE enwiki_pages IS 'English Wikipedia''s articles (namespace 0) and categories (14) that are no redirect (#1440, ADR-0121), by page id, the title as the dump writes it, with underscores for spaces.';

CREATE UNLOGGED TABLE IF NOT EXISTS enwiki_page_items (
    page INTEGER PRIMARY KEY,
    item TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enwiki_page_items_item ON enwiki_page_items (item);
COMMENT ON TABLE enwiki_page_items IS 'The Wikidata item of each article and category kept (#1440): page_props'' wikibase_item.';

CREATE UNLOGGED TABLE IF NOT EXISTS enwiki_categories (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL UNIQUE
);
COMMENT ON TABLE enwiki_categories IS 'The categories pages are filed under that are not hidden (#1440, ADR-0121): the linktarget id the category links name and the category''s title, with underscores, without its Category: prefix. A hidden category (__HIDDENCAT__, a maintenance or tracking one) is not kept, nor any link to it.';

CREATE UNLOGGED TABLE IF NOT EXISTS enwiki_category_links (
    page INTEGER NOT NULL,
    category INTEGER NOT NULL,
    subcat BOOLEAN NOT NULL,
    PRIMARY KEY (page, category)
);
CREATE INDEX IF NOT EXISTS idx_enwiki_category_links_category ON enwiki_category_links (category, subcat);
COMMENT ON TABLE enwiki_category_links IS 'Which category each article or category is filed under (#1440, ADR-0121): the filed page''s id (an enwiki_pages row), the category''s linktarget id (an enwiki_categories row), and whether the filed page is itself a category (a subcategory), as categorymembers'' cmtype tells them.';

-- Readership (ADR-0055, #1436): each month of Wikimedia's pageview_complete
-- user file, summed per Wikipedia article and kept per Wikidata item and
-- edition, joined through the subset's sitelinks. A build keeps a month at a
-- time (readership_month_files says which file each month came from) and
-- swaps a month in whole. UNLOGGED for the subset's reason: every row is
-- rebuilt from its dump. readership_month_files is unlogged too, so a crash
-- that empties the months empties the record of them with it, and the next
-- build reads the year again rather than skipping months it no longer holds.
CREATE UNLOGGED TABLE IF NOT EXISTS readership_month_files (
    month DATE PRIMARY KEY CHECK (EXTRACT(DAY FROM month) = 1),
    file_name TEXT NOT NULL,
    build_id INTEGER NOT NULL REFERENCES dump_builds(id),
    lines BIGINT NOT NULL,
    editions JSONB NOT NULL,
    kept BIGINT NOT NULL,
    built_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    redirects_dump_date DATE,
    redirects_build_id INTEGER
);
COMMENT ON TABLE readership_month_files IS 'Each month of readership kept (#1436): the pageview file it was read from, the build that read it, its lines, every Wikipedia edition''s total views that month (editions, by sitelink site code: the denominator a door divides by, and what says which editions ADR-0055 counts, those over 15M views a year) and the rows kept.';

CREATE UNLOGGED TABLE IF NOT EXISTS readership_months (
    month DATE NOT NULL,
    item TEXT NOT NULL,
    site TEXT NOT NULL,
    views INTEGER NOT NULL CHECK (views >= 0),
    mobile INTEGER NOT NULL CHECK (mobile >= 0 AND mobile <= views),
    daily INTEGER[],
    PRIMARY KEY (item, site, month)
);
CREATE INDEX IF NOT EXISTS idx_readership_months_month ON readership_months (month);
COMMENT ON TABLE readership_months IS 'A month''s views of a Wikidata item''s article in one Wikipedia edition (ADR-0055, #1436): the article''s title and its redirects (#1650), in all three of the dump''s spellings and every access method, summed; mobile is the views on a phone (mobile web and app), for the automated-traffic check; daily is the month''s series, summed day by day over the titles whose plain spelling reaches 400 views. A title is staged where its plain spelling reaches 10 views in the month, every encoded spelling always, and kept where they sum to 10.';

-- The redirects readership folds under an article (#1650). See db/migrations/126.
CREATE UNLOGGED TABLE IF NOT EXISTS wikipedia_redirect_builds (
    build_id INTEGER PRIMARY KEY REFERENCES dump_builds(id),
    dump_date DATE NOT NULL,
    editions JSONB NOT NULL,
    swapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE wikipedia_redirect_builds IS 'Each build of the redirects readership folds (#1650, ADR-0055 decision 2) that was swapped in: the dump build that read it, the dump date every edition''s tables share, and the redirects kept per edition by its sitelink site code. The newest row is what wikipedia_redirects holds; unlogged like it, so a crash empties the record with the table and the panel asks for a build.';

CREATE UNLOGGED TABLE IF NOT EXISTS wikipedia_redirects (
    site TEXT NOT NULL,
    title TEXT NOT NULL,
    target TEXT NOT NULL,
    PRIMARY KEY (site, title)
);
COMMENT ON TABLE wikipedia_redirects IS 'An article''s redirects in the Wikipedia editions a door counts (#1650, ADR-0055 decision 2: over 15 million views a year): a redirect in namespace 0 by its title, and the title of the article it points to, both with spaces as Wikidata''s sitelinks write them. Kept only where the target is a sitelink of the local subset and the redirect is no item''s own sitelink, so a month''s views of the redirect are summed under that article''s item.';

COMMENT ON COLUMN readership_month_files.redirects_dump_date IS 'The dump date of the redirects the month was folded with (#1650), or null where no redirects were in place when it was kept.';
COMMENT ON COLUMN readership_month_files.redirects_build_id IS 'The build of the redirects the month was folded with (#1650): a build reads again a month folded with another, since one dump date can be built twice over a changed subset.';

CREATE UNLOGGED TABLE IF NOT EXISTS readership_staging (
    build_id INTEGER NOT NULL,
    site TEXT NOT NULL,
    title TEXT NOT NULL,
    views INTEGER NOT NULL,
    mobile INTEGER NOT NULL,
    daily INTEGER[]
);
COMMENT ON TABLE readership_staging IS 'A month being read (#1436): its titles over the floor, staged by the build that reads it, summed and joined to items once the file is verified, then cleared.';

-- A component part's name, coordinate and reference are its point's
-- (ADR-0100): whoever renames, moves or renumbers the point - the run, a
-- curator, a publish - the part and its relation follow, so the two never
-- disagree. The name falls back as part_site_components names a part.
-- A part that holds a kind of its own names itself (ADR-0100 decision 2,
-- #1250): the Karnak Temple Complex, once the Temple of Karnak is merged into
-- it, keeps its own name, anchor and relation however its point is written.
-- part_follows_point is the rule, for one point: the trigger applies it on
-- every write, and the undo of a merge applies it to the points it gives a
-- part back, which a run may have renamed while the merge stood. See
-- db/migrations/124.
CREATE OR REPLACE FUNCTION part_follows_point(point_id INTEGER)
RETURNS VOID AS $$
  UPDATE experiences part
     SET name = COALESCE(NULLIF(el.name, ''), el.external_ref, part.name), location = el.location,
         -- Stamped as every writer of the table stamps it (ADR-0069).
         updated_at = NOW()
    FROM experience_locations el
   WHERE el.id = point_id AND part.id = el.experience_id
     AND EXISTS (SELECT 1 FROM experience_parts p WHERE p.part_id = el.experience_id AND p.reason = 'component')
     AND NOT EXISTS (SELECT 1 FROM experience_kind_memberships m WHERE m.experience_id = el.experience_id)
     AND (part.name IS DISTINCT FROM COALESCE(NULLIF(el.name, ''), el.external_ref, part.name)
          OR part.location IS DISTINCT FROM el.location);
  UPDATE experience_parts p SET external_ref = el.external_ref
    FROM experience_locations el
   WHERE el.id = point_id AND p.part_id = el.experience_id AND p.reason = 'component'
     AND p.external_ref IS DISTINCT FROM el.external_ref
     AND NOT EXISTS (SELECT 1 FROM experience_kind_memberships m WHERE m.experience_id = el.experience_id);
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION follow_component_point()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM part_follows_point(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_follow_component_point ON experience_locations;
CREATE TRIGGER trg_follow_component_point
  AFTER UPDATE OF name, location, external_ref ON experience_locations
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.location IS DISTINCT FROM NEW.location
        OR OLD.external_ref IS DISTINCT FROM NEW.external_ref)
  EXECUTE FUNCTION follow_component_point();

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

-- Two data sources' views of one place, and the one a curator chose (#1246).
--
-- Where two standing memberships of a place under different ids report
-- different values of a field (db/sourceViews.ts), the place keeps its value
-- and the review queue asks which source's value it should show. The answer is
-- a row here: the membership chosen and the views of the field as they stood,
-- by membership id, so the card stays answered while the sources keep sending
-- what they sent and comes back when one of them sends something different.
CREATE TABLE IF NOT EXISTS experience_view_choices (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    field VARCHAR(20) NOT NULL CHECK (field IN ('name', 'description', 'imageUrl', 'location')),
    chosen_membership_id INTEGER REFERENCES experience_kind_memberships(id) ON DELETE SET NULL,
    views JSONB NOT NULL,
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (experience_id, field)
);

COMMENT ON TABLE experience_view_choices IS 'A curator''s choice between two sources'' views of one field of a place (#1246); answers the queue card while the views stay as recorded in views';
COMMENT ON COLUMN experience_view_choices.views IS 'The standing views of the field when the choice was made, as viewsOfFieldSql (db/sourceViews.ts) states them: membership id to value. A different value from either source opens the question again.';

-- Jev's suggestion for the same question (#1260): which view it would show,
-- with its confidence, for the views as they stood when it was asked. Never
-- applied; a curator decides. One row per call: the newest for the views as
-- they stand is the card's, and the rows added up are what Jev cost.
CREATE TABLE IF NOT EXISTS experience_view_suggestions (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    field VARCHAR(20) NOT NULL CHECK (field IN ('name', 'description', 'imageUrl', 'location')),
    views JSONB NOT NULL,
    suggested_membership_id INTEGER REFERENCES experience_kind_memberships(id) ON DELETE SET NULL,
    confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    probabilities JSONB NOT NULL,
    model VARCHAR(40) NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One row per call, never replaced: the rows are also what the calls cost.
CREATE INDEX IF NOT EXISTS idx_experience_view_suggestions_place ON experience_view_suggestions(experience_id, field, asked_at DESC);

COMMENT ON TABLE experience_view_suggestions IS 'Jev''s suggested answers to the sources card (#1260), one row per call, each for the views recorded in views and stale once they change. Never applied.';
COMMENT ON COLUMN experience_view_suggestions.input_tokens IS 'What the call cost: Jev is priced per input token, output free.';

-- Jev's judgement of a candidate Wikidata item for a World Heritage component
-- (#1272): the item is the component, or another place, with its confidence,
-- for the candidate as it was asked about. Never applied; a curator decides.
-- One row per question: a card's candidates are asked in one call, whose cost
-- is shared out over its questions. See db/migrations/084.
CREATE TABLE IF NOT EXISTS experience_component_item_suggestions (
    id SERIAL PRIMARY KEY,
    location_id INTEGER NOT NULL REFERENCES experience_locations(id) ON DELETE CASCADE,
    wikidata_item VARCHAR(20) NOT NULL,
    asked JSONB NOT NULL,
    judgement VARCHAR(10) CHECK (judgement IN ('same', 'other')),
    confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    probabilities JSONB NOT NULL,
    model VARCHAR(40) NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_experience_component_item_suggestions_candidate
    ON experience_component_item_suggestions(location_id, wikidata_item, asked_at DESC);
COMMENT ON TABLE experience_component_item_suggestions IS 'Jev''s judgement of a candidate Wikidata item for a World Heritage component (#1272): same, the item is the component; other, another place; null, an answer the client refused. One row per question, each for the candidate as recorded in asked and stale once the finder proposes it with other measures. Never applied.';
COMMENT ON COLUMN experience_component_item_suggestions.asked IS 'The candidate as the question was built: the item''s label, the distance, the name similarity and the rule that found it, as askedSql states them.';
COMMENT ON COLUMN experience_component_item_suggestions.input_tokens IS 'This question''s share of what its call cost: Jev is priced per input token, output free, and a card''s candidates are asked in one call.';

-- Jev's judgement of two near places with similar names (#1249, ADR-0087). See db/migrations/119.
CREATE TABLE IF NOT EXISTS experience_merge_suggestions (
    id SERIAL PRIMARY KEY,
    place_a INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    place_b INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    proposal_id INTEGER REFERENCES experience_merge_proposals(id) ON DELETE SET NULL,
    asked JSONB NOT NULL,
    judgement VARCHAR(10) CHECK (judgement IN ('one', 'two', 'part_of')),
    confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    probabilities JSONB NOT NULL,
    model VARCHAR(40) NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_experience_merge_suggestions_pair
    ON experience_merge_suggestions(place_a, place_b, asked_at DESC);
COMMENT ON TABLE experience_merge_suggestions IS 'Jev''s judgement of two near places with similar names (#1249, ADR-0087): one, the two are one place; two, two places; part_of, one lies within the other; null, an answer the client refused. One row per question, keyed on the two places and kept when a pass drops the proposal, each for the pair as recorded in asked and stale once the pass or a rename changes it. Never applied.';
COMMENT ON COLUMN experience_merge_suggestions.proposal_id IS 'The proposal the question was asked for; null once a pass dropped it. The judgement and its cost stay, on the two places.';
COMMENT ON COLUMN experience_merge_suggestions.asked IS 'The pair as the question was built from it: both names, the distance, the similarity and whether exact; a judgement answers for that pair only.';
COMMENT ON COLUMN experience_merge_suggestions.input_tokens IS 'This question''s share of its call''s input tokens, so the rows added up are what the calls cost.';

-- One gate over: how a curator answers a single field of a held proposal (#722).
--
-- A held field is one nobody claimed and the gate kept out of the columns
-- because a reader can already see the stored value (ADR-0025 decision 5,
-- ADR-0037 for a field of a place or a work). This table is what gives the
-- card one answer per held field rather than one for the whole proposal, and
-- it records both verdicts rather than only the refusal.
--
-- Refusing needs a row of its own because editing is not a refusal: an edit
-- claims the field, and a claim is a statement about whose value it is rather
-- than about this value -- it also outlives the question, so a source
-- proposing something else next month would meet the claim and no curator.
--
-- Publishing needs it for a different reason, one that exists only because the
-- answer is per row. A whole-card publish clears pending_change_sync_log_id, which is what
-- takes the card away; publishing one of six leaves the pointer standing for the
-- other five, and the run's record still says the field it wrote was held. With
-- no row here that card would go on offering a value it has already applied.
-- Rewriting the run's record instead is not an option: what a changeset holds is
-- what happened.
--
-- A sibling of experience_conflict_decisions rather than a widening of it. The
-- two answer different questions, are read by different queries, and only this
-- one has a part: since ADR-0037 a held card carries the fields of the object's
-- places and works beside the object's own. The part is identified the way
-- partRecord.ts identifies it -- the reference narrows, the name decides --
-- because nine (experience_id, external_ref) pairs on this database are
-- duplicated, and one point carries no reference at all. Both halves are the
-- record's own, which names a changed item by what it was called before the run
-- rewrote it, so they are stable for as long as the hold stands.
--
-- What is stored is the value answered about, and the readers suppress a
-- proposal only while it is jsonb-equal to it: a source that has changed its
-- mind is asking a new question and must be heard.
--
-- NULLS NOT DISTINCT is load-bearing, not tidiness. The object's own field
-- carries three NULLs and the referenceless point one; under the default rule
-- no two such rows would ever collide, so the standing answer would become a
-- pile and the upsert that replaces it would never fire.
CREATE TABLE IF NOT EXISTS experience_held_decisions (
    id BIGSERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    -- NULL is the object's own field. A part carries the record's kind, and the
    -- CHECK is what stops a third spelling of the same two words.
    part_kind VARCHAR(20) CHECK (part_kind IS NULL OR part_kind IN ('locations', 'treasures')),
    part_ref VARCHAR(255),
    part_name VARCHAR(500),
    field VARCHAR(100) NOT NULL,
    answer VARCHAR(10) NOT NULL CHECK (answer IN ('published', 'refused')),
    value JSONB NOT NULL,
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE NULLS NOT DISTINCT (experience_id, part_kind, part_ref, part_name, field)
);

-- No index beyond the unique constraint, for the reason given above it: the
-- btree leads on experience_id, which is where every reader of this table
-- starts -- the queue asking whether one card's row is answered, publishing
-- reading one object's answers under its lock.

COMMENT ON TABLE experience_held_decisions IS 'Gate-held proposals a curator has answered, by value; keeps the held card and its count from asking again while the proposal is unchanged';
COMMENT ON COLUMN experience_held_decisions.part_kind IS 'NULL for the object own field; otherwise the contents kind the record filed the part under';
COMMENT ON COLUMN experience_held_decisions.answer IS 'published: the value was written by a curator click. refused: the curator said not this, and nothing was written';
COMMENT ON COLUMN experience_held_decisions.value IS 'The proposed value the answer is about, read from the locked proposal and never from the request';

-- A run's batch a curator has set aside (#805, ADR-0051). Keyed on the run
-- because that is the unit a batch has: run 98 put 1 255 questions about one
-- field into the queue at once, and "not now" is said about the run, not 1 255
-- times. The row does nothing once the run's questions are answered or a later
-- run replaces its pointer -- the read offers only batches with open rows -- so
-- nothing expires it and nothing needs to.
CREATE TABLE IF NOT EXISTS curator_queue_set_aside (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sync_log_id INTEGER NOT NULL REFERENCES experience_sync_logs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, sync_log_id)
);
COMMENT ON TABLE curator_queue_set_aside IS 'Runs whose open questions this curator has set aside on the review page; the batch is hidden from their default list until its rows are answered';

-- When a user was first shown the "New" chip (issue #480). The chip lives for
-- max(source window, a week from this timestamp), so only the first
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
    status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'matching', 'reviewing', 'failed')),
    data_path TEXT,  -- filesystem path to raw JSON (/data/imports/{id}.json)
    stats JSONB,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
COMMENT ON COLUMN import_runs.status IS 'Import run status: running, matching, reviewing, failed (CHECK; @tyr/shared/runStatuses)';

-- A run's status move the lifecycle does not allow is refused (#794).
--
-- A sync log closes from running and may have its verdict corrected after,
-- but never becomes running again: the startup sweep would take it for a run
-- a restart interrupted. An import run goes running -> matching -> reviewing,
-- or to failed from either of the first two, and nothing leaves reviewing or
-- failed. The moves are listed in @tyr/shared/runStatuses (RUN_STATUS_MOVES)
-- and here, and a database-lane spec (runStatusMoves.db.test.ts) walks every
-- pair against the list. An insert is not a move.
CREATE OR REPLACE FUNCTION guard_run_status_move() RETURNS TRIGGER AS $$
DECLARE
  allowed BOOLEAN;
BEGIN
  allowed := CASE TG_TABLE_NAME
    WHEN 'experience_sync_logs' THEN NEW.status <> 'running'
    WHEN 'import_runs' THEN (OLD.status, NEW.status) IN
      (('running', 'matching'), ('matching', 'reviewing'), ('running', 'failed'), ('matching', 'failed'))
    ELSE FALSE
  END;
  IF NOT allowed THEN
    RAISE EXCEPTION 'status may not move from % to % on %', OLD.status, NEW.status, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_run_status_move ON experience_sync_logs;
CREATE TRIGGER guard_run_status_move
  BEFORE UPDATE OF status ON experience_sync_logs
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION guard_run_status_move();
DROP TRIGGER IF EXISTS guard_run_status_move ON import_runs;
CREATE TRIGGER guard_run_status_move
  BEFORE UPDATE OF status ON import_runs
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION guard_run_status_move();

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
    match_status VARCHAR(30) NOT NULL DEFAULT 'no_candidates'
      CHECK (match_status IN ('no_candidates', 'needs_review', 'auto_matched', 'manual_matched', 'children_matched', 'suggested')),
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
COMMENT ON COLUMN region_import_state.match_status IS 'Match lifecycle: no_candidates, needs_review, auto_matched, manual_matched, children_matched, suggested (CHECK; @tyr/shared/runStatuses)';
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

-- The reference map an admin lays under a region in the Create Subregions dialog
-- (#595, ADR-0113): one per region, calibrated by its four corners. Working
-- material of the world view editor, read and written by admins only and never
-- shown to a visitor, so it is not a picture in ADR-0043's sense. Raster only
-- and at most 10 MB: the dialog turns any other image into a PNG before saving.
CREATE TABLE IF NOT EXISTS region_image_overlays (
    region_id INTEGER PRIMARY KEY REFERENCES regions(id) ON DELETE CASCADE,
    image BYTEA NOT NULL CHECK (octet_length(image) BETWEEN 1 AND 10485760),
    image_type TEXT NOT NULL CHECK (image_type IN ('image/png', 'image/jpeg', 'image/webp')),
    image_name TEXT NOT NULL CHECK (length(image_name) BETWEEN 1 AND 255),
    image_width INTEGER NOT NULL CHECK (image_width > 0),
    image_height INTEGER NOT NULL CHECK (image_height > 0),
    corners JSONB NOT NULL CHECK (jsonb_typeof(corners) = 'array' AND jsonb_array_length(corners) = 4),
    opacity REAL NOT NULL CHECK (opacity >= 0 AND opacity <= 1),
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE region_image_overlays IS 'The reference map an admin calibrates under a region in the Create Subregions dialog (#595, ADR-0113): one per region, admin-only working material, never shown to a visitor.';
COMMENT ON COLUMN region_image_overlays.image IS 'The image''s bytes: PNG, JPEG or WebP (image_type), checked by their signature on write, at most 10 MB.';
COMMENT ON COLUMN region_image_overlays.corners IS 'Where the image''s corners lie on the map, as four [lng, lat] pairs in MapLibre''s image-source order: top left, top right, bottom right, bottom left.';
COMMENT ON COLUMN region_image_overlays.opacity IS 'How opaque the image is drawn over the map, 0 to 1.';

-- The groups an admin sorts a region's members into in the same dialog, and
-- which group each member is in (#595): working material of the world view
-- editor, read and written by admins only.
CREATE TABLE IF NOT EXISTS region_subdivision_groups (
    id SERIAL PRIMARY KEY,
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
    color TEXT CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    existing_region_id INTEGER REFERENCES regions(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    UNIQUE (region_id, sort_order)
);

CREATE TABLE IF NOT EXISTS region_member_group_assignments (
    region_member_id INTEGER PRIMARY KEY REFERENCES region_members(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES region_subdivision_groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rsg_region ON region_subdivision_groups(region_id);
CREATE INDEX IF NOT EXISTS idx_rmga_group ON region_member_group_assignments(group_id);

COMMENT ON TABLE region_subdivision_groups IS 'The groups an admin sorts a region''s members into in the Create Subregions dialog (#595), in their order: each becomes a subregion when the admin creates them. Admin-only working material.';
COMMENT ON COLUMN region_subdivision_groups.existing_region_id IS 'The child region the group fills instead of a new one (an imported child, say); cleared if that region is deleted, keeping the group.';
COMMENT ON COLUMN region_subdivision_groups.color IS 'The colour picked for the group, often with the eyedropper from the reference map, as #rrggbb; null for the palette''s.';
COMMENT ON TABLE region_member_group_assignments IS 'Which group of the Create Subregions dialog a region member is in (#595): at most one, and gone with the member or the group. A member no longer in the group''s region is not read as assigned.';

-- Wikidata geoshape cache (geometry for geoshape-based GADM matching)
-- Cache-first proxy: filled from maps.wikimedia.org and from composite unions of
-- child entity geoshapes. Keyed by Wikidata QID or "commons:{filename}".
-- See backend/src/services/worldViewImport/geoshapeCache.ts / geoshapeComposite.ts.
CREATE TABLE IF NOT EXISTS wikidata_geoshapes (
    wikidata_id TEXT PRIMARY KEY,            -- Wikidata QID or "commons:{filename}"
    geom geometry(MultiPolygon, 4326),       -- NULL when not_available; SRID 4326
    not_available BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE = no geoshape exists (negative cache)
    composite_of INTEGER CHECK (composite_of > 0),  -- parts a composite is the union of; NULL for a shape Wikimedia holds
    -- Negative-cache invariant: a row is either a real geoshape or a not_available
    -- marker. Stops a NULL geom with not_available=FALSE from reaching PostGIS calls
    -- (e.g. geoshapeCoverage.ts) and blocks a degenerate composite union from
    -- overwriting a valid cached geom with NULL via ON CONFLICT DO UPDATE.
    CONSTRAINT wikidata_geoshapes_geom_presence CHECK (not_available OR geom IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_wikidata_geoshapes_geom ON wikidata_geoshapes USING GIST (geom);

COMMENT ON TABLE wikidata_geoshapes IS 'Cache of Wikidata/Commons geoshapes (and composite unions) for WorldView Import geoshape matching';
COMMENT ON COLUMN wikidata_geoshapes.not_available IS 'Negative cache: TRUE means a geoshape lookup confirmed none exists';
COMMENT ON COLUMN wikidata_geoshapes.composite_of IS 'How many parts a composite geoshape is the union of, every part the item names (#1628); NULL for a shape Wikimedia holds for the item';

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
-- Wikidata query cache (migration 029)
-- =============================================================================

-- Answers from query.wikidata.org, kept so a failed run resumes where it stopped
-- rather than at the first phase, and so a repeated question costs their cluster
-- nothing. Museum run 61 died having already paid for 1166 artwork classes and
-- threw them away.
--
-- Keyed by the hash of the asking source and the query text together (ADR-0047),
-- because the query is the question: change a filter and it is a different
-- question and must miss, rather than relying on somebody remembering to
-- invalidate -- and one source's rows are never another's, so what the panel
-- shows for a source is what its runs read. Every row carries its own expiry, a run
-- can be told to ignore the cache entirely, and the admin panel shows each
-- kind's age with a button to drop it -- a cache that cannot be bypassed is a
-- fork of reality rather than a cache.
CREATE TABLE IF NOT EXISTS wikidata_query_cache (
    id SERIAL PRIMARY KEY,
    -- Whose run kept this: the store is shared, but every question an admin asks
    -- about it is about one source, and lifetimes differ by source as much as by
    -- kind.
    source_id INTEGER NOT NULL REFERENCES experience_sources(id) ON DELETE CASCADE,
    query_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    query_text TEXT NOT NULL,
    result JSONB NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wikidata_cache_kind ON wikidata_query_cache(kind);
CREATE INDEX IF NOT EXISTS idx_wikidata_cache_expires ON wikidata_query_cache(expires_at);

-- How long each kind is worth keeping, when an admin disagrees with the default.
-- The defaults live in code because they are an argument about how fast the facts
-- change; a row here means a person decided otherwise. Changing a lifetime
-- re-stamps what is already kept, or the panel would show one rule and the
-- reader honour another.
CREATE TABLE IF NOT EXISTS wikidata_cache_policy (
    source_id INTEGER NOT NULL REFERENCES experience_sources(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    ttl_ms BIGINT NOT NULL CHECK (ttl_ms > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_id, kind)
);

COMMENT ON TABLE wikidata_cache_policy IS 'Per-kind overrides for how long a cached Wikidata answer stays fresh. Absent kind = the default in wikidataCache.ts, which states why that number and not another.';

COMMENT ON TABLE wikidata_query_cache IS 'Answers from query.wikidata.org, kept so a failed run resumes where it stopped and a repeated question costs their cluster nothing. Never a source of truth: every row carries its own expiry, a run can be told to ignore the cache entirely, and the admin panel shows each kind''s age and expiry with a button to drop it.';
COMMENT ON COLUMN wikidata_query_cache.query_hash IS 'SHA-256 of the asking source''s source_id and the exact query text (ADR-0047). The query is the question, so a changed filter is a different key and misses by construction rather than by remembering to invalidate.';
COMMENT ON COLUMN wikidata_query_cache.expires_at IS 'Stored rather than derived: the row keeps the rule that applied when it was written, and the panel shows the same expiry the reader honours.';

-- =============================================================================
-- Catalogue Data Assertions
-- =============================================================================

-- What this catalogue has been told to carry.
--
-- The assertions in the admin panel are claims that should hold -- a place is
-- not stored twice, an object a reader is offered has somewhere to go. The
-- catalogue does not hold all of them, and never will hold all of every rule
-- added later: measured the day this landed, 28 objects sat in no region, 173
-- offered places carried no region row, and 2911 pictures named no author. A
-- panel that demanded zero everywhere would be red on its first morning and
-- stay red, which is how a check becomes wallpaper.
--
-- So the rule stays at zero and the debt is recorded here. A row means a person
-- looked at a number and said this is what we are carrying; the panel reports a
-- larger number as something that needs attention and an equal one as held.
--
-- A ledger, not a setting (ADR-0032): one row per act of accepting, never
-- updated, so the current number is the newest row per assertion and the ones
-- before it are the history of what this catalogue was carrying and who said
-- so. `accepted_by` has no cascade for the same reason the curation log's
-- curator does not -- the record of a decision outlives the account that made
-- it, and deleting a user has to be a deliberate act that faces its trail.
--
-- Lives in the database it describes, so the numbers travel with the rows they
-- are about: a dump restored elsewhere carries its own accepted debt, and a
-- fresh checkout of the code inherits none.
CREATE TABLE IF NOT EXISTS data_assertion_acceptances (
    id SERIAL PRIMARY KEY,
    assertion_id VARCHAR(80) NOT NULL,
    accepted_count INTEGER NOT NULL CHECK (accepted_count >= 0),
    accepted_by INTEGER NOT NULL REFERENCES users(id),
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The read is always "the newest row for each assertion", which is what this
-- order serves; the id breaks a tie between two acceptances in one clock tick.
CREATE INDEX IF NOT EXISTS idx_data_assertion_acceptances_current
    ON data_assertion_acceptances(assertion_id, accepted_at DESC, id DESC);

COMMENT ON TABLE data_assertion_acceptances IS 'What a person accepted as the debt this catalogue carries, per assertion. A ledger: the newest row per assertion_id is the number in force, the rest is history.';
COMMENT ON COLUMN data_assertion_acceptances.accepted_count IS 'The number the assertion returned when it was accepted, measured on the server at that moment rather than sent by the client.';

-- =============================================================================
-- Catalogue coverage (ADR-0081)
-- =============================================================================
--
-- A copy of the files in db/catalogue-coverage/, which are the source of truth:
-- the register of kinds of experience, the surveyed regions, and what a
-- traveller expects in each. scripts/catalogue-coverage.sh load replaces the
-- content of the coverage tables from the files in one transaction, and nothing
-- else writes them. They exist so that the comparison with the catalogue is a
-- join, not a script that reads two things.
--
-- Apart from experience_kinds on purpose. That table is what a traveller
-- browses by, and a proposed kind in it would be one clause away from a
-- visitor's list. A live kind's record points at its experience_kinds row; a
-- proposed kind has none.
--
-- Keys are the files' own slugs, so a reload keeps every key it had.
CREATE TABLE IF NOT EXISTS coverage_kinds (
    slug VARCHAR(80) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    form VARCHAR(20) NOT NULL CHECK (form IN ('place', 'work', 'food', 'drink', 'event', 'route', 'activity', 'title', 'person', 'species', 'object', 'sound')),
    definition TEXT NOT NULL,
    status VARCHAR(10) NOT NULL CHECK (status IN ('live', 'proposed')),
    experience_kind_id INTEGER REFERENCES experience_kinds(id),
    issue_number INTEGER,
    vision_heading TEXT,
    in_venue BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT coverage_kinds_proposed_names_no_catalogue_kind CHECK (status = 'live' OR experience_kind_id IS NULL)
);

-- One record per catalogue kind: two records claiming Archaeology would count
-- every expectation of it twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coverage_kinds_experience_kind
    ON coverage_kinds(experience_kind_id) WHERE experience_kind_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS coverage_regions (
    slug VARCHAR(80) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    country VARCHAR(255) NOT NULL,
    centre GEOMETRY(Point, 4326) NOT NULL,
    radius_km DOUBLE PRECISION NOT NULL CHECK (radius_km > 0),
    surveyed DATE NOT NULL
);

-- The ids are held to their shape here because the comparison joins them to
-- experiences.external_id and treasures.external_id as text.
CREATE TABLE IF NOT EXISTS coverage_expectations (
    region_slug VARCHAR(80) NOT NULL REFERENCES coverage_regions(slug) ON DELETE CASCADE,
    slug VARCHAR(120) NOT NULL,
    name TEXT NOT NULL,
    aliases TEXT[] NOT NULL DEFAULT '{}',
    type VARCHAR(20) NOT NULL CHECK (type IN ('place', 'work', 'food', 'drink', 'event', 'route', 'activity', 'title', 'person', 'species', 'object', 'sound')),
    wikidata_id VARCHAR(20) CHECK (wikidata_id ~ '^Q[1-9][0-9]*$'),
    same_as TEXT[] NOT NULL DEFAULT '{}',
    unesco_id VARCHAR(20) CHECK (unesco_id ~ '^[1-9][0-9]*$'),
    venue TEXT,
    source_count INTEGER NOT NULL CHECK (source_count >= 2),
    sitelinks INTEGER CHECK (sitelinks >= 0),
    location GEOMETRY(Point, 4326),
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (region_slug, slug)
);

CREATE INDEX IF NOT EXISTS idx_coverage_expectations_wikidata
    ON coverage_expectations(wikidata_id) WHERE wikidata_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coverage_expectations_location
    ON coverage_expectations USING GIST (location);

CREATE TABLE IF NOT EXISTS coverage_expectation_kinds (
    region_slug VARCHAR(80) NOT NULL,
    expectation_slug VARCHAR(120) NOT NULL,
    kind_slug VARCHAR(80) NOT NULL REFERENCES coverage_kinds(slug) ON DELETE CASCADE,
    PRIMARY KEY (region_slug, expectation_slug, kind_slug),
    CONSTRAINT coverage_expectation_kinds_entry FOREIGN KEY (region_slug, expectation_slug) REFERENCES coverage_expectations(region_slug, slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coverage_expectation_kinds_kind
    ON coverage_expectation_kinds(kind_slug);

COMMENT ON TABLE coverage_kinds IS 'The register of kinds of experience, live and proposed, loaded from db/catalogue-coverage/kinds.jsonl (ADR-0081). A copy: the file is the source of truth.';
COMMENT ON COLUMN coverage_kinds.form IS 'What a member of the kind is. An expectation is filed only under a kind whose form is its own type.';
COMMENT ON COLUMN coverage_kinds.in_venue IS 'True when a member exists only inside a place: a work shown there, something done there. An expectation filed under such a kind names its venue.';
COMMENT ON COLUMN coverage_kinds.issue_number IS 'The issue that owns building a proposed kind. Its priority and order live there, never here (ADR-0079).';
COMMENT ON TABLE coverage_regions IS 'The surveyed regions, loaded from db/catalogue-coverage/regions.jsonl (ADR-0081).';
COMMENT ON TABLE coverage_expectations IS 'What two or more independent sources recommend in a surveyed region, loaded from db/catalogue-coverage/expectations/ (ADR-0081). Identified by wikidata_id, same_as and unesco_id, never by name.';
COMMENT ON COLUMN coverage_expectations.same_as IS 'Other Wikidata items that are this same place: a building and the museum inside it.';
COMMENT ON COLUMN coverage_expectations.source_count IS 'How many sources named the entry. Which ones is not published.';
COMMENT ON TABLE coverage_expectation_kinds IS 'The kinds of the register an expectation is filed under. An expectation with no row here is not sorted yet.';

-- A gap the coverage report found, judged once by cause (ADR-0116): a copy of
-- db/catalogue-coverage/judgements.jsonl, loaded with the coverage tables above.
-- The subject is an entry of a region's list and the live kind that does not
-- offer it (an entry filed under two live kinds has a gap per kind), or a
-- catalogue row the region offers and no entry names, by its Wikidata id; one
-- of the two. A defect and a missing door name the issue that owns them.
CREATE TABLE IF NOT EXISTS coverage_judgements (
    region_slug VARCHAR(80) NOT NULL REFERENCES coverage_regions(slug) ON DELETE CASCADE,
    entry_slug VARCHAR(120),
    kind_slug VARCHAR(80) REFERENCES coverage_kinds(slug) ON DELETE CASCADE,
    row_wikidata_id VARCHAR(20) CHECK (row_wikidata_id ~ '^Q[1-9][0-9]*$'),
    cause VARCHAR(20) NOT NULL CHECK (cause IN ('rule-defect', 'door-missing', 'kind-missing', 'part-of-offered', 'offered-elsewhere', 'not-a-must', 'worth-a-visit')),
    issue_number INTEGER CHECK (issue_number > 0),
    judged DATE NOT NULL,
    note TEXT NOT NULL CHECK (note <> ''),
    CONSTRAINT coverage_judgements_one_subject CHECK ((entry_slug IS NULL) <> (row_wikidata_id IS NULL)),
    CONSTRAINT coverage_judgements_entry_names_kind CHECK ((entry_slug IS NULL) = (kind_slug IS NULL)),
    CONSTRAINT coverage_judgements_cause_owned CHECK (cause NOT IN ('rule-defect', 'door-missing') OR issue_number IS NOT NULL),
    -- An offered row has no door, kind, part or other kind to wait on; an entry a kind lacks is never worth a visit.
    CONSTRAINT coverage_judgements_row_causes CHECK (row_wikidata_id IS NULL OR cause IN ('worth-a-visit', 'not-a-must', 'rule-defect')),
    CONSTRAINT coverage_judgements_entry_causes CHECK (entry_slug IS NULL OR cause <> 'worth-a-visit'),
    CONSTRAINT coverage_judgements_entry FOREIGN KEY (region_slug, entry_slug) REFERENCES coverage_expectations(region_slug, slug) ON DELETE CASCADE,
    CONSTRAINT coverage_judgements_filing FOREIGN KEY (region_slug, entry_slug, kind_slug) REFERENCES coverage_expectation_kinds(region_slug, expectation_slug, kind_slug) ON DELETE CASCADE
);

-- A subject is judged once: one line per entry and kind, one per catalogue row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coverage_judgements_entry
    ON coverage_judgements(region_slug, entry_slug, kind_slug) WHERE entry_slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_coverage_judgements_row
    ON coverage_judgements(region_slug, row_wikidata_id) WHERE row_wikidata_id IS NOT NULL;

COMMENT ON TABLE coverage_judgements IS 'A gap the coverage report found, judged once by cause, loaded from db/catalogue-coverage/judgements.jsonl (ADR-0116). A copy: the file is the source of truth.';
COMMENT ON COLUMN coverage_judgements.entry_slug IS 'The entry of the region''s survey list a live kind does not offer; null when the subject is a catalogue row.';
COMMENT ON COLUMN coverage_judgements.kind_slug IS 'The live kind whose gap is judged: the entry is filed under it and it does not offer the entry. An entry filed under two live kinds has a gap, and a line, per kind.';
COMMENT ON COLUMN coverage_judgements.row_wikidata_id IS 'The catalogue row the region offers and no entry names, by its Wikidata id; null when the subject is an entry.';
COMMENT ON COLUMN coverage_judgements.cause IS 'Why the gap stands, or why the row stays, from the closed vocabulary the report counts by. A rule-defect and a door-missing name their issue. A row takes worth-a-visit, not-a-must or rule-defect; an entry never worth-a-visit.';
COMMENT ON COLUMN coverage_judgements.issue_number IS 'The issue that owns the cause, where one does.';
COMMENT ON COLUMN coverage_judgements.judged IS 'The date the judgement was made, which is the date of the catalogue it was made against.';

-- =============================================================================
-- Schema Complete
-- =============================================================================
